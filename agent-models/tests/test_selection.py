import copy
import io
import json
from datetime import UTC, datetime

import pytest

from agent_models import benchmarks, cli, coverage, decision_context, queries, selection

NOW = datetime(2026, 11, 1, tzinfo=UTC)


def measured(model, effort="medium", score=80, cost=1, seconds=30, **extra):
    return {"model": model, "label": model, "effort": effort, "score": score, "cost": cost,
        "cost_kind": "published", "cost_basis": "USD/test", "seconds": seconds,
        "time_basis": "agent session", "metric": "bugs fixed", "unit": "/105", "tasks": 105,
        "direction": "higher", "harness": "Codex CLI", "harness_version": "1.0",
        "n_runs": 3, "date": "2026-10-31", "configuration": "same repo", "caveat": None, **extra}


@pytest.fixture
def setup(monkeypatch, no_policy_refresh):
    from agent_models import semantic

    monkeypatch.setattr(semantic, "domains", lambda task, **kwargs: [])
    catalog = {"backend": "codex", "observed": "2026-11-01T00:00:00Z", "models": [
        {"id": name, "model": name, "efforts": ["low", "medium", "high", "max"]}
        for name in ("gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna")]}
    rows = [measured(m["id"], effort, score=score, cost=cost, seconds=seconds)
            for m in catalog["models"] for effort, score, cost, seconds in (
                ("low", 50, 0.1, 10), ("medium", 70, 0.3, 20), ("high", 80, 1, 30), ("max", 85, 5, 90))]
    data = {"retrieved": "2026-10-31T00:00:00Z", "sources": {"Bug Hunt": {
        "status": "ok", "url": "https://example.invalid/", "version": "v1", "measurements": rows}}}
    monkeypatch.setattr(benchmarks, "snapshot", lambda: data)
    monkeypatch.setattr(benchmarks, "account_observation", lambda *a, **k: {})
    return data, catalog


def found(catalog, domains=("debugging",), query=""):
    return queries.search(domains, query, catalog=catalog, now=NOW, include_effort=True, complete=True)


def test_all_models_interior_efforts_and_unknowns_survive_without_winner_roles(setup):
    _, catalog = setup
    catalog["models"] += [{"id": f"unfamiliar-{i}", "model": f"unfamiliar-{i}", "efforts": None}
                           for i in range(8)]
    result = selection.suggest(found(catalog), catalog)
    assert len(result["options"]) == 11
    assert result["options"][0]["measured_efforts"] == ["max", "high", "medium", "low"]
    assert all("role" not in row for option in result["options"] for row in option["evidence"])
    assert all("recommended_effort" not in option for option in result["options"])
    unknown = result["options"][-1]
    assert unknown["evidence"] == [] and unknown["coverage"] == {"debugging": 0}
    text = selection.brief(result)
    assert "medium=70 / source $0.3 / 20s" in text and "low=50 / source $0.1 / 10s" in text
    assert "n=3" in text and "tasks=105" in text and "agent session" in text


@pytest.mark.parametrize("backend", decision_context.BACKENDS)
def test_common_rules_across_harnesses_keep_cross_harness_scope(setup, backend):
    data, catalog = setup
    catalog["backend"] = backend
    data["sources"]["Bug Hunt"]["measurements"].append(
        measured("gpt-6.1-sol", "medium", score=100, harness="mini-swe-agent"))
    result = selection.suggest(found(catalog), catalog)
    assert len(result["options"]) == 3
    rows = result["options"][0]["evidence"]
    assert {r["harness"] for r in rows} == {"Codex CLI", "mini-swe-agent"}
    assert any(r["harness_relation"] is False for r in rows)
    assert all(r["score_metric"] == "bugs fixed [/105]" and r["version"] == "v1" for r in rows)


