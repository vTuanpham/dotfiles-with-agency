from agent_models import comparison


def option(name, score=None, cost=None, seconds=None, *, backend="codex", billing="subscription"):
    return {
        "model": name,
        "id": name,
        "backend": backend,
        "billing_route": billing,
        "privacy_gate": "native",
        "admission": "caller allowed",
        "efforts": ["high"],
        "aliases": [name],
        "evidence": []
        if score is None
        else [
            {
                "domain": "debugging",
                "source": "Example",
                "score_metric": "correct",
                "score": score,
                "cost": cost,
                "seconds": seconds,
                "effort": "high",
                "direction": "higher",
                "cost_kind": "run",
                "speed": None,
            }
        ],
    }


def result(options, **extra):
    return {"options": options, "domains": ["debugging"], "decision_context": {}, **extra}


def test_intermediate_tradeoff_and_free_route_survive_small_comparison():
    data = comparison.portfolio(
        result(
            [
                option("cheap", 20, 1, 30),
                option("balanced", 60, 3, 20),
                option("strong", 90, 9, 60),
                option("other", 10, 4, 40, backend="opencode", billing="free"),
            ]
        ),
        size=4,
    )
    rows = {row["model"]: row for row in data["models"]}
    assert any("intermediate" in reason for reason in rows["balanced"]["reasons"])
    assert rows["other"]["routes"][0]["billing_route"] == "free"
    assert data["model_count"] == 4
    rendered = comparison.render(result([option("cheap", 20, 1, 30),
                                         option("strong", 90, 9, 60)]))
    assert "Example observed quality" in rendered
    assert "Native effort choices: codex:cheap=high" in rendered


def test_compact_comparison_keeps_account_evidence_and_errors():
    account = {"backend": "codex", "account": "01", "freshness": "fresh", "windows": [{
        "label": "weekly", "remaining_percent": 15, "window_minutes": 10080,
        "resets": "2026-11-15T00:00:00Z", "pool_id": "native-id", "model_ids": ["model"],
    }]}
    data = result([option("model")], backends={"codex": {"account_observation": {
        "quotas": [account], "errors": ["one source unavailable"], "profiles": {}, "scope": "cached",
    }}})
    rendered = comparison.render(data)
    assert "2026-11-15T00:00:00Z" in rendered and "pool=native-id models=model" in rendered
    assert "one source unavailable" in rendered


def test_route_gets_only_explicit_native_model_pool_binding():
    item = option("model")
    item["allowance_links"] = [{"account_index": 0, "window_indices": [0]}]
    account = {"backend": "codex", "account": "01", "freshness": "fresh", "windows": [{
        "label": "weekly", "remaining_percent": 15, "window_minutes": 10080,
        "resets": "2026-11-15T00:00:00Z", "pool_id": "native-id", "model_ids": ["model"],
    }]}
    data = result([item], backends={"codex": {"account_observation": {
        "quotas": [account], "errors": [], "profiles": {}, "scope": "cached",
    }}})
    text = comparison.render(data)
    assert "codex:model · 01 weekly: 15% remaining" in text
    item["allowance_links"] = []
    assert "codex:model · 01 weekly: 15% remaining" not in comparison.render(data)


def test_current_unmeasured_session_and_each_harness_are_visible():
    options = [option("current")]
    options += [option(f"measured-{i}", i, i, 10) for i in range(1, 30)]
    options += [
        option("claude", 25, 1, 10, backend="claude"),
        option("agy", 26, 1, 10, backend="agy"),
        option("free", 27, 1, 10, backend="opencode", billing="free"),
    ]
    data = comparison.portfolio(
        result(options, decision_context={"session": {"backend": "codex", "model": "current"}}), size=6
    )
    assert data["models"][0]["model"] == "current"
    assert {route["backend"] for row in data["models"] for route in row["routes"]} == {
        "codex",
        "claude",
        "agy",
        "opencode",
    }
    assert data["model_count"] == len(options)


def test_shared_model_has_separate_routes_and_does_not_duplicate_measurements():
    native = option("shared", 20, 1, 10)
    free = {**native, "backend": "opencode", "id": "provider/shared-free", "billing_route": "free"}
    (row,) = comparison.models([native, free])
    assert len(row["routes"]) == 2 and len(row["evidence"]) == 1
    assert row["routes"][0]["billing_route"] != row["routes"][1]["billing_route"]


