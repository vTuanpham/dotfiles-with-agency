import json

from agent_models import usage


def test_usage_pairs_only_attributable_turns_and_never_exposes_messages(tmp_path):
    job = tmp_path / "jobs" / "owner" / "job"
    job.mkdir(parents=True)
    events = [
        {"kind": "turn_started", "at": "2026-11-08T00:00:00Z", "turnId": "a",
         "backend": "codex", "requestedModel": "model", "requestedAccount": "01"},
        {"kind": "message", "text": "private prompt and payload"},
        {"kind": "effort_observed", "turnId": "other", "effort": "max"},
        {"kind": "effort_observed", "turnId": "a", "effort": "high"},
        {"kind": "turn_completed", "at": "2026-11-08T00:00:12Z", "turnId": "a",
         "status": "completed"},
        {"kind": "turn_started", "backend": "codex", "requestedModel": "model"},
        {"kind": "turn_started", "backend": "codex", "requestedModel": "model"},
        {"kind": "turn_completed", "status": "completed"},
        {"kind": "runner_exit"},
        {"kind": "turn_started", "backend": "codex", "requestedModel": "model"},
        {"kind": "turn_completed", "status": "failed"},
    ]
    (job / "live.jsonl").write_text("".join(json.dumps(event) + "\n" for event in events))
    result = usage.summary(tmp_path)
    assert "private prompt" not in json.dumps(result)
    assert result["skipped"]["overlapping_turns"] == 1
    assert len(result["rows"]) == 2
    completed = next(row for row in result["rows"] if row["requested_account"] == "01")
    assert completed["outcomes"] == {"completed": 1}
    assert completed["observed_effort"] == "high"
    assert completed["seconds"] == 12 and completed["timed_turns"] == 1
    failed = next(row for row in result["rows"] if row["requested_account"] is None)
    assert failed["outcomes"] == {"failed": 1}
    assert usage.summary(tmp_path, backend="agy")["rows"] == []


def test_usage_does_not_guess_historical_or_mismatched_turns(tmp_path):
    job = tmp_path / "jobs" / "owner" / "job"
    job.mkdir(parents=True)
    events = [
        {"kind": "turn_started"}, {"kind": "turn_completed", "status": "completed"},
        {"kind": "runner_exit"},
        {"kind": "turn_started", "backend": "agy", "turnId": "a"},
        {"kind": "turn_completed", "turnId": "b", "status": "completed"},
    ]
    (job / "live.jsonl").write_text("".join(json.dumps(event) + "\n" for event in events))
    result = usage.summary(tmp_path)
    assert result["rows"] == []
    assert result["skipped"] == {"missing_provenance": 1, "mismatched_turns": 1}


def test_usage_counts_claude_per_turn_tokens_without_counting_cumulative_model_totals(tmp_path):
    job = tmp_path / "jobs" / "owner" / "job"
    job.mkdir(parents=True)
    events = [
        {"kind": "turn_started", "backend": "claude", "requestedModel": "model", "turnId": "a"},
        {"kind": "turn_completed", "status": "completed", "usage": {"input_tokens": 20,
         "output_tokens": 10}, "modelUsage": {"model": {"outputTokens": 1000}}},
    ]
    (job / "live.jsonl").write_text("".join(json.dumps(event) + "\n" for event in events))
    row = usage.summary(tmp_path)["rows"][0]
    assert (row["token_turns"], row["input_tokens"], row["output_tokens"]) == (1, 20, 10)