def test_task_context_changes_request_seen_by_agent_without_changing_model_evidence(setup):
    _, catalog = setup
    evidence = found(catalog)
    variants = [
        ("Fix code in a three-line README example", {"scope": "three lines", "verification": "diff review"}),
        ("Fix code in a 20-file concurrent correctness bug", {"scope": "20 files", "failure_cost": "high"}),
        ("Fix code under an interactive deadline", {"deadline": "first useful triage in a minute"}),
        ("Fix code overnight", {"deadline": "overnight", "verification": "repeatable failing test"}),
    ]
    results = [selection.suggest(evidence, catalog, task=task, context={"task": context})
               for task, context in variants]
    assert all(r["options"] == results[0]["options"] for r in results)
    assert len({selection.brief(r) for r in results}) == 4
    assert results[2]["decision_context"]["task"]["deadline"] == "first useful triage in a minute"


def test_account_constraints_admit_only_exact_allowed_luna_and_native_efforts(setup):
    _, catalog = setup
    context = {"allowed_backends": ["codex"], "allowed_routes": {"codex": ["gpt-6-luna"]},
        "allowed_efforts": {"codex": {"gpt-6-luna": ["low", "medium", "nonexistent"]}},
        "accounts": {"codex": {"plan": "free", "billing": "included", "allowance": "unknown"}}}
    result = selection.suggest(found(catalog), catalog, context=context)
    assert [o["id"] for o in result["options"]] == ["gpt-6-luna"]
    option = result["options"][0]
    assert option["admission"] == "caller allowed" and option["efforts"] == ["low", "medium"]
    assert {r["effort"] for r in option["evidence"]} == {"low", "medium"}
    assert option["native_efforts"] == ["low", "medium", "high", "max"]
    context["allowed_routes"]["codex"] = ["luna"]
    assert selection.suggest(found(catalog), catalog, context=context)["options"] == []


def test_resolved_claude_ids_are_proved_bindings_but_opencode_providers_are_exact(setup):
    _, _ = setup
    catalog = {"backend": "claude", "models": [{"id": alias, "model": "claude-sonnet-5-5",
        "efforts": ["medium"]} for alias in ("default", "sonnet")]}
    context = {"allowed_routes": {"claude": ["claude-sonnet-5-5"]}}
    result = selection.suggest(found(catalog), catalog, context=context)
    assert [o["id"] for o in result["options"]] == ["sonnet"]
    catalog = {"backend": "opencode", "models": [
        {"id": provider + "/model", "model": "model", "efforts": ["medium"]}
        for provider in ("opencode", "opencode-go")]}
    context = {"allowed_routes": {"opencode": ["model"]}}
    assert selection.suggest(found(catalog), catalog, context=context)["options"] == []
    context["allowed_routes"]["opencode"] = ["opencode/model"]
    assert [o["id"] for o in selection.suggest(found(catalog), catalog, context=context)["options"]] == [
        "opencode/model"]


def test_prefilter_does_not_confuse_other_exclusions_with_explicit_choice_rejection(setup):
    _, catalog = setup
    context = {"allowed_routes": {"codex": ["gpt-6-luna"]}}
    prepared = decision_context.restrict(catalog, context, "gpt-6-luna")
    result = selection.suggest(found(prepared), prepared, choice="gpt-6-luna", effort="high",
                               context=context)
    assert result["excluded_count"] == 2 and not result["problems"]
    assert result["options"][0]["admission"] == "caller allowed"
    prepared = decision_context.restrict(catalog, context, "gpt-6-astra")
    result = selection.suggest(found(prepared), prepared, choice="gpt-6-astra", context=context)
    assert result["options"] == [] and "excluded by caller" in result["problems"][0]


def test_resolved_native_effort_restrictions_use_the_same_binding_as_route_admission(setup):
    _, catalog = setup
    catalog.update(backend="claude", models=[{"id": "sonnet", "model": "claude-sonnet-5-5",
        "efforts": ["low", "medium", "high"]}])
    context = {"allowed_efforts": {"claude": {"claude-sonnet-5-5": ["medium", "unavailable"]}}}
    prepared = decision_context.restrict(catalog, context)
    assert prepared["models"][0]["efforts"] == ["medium"]
    assert prepared["models"][0]["native_efforts"] == ["low", "medium", "high"]
    twice = decision_context.restrict(prepared, context)
    assert twice["models"][0]["efforts"] == ["medium"]
    assert twice["models"][0]["native_efforts"] == ["low", "medium", "high"]


