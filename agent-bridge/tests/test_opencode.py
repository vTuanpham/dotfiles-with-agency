import json
from collections import deque
from pathlib import Path
from types import SimpleNamespace

import pytest

from agent_bridge import opencode


@pytest.mark.parametrize("outcome", ["session.compaction.ended", "session.compaction.failed"])
def test_compact_waits_for_native_outcome(monkeypatch, tmp_path, outcome):
    events = iter([
        b'data: {"type":"session.compaction.ended","data":{"sessionID":"ses_other"}}\n',
        json.dumps({"type": outcome, "data": {"sessionID": "ses_worker",
                   "error": {"message": "Nothing to compact"}}}).encode().join([b"data: ", b"\n"]),
    ])
    calls = []

    class Connection:
        def __init__(self, *args, **kwargs):
            pass

        def request(self, method, path, **kwargs):
            calls.append((method, path))

        def getresponse(self):
            return SimpleNamespace(status=200, getheader=lambda *args: "text/event-stream",
                                   readline=lambda limit: next(events, b""))

        def close(self):
            pass

    monkeypatch.setattr(opencode.http.client, "HTTPConnection", Connection)
    monkeypatch.setattr(opencode, "native_request", lambda *args: {
        "sessionID": "ses_worker", "type": "compaction",
    })
    if outcome.endswith("failed"):
        with pytest.raises(RuntimeError, match="Nothing to compact"):
            opencode.compact_over_api(tmp_path, "ses_worker", "http://127.0.0.1:1234", "fixture")
    else:
        opencode.compact_over_api(tmp_path, "ses_worker", "http://127.0.0.1:1234", "fixture")
    assert calls == [("GET", "/api/event")]
    kinds = [json.loads(line)["kind"] for line in (tmp_path / "live.jsonl").read_text().splitlines()]
    assert kinds == (["compact_started", "compacted"] if outcome.endswith("ended") else ["compact_started"])


def test_effective_variant_requires_matching_native_message_and_model(monkeypatch):
    data = {"id": "msg_assistant", "type": "assistant", "model": {
        "providerID": "opencode", "id": "deepseek-v4.1-flash-free", "variant": "default"}}
    calls = []
    def request(*args):
        calls.append(args)
        return data
    monkeypatch.setattr(opencode, "native_request", request)
    st = {"sessionId": "ses_worker", "model": "opencode/deepseek-v4.1-flash-free"}
    assert opencode.read_effective_variant(
        st, "http://127.0.0.1:1234", "secret", {"messageID": "msg_assistant"}
    ) == "default"
    assert calls[0][2:] == ("GET", "/api/session/ses_worker/message/msg_assistant")
    assert opencode.read_effective_variant(
        {**st, "model": "other/model"}, "url", "secret", {"messageID": "msg_assistant"}
    ) is None
    assert opencode.read_effective_variant(st, "url", "secret", {"messageID": "../bad"}) is None


