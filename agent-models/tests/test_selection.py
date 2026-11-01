import copy
import json
from datetime import UTC, datetime

import pytest

from agent_models import benchmarks, cli, coverage, queries, reference, selection

NOW = datetime(2026, 11, 1, tzinfo=UTC)


@pytest.fixture
def setup(monkeypatch, tmp_path):
    (tmp_path / "models.md").write_text("| small | Luna | Haiku | Flash |\n"
                                       "| mid | Terra | Sonnet | Unverified |\n"
                                       "| high | Sol | Opus | Unverified |\n"
                                       "| top | Astra | Fable | Argon |\n")
    monkeypatch.setattr(reference, "GUIDES", tmp_path)
    catalog = {"backend": "codex", "models": [
        {"id": "gpt-6.1-sol", "model": "gpt-6.1-sol", "efforts": ["high"]},
        {"id": "gpt-6-astra", "model": "gpt-6-astra", "efforts": ["high"]},
        {"id": "gpt-6-luna", "model": "gpt-6-luna", "efforts": ["high"]},
    ]}
    data = {"retrieved": "2026-10-31T00:00:00Z", "sources": {
        "LiveBench": {"status": "ok", "url": "https://livebench.ai/", "release": "20261025",
            "efforts": {m["id"]: "high" for m in catalog["models"]}, "points": {
                "Coding": [{"model": m["id"], "score": score, "cost": cost}
                           for m, score, cost in zip(catalog["models"], (95, 90, 70), (1, 10, 0.1))],
                "Design": [{"model": m["id"], "score": score, "cost": cost}
                           for m, score, cost in zip(catalog["models"], (80, 98, 70), (1, 10, 0.1))],
            }}}}
    data["sources"]["LiveBench"]["points"]["Overall"] = copy.deepcopy(
        data["sources"]["LiveBench"]["points"]["Coding"])
    monkeypatch.setattr(benchmarks, "snapshot", lambda: data)
    return data, catalog


def test_ui_refactor_maps_to_multiple_domains_and_unknown_tasks_need_help():
    assert queries.domains(task="Refactor the UI layout and tests") == ["design", "coding"]
    assert queries.domains(task="Optimize a CUDA GPU kernel") == ["performance"]
    assert queries.domains(task="Find and fix hidden bugs") == ["coding", "debugging"]
    assert queries.domains(task="Refactor a React component") == ["design", "coding"]
    assert queries.domains(task="Debug a Linux kernel panic") == ["coding", "debugging", "performance"]
    assert queries.domains(task="Write unit tests") == ["coding"]
    assert queries.domains(["coding", "design", "coding"], "GPU work") == ["coding", "design"]
    with pytest.raises(ValueError, match="mapping Unverified"):
        queries.domains(task="help with this project")


def test_partial_names_aliases_and_versions_do_not_loan_other_models(setup):
    assert coverage.query_matches("sol", "GPT-6.1 Sol")
    assert coverage.query_matches("gpt-6.1", "gpt-6.1-sol")
    assert not coverage.query_matches("gpt-6.1", "gpt-6.10-sol")
    assert coverage.matches({"model": "deepseek-v4.1-flash-1017"}, "DeepSeek V4.1 Flash (1017)")
    assert not coverage.matches({"model": "deepseek-v4.1-flash"}, "DeepSeek V4.1 Flash (1017)")
    assert coverage.matches({"model": "deepseek-v4.1-flash-1017"},
                            "deepseek/deepseek-v4.1-flash-1017")
    assert coverage.supported({"efforts": ["high"]}, "DeepSeek V4.1 Flash (1017)") is None
    for annotation in ("Vision", "Beta", "FP8", "NVFP4", "v1"):
        assert coverage.setting(f"Example ({annotation})") is None
        assert not coverage.matches({"model": "Example"}, f"Example ({annotation})")
    data, _ = setup
    data["sources"]["LiveBench"]["points"]["Coding"][0]["model"] = "claude-sonnet-5.5"
    data["sources"]["LiveBench"]["efforts"]["claude-sonnet-5.5"] = "high"
    native = {"backend": "claude", "models": [
        {"id": "sonnet", "model": "claude-sonnet-5-5", "efforts": ["high"]}]}
    found = queries.search(["coding"], "sonnet", catalog=native, now=NOW)
    assert found["coding"]["sources"]["LiveBench"]["results"][0]["model"] == "claude-sonnet-5.5"


