import json
from collections import deque

import pytest

from agent_bridge import agy_acp, core


@pytest.mark.parametrize("advertised,checkpoint", [(True, True), (True, False), (False, False)])
def test_compact_requires_advertised_command_and_new_native_checkpoint(
    tmp_path, monkeypatch, advertised, checkpoint
):
    job = tmp_path / "job"
    job.mkdir()
    session = "session"
    transcript = agy_acp.agy.transcript_path(job, session).with_name("transcript_full.jsonl")
    transcript.parent.mkdir(parents=True)
    old = {"type": "CHECKPOINT", "source": "SYSTEM", "status": "DONE",
           "step_index": 1, "created_at": "old"}
    transcript.write_text(json.dumps(old) + "\n")
    state = {"backend": "agy", "cwd": str(tmp_path), "conversationId": session}
    path = job / "state.json"
    core.save(path, state)
    calls = []

    class FakeRpc:
        def __init__(self, *_):
            commands = [{"name": "compact"}] if advertised else []
            self.events = deque([{"method": "session/update", "params": {"sessionId": session,
                "update": {"sessionUpdate": "available_commands_update", "availableCommands": commands}}}])

        def call(self, method, params):
            calls.append((method, params))
            if method == "initialize":
                return {"protocolVersion": 1}
            if method == "session/resume":
                return {}
            assert method == "session/prompt" and params["prompt"][0]["text"] == "/compact"
            if checkpoint:
                with transcript.open("a") as stream:
                    stream.write(json.dumps({**old, "step_index": 2, "created_at": "new"}) + "\n")
            return {"stopReason": "end_turn"}

        def close(self):
            pass

    monkeypatch.setattr(agy_acp, "Rpc", FakeRpc)
    if checkpoint:
        agy_acp.run(job, state, path, "", resume=True, compact=True)
        assert '"kind":"compacted"' in (job / "live.jsonl").read_text()
    else:
        with pytest.raises(RuntimeError, match="checkpoint|advertise"):
            agy_acp.run(job, state, path, "", resume=True, compact=True)
        log = job / "live.jsonl"
        assert not log.exists() or '"kind":"compacted"' not in log.read_text()
    assert any(method == "session/prompt" for method, _ in calls) == advertised