def test_live_steer_uses_native_prompt_and_confirms_exact_receipt(tmp_path, monkeypatch):
    (tmp_path / "steer").mkdir()
    (tmp_path / "steer/001.md").write_text("First prompt\n")
    (tmp_path / "steer/002.md").write_text("Change course\n")
    (tmp_path / "steer/003.md").write_text("Later\n")
    (tmp_path / "steer/003.queue").touch()
    (tmp_path / "steer/004.md").write_text("Existing queue\n")
    st = {"sessionId": "ses_worker", "inflight": {"file": "001.md"}}
    calls = []

    class Connection:
        def __init__(self, host, port, timeout):
            assert (host, port, timeout) == ("127.0.0.1", 1234, 2)

        def request(self, method, path, body, headers):
            calls.append((method, path, json.loads(body) if body else None, headers))

        def getresponse(self):
            body = next(call[2] for call in reversed(calls) if call[0] == "POST")
            data = ({"id": body["id"], "type": "user", "text": body["text"]}
                    if calls[-1][0] == "GET" else
                    {"id": body["id"], "sessionID": "ses_worker", "type": "user",
                     "delivery": "steer", "payload": {"text": body["text"]}})
            return SimpleNamespace(status=200, getheader=lambda *a: "application/json",
                                   read=lambda _: json.dumps({"data": data}).encode())

        def close(self):
            pass

    monkeypatch.setattr(opencode.http.client, "HTTPConnection", Connection)
    opencode.steer_live(tmp_path, st, "http://127.0.0.1:1234", "fixture", skip={"004.md"})
    assert calls[0][0:2] == ("POST", "/api/session/ses_worker/prompt")
    assert calls[0][2]["text"] == "Change course" and calls[0][2]["delivery"] == "steer"
    assert calls[0][2]["id"].startswith("msg_")
    assert (tmp_path / "steer/001.md").exists()
    assert (tmp_path / "steer/sent/002.md").read_text() == "Change course\n"
    assert "liveSteer" not in json.loads((tmp_path / "state.json").read_text())
    opencode.steer_live(tmp_path, st, "http://127.0.0.1:1234", "fixture", skip={"004.md"})
    assert len(calls) == 2 and (tmp_path / "steer/003.md").exists()
    assert (tmp_path / "steer/004.md").exists()


def test_live_steer_uncertain_response_retains_stable_id(tmp_path, monkeypatch):
    (tmp_path / "steer").mkdir()
    (tmp_path / "steer/001.md").write_text("follow up")
    st = {"sessionId": "ses_worker"}
    calls = []

    class Connection:
        def __init__(self, *args, **kwargs):
            pass

        def request(self, method, path, body, headers):
            calls.append(json.loads(body)["id"])

        def getresponse(self):
            raise TimeoutError("fixture")

        def close(self):
            pass

    monkeypatch.setattr(opencode.http.client, "HTTPConnection", Connection)
    for _ in range(2):
        with pytest.raises(TimeoutError):
            opencode.steer_live(tmp_path, st, "http://127.0.0.1:1234", "fixture")
    assert calls[0] == calls[1] == st["liveSteer"]["id"]
    assert (tmp_path / "steer/001.md").is_file()


def test_admitted_steer_is_not_confirmed_until_native_history_contains_it(tmp_path, monkeypatch):
    (tmp_path / "steer").mkdir()
    (tmp_path / "steer/001.md").write_text("follow up")
    st = {"sessionId": "ses_worker"}
    posts = []
    ready = False

    def request(_url, _password, method, _path, body=None):
        if method == "POST":
            posts.append(body["id"])
            return {"id": body["id"], "sessionID": "ses_worker", "type": "user",
                    "delivery": "steer", "payload": {"text": "follow up"}}
        if not ready:
            raise opencode.NativeMessagePending()
        return {"id": posts[-1], "type": "user", "text": "follow up"}

    monkeypatch.setattr(opencode, "native_request", request)
    assert opencode.steer_live(tmp_path, st, "url", "secret") is False
    assert (tmp_path / "steer/001.md").exists() and st["liveSteer"]
    assert not (tmp_path / "live.jsonl").exists()
    ready = True
    assert opencode.steer_live(tmp_path, st, "url", "secret") is True
    assert posts[0] == posts[1] and (tmp_path / "steer/sent/001.md").exists()


def test_live_steer_recovers_after_receipt_file_was_moved(tmp_path, monkeypatch):
    (tmp_path / "steer/sent").mkdir(parents=True)
    (tmp_path / "steer/sent/001.md").write_text("follow up")
    session = "ses_worker"
    identity = opencode.hashlib.sha256(f"{tmp_path.resolve()}\0{session}\0{'001.md'}".encode()).hexdigest()
    st = {"sessionId": session, "liveSteer": {"id": "msg_" + identity, "file": "001.md", "session": session}}
    monkeypatch.setattr(opencode, "command", lambda *a, **k: pytest.fail("no server needed"))
    opencode.recover_live_steer(tmp_path, st)
    assert "liveSteer" not in st
    events = [json.loads(line) for line in (tmp_path / "live.jsonl").read_text().splitlines()]
    assert [event["kind"] for event in events] == ["steer_sent"]