def test_incomparable_runs_do_not_supply_intermediate_frontier():
    options = [option("a", 20, 1, 20), option("b", 60, 3, 30), option("c", 90, 9, 40)]
    options[1]["evidence"][0]["harness"] = "another runner"
    data = comparison.portfolio(result(options))
    assert not any("intermediate" in reason for row in data["models"] for reason in row["reasons"])


def test_single_model_cohort_is_evidence_not_a_comparative_winner():
    item = option("only", 20, 1, 30)
    row = comparison.portfolio(result([item]))["models"][0]
    assert any("evidence" in reason for reason in row["reasons"])
    assert not any("observed quality" in reason or "published cost" in reason for reason in row["reasons"])


def test_hidden_unverified_provider_has_no_effort_control_in_compact_text():
    native = option("shared", 20, 1, 10)
    unknown = {**native, "backend": "opencode", "id": "provider/shared", "billing_route": "unverified",
               "admission": "conditional: entitlement unknown"}
    text = comparison.render(result([native, unknown]))
    assert "codex:shared=high" in text
    assert "provider/shared" not in text


def test_caller_allowed_opencode_route_stays_visible_when_billing_is_unknown():
    native = option("shared", 20, 1, 10)
    allowed = {**native, "backend": "opencode", "id": "provider/shared", "billing_route": "unverified"}
    text = comparison.render(result([native, allowed]))
    assert "opencode:provider/shared" in text and "opencode:provider/shared=high" in text


def test_inventory_failure_explains_comparison_is_incomplete():
    data = result([option("model")], inventory_failures={"opencode": {"stage": "inventory"}})
    assert "opencode: inventory unavailable; routes omitted (details in --json)" in comparison.render(data)


def test_missing_speed_does_not_become_fast_or_zero_and_fallback_is_visible():
    item = option("a", 20, 0, 0)
    item["evidence"][0]["speed"] = {"median_output_tokens_per_second": 0}
    rendered = comparison.render(result([item], task_routing={"note": "Overall evidence shown."}))
    assert "Overall evidence shown." in rendered and "/ source $0" in rendered
    assert "Source speed:" not in rendered and "0s" not in rendered


def test_long_policy_sections_use_local_drilldown_without_clipping_conditions():
    text = "An operative condition. " * 150 + "Except on verified plans."
    policy = {
        "id": "example",
        "backend": "codex",
        "status": "fresh",
        "url": "https://example.org/policy",
        "read": "model-guide policy --backend codex",
        "excerpt": text,
        "passages": [{"heading": "Usage limits", "text": text}],
    }
    rendered = comparison.render(result([option("safe\x1b[31m")], policy_evidence=[policy]))
    assert "Policy / codex: fresh · model-guide policy --backend codex" in rendered
    assert "An operative condition" not in rendered and "\x1b" not in rendered
    assert policy["passages"][0]["text"].endswith("Except on verified plans.")


def test_best_score_keeps_its_missing_price_and_actual_time():
    item = option("a", 40, None, 200)
    item["evidence"].append(
        {**item["evidence"][0], "effort": "low", "score": 10, "cost": 0.25, "seconds": 20}
    )
    text = comparison.render(result([item]))
    assert "high=40 / 3.3m / cost unavailable" in text
    assert "low=10 / source $0.25 / 20s" in text
    assert "high=40 / source $0.25" not in text


def test_incompatible_runs_are_not_merged_into_an_effort_range():
    item = option("a", 40, 4, 200)
    item["evidence"].append(
        {**item["evidence"][0], "score": 5, "cost": 0.1, "harness_version": "different-runner"}
    )
    text = comparison.render(result([item]))
    assert "high=40 / source $4" in text and "5–40" not in text


def test_excluded_explicit_choice_is_retained_as_input_but_not_a_comparison_option():
    item = option("a", 40, 4, 200)
    item["admission"] = "excluded: requested effort not established"
    data = result([item])
    assert comparison.portfolio(data)["models"] == []
    assert data["options"] == [item]


def test_speed_points_keep_effort_throughput_and_latency_together():
    item = option("a", 40, 4, 200)
    item["evidence"][0]["speed"] = {
        "median_output_tokens_per_second": 100,
        "median_time_to_first_token_seconds": 40,
    }
    item["evidence"].append(
        {
            **item["evidence"][0],
            "effort": "low",
            "speed": {"median_output_tokens_per_second": 10, "median_time_to_first_token_seconds": 2},
        }
    )
    text = comparison.render(result([item]))
    assert "low: 10 tokens/s, 2 s TTFT" in text
    assert "high: 100 tokens/s, 40 s TTFT" in text


