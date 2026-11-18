import importlib.util
import sys
from pathlib import Path
from xml.etree import ElementTree

import pytest


def renderer():
    path = Path(__file__).resolve().parents[2] / "docs/tools/model_effort.py"
    spec = importlib.util.spec_from_file_location("model_effort", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_effort_visual_uses_snapshot_settings_dates_and_unknown_time(monkeypatch, tmp_path):
    module = renderer()
    rows = [["Model", "Artificial Analysis Intelligence Index", "Cost per Task USD", "Total Response (s)"],
            ["Example (adaptive)", "40", "$0.2", "--"],
            ["Example (deep)", "60", "$0.8", "123.34"],
            ["Example (deep with fallback)", "99", "$2", "500"]]
    data = {"retrieved": "2026-10-30T13:39:00Z", "sources": {"Artificial Analysis": {
        "status": "ok", "url": "https://artificialanalysis.ai/leaderboards/models",
        "metadata": ["Intelligence Index v5.0"], "tables": [rows]}}}
    monkeypatch.setattr(module, "snapshot", lambda: data)
    output = tmp_path / "figure.svg"
    monkeypatch.setattr(sys, "argv", ["model_effort", "--model", "Example", "--output", str(output)])
    module.main()
    svg = ElementTree.parse(output)
    ns = {"s": "http://www.w3.org/2000/svg"}
    assert len(svg.findall(".//s:circle", ns)) == 2
    text = output.read_text()
    assert all(value in text for value in ("adaptive", "deep", "unknown", "123.34 s", "13:39 UTC"))
    assert "500" not in text
    rows.append(rows[1])
    with pytest.raises(ValueError, match="duplicate"):
        module.main()


def test_effort_visual_uses_current_api_cost_and_v3_latency_without_fallback_runs(monkeypatch, tmp_path):
    module = renderer()
    rows = [{"model": "Example (" + setting + ")",
             "metric": "artificial_analysis_intelligence_index", "score": score, "cost": cost,
             "speed": {"methodology_version": "v3", "time_to_first_token_seconds": latency}}
            for setting, score, cost, latency in (("low", 40, 0.2, None), ("high", 60, 0.8, 26.29),
                                                 ("max with fallback", 70, 1, 100))]
    data = {"retrieved": "2026-11-18T03:00:00Z", "sources": {"Artificial Analysis": {
        "status": "ok", "url": "https://artificialanalysis.ai/", "metadata": [], "measurements": rows,
        "retrieved": "2026-11-17T02:00:00Z"}}}
    monkeypatch.setattr(module, "snapshot", lambda: data)
    output = tmp_path / "figure.svg"
    monkeypatch.setattr(sys, "argv", ["model_effort", "--model", "Example", "--output", str(output)])
    module.main()
    text = output.read_text()
    assert text.count("<circle ") == 2
    assert "First-token latency" in text and "v3 headline mean" in text
    assert "26.29 s" in text and "unknown" in text
    assert "17 Nov 2026 02:00 UTC" in text and "18 Nov" not in text
    assert "fallback" not in text