def test_explicit_native_bundled_setting_matches_without_inventing_an_effort_control(setup):
    data, _ = setup
    data["sources"]["LiveBench"]["points"]["Coding"] = [
        {"model": "Gemini 3.8 Flash (High)", "score": 90, "cost": 1}]
    data["sources"]["LiveBench"]["points"]["Overall"] = copy.deepcopy(
        data["sources"]["LiveBench"]["points"]["Coding"])
    catalog = {"backend": "agy", "models": [{"id": "gemini-3.8-flash-high",
                "model": "gemini-3.8-flash-high", "efforts": None}]}
    found = queries.search(["coding"], "flash", catalog=catalog, now=NOW)["coding"]
    assert found["sources"]["LiveBench"]["results"][0]["score"] == 90
    assert coverage.summarize(catalog, data)["models"][0]["coverage"] == "matched"
    assert not coverage.matches(catalog["models"][0], "Gemini 3.8 Flash (Low)")
    assert coverage.supported(catalog["models"][0], "Gemini 3.8 Flash (High)") is None


def test_multi_domain_shortlist_reports_conflict_and_preserves_cheap_alternative(setup):
    _, catalog = setup
    evidence = queries.search(["coding", "design"], catalog=catalog, now=NOW)
    result = selection.suggest(evidence, catalog)
    assert result == selection.suggest(evidence, catalog)
    ids = {r["id"] for r in result["shortlist"]}
    assert ids == {m["id"] for m in catalog["models"]}
    assert any("conflicting" in n for n in result["notes"])
    assert all(r["recommended_effort"] is None and r["measured_efforts"] == ["high"]
               for r in result["shortlist"])
    assert "cheapest" in selection.brief(result)
    assert "effort: measured only at high" in selection.brief(result)
    assert "0.1" in selection.brief(result)


def test_equal_scores_keep_tied_alternatives_instead_of_breaking_tie_by_name(setup):
    data, catalog = setup
    data["sources"]["LiveBench"]["points"]["Coding"][1]["score"] = 95
    result = selection.suggest(queries.search(["coding"], catalog=catalog, now=NOW), catalog)
    assert any("tied" in n for n in result["notes"])
    assert {r["id"] for r in result["shortlist"]} >= {"gpt-6.1-sol", "gpt-6-astra"}


def test_effort_filter_runs_before_ranking_and_unknown_controls_are_explicit(setup):
    data, catalog = setup
    data["sources"]["LiveBench"]["efforts"]["gpt-6.1-sol"] = "max"
    found = queries.search(["coding"], catalog=catalog, now=NOW)
    assert found["coding"]["unsupported_effort_count"] == 1
    assert found["coding"]["sources"]["LiveBench"]["results"][0]["model"] == "gpt-6-astra"
    catalog["models"][0]["efforts"] = None
    result = selection.suggest(queries.search(["coding"], catalog=catalog, now=NOW), catalog)
    sol = next(r for r in result["shortlist"] if r["id"] == "gpt-6.1-sol")
    assert sol["recommended_effort"] is None and "Unverified" in " ".join(sol["problems"])
    model = {"efforts": ["high"]}
    assert coverage.supported(model, "Gemini 4 Argon (High)") is True
    assert coverage.supported(model, "Gemini 4 Argon (High)", None) is None


def test_explicit_choice_is_never_replaced_when_unavailable_or_unsupported(setup):
    _, catalog = setup
    evidence = queries.search(["coding"], catalog=catalog, now=NOW)
    missing = selection.suggest(evidence, catalog, choice="not-installed")
    assert missing["shortlist"] == [] and "no substitution" in missing["problems"][0]
    selected = selection.suggest(evidence, catalog, choice="sol", effort="max", max_usd=0.01)
    assert [r["id"] for r in selected["shortlist"]] == ["gpt-6.1-sol"]
    assert selected["shortlist"][0]["requested_effort"] == "max"
    assert selected["shortlist"][0]["recommended_effort"] is None
    assert any("unsupported" in p for p in selected["shortlist"][0]["problems"])