def test_scarce_or_free_account_prose_never_invents_access_or_a_winner(setup):
    _, catalog = setup
    basic = selection.suggest(found(catalog), catalog)
    scarce = selection.suggest(found(catalog), catalog, context={"accounts": {
        "claude": {"plan": "$20", "allowance": "scarce"}, "codex": {"billing": "included"}}})
    assert [o["id"] for o in basic["options"]] == [o["id"] for o in scarce["options"]]
    assert all(o["admission"] == "conditional: entitlement unknown" for o in scarce["options"])
    catalog["backend"] = "opencode"
    catalog["models"][0].update(id="opencode/deepseek-free", model="gpt-6.1-sol",
        billing_route="free variant", benchmark_model="gpt-6.1-sol")
    evidence = found(catalog)
    for context in ({"priorities": ["zero money", "bounded executable check"]},
                    {"task": {"deadline": "urgent"}, "session": {"context": "Luna already loaded"}}):
        result = selection.suggest(evidence, catalog, context=context)
        assert len(result["options"]) == 3
        assert all("rank" not in o for o in result["options"])
        assert result["options"][0]["evidence"][0]["seconds"] == 90
        assert "selected-route" in result["options"][0]["evidence"][0]["execution_scope"]


def test_exact_choices_do_not_substitute_or_invent_supported_effort(setup):
    _, catalog = setup
    evidence = found(catalog)
    assert selection.suggest(evidence, catalog, choice="sol")["options"] == []
    result = selection.suggest(evidence, catalog, choice="gpt-6-luna", effort="ultra")
    assert [o["id"] for o in result["options"]] == ["gpt-6-luna"]
    assert result["options"][0]["admission"].startswith("excluded")
    assert "no substitution" in " ".join(result["options"][0]["problems"])
    catalog["models"][2]["efforts"] = None
    result = selection.suggest(found(catalog), catalog, choice="gpt-6-luna", effort="medium")
    assert result["options"][0]["efforts"] is None
    assert result["options"][0]["admission"].startswith("excluded")


def test_exact_effort_exposes_other_effort_evidence_with_its_scope(setup):
    data, catalog = setup
    data["sources"]["Bug Hunt"]["measurements"] = [measured("gpt-6-luna", "max")]
    result = selection.suggest(found(catalog), catalog, choice="gpt-6-luna", effort="high")
    option = result["options"][0]
    assert option["coverage"] == {"debugging": 0} and not option["evidence"]
    assert option["other_effort_evidence"][0]["effort"] == "max"
    text = selection.brief(result)
    assert "not a direct measurement at this effort" in text
    assert "debugging/Bug Hunt" in text and "max=80" in text and "Codex CLI" in text


def test_exact_effort_also_shows_tradeoffs_when_it_has_its_own_evidence(setup):
    _, catalog = setup
    result = selection.suggest(found(catalog), catalog, choice="gpt-6-luna", effort="high")
    text = selection.brief(result)
    assert "high=80" in text and "max=85" in text and "low=50" in text
    assert "not a direct measurement at this effort" in text


def test_unknown_or_excluded_measurements_cannot_establish_published_bounds(setup):
    data, catalog = setup
    catalog["models"].append({"id": "new-model", "model": "new-model", "efforts": ["low"]})
    for row in data["sources"]["Bug Hunt"]["measurements"]:
        row.update(seconds=None, cost=None)
    result = selection.suggest(found(catalog), catalog, max_usd=1, max_seconds=10)
    assert result["options"] == []
    explicit = selection.suggest(found(catalog), catalog, choice="new-model", max_usd=1)
    assert explicit["options"][0]["admission"].startswith("excluded")
    with pytest.raises(ValueError):
        selection.suggest(found(catalog), catalog, max_seconds=float("nan"))


def test_cli_rejects_invalid_bound_before_inventory(setup, monkeypatch, capsys):
    monkeypatch.setattr(cli.inventory, "catalog", lambda *args: pytest.fail("inventory should not run"))
    monkeypatch.setattr(cli.sys, "argv", ["model-guide", "suggest", "--max-seconds", "-1"])
    assert cli.main() == 1
    assert "--max-seconds must be a finite nonnegative number" in capsys.readouterr().err


