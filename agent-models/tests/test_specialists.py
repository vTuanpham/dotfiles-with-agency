import copy
import json
from dataclasses import asdict
from pathlib import Path

import pytest

from agent_models import benchmarks, kernel_source, queries, shortlist, specialists

FIXTURES = Path(__file__).with_name("fixtures")


def fixture(name):
    return json.loads((FIXTURES / (name + ".json")).read_text())


def test_bug_csv_keeps_every_real_effort_and_versioned_replicate():
    published, rows, audit = specialists.bug_runs((FIXTURES / "bughunt-runs.csv").read_text())
    opus = [r for r in rows if r.model == "claude-opus-5-5"]
    assert {r.effort for r in opus} == {"low", "medium", "high", "xhigh", "max"}
    assert all(r.harness_version and r.run_id and r.n_runs == 1 for r in opus)
    assert audit["available_rows"] == audit["captured_rows"]
    assert audit["superseded_rows"] == 1 and published >= "2026-09-23"
    means = specialists.cohorts([asdict(r) for r in opus])
    maximum = next(r for r in means if r["effort"] == "max")
    assert maximum["n_runs"] == 3 and maximum["score"] == pytest.approx(125 / 3)
    maximum["harness_version"] = "different CLI"
    mixed = specialists.cohorts([means[0], maximum])
    assert len(mixed) == 2


def test_csv_reconciles_clamped_efforts_and_contended_time_without_using_summary_scores():
    summary = fixture("bughunt")
    summary["runs"] = [summary["runs"][0]]
    summary["runs"][0].update(id="Opus 5.5 (high effort) - mean of 3", model="Opus 5.5",
                              harness="Claude Code", effort="high", effort_status="clamped",
                              wall_note="Contended wall time")
    _, rows, _ = specialists.bug_runs((FIXTURES / "bughunt-runs.csv").read_text(), summary)
    high = [r for r in rows if r.model == "claude-opus-5-5" and r.effort is None]
    assert len(high) == 3 and all(r.seconds is None for r in high)
    assert all(r.score != summary["runs"][0]["fixed"] for r in high)


def test_kernel_audit_outcomes_preserve_pro_identity_efforts_and_failed_cells():
    data = fixture("kernelbench-runs")
    rows = specialists.kernel(data)[1]
    assert len(rows) == 10  # All runs, not just selected valid cells.
    pro = [r for r in rows if r.model == "GPT-6 Astra Pro"]
    assert len(pro) == 5 and any(r.effort == "xhigh" for r in pro)
    assert any(r.score is None for r in pro)
    assert all(r.run_id for r in rows)
    assert not __import__("agent_models.coverage", fromlist=["matches"]).matches(
        {"model": "gpt-6-astra"}, "GPT-6 Astra Pro")


def test_kernel_full_inventories_retain_unaudited_receipts_and_detail_harness():
    raw = fixture("kernel-inventories")
    rows, paths = kernel_source.missing_runs(fixture("kernelbench-runs"), raw["catalog"],
                                            raw["mega_csv"], raw["manifests"], [])
    assert len(rows) >= 4 and all(r.score is None for r in rows)
    run = next(iter(raw["details"]))
    row = next(r for r in rows if r.run_id == run)
    updated = kernel_source.detail(row, raw["details"][run])
    assert updated.harness and updated.score is None and updated.effort is None
    assert paths[(run, row.hardware)].endswith(run + ".json")
    hostile = copy.deepcopy(raw["details"][run])
    hostile["run_id"] = "another run"
    with pytest.raises(ValueError, match="identity mismatch"):
        kernel_source.detail(row, hostile)


def test_real_kernel_reused_run_id_does_not_cross_hardware_or_hide_conflicting_scores():
    rows = specialists.kernel(fixture("kernel-collision"))[1]
    assert len(rows) == 2 and len({r.run_id for r in rows}) == 1
    rtx = next(r for r in rows if r.hardware == "RTX PRO 6000")
    b200 = next(r for r in rows if r.hardware == "B200")
    assert rtx.score is None and rtx.caveat is not None
    assert "conflicting board cell=True" in rtx.caveat
    assert b200.score == pytest.approx(1.78)


def test_kernel_real_cells_keep_three_units_and_unknown_efforts():
    published, rows = specialists.kernel(fixture("kernelbench"))
    assert published == "2026-10-29"
    sol = [r for r in rows if r.model == "GPT-6.1 Sol"]
    assert len(sol) == 5
    assert {r.unit for r in sol} == {"% roofline", "x vs baseline", "geomean latency ms"}
    latency = next(r for r in sol if r.direction == "lower")
    assert latency.score == 0.279675 and latency.effort == "xhigh"
    mega = next(r for r in sol if r.unit == "x vs baseline")
    assert mega.score == 4.99 and mega.effort is None and mega.cost is None
    assert all(r.tasks in (1, 4) for r in sol)


@pytest.mark.parametrize("field,value", [("score", "0.3"), ("score", float("nan")),
                                         ("valid", "true"), ("correct", 1), ("latency_ms", -1)])
def test_kernel_rejects_coercion_and_hostile_numeric_cells(field, value):
    data = fixture("kernelbench")
    cell = data["models"][0]["benches"]["cuda"]["cells"]["02_deepseek_nsa"]
    cell[field] = value
    with pytest.raises(ValueError):
        specialists.kernel(data)