def test_speed_comparison_includes_measured_middle_effort_between_extremes():
    item = option("a", 40, 4, 200)
    item["efforts"] = ["low", "medium", "high", "max"]
    item["evidence"] = [
        {**item["evidence"][0], "effort": effort, "speed": {
            "median_output_tokens_per_second": tps, "median_time_to_first_token_seconds": ttft}}
        for effort, tps, ttft in (("low", 50, 1), ("medium", 80, 3), ("high", 90, 10), ("max", 100, 60))
    ]
    text = comparison.render(result([item]))
    assert "low: 50 tokens/s, 1 s TTFT" in text
    assert "medium: 80 tokens/s, 3 s TTFT" in text
    assert "max: 100 tokens/s, 60 s TTFT" in text


def test_cost_floor_is_labelled_and_does_not_become_a_cheapest_candidate():
    item = option("a", 40, 0.1, 200)
    item["evidence"][0]["cost_kind"] = "floor"
    assert "/ source ≥$0.1" in comparison.render(result([item]))
    assert all(reason != "published cost" for reason, _ in comparison.witnesses(item["evidence"]))


def test_run_counts_remain_visible_when_efforts_have_different_sample_sizes():
    item = option("a", 40, 4, 200)
    item["evidence"][0]["n_runs"] = 3
    item["evidence"].append({**item["evidence"][0], "score": 10, "cost": 0.1, "effort": "low", "n_runs": 1})
    text = comparison.render(result([item]))
    assert "high=40 / source $4 / 3.3m [n=3]" in text
    assert "low=10 / source $0.1 / 3.3m [n=1]" in text


def test_pagination_preserves_comparison_and_shows_only_matching_bounded_runs():
    item = option("a", 40, 4, 200)
    item["evidence"][0]["meets_published_bounds"] = False
    item["evidence"].append({**item["evidence"][0], "score": 10, "cost": 0.1,
                             "seconds": 5, "effort": "low", "meets_published_bounds": True})
    data = result([item, option("b", 30, 1, 10)])
    text = comparison.render(data, limit=1)
    assert "Compare for:" in text and "Continue comparison: --limit 1 --offset 1" in text
    text = comparison.render(result([item]))
    assert "low=10 / source $0.1 / 5s [within bounds]" in text
    assert "high=40" not in text


def test_account_errors_are_not_attributed_to_another_backend():
    from agent_models import benchmarks

    source = {"quotas": [], "profiles": {}, "errors": ["codex quota unavailable", "shared failure"]}
    claude = benchmarks.account_observation("claude", None, data=source)
    assert claude["errors"] == ["shared failure"]
    assert benchmarks.account_observation("codex", None, data=source)["errors"] == source["errors"]


def test_account_context_is_shown_with_each_matching_route():
    item = option("shared")
    item["account_context"] = {"allowance": "ample"}
    other = {**item, "backend": "claude", "account_context": {"allowance": "scarce"}}
    text = comparison.render(result([item, other]))
    assert "codex:shared · caller account context: allowance=ample" in text
    assert "claude:shared · caller account context: allowance=scarce" in text


def test_broad_task_view_keeps_more_evidence_without_unrelated_warnings():
    item = option("model", 40, 1, 10)
    item["evidence"] = [{**item["evidence"][0], "domain": area, "score_metric": area} for area in
                        ("overall", "reasoning", "backend", "coding")]
    data = result([item], domains=["overall", "reasoning", "backend", "coding"],
                  task_routing={"focus_domains": []},
                  notes=["unrelated source unavailable"],
                  display_notes={"notes": [], "coverage_notes": []})
    text = comparison.render(data)
    assert "Inferred focus: unclear" in text and "coding/Example" in text
    assert "unrelated source unavailable" not in text


def test_broad_view_does_not_repeat_one_measurement_under_two_domains():
    item = option("model", 40, 1, 10)
    item["evidence"] = [{**item["evidence"][0], "domain": area} for area in ("backend", "coding")]
    text = comparison.render(result([item], domains=["backend", "coding"],
                                    task_routing={"focus_domains": []}))
    assert text.count("Example correct high=40") == 1