def test_source_failure_does_not_remove_models_or_mark_quality_as_zero(setup):
    data, catalog = setup
    data["sources"] = {"Bug Hunt": {"status": "unavailable", "error": "offline"}}
    result = selection.suggest(found(catalog), catalog)
    assert len(result["options"]) == 3 and all(o["evidence"] == [] for o in result["options"])
    assert "source unavailable; model ability unknown" in " ".join(result["notes"])


def test_invalid_retained_speed_source_is_isolated_without_losing_native_candidates(setup):
    data, catalog = setup
    data["sources"]["Artificial Analysis"] = {"status": "ok", "raw": {"status": 200.0, "data": []},
                                               "measurements": []}
    result = selection.suggest(found(catalog), catalog)
    assert len(result["options"]) == 3
    assert all(o["coverage"]["debugging"] for o in result["options"])
    assert result["sources"]["debugging/Artificial Analysis"]["status"] == "unavailable"


def test_speed_keeps_raw_zero_scope_and_all_efforts_without_inventing_task_duration(setup):
    data, catalog = setup
    data["sources"]["Artificial Analysis"] = {"status": "ok", "version": "legacy", "measurements": [
        measured("gpt-6-luna", level, cost=None, seconds=None, harness=None,
            metric="artificial_analysis_intelligence_index", model_metadata={"release_date": "2026-09-23"},
            speed={"median_output_tokens_per_second": tps, "median_time_to_first_token_seconds": ttft,
                   "provider": provider, "workload": {"prompt_length": 1000},
                   "methodology_version": "legacy unknown"})
        for level, tps, ttft, provider in (("low", 0, 0, None), ("medium", 100, 1, "provider-a"),
                                          ("high", 120, 90, "provider-b"))]}
    result = selection.suggest(found(catalog), catalog)
    option = result["options"][2]
    rows = [r for r in option["evidence"] if r["source"] == "Artificial Analysis"]
    assert {r["effort"] for r in rows} == {"low", "medium", "high"}
    assert all(r["seconds"] is None for r in rows)
    assert {r["speed"]["provider"] for r in rows} == {None, "provider-a", "provider-b"}
    text = selection.brief(result)
    assert "reported 0; validity unknown" in text and "120 tokens/s, 90 s TTFT" in text
    assert rows[0]["model_metadata"]["release_date"] == "2026-09-23"


@pytest.mark.parametrize("query,label", [("deepseek", "opencode/deepseek-v4.1-flash-free"),
    ("deep flash", "opencode-go/deepseek-v4.1-flash"), ("glm", "GLM-5.3-Flash"),
    ("Luna", "gpt-6-luna"), ("gpt sol", "gpt-6.1-sol")])
def test_flexible_discovery_is_not_exact_admission(query, label):
    assert coverage.query_matches(query, label)
    assert not coverage.query_matches("gpt-6.1", "gpt-6.10-sol")


def test_query_limits_unknowns_and_preserves_explicit_native_choice(setup):
    _, catalog = setup
    catalog["models"] += [{"id": name, "model": name, "efforts": None}
                           for name in ("unknown-model", "unrelated-model")]
    result = selection.suggest(found(catalog, query="unknown"), catalog)
    assert [o["id"] for o in result["options"]] == ["unknown-model"]


def test_inventory_pages_do_not_imply_model_ranking(setup):
    _, catalog = setup
    catalog["models"] += [{"id": f"new-{i}", "model": f"new-{i}", "efforts": None} for i in range(30)]
    result = selection.suggest(found(catalog), catalog)
    page = selection.brief(result, limit=5, offset=4)
    assert page.count("- codex:") == 5 and "Continue: --limit 5 --offset 9" in page


