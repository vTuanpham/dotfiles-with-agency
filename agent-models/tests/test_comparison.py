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