def state(tmp_path, sandbox="workspace-write"):
    return {
        "cwd": str(tmp_path),
        "title": "Probe task",
        "model": "openrouter/google/gemma-4-31b-it:free",
        "effort": "high",
        "sessionId": "sid",
        "sandbox": sandbox,
        "writableRoots": [str(tmp_path)],
    }


def test_command_confines_both_modes_and_sets_permissions(monkeypatch, tmp_path):
    st = state(tmp_path)
    job = tmp_path / "job"
    home = tmp_path / "home"
    shared_auth = home / ".local/share/opencode/auth.json"
    shared_cache = home / ".cache/opencode"
    shared_auth.parent.mkdir(parents=True)
    shared_auth.write_text('{"key":"secret"}')
    (shared_cache / "bin").mkdir(parents=True)
    for name in ("node_modules", "packages"):
        (shared_cache / name).mkdir()
    (shared_cache / "package.json").write_text("{}")
    (shared_cache / "models.json").write_text("{}")
    monkeypatch.setattr(opencode.Path, "home", lambda: home)
    for key in ("OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "OPENCODE_SERVER_PASSWORD", "OPENCODE_PASSWORD"):
        monkeypatch.setenv(key, "inherited")
    cmd, env = opencode.command(st, job, "prompt", resume=True)
    assert cmd[0] == "bwrap" and "--ro-bind" in cmd and "--dev" in cmd and "--proc" in cmd
    assert "--bind" in cmd and str(tmp_path) in cmd
    assert "--die-with-parent" in cmd
    assert all(str(job) != cmd[index + 1] for index, value in enumerate(cmd) if value == "--bind")
    bind_sources = [cmd[index + 1] for index, value in enumerate(cmd) if value == "--bind"]
    private = job / "home"
    assert bind_sources == [str(private), str(tmp_path), str(opencode.heavy_directory())]
    out = job / "out"  # a writable root inside the job dir must be mounted after the read-only job root
    cmd_out, _ = opencode.command({**st, "writableRoots": [str(out)]}, job, "prompt", resume=True)
    assert cmd_out.index(str(out)) > cmd_out.index(str(job))
    assert private.stat().st_mode & 0o777 == 0o700
    assert env["XDG_DATA_HOME"] == str(private / "data")
    assert env["XDG_STATE_HOME"] == str(private / "state")
    assert env["XDG_CACHE_HOME"] == str(private / "cache")
    assert (private / "data/opencode/auth.json").read_text() == '{"key":"secret"}'
    assert (private / "data/opencode/auth.json").stat().st_mode & 0o777 == 0o600
    assert (private / "cache/opencode/models.json").read_text() == "{}"
    ro_binds = [(cmd[index + 1], cmd[index + 2]) for index, value in enumerate(cmd) if value == "--ro-bind"]
    assert (str(job), str(job)) in ro_binds
    cache_binds = [(source, target) for source, target in ro_binds if Path(source).parent == shared_cache]
    assert {Path(target).name for _, target in cache_binds} == {
        "bin",
        "node_modules",
        "packages",
        "package.json",
    }
    assert len(cache_binds) == 4
    assert (home / ".config/opencode") not in [Path(source) for source in bind_sources]
    assert not any(
        key in env
        for key in ("OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "OPENCODE_SERVER_PASSWORD", "OPENCODE_PASSWORD")
    )
    assert "--session" in cmd and "sid" in cmd
    assert "prompt" not in cmd
    assert cmd[cmd.index("-m") + 1] == "openrouter/google/gemma-4-31b-it:free#high"
    outside = {"external_directory": {"*": "allow"}}
    assert json.loads(env["OPENCODE_CONFIG_CONTENT"])["permission"] == outside

    st["sandbox"] = "read-only"
    cmd, env = opencode.command(st, job, "read", resume=False)
    bind_sources = [cmd[index + 1] for index, value in enumerate(cmd) if value == "--bind"]
    assert str(tmp_path) not in bind_sources
    permission = json.loads(env["OPENCODE_CONFIG_CONTENT"])["permission"]
    assert permission == {
        **outside,
        "edit": "deny",
        "bash": "deny",
        "webfetch": "deny",
        "websearch": "deny",
    }


def test_opencode_steer_survives_spawn_failure_and_is_redelivered(monkeypatch, tmp_path):
    job = tmp_path / "job"
    job.mkdir()
    (job / "steer").mkdir()
    (job / "steer/001.md").write_text("handle this steer")
    state_path = job / "state.json"
    st = {**state(tmp_path), "cwd": str(tmp_path)}
    monkeypatch.setattr(opencode, "command", lambda *args, **kwargs: (["opencode"], {}))
    monkeypatch.setattr(opencode, "runner_started", lambda *_: None)
    monkeypatch.setattr(opencode, "runner_finished", lambda *_: None)
    monkeypatch.setattr(
        opencode.subprocess,
        "Popen",
        lambda *args, **kwargs: (_ for _ in ()).throw(OSError("spawn failed")),
    )
    with pytest.raises(OSError, match="spawn failed"):
        opencode.run(job, st, state_path, "")
    assert (job / "steer/001.md").is_file()
    assert json.loads(state_path.read_text())["inflight"] == {"id": "steer-001", "file": "001.md"}

    commands, prompts = fake_turns(monkeypatch, [STOP, b""], [0])
    opencode.run(job, st, state_path, "", resume=True)
    assert prompts == [
        b"(redelivered after a runner restart; skip it if you already handled it)\nhandle this steer"
    ]
    assert (job / "steer/sent/001.md").is_file()
    assert json.loads(state_path.read_text())["inflight"] is None


@pytest.mark.parametrize("model", [
    "opencode/deepseek-v4.1-flash-free", "opencode/glm-5.3-flash-free",
    "opencode-go/gpt-6-luna",
])
def test_requested_model_variant_uses_the_private_native_server(monkeypatch, tmp_path, model):
    monkeypatch.setattr(opencode.Path, "home", lambda: tmp_path / "home")
    st = {**state(tmp_path), "model": model, "effort": None}
    command, _ = opencode.command(st, tmp_path / "job", "Reply only OK")
    assert any(str(value).endswith("opencode_supervisor.py") for value in command)
    assert command[command.index("-m") + 1] == model


def test_fixture_events_map_messages_tool_commands_and_usage(tmp_path):
    st = state(tmp_path)
    fixture = Path(__file__).parent / "fixtures" / "opencode.ndjson"
    for line in fixture.read_text().splitlines():
        opencode.process(json.loads(line), st, tmp_path)
    events = [json.loads(line) for line in (tmp_path / "live.jsonl").read_text().splitlines()]
    assert [event["kind"] for event in events] == [
        "thread_started",
        "message",
        "command_start",
        "command_end",
        "step_finished",
    ]
    assert events[-1]["level"] == "info"
    assert events[-1]["usage"]["input"] == 12 and events[-1]["cost"] == 0


def test_urgent_peer_message_routes(tmp_path):
    job, peer = tmp_path / "owner" / "worker", tmp_path / "owner" / "wake"
    job.mkdir(parents=True)
    peer.mkdir()
    (peer / "state.json").write_text("{}")
    opencode.process({"type": "text", "part": {"text": "URGENT: TO wake: check"}}, {}, job)
    assert (peer / "steer" / "001.md").read_text() == "[from worker] check\n"


def test_command_end_output_is_capped(tmp_path):
    opencode.process(
        {"type": "tool_use", "part": {"tool": "shell", "state": {"output": "x" * 2500}}},
        {},
        tmp_path,
    )
    event = json.loads((tmp_path / "live.jsonl").read_text().splitlines()[-1])
    assert len(event["output"]) == 2000


def test_free_tier_runs_only_zero_retention_models(tmp_path):
    for model in ("opencode/big-pickle", "opencode/mimo-v2.6-flash-free",
                  "opencode/minimax-m3.1-flash-free", ""):
        with pytest.raises(RuntimeError, match="zero-retention"):
            opencode.command({**state(tmp_path), "model": model, "effort": ""}, tmp_path, "p")
    assert not opencode.unreviewed_free("opencode/glm-5.3-flash-free")
    assert not opencode.unreviewed_free("openrouter/google/gemma-4-31b-it:free")  # provider's own terms
    assert not opencode.unreviewed_free("opencode-go/glm-5.3")


def fake_turns(monkeypatch, outputs, codes):
    """Each opencode process reads the next chunks from outputs (b"" ends it) and exits with the next code."""
    outputs, codes = deque(outputs), deque(codes)
    procs, commands, prompts = [], [], []

    class Input:
        def write(self, value):
            prompts.append(value)

        def close(self):
            pass

    class Process:
        def __init__(self, *args, **kwargs):
            self.pid, self.returncode = 100 + len(procs), codes.popleft()
            self.stdout = type("Output", (), {"fileno": lambda self: 42 + len(procs)})()
            self.stdin = Input()
            procs.append(self)

        def wait(self, timeout=None):
            return self.returncode

        def poll(self):
            return self.returncode

    def popen(cmd, **kwargs):
        commands.append(cmd)
        return Process()

    monkeypatch.setattr(opencode, "capped", lambda cmd, state=None: cmd)
    monkeypatch.setattr(opencode.subprocess, "Popen", popen)
    monkeypatch.setattr(opencode.select, "select", lambda *_: ([procs[-1].stdout], [], []))
    monkeypatch.setattr(opencode.os, "read", lambda *_: outputs.popleft())
    monkeypatch.setattr(opencode, "runner_started", lambda *_: None)
    monkeypatch.setattr(opencode, "runner_finished", lambda *_: None)
    return commands, prompts


STOP = b'{"type":"step_finish","sessionID":"sid","part":{"reason":"stop"}}\n'


def test_fragmented_fixture_replays_through_runner_before_one_terminal_receipt(monkeypatch, tmp_path):
    payload = (Path(__file__).parent / "fixtures/opencode.ndjson").read_bytes()
    chunks = [payload[index:index + 7] for index in range(0, len(payload), 7)]
    fake_turns(monkeypatch, [*chunks, b""], [0])
    opencode.run(tmp_path, state(tmp_path), tmp_path / "state.json", "Replay fixture")
    events = [json.loads(line) for line in (tmp_path / "live.jsonl").read_text().splitlines()]
    assert [event["kind"] for event in events].count("turn_completed") == 1
    completed = next(event for event in events if event["kind"] == "turn_completed")
    assert completed["status"] == "completed"
    assert events.index(completed) > next(index for index, event in enumerate(events)
                                         if event["kind"] == "step_finished")
    assert next(event for event in events if event["kind"] == "message")["text"] == "A short reply"
    assert next(event for event in events if event["kind"] == "step_finished")["usage"]["input"] == 12


def test_steer_runs_as_next_session_turn(monkeypatch, tmp_path):
    state_path, job = tmp_path / "state.json", tmp_path
    st = state(tmp_path)
    (job / "steer").mkdir()
    (job / "steer" / "001.md").write_text("next turn")
    (job / "steer" / "001.queue").touch()
    commands, prompts = fake_turns(monkeypatch, [STOP + b"{partial", b"", STOP, b""], [0, 0])
    opencode.run(job, st, state_path, "first prompt")
    assert len(commands) == 2
    assert "first prompt" not in commands[0] and prompts[0].endswith(b"first prompt")
    assert "next turn" not in commands[1] and prompts[1] == b"next turn"
    assert commands[1][commands[1].index("--session") + 1] == "sid"
    assert not (job / "steer" / "001.md").exists()
    assert not (job / "steer" / "001.queue").exists()
    assert (job / "steer" / "sent" / "001.md").exists()
    kinds = [json.loads(line)["kind"] for line in (job / "live.jsonl").read_text().splitlines()]
    assert kinds.count("turn_completed") == 2  # one per process, not per model step


def test_running_turn_delivers_steer_through_private_server(monkeypatch, tmp_path):
    (tmp_path / "steer").mkdir()
    announcement = b'{"bridge_server":"http://127.0.0.1:1234"}\n'
    native = b'{"type":"step_start","sessionID":"ses_worker","part":{}}\n'
    end = b'{"type":"step_finish","sessionID":"ses_worker","part":{"reason":"stop"}}\n'
    commands, prompts = fake_turns(monkeypatch, [announcement + native, end, b""], [0])
    deliveries = []

    def deliver(job, st, url, password, *, skip):
        if not deliveries:
            deliveries.append((st["sessionId"], url, password, skip))
            (job / "steer/001.md").write_text("Change course\n")
            (job / "steer/sent").mkdir()
            (job / "steer/001.md").rename(job / "steer/sent/001.md")

    monkeypatch.setattr(opencode, "steer_live", deliver)
    st = state(tmp_path)
    opencode.run(tmp_path, st, tmp_path / "state.json", "initial prompt")
    assert len(commands) == len(prompts) == 1
    assert deliveries[0][:2] == ("ses_worker", "http://127.0.0.1:1234")
    assert deliveries[0][3] == set()
    assert "bridge_server" not in (tmp_path / "stream.ndjson").read_text()
    assert (tmp_path / "steer/sent/001.md").exists()


def test_undelivered_native_steer_recovery_resumes_without_reprompting_it(monkeypatch, tmp_path):
    (tmp_path / "steer").mkdir()
    (tmp_path / "steer/001.md").write_text("change course")
    announcement = b'{"bridge_server":"http://127.0.0.1:1234"}\n'
    native = b'{"type":"step_start","sessionID":"ses_worker","part":{}}\n'
    end = b'{"type":"step_finish","sessionID":"ses_worker","part":{"reason":"stop"}}\n'
    _, prompts = fake_turns(monkeypatch, [announcement + native, end, b""], [0])
    monkeypatch.setattr(opencode, "recover_live_steer", lambda *_: None)

    def deliver(job, st, *_args, **_kwargs):
        if st.get("liveSteer"):
            (job / "steer/sent").mkdir(exist_ok=True)
            (job / "steer/001.md").rename(job / "steer/sent/001.md")
            st.pop("liveSteer")
        return True

    monkeypatch.setattr(opencode, "steer_live", deliver)
    st = {**state(tmp_path), "sessionId": "ses_worker", "liveSteer": {"file": "001.md"}}
    opencode.run(tmp_path, st, tmp_path / "state.json", "", resume=True)
    assert prompts == [b"Continue."]
    assert (tmp_path / "steer/sent/001.md").is_file()


def test_running_turn_uses_native_variant_once(monkeypatch, tmp_path):
    announcement = b'{"bridge_server":"http://127.0.0.1:1234"}\n'
    event = b'{"type":"step_start","sessionID":"ses_worker","part":{"messageID":"msg_assistant"}}\n'
    end = b'{"type":"step_finish","sessionID":"ses_worker","part":{"reason":"stop"}}\n'
    fake_turns(monkeypatch, [announcement + event + event, end, b""], [0])
    calls = []
    monkeypatch.setattr(opencode, "read_effective_variant", lambda *args: calls.append(args) or "default")
    monkeypatch.setattr(opencode, "steer_live", lambda *args, **kwargs: None)
    st = {**state(tmp_path), "effectiveEffort": "stale"}
    opencode.run(tmp_path, st, tmp_path / "state.json", "initial prompt")
    assert st["effectiveEffort"] == "default"
    assert len(calls) == 1


def test_denied_call_is_reported_and_worker_continues(monkeypatch, tmp_path):
    state_path, job = tmp_path / "state.json", tmp_path
    (job / "steer").mkdir()
    declined = {
        "type": "tool_use",
        "sessionID": "sid",
        "part": {
            "tool": "shell",
            "state": {"status": "error", "input": {"command": "cd /tmp"}, "error": opencode.DECLINED},
        },
    }
    aborted = {
        "type": "error",
        "sessionID": "sid",
        "error": {"type": "aborted", "message": "Step interrupted"},
    }
    first = (json.dumps(declined) + "\n" + json.dumps(aborted) + "\n").encode()
    commands, prompts = fake_turns(monkeypatch, [first, b"", STOP, b""], [1, 0])
    opencode.run(job, state(tmp_path), state_path, "first prompt")
    events = [json.loads(line) for line in (job / "live.jsonl").read_text().splitlines()]
    assert [e["denied"] for e in events if e["kind"] == "permission_denied"] == [["cd /tmp"]]
    assert not any(e["kind"] == "error" for e in events)
    assert len(commands) == 2 and "auto-denied" in prompts[1].decode()


def test_denial_does_not_hide_provider_error(monkeypatch, tmp_path):
    declined = {
        "type": "tool_use",
        "part": {
            "tool": "shell",
            "state": {"status": "error", "input": {"command": "cd /tmp"}, "error": opencode.DECLINED},
        },
    }
    provider_error = {"type": "error", "error": {"type": "provider", "message": "quota exhausted"}}
    output = (json.dumps(declined) + "\n" + json.dumps(provider_error) + "\n").encode()
    fake_turns(monkeypatch, [output, b""], [1])
    with pytest.raises(RuntimeError, match="opencode exited"):
        opencode.run(tmp_path, state(tmp_path), tmp_path / "state.json", "prompt")
    events = [json.loads(line) for line in (tmp_path / "live.jsonl").read_text().splitlines()]
    assert any(event["kind"] == "error" and "quota exhausted" in event["message"] for event in events)


def test_missing_finish_and_missing_resume_session_are_reported(monkeypatch, tmp_path):
    # a reply without step events is a completed turn; exit 0 with nothing is reported, not fatal
    reply, empty = b'{"type":"text","part":{"text":"reply"}}\n', b'{"type":"step_start","part":{}}\n'
    fake_turns(monkeypatch, [reply, b"", empty, b""], [0, 0])
    opencode.run(tmp_path / "a", state(tmp_path), tmp_path / "a.json", "prompt")
    opencode.run(tmp_path / "b", state(tmp_path), tmp_path / "b.json", "prompt")
    done = [json.loads(line) for line in (tmp_path / "a/live.jsonl").read_text().splitlines()]
    assert [e["status"] for e in done if e["kind"] == "turn_completed"] == ["completed"]
    events = [json.loads(line) for line in (tmp_path / "b/live.jsonl").read_text().splitlines()]
    assert any(event["kind"] == "turn_completed" and event["status"] == "incomplete" for event in events)
    assert any(event["kind"] == "error" and event["level"] == "urgent" for event in events)

    with pytest.raises(RuntimeError, match="session ID is missing"):
        opencode.run(
            tmp_path, {**state(tmp_path), "sessionId": ""}, tmp_path / "resume.json", "again", resume=True
        )

    (tmp_path / "steer").mkdir(exist_ok=True)
    (tmp_path / "steer" / "001.md").write_text("next")
    fake_turns(monkeypatch, [STOP, b"", b'{"type":"step_finish"}\n', b""], [0, 0])
    with pytest.raises(RuntimeError, match="turn had no session ID"):
        opencode.run(tmp_path, state(tmp_path), tmp_path / "state2.json", "prompt")