def test_unknown_latency_and_class_cannot_satisfy_a_constraint(setup):
    _, catalog = setup
    evidence = queries.search(["coding"], catalog=catalog, now=NOW)
    assert selection.suggest(evidence, catalog, max_seconds=2)["shortlist"] == []
    constrained = selection.suggest(evidence, catalog, minimum_class="top")
    assert [r["id"] for r in constrained["shortlist"]] == ["gpt-6-astra"]
    with pytest.raises(ValueError):
        selection.suggest(evidence, catalog, max_usd=float("nan"))
    assert selection.model_class({"model": "gpt-6-solarium"}) is None
    assert selection.model_class({"model": "other-vendor/sol"}) is None


def test_recommended_effort_preserves_the_native_control_identifier(setup):
    data, catalog = setup
    catalog["models"][0]["efforts"] = ["HIGH", "max"]
    data["sources"]["Artificial Analysis"] = {"status": "ok", "effort_tradeoffs": [{
        "model": "GPT-6.1 Sol", "configuration": "", "from": "high", "to": "max",
        "before": {"Artificial Analysis Intelligence Index": 95, "Cost per Task USD": 4},
        "after": {"Artificial Analysis Intelligence Index": 100, "Cost per Task USD": 10},
    }]}
    result = selection.suggest(queries.search(["coding"], catalog=catalog, now=NOW,
                                              include_effort=True), catalog)
    sol = next(r for r in result["shortlist"] if r["id"] == "gpt-6.1-sol")
    assert sol["recommended_effort"] is None
    assert sol["effort_evidence"][0]["quality"] == ["max"]
    assert sol["effort_evidence"][0]["value"] == ["HIGH"]
    assert sol["effort_evidence"][0]["score_fraction"] == 0.95
    assert sol["effort_evidence"][0]["cost_fraction"] == 0.4
    text = selection.brief(result)
    assert "quality: max; value: HIGH, 95% of score at 40% cost" in text
    assert "domain-specific effort gains Unverified" in text


@pytest.mark.parametrize("task,expected", [
    ("fix a flaky failing test", ["coding", "debugging"]),
    ("Find a bug in the parser", ["coding", "debugging"]),
    ("Debug a race condition", ["coding", "debugging"]),
    ("Investigate a regression", ["coding", "debugging"]),
    ("Fix failing tests after a refactor", ["coding", "debugging"]),
    ("Optimize CUDA kernel throughput", ["performance"]),
    ("Profile inference latency", ["performance"]),
    ("Optimize cache locality", ["performance"]),
])
def test_realistic_task_routing(task, expected):
    assert queries.domains(task=task) == expected


def test_claude_aliases_resolve_once_without_merging_provider_routes(setup):
    data, _ = setup
    source = data["sources"]["LiveBench"]
    source["points"]["Coding"] = [{"model": "claude-opus-5.5", "score": 95, "cost": 1}]
    source["efforts"] = {"claude-opus-5.5": "high"}
    catalog = {"backend": "claude", "models": [
        {"id": alias, "model": "claude-opus-5-5", "efforts": ["high"]} for alias in ("default", "opus")]}
    result = selection.suggest(queries.search(["coding"], catalog=catalog, now=NOW), catalog)
    assert len(result["shortlist"]) == 1 and result["shortlist"][0]["id"] == "opus"
    assert selection.brief(result).count("alias opus") == 1
    explicit = selection.suggest(queries.search(["coding"], catalog=catalog, now=NOW), catalog,
                                 choice="default")
    assert explicit["shortlist"][0]["id"] == "default"
    routes = {"backend": "opencode", "models": [
        {"id": p + "/claude-opus-5-5", "model": "claude-opus-5-5", "efforts": ["high"]}
        for p in ("provider-a", "provider-b")]}
    assert len(coverage.canonical_catalog(routes)["models"]) == 2


