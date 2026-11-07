import json

from agent_bridge.core import log_turn_started


def test_turn_records_requested_context_without_claiming_actual_account(tmp_path):
    log_turn_started(tmp_path, {"backend": "agy", "model": "model-a", "account": "a1"}, "turn-1")
    event = json.loads((tmp_path / "live.jsonl").read_text())
    assert (event["backend"], event["requestedModel"], event["requestedAccount"]) == ("agy", "model-a", "a1")
    assert event["requestedEffort"] is None
    assert "effectiveAccount" not in event