def test_context_validation_rejects_unknown_coercions_duplicates_and_oversize(tmp_path):
    for value in ([], {"allowed_backends": "codex"}, {"allowed_backends": ["other"]},
                  {"allowed_routes": {"codex": ["a", "a"]}}, {"task": {"difficulty_score": 4}}):
        with pytest.raises(ValueError):
            decision_context.validate(value)
    with pytest.raises(ValueError):
        decision_context.read("-", io.StringIO('{"task":{},"task":{}}'))
    path = tmp_path / "context.json"
    path.write_text(" " * (decision_context.MAX_BYTES + 1))
    with pytest.raises(ValueError, match="64 KiB"):
        decision_context.read(str(path), io.StringIO())


def test_context_display_does_not_truncate_late_operative_constraints():
    constraint = "The account has a limited allowance. " * 10 + "Only Luna is permitted."
    assert constraint in "\n".join(selection.context_lines({"accounts": {"codex": {
        "allowance": constraint}}}))


def test_cli_default_cross_harness_partial_failure_and_luna_only_context(setup, monkeypatch, capsys):
    _, catalog = setup
    called = []

    def native(backend, account):
        called.append(backend)
        if backend == "agy":
            raise RuntimeError("offline")
        result = copy.deepcopy(catalog)
        result["backend"] = backend
        return result

    monkeypatch.setattr(cli.inventory, "catalog", native)
    args = ["model-guide", "suggest", "--task", "Fix code with failing tests", "--json"]
    monkeypatch.setattr(cli.sys, "argv", args)
    assert cli.main() == 0
    result = json.loads(capsys.readouterr().out)
    assert set(called) == set(decision_context.BACKENDS)
    assert len(result["options"]) == 9 and result["inventory_failures"]["agy"]["stage"] == "inventory"
    monkeypatch.setattr(cli.sys, "stdin", io.StringIO(json.dumps({"allowed_backends": ["codex"],
        "allowed_routes": {"codex": ["gpt-6-luna"]}, "task": {"scope": "three lines"}})))
    monkeypatch.setattr(cli.sys, "argv", args + ["--context", "-"])
    assert cli.main() == 0
    result = json.loads(capsys.readouterr().out)
    assert [o["id"] for o in result["options"]] == ["gpt-6-luna"]


def test_cross_backend_comparison_uses_one_captured_snapshot(setup, monkeypatch, capsys):
    data, catalog = setup
    snapshots, seen = [], []
    monkeypatch.setattr(benchmarks, "snapshot", lambda: snapshots.append(1) or data)
    monkeypatch.setattr(cli.inventory, "catalog", lambda backend, account: {**catalog, "backend": backend})
    original = queries.search

    def search(*args, **kwargs):
        seen.append(kwargs["data"])
        return original(*args, **kwargs)

    monkeypatch.setattr(cli.queries, "search", search)
    monkeypatch.setattr(cli.sys, "argv", ["model-guide", "suggest", "--task", "Fix code", "--json"])
    assert cli.main() == 0
    capsys.readouterr()
    assert snapshots == [1] and len(seen) == 4 and all(value is data for value in seen)


def test_allowance_linkage_uses_exact_reported_membership_not_pool_name_or_equal_values(
        setup, monkeypatch, capsys):
    _, catalog = setup
    monkeypatch.setattr(cli.inventory, "catalog", lambda *a: catalog)
    windows = [{"label": "native pool", "remaining_percent": 90, "group": "Luna and friends",
        "limit": "weekly", "resets": None, "model_ids": models}
        for models in (None, ["gpt-6-luna"], ["gpt-6.1-sol"])]
    monkeypatch.setattr(benchmarks, "account_observation", lambda *a, **k: {"profiles": {}, "errors": [],
        "quotas": [{"backend": "codex", "account": "01", "freshness": "fresh", "windows": windows}]})
    monkeypatch.setattr(cli.sys, "argv", ["model-guide", "suggest", "--backend", "codex", "--json"])
    assert cli.main() == 0
    result = json.loads(capsys.readouterr().out)
    luna = next(o for o in result["options"] if o["id"] == "gpt-6-luna")
    assert luna["allowance_links"] == [{"account_index": 0, "window_indices": [1]}]
    assert "empty links mean unknown" in result["backends"]["codex"]["allowance_link_scope"]


