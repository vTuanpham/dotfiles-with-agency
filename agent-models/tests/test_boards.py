import copy
import json
from pathlib import Path

import pytest

from agent_models import artificial, boards, coverage

DATA = json.loads((Path(__file__).with_name("fixtures") / "boards.json").read_text())


def test_vals_full_export_preserves_component_harness_controls_and_nulls():
    rows, published, version = boards.vals_decode(DATA["vals"])
    assert published == "2026-10-29" and version == "2.2"
    assert len(rows) == 18 and any(r.harness == "OpenHands" for r in rows)
    assert any(r.effort == "max" for r in rows)
    assert all(r.cost_basis == "USD/test" for r in rows)
    assert len({r.configuration for r in rows}) > 1


def test_swe_export_preserves_scaffold_version_and_subset():
    rows = boards.swe_decode(DATA["swe"])
    assert len(rows) == 2 and rows[0].harness == "mini-SWE-agent"
    assert rows[0].harness_version == "2.0.0a0" and rows[0].configuration == "Multilingual"
    assert rows[0].score == 72.7 and rows[0].cost == pytest.approx(0.3518355868)


def test_osworld_full_export_keeps_steps_subset_tool_mode_and_agent():
    rows = boards.osworld_decode(DATA["osworld"])
    assert len(rows) == 10 and {r.effort for r in rows} >= {"low", "medium", "max"}
    agent = next(r for r in rows if r.label.startswith("Darwinx"))
    assert agent.model == "anthropic/claude-opus-4-8" and agent.harness.startswith("Darwinx")
    assert agent.effort is None  # "max (thinking disabled)" is not native max evidence.
    assert '"stepBudget": 450' in agent.configuration
    assert {r.metric for r in rows} == {"binaryAccuracy", "partialScore"}


def test_bfcl_preserves_fc_scaffold_and_benchmark_cost_response_time_units():
    rows = boards.bfcl_decode(DATA["bfcl"])
    assert len(rows) == 2 and rows[0].harness == "BFCL native function calling"
    assert rows[0].score == 77.47 and rows[0].effort is None
    assert rows[0].cost_basis == "USD/benchmark" and rows[0].time_basis == "response"


def test_livecodebench_keeps_question_dates_without_guessing_run_dates():
    rows = boards.lcb_decode(DATA["lcb"])
    assert sum(r.tasks for r in rows) == 4
    assert all(r.date is None and r.configuration.startswith("question date ") for r in rows)
    assert all(r.score is None and "contamination risk" in r.caveat for r in rows)
    data = copy.deepcopy(DATA["lcb"])
    for model in data["models"]:
        model["release_date"] = 0  # An explicitly earlier cutoff permits these test cohorts.
    assert all(r.score is not None for r in boards.lcb_decode(data))


@pytest.mark.parametrize("name,decoder,mutate", [
    ("vals", boards.vals_decode, lambda d: d["tasks"]["overall"][next(iter(d["tasks"]["overall"]))]
     .update(accuracy="90")),
    ("swe", boards.swe_decode, lambda d: d["leaderboards"][0]["results"][0].update(resolved=float("nan"))),
    ("osworld", boards.osworld_decode, lambda d: d["results"][0].update(binaryAccuracy=True)),
    ("lcb", boards.lcb_decode, lambda d: d["performances"][0].update({"pass@1": -1})),
])
def test_structured_boards_reject_coercion_nonfinite_and_invalid_scores(name, decoder, mutate):
    data = copy.deepcopy(DATA[name])
    mutate(data)
    with pytest.raises(ValueError):
        decoder(data)


def aa_record(name, slug):
    return {"id": slug, "slug": slug, "name": name, "release_date": "2026-09-23",
            "model_creator": {"id": "anthropic", "name": "Anthropic", "slug": "anthropic"},
            "evaluations": {"artificial_analysis_intelligence_index": 58.4},
            "pricing": {"price_1m_input_tokens": 5, "price_1m_output_tokens": 25},
            "median_output_tokens_per_second": 100, "median_time_to_first_token_seconds": 1}


def test_aa_native_effort_comes_from_name_not_unsuffixed_slug():
    data = {"status": 200, "data": [
        aa_record("Claude Opus 5.5 (Max)", "claude-opus-5-5"),
        aa_record("Claude Opus 5.5 (Xhigh, Default Fallback)", "claude-opus-5-5-xhigh"),
        aa_record("Claude Opus 5.5", "claude-opus-5-5-unknown")]}
    rows = artificial.decode(data)
    assert [r["effort"] for r in rows] == ["max", "xhigh", None]
    assert rows[1]["configuration"] == "Default Fallback"
    assert coverage.matches({"model": "claude-opus-5-5"}, rows[1]["model"])
    assert rows[0]["score"] == 58.4 and all(r["cost"] is None for r in rows)
    data["data"].append(copy.deepcopy(data["data"][0]))
    with pytest.raises(ValueError, match="duplicate"):
        artificial.decode(data)