def test_acp_process_keeps_sandbox_and_explicit_writable_roots(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(agy_acp, "capped", lambda command, state: command)
    monkeypatch.setattr(agy_acp.subprocess, "Popen",
                        lambda command, **kwargs: calls.append((command, kwargs)))
    state = {"cwd": str(tmp_path), "sandbox": "workspace-write",
             "writableRoots": [str(tmp_path), "/tmp/extra"]}
    rpc = agy_acp.Rpc(tmp_path, state)
    rpc.err.close()
    assert calls[0][0] == ["agy", "acp", "--sandbox", "--disable-telemetry", "--add-dir", "/tmp/extra"]
    assert calls[0][1]["env"]["HOME"] == str(tmp_path / "home")
    assert calls[0][1]["start_new_session"] is True


@pytest.mark.parametrize("update_settings", [False, True])
def test_active_prompt_is_steered_and_receipt_confirms_delivery(tmp_path, monkeypatch, update_settings):
    job = tmp_path / "job"
    (job / "steer").mkdir(parents=True)
    state = {"backend": "agy", "cwd": str(tmp_path), "model": None, "effort": None}
    path = job / "state.json"
    core.save(path, state)
    calls = []

    class FakeRpc:
        def __init__(self, *_):
            self.events = deque()
            self.seq = 0
            self.output = deque()

        def call(self, method, params):
            if method == "initialize":
                return {"protocolVersion": 1}
            assert method == "session/new"
            return {"sessionId": "session", "configOptions": [
                {"id": "model", "currentValue": "native-default"},
                {"id": "thought_level", "currentValue": "high"}]}

        def send(self, value):
            if value.get("method") != "session/prompt":
                return
            calls.append(value)
            text = value["params"]["prompt"][0]["text"]
            self.output.append({"method": "session/update", "params": {"sessionId": "session", "update": {
                "sessionUpdate": "user_message_chunk", "content": {"type": "text", "text": text}}}})
            if update_settings:
                for session, model in [("session", "changed-model"), ("other-session", "wrong-model")]:
                    self.output.append({"method": "session/update", "params": {"sessionId": session,
                        "update": {"sessionUpdate": "config_option_update", "configOptions": [
                            {"id": "model", "currentValue": model},
                            {"id": "thought_level", "currentValue": "medium"}]}}})
            if len(calls) == 1:
                (job / "steer/001.md").write_text("change course\n")
                (job / "steer/002.md").write_text("another adjustment\n")
            else:
                self.output.append({"method": "session/update", "params": {"sessionId": "session", "update": {
                    "sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "done"}}}})
            self.output.append({"id": value["id"], "result": {"stopReason": "end_turn"}})

        def read(self, _):
            return self.output.popleft()

        def close(self):
            pass

    monkeypatch.setattr(agy_acp, "Rpc", FakeRpc)
    monkeypatch.setattr(agy_acp.agy, "build_home", lambda *_: None)
    agy_acp.run(job, state, path, "original request")
    assert len(calls) == 3
    assert calls[1]["params"]["prompt"][0]["text"] == "change course"
    assert calls[2]["params"]["prompt"][0]["text"] == "another adjustment"
    assert (job / "steer/sent/001.md").is_file()
    assert (job / "steer/sent/002.md").is_file()
    events = [json.loads(line)["kind"] for line in (job / "live.jsonl").read_text().splitlines()]
    assert events.count("steer_sent") == 2 and events.count("turn_completed") == 1
    assert state["effectiveEffort"] == ("medium" if update_settings else "high")
    assert state["resolvedModel"] == ("changed-model" if update_settings else "native-default")


def test_explicit_queue_waits_for_active_turn(tmp_path, monkeypatch):
    job = tmp_path / "job"
    (job / "steer").mkdir(parents=True)
    (job / "steer/001.md").write_text("later")
    (job / "steer/001.queue").touch()
    state = {"backend": "agy", "cwd": str(tmp_path), "model": None, "effort": None}
    path = job / "state.json"
    core.save(path, state)
    timeline = []

    class FakeRpc:
        def __init__(self, *_):
            self.seq, self.events, self.output = 0, deque(), deque()

        def call(self, method, _):
            return {"protocolVersion": 1} if method == "initialize" else {"sessionId": "s"}

        def send(self, value):
            if value.get("method") != "session/prompt":
                return
            text = value["params"]["prompt"][0]["text"]
            timeline.append("later sent" if text == "later" else "initial sent")
            self.output.extend([
                {"method": "session/update", "params": {"sessionId": "s", "update": {
                    "sessionUpdate": "user_message_chunk", "content": {"text": text}}}},
                {"id": value["id"], "result": {"stopReason": "end_turn"}},
            ])

        def read(self, _):
            value = self.output.popleft()
            if value.get("id") and timeline == ["initial sent"]:
                timeline.append("initial finished")
            return value

        def close(self):
            pass

    monkeypatch.setattr(agy_acp, "Rpc", FakeRpc)
    monkeypatch.setattr(agy_acp.agy, "build_home", lambda *_: None)
    agy_acp.run(job, state, path, "initial")
    assert timeline == ["initial sent", "initial finished", "later sent"]
    assert not (job / "steer/001.queue").exists()
    assert (job / "steer/sent/001.md").is_file()


def test_stop_during_setup_does_not_send_a_prompt(tmp_path, monkeypatch):
    job = tmp_path / "job"
    job.mkdir()
    (job / "stop").touch()
    state = {"backend": "agy", "cwd": str(tmp_path), "model": None, "effort": None}
    core.save(job / "state.json", state)

    class FakeRpc:
        def __init__(self, *_):
            self.events, self.seq = deque(), 0

        def call(self, method, _):
            return {"protocolVersion": 1} if method == "initialize" else {"sessionId": "s"}

        def send(self, _):
            pytest.fail("stopped worker must not send a prompt")

        def close(self):
            pass

    monkeypatch.setattr(agy_acp, "Rpc", FakeRpc)
    monkeypatch.setattr(agy_acp.agy, "build_home", lambda *_: None)
    agy_acp.run(job, state, job / "state.json", "initial")
    events = [json.loads(line)["kind"] for line in (job / "live.jsonl").read_text().splitlines()]
    assert "stopped" in events and "turn_started" not in events


def test_interrupt_settles_before_queued_steer_is_sent(tmp_path, monkeypatch):
    job = tmp_path / "job"
    (job / "steer").mkdir(parents=True)
    state = {"backend": "agy", "cwd": str(tmp_path), "model": None, "effort": None}
    core.save(job / "state.json", state)
    timeline = []

    class FakeRpc:
        def __init__(self, *_):
            self.events, self.output, self.seq = deque(), deque(), 0

        def call(self, method, _):
            return {"protocolVersion": 1} if method == "initialize" else {"sessionId": "s"}

        def send(self, value):
            if value["method"] == "session/cancel":
                timeline.append("cancel sent")
                return
            text = value["params"]["prompt"][0]["text"]
            timeline.append("steer sent" if text == "next" else "initial sent")
            self.output.append({"method": "session/update", "params": {"sessionId": "s", "update": {
                "sessionUpdate": "user_message_chunk", "content": {"text": text}}}})
            self.output.append({"id": value["id"], "result": {
                "stopReason": "end_turn" if text == "next" else "cancelled"}})
            if text != "next":
                (job / "interrupt").touch()
                (job / "steer/001.md").write_text("next")

        def read(self, _):
            value = self.output.popleft()
            if value.get("id") and "steer sent" not in timeline:
                timeline.append("cancel settled")
            return value

        def close(self):
            pass

    monkeypatch.setattr(agy_acp, "Rpc", FakeRpc)
    monkeypatch.setattr(agy_acp.agy, "build_home", lambda *_: None)
    agy_acp.run(job, state, job / "state.json", "initial")
    assert timeline == ["initial sent", "cancel sent", "cancel settled", "steer sent"]


def test_uncertain_prior_delivery_is_not_resent(tmp_path):
    job = tmp_path / "job"
    job.mkdir()
    state = {"cwd": str(tmp_path), "model": None, "conversationId": "session",
             "inflight": {"file": "001.md"}}
    with pytest.raises(RuntimeError, match="uncertain"):
        agy_acp.run(job, state, job / "state.json", "", resume=True)


def test_resume_without_session_never_creates_a_new_one(tmp_path, monkeypatch):
    monkeypatch.setattr(agy_acp, "Rpc", lambda *_: pytest.fail("must not launch AGY"))
    with pytest.raises(RuntimeError, match="session ID is missing"):
        agy_acp.run(tmp_path, {"model": None}, tmp_path / "state.json", "continue", resume=True)


def test_configure_detects_model_changed_by_effort_selection():
    class FakeRpc:
        def call(self, method, params):
            assert method == "session/set_config_option"
            return {"configOptions": [{"id": "model", "currentValue": "other"},
                                      {"id": "thought_level", "currentValue": params["value"]}]}

    result = {"configOptions": [{"id": "model", "currentValue": "requested"},
                                {"id": "thought_level", "currentValue": "low"}]}
    with pytest.raises(RuntimeError, match="changed requested model"):
        agy_acp.configure(FakeRpc(), "session", result, {"model": "requested", "effort": "high"})


def test_permission_request_is_denied_without_exposing_its_payload():
    calls = []
    class FakeRpc:
        def send(self, value):
            calls.append(value)

    # The native request can contain sensitive tool input; only the decision is returned.
    from unittest.mock import patch

    with patch.object(agy_acp, "log") as log:
        agy_acp.reject(FakeRpc(), {"id": 1, "method": "session/request_permission", "params": {
            "options": [{"kind": "allow_once", "optionId": "allow"},
                        {"kind": "reject_once", "optionId": "reject"}],
            "toolCall": {"rawInput": "private"}}}, "/tmp")
    assert calls == [{"id": 1, "result": {"outcome": {"outcome": "selected", "optionId": "reject"}}}]
    assert "private" not in str(log.call_args)


def test_worker_peer_message_routes_before_the_turn_ends(tmp_path):
    job, peer = tmp_path / "owner/worker", tmp_path / "owner/peer"
    job.mkdir(parents=True)
    peer.mkdir()
    (peer / "state.json").write_text("{}")
    chunks = ["TO peer:", " please check"]
    agy_acp.flush_message(job, chunks)
    assert chunks == []
    assert (peer / "steer/001.md").read_text() == "[from worker] please check\n"