def test_unknown_task_text_is_preserved_and_falls_back_to_broad_retrieval(setup, monkeypatch, capsys):
    from agent_models import semantic

    monkeypatch.setattr(semantic, "domains", lambda task, **kwargs: [])
    _, catalog = setup
    monkeypatch.setattr(cli.inventory, "catalog", lambda *a: catalog)
    task = "Straighten the explanation without changing its meaning"
    monkeypatch.setattr(cli.sys, "argv", ["model-guide", "suggest", "--backend", "codex", "--task", task])
    assert cli.main() == 0
    text = capsys.readouterr().out
    assert task in text and "Inferred focus: unclear" in text
    assert queries.resolve(["coding"], task)["domains"] == ["coding"]


def test_inferred_focus_never_hides_other_task_evidence(setup, monkeypatch, capsys):
    _, catalog = setup
    monkeypatch.setattr(cli.inventory, "catalog", lambda *args: catalog)
    monkeypatch.setattr(cli.sys, "argv", ["model-guide", "suggest", "--backend", "codex",
                                         "--task", "improve typography", "--json"])
    assert cli.main() == 0
    result = json.loads(capsys.readouterr().out)
    assert result["task_routing"]["focus_domains"] == ["design"]
    assert "debugging" in result["domains"]
    assert any(row["domain"] == "debugging" for row in result["options"][0]["evidence"])


def test_multiple_cohorts_cannot_hide_requested_performance_or_browser_evidence(setup):
    data, catalog = setup
    data["sources"]["Bug Hunt"]["measurements"] += [measured("gpt-6-luna", configuration=str(i))
                                                    for i in range(10)]
    data["sources"]["KernelBench.com"] = {"status": "ok", "measurements": [
        measured("gpt-6-luna", metric="latency us", direction="lower", score=20, seconds=100)]}
    data["sources"]["OSWorld"] = {"status": "ok", "measurements": [
        measured("gpt-6-luna", metric="desktop success", score=30)]}
    result = selection.suggest(found(catalog, domains=["debugging", "performance", "browser"]), catalog)
    text = selection.brief(result)
    assert "performance/KernelBench.com" in text and "browser/OSWorld" in text
    assert "scoped evidence groups in --json" in text


def test_cli_prefilters_before_queries_and_empty_backend_restriction_launches_nothing(
        setup, monkeypatch, capsys):
    _, catalog = setup
    calls = []
    monkeypatch.setattr(cli.inventory, "catalog", lambda *a: calls.append(a) or catalog)
    real_search = queries.search

    def restricted_search(*args, **kwargs):
        assert [m["id"] for m in args[3]["models"]] == ["gpt-6-luna"]
        return real_search(*args, **kwargs)

    monkeypatch.setattr(cli.queries, "search", restricted_search)
    monkeypatch.setattr(cli.sys, "argv", ["model-guide", "suggest", "--context", "-", "--json"])
    monkeypatch.setattr(cli.sys, "stdin", io.StringIO(json.dumps({"allowed_backends": ["codex"],
        "allowed_routes": {"codex": ["gpt-6-luna"]}})))
    assert cli.main() == 0
    assert len(json.loads(capsys.readouterr().out)["options"]) == 1
    calls.clear()
    monkeypatch.setattr(cli.sys, "stdin", io.StringIO('{"allowed_backends":[]}'))
    assert cli.main() == 0 and not calls
    assert json.loads(capsys.readouterr().out)["options"] == []


def test_vision_and_computer_use_domains_remain_distinct():
    routing = queries.resolve(["vision", "browser"], "Use screenshots to control the desktop GUI")
    assert routing["domains"] == ["vision", "browser"]


def test_domain_limits_survive_even_when_other_warnings_are_long(setup):
    _, catalog = setup
    result = selection.suggest(found(catalog, domains=["debugging", "backend"]), catalog)
    result["notes"] = [f"source {i} unavailable" for i in range(10)] + result["notes"]
    text = selection.brief(result)
    assert "not production incident diagnosis" in text
    assert "database design, security and service architecture are not directly measured" in text
    assert "more evidence warnings in --json" in text