def test_brief_collapses_roles_and_keeps_score_and_cost_metrics_separate(setup):
    _, catalog = setup
    result = selection.suggest(queries.search(["design", "coding"], catalog=catalog, now=NOW), catalog)
    text = selection.brief(result)
    assert "Design score=" in text and "cost " in text
    assert "; estimated USD" not in text
    for line in text.splitlines():
        if line.startswith("- "):
            assert line.count("design:") <= 1 and line.count("coding:") <= 1
    assert all(not option["problems"] for option in result["shortlist"])


def test_measured_context_keeps_requested_domain_order(setup):
    _, catalog = setup
    evidence = queries.search(["design", "coding", "backend"], catalog=catalog, now=NOW)
    result = selection.suggest(evidence, catalog)
    astra = next(option for option in result["shortlist"] if option["id"] == "gpt-6-astra")
    assert list(dict.fromkeys(r["domain"] for r in astra["tradeoffs"])) == ["design", "coding", "backend"]


def test_a_single_measured_effort_is_not_recommended_as_a_default(setup):
    data, catalog = setup
    source = data["sources"]["LiveBench"]
    source["efforts"] = {m["id"]: "max" for m in catalog["models"]}
    for model in catalog["models"]:
        model["efforts"] = ["high", "max"]
    result = selection.suggest(queries.search(["coding"], catalog=catalog, now=NOW), catalog)
    assert all(option["recommended_effort"] is None for option in result["shortlist"])
    assert "effort: measured only at max" in selection.brief(result)
    assert "recommend max" not in selection.brief(result)


def test_effort_cost_ties_do_not_invent_a_recommended_setting():
    from agent_models import effort

    model = {"efforts": ["high", "max"]}
    rows = [{"model": "Example", "effort": level, "score": 100, "cost": 1, "direction": "higher"}
            for level in model["efforts"]]
    plan = effort.knee(rows, "test curve", model)
    assert plan["setting"] is None and "tie" in plan["explanation"]


def test_effort_display_does_not_round_a_below_threshold_point_up_to_the_target():
    from agent_models import effort

    model = {"efforts": ["high", "max"]}
    rows = [{"model": "Example", "effort": level, "score": score, "cost": cost, "direction": "higher"}
            for level, score, cost in (("high", 94.5, 4), ("max", 100, 10))]
    plan = effort.knee(rows, "test curve", model)
    assert plan["setting"] is None and plan["quality"] == ["max"] and plan["value"] == ["high"]
    assert "94.5% of score at 40% cost" in plan["explanation"]


def test_stale_missing_and_unavailable_evidence_are_reported(setup):
    data, catalog = setup
    data["retrieved"] = "2026-01-01T00:00:00Z"
    data["sources"]["Vals Terminal-Bench"] = {"status": "unavailable", "error": "offline"}
    found = queries.search(["coding", "performance"], catalog=catalog, now=NOW)
    assert any("Stale snapshot" in n for n in found["coding"]["warnings"])
    assert any("KernelBench.com" in n for n in found["performance"]["warnings"])
    result = selection.suggest(found, catalog)
    assert any("unavailable" in n for n in result["notes"])
    assert all("performance" in " ".join(r["problems"]) for r in result["shortlist"])


def test_native_availability_and_unrounded_cost_bounds_are_applied_before_selection(setup):
    data, catalog = setup
    rows = data["sources"]["LiveBench"]["points"]["Coding"]
    rows.insert(0, {"model": "unavailable-super-model", "score": 100, "cost": 0.01})
    rows[1]["cost"] = 0.123949
    evidence = queries.search(["coding"], catalog=catalog, now=NOW)
    assert all(r["model"] != "unavailable-super-model"
               for r in evidence["coding"]["sources"]["LiveBench"]["results"])
    constrained = selection.suggest(evidence, catalog, max_usd=0.12392)
    assert "gpt-6.1-sol" not in {r["id"] for r in constrained["shortlist"]}