def test_kernel_excludes_invalid_unaudited_and_absent_cells_without_zero_filling():
    data = fixture("kernelbench")
    cells = data["models"][0]["benches"]["cuda"]["cells"]
    cells["02_deepseek_nsa"].update(valid=False, verdict="unaudited")
    del cells["03_megaqwen_decode"]
    rows = specialists.kernel(data)[1]
    assert [r.score for r in rows[:4]][1:3] == [None, None]
    cells["02_deepseek_nsa"].update(valid=True, verdict="reward_hack")
    with pytest.raises(ValueError, match="audit eligibility"):
        specialists.kernel(data)


def test_kernel_unknown_units_and_duplicate_identity_fail_closed():
    data = fixture("kernelbench")
    data["benches"]["cuda"]["problems"].append("unknown_operation")
    with pytest.raises(ValueError, match="unit layout"):
        specialists.kernel(data)
    data = fixture("kernelbench")
    data["models"].append(copy.deepcopy(data["models"][0]))
    with pytest.raises(ValueError, match="duplicate"):
        specialists.kernel(data)
    data = fixture("kernelbench")
    data["benches"]["cuda"]["gpu"]["name"] = "H100"
    with pytest.raises(ValueError, match="canonical hardware changed"):
        specialists.kernel(data)


def test_bug_hunt_real_data_uses_native_ids_harness_cost_basis_and_105_bugs():
    published, rows = specialists.bug_hunt(fixture("bughunt"))
    assert published == "2026-10-27" and len(rows) == 3
    row = rows[0]
    assert row.model == "gpt-6-astra" and row.score == 43 and row.tasks == 105
    assert row.effort == "xhigh" and row.harness == "Codex CLI"
    assert row.cost_kind == "list" and row.seconds == 58.8 * 60


@pytest.mark.parametrize("field,value", [("fixed", 106), ("fixed", True), ("fixed", "43"),
                                         ("wall_min", float("inf")), ("cost_kind", "estimate-ish"),
                                         ("effort_status", "assumed_max"), ("n_runs", 1.5)])
def test_bug_hunt_strict_decoding(field, value):
    data = fixture("bughunt")
    data["runs"][0][field] = value
    with pytest.raises(ValueError):
        specialists.bug_hunt(data)


def test_bug_hunt_superseded_default_effort_and_unknown_cost_are_not_guessed():
    data = fixture("bughunt")
    data["runs"][0]["superseded"] = "Superseded by a replicated run"
    data["runs"][1].update(effort_status="inert_default", cost_kind="unknown", cost_usd=None,
                           wall_note="Contended wall time")
    rows = specialists.bug_hunt(data)[1]
    assert len(rows) == 2 and rows[0].effort is None and rows[0].cost is None and rows[0].seconds is None
    data["meta"]["planted_total"] = 106
    with pytest.raises(ValueError, match="task set changed"):
        specialists.bug_hunt(data)


def test_bug_hunt_inconsistent_task_counts_are_rejected():
    data = fixture("bughunt")
    data["runs"][0]["repo1_fixed"] = 0
    with pytest.raises(ValueError, match="inconsistent"):
        specialists.bug_hunt(data)


def test_domain_query_preserves_units_unmatched_names_and_missing_values(monkeypatch):
    rows = specialists.kernel(fixture("kernelbench"))[1]
    data = {"retrieved": "2026-11-01T00:00:00Z", "sources": {
        "KernelBench.com": {"status": "ok", "measurements": [asdict(r) for r in rows]}}}
    monkeypatch.setattr(benchmarks, "snapshot", lambda: data)
    found = benchmarks.search("performance", "sol")["sources"]["KernelBench.com"]
    assert {r["unit"] for r in found["measurements"]} == {
        "% roofline", "x vs baseline", "geomean latency ms"}
    catalog = {"backend": "codex", "models": [{"id": "gpt-6.1-sol", "model": "gpt-6.1-sol",
                                                "efforts": ["high"]}]}
    result = benchmarks.search("performance", "gpt-6.1", catalog=catalog)
    assert result["unsupported_effort_count"] == 1
    assert all(r["effort"] is None for r in result["sources"]["KernelBench.com"]["measurements"])
    assert benchmarks.search("performance", "no-such-model")["sources"]["KernelBench.com"]["matches"] == 0


def test_specialist_brief_sorts_metric_direction_counts_unknowns_and_summarizes_run_age(monkeypatch):
    from datetime import UTC, datetime

    template = asdict(next(r for r in specialists.kernel(fixture("kernelbench"))[1]
                           if r.direction == "lower"))
    rows = [
        {**template, "model": "Slow", "label": "Slow", "score": 5, "harness": "A",
         "date": "2026-09-01", "seconds": 16290},
        {**template, "model": "Fast", "label": "Fast", "score": 1, "harness": "Z",
         "date": "2026-10-18", "seconds": 120},
        {**template, "model": "Missing", "label": "Missing", "score": None, "harness": "B", "date": None},
    ]
    data = {"retrieved": "2026-11-01T00:00:00Z", "sources": {"KernelBench.com": {
        "status": "ok", "url": "https://kernelbench.com/", "measurements": rows}}}
    monkeypatch.setattr(benchmarks, "snapshot", lambda: data)
    found = queries.search(["performance"], limit=1, now=datetime(2026, 11, 1, tzinfo=UTC))["performance"]
    values = found["sources"]["KernelBench.com"]["measurements"]
    assert [r["model"] for r in values] == ["Fast", "Slow"]
    assert found["sources"]["KernelBench.com"]["unverified_measurements"] == 1
    text = shortlist.brief(found)
    assert "newest run 2026-10-18; 33% of rows older than 30 days" in text
    assert text.index("  Fast") < text.index("  Slow") and "  Missing" not in text
    assert "4.5h/run" in text and "1.629e+04" not in text
    assert "Unverified measurements: 1 (excluded from leaders)" in text