def test_overlapping_preference_intervals_and_allowance_pressure_keep_alternatives(setup):
    data, catalog = setup
    data["sources"]["Arena/webdev"] = {"status": "ok", "url": "https://arena.ai/",
        "published": "2026-10-31", "rows": [
            {"model_name": "GPT-6 Astra (High)", "rank": 1,
             "rating": 100, "rating_lower": 95, "rating_upper": 105},
            {"model_name": "GPT-6.1 Sol (High)", "rank": 2,
             "rating": 98, "rating_lower": 93, "rating_upper": 103},
        ]}
    result = selection.suggest(queries.search(["design"], catalog=catalog, now=NOW), catalog, pressure=True)
    assert result["shortlist"][0]["id"] == "gpt-6-luna"
    assert len(result["shortlist"]) > 1
    assert any("overlapping intervals" in n for n in result["notes"])


def test_suggest_cli_defaults_to_brief_and_supports_json(setup, monkeypatch, capsys):
    _, catalog = setup
    monkeypatch.setattr(cli.inventory, "catalog", lambda *a: catalog)
    monkeypatch.setattr(benchmarks, "account_observation", lambda *a: {})
    args = ["model-guide", "suggest", "--backend", "codex", "--task", "UI refactor"]
    monkeypatch.setattr(cli.sys, "argv", args)
    assert cli.main() == 0 and "no automatic pick" in capsys.readouterr().out
    monkeypatch.setattr(cli.sys, "argv", args + ["--json"])
    assert cli.main() == 0
    assert json.loads(capsys.readouterr().out)["domains"] == ["design", "coding"]
    monkeypatch.setattr(cli.sys, "argv", ["model-guide", "benchmarks", "--backend", "codex",
                                         "--account", "another-account"])
    with pytest.raises(SystemExit):
        cli.main()


def test_conflicting_harnesses_never_merge_or_lend_a_native_score(setup):
    data, catalog = setup
    template = {"model": "gpt-6.1-sol", "label": "Sol", "effort": "high", "metric": "bugs fixed",
                "score": 20, "unit": "/105", "direction": "higher", "tasks": 105,
                "cost": 1, "cost_kind": "list", "seconds": 30, "date": "2026-10-01", "caveat": None,
                "harness_version": "1.0", "n_runs": 1}
    data["sources"]["Bug Hunt"] = {"status": "ok", "measurements": [
        {**template, "harness": "Codex CLI"},
        {**template, "harness": "mini-swe-agent", "score": 100, "cost": 0.01}]}
    result = selection.suggest(queries.search(["debugging"], catalog=catalog, now=NOW), catalog)
    facts = result["shortlist"][0]["tradeoffs"]
    assert all(r["score"] == 20 and r["harness"] == "Codex CLI" for r in facts)
    data["sources"]["Bug Hunt"]["measurements"].pop(0)
    result = selection.suggest(queries.search(["debugging"], catalog=catalog, now=NOW), catalog)
    assert "other harness: mini-swe-agent" in selection.brief(result)
    assert "bugs fixed 100/105 (mean of 1 run)" in selection.brief(result)


def test_performance_never_calls_singletons_on_different_tasks_leaders(setup):
    data, catalog = setup
    template = {"label": "test", "effort": "high", "score": 10, "unit": "% roofline",
                "direction": "higher", "tasks": 1, "cost": None, "cost_kind": None,
                "seconds": None, "date": None, "caveat": None, "harness": "Codex CLI"}
    data["sources"]["KernelBench.com"] = {"status": "ok", "measurements": [
        {**template, "model": "gpt-6-astra", "metric": "operation A / H100"},
        {**template, "model": "gpt-6.1-sol", "metric": "operation B / RTX"}]}
    result = selection.suggest(queries.search(["performance"], catalog=catalog, now=NOW), catalog)
    assert not any(r["role"] == "quality leader" for o in result["shortlist"] for r in o["tradeoffs"])
    assert "leads 0 of 0 comparable tasks" in selection.brief(result)
