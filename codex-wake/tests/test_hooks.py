import json
import types
from contextlib import contextmanager
from io import StringIO
from pathlib import Path

import pytest

from codex_wake import cli, hooks, monitor


@pytest.fixture
def host(monkeypatch, tmp_path):
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
    monkeypatch.delenv("AGENT_BRIDGE_WORKER", raising=False)
    monkeypatch.setattr(hooks.time, "sleep", lambda seconds: None)
    data = {"items": [], "status": "idle", "parent": "root", "turn": "child-turn", "parent_turn": "turn",
            "calls": [], "connections": 0}
    messages, launches = [], []

    class Target:
        thread, home = "root", Path("/codex-home")

        def __init__(self, thread, home=None):
            assert thread == "root"

        def check(self):
            pass

        def send(self, message):
            messages.append(message)

    def call(method, params):
        data["calls"].append((method, params))
        if method == "thread/read":
            name = params["threadId"]
            return {"thread": {"id": name, "parentThreadId": data["parent"] if name == "child" else None,
                               "status": {"type": data["status"] if name == "root" else "idle"}}}
        if method == "thread/turns/list":
            return {"data": [{"id": data["turn"] if params["threadId"] == "child" else data["parent_turn"]}]}
        assert params["threadId"] == "root"
        if method == "thread/backgroundTerminals/list":
            return {"data": [{"itemId": value["id"], "command": value["command"]}
                             for value in data["items"] if value["status"] == "inProgress"],
                    "nextCursor": None}
        assert method == "thread/items/read"
        return {"data": [{"turnId": "turn", "item": value} for value in data["items"]
                         if value["id"] in params["itemIds"] and not value.get("unpersisted")]}

    @contextmanager
    def connect(home):
        data["connections"] += 1
        yield call

    monkeypatch.setattr(hooks, "Wake", Target)
    monkeypatch.setattr(hooks, "connection", connect)
    monkeypatch.setattr(hooks.subprocess, "run", lambda command, **kwargs: launches.append((command, kwargs)))
    return Target("root"), data, messages, launches


def event(name, **fields):
    return {"hook_event_name": name, "session_id": "root", "turn_id": "turn", **fields}


def item(name="command", status="inProgress", command="make build", **fields):
    return {"id": name, "type": "commandExecution", "command": command, "cwd": "/workspace",
            "status": status, **fields}


def test_stop_arms_native_items_without_running_or_rewriting_the_command(host):
    target, data, messages, launches = host
    data["items"] = [item(), item("wrapped", command="codex-wake run -- make build"),
                     item("bridge", command="agent-bridge watch example --until-event"),
                     item("watched", command="agent-bridge start example --watch=1800"),
                     item("opaque", command="cat <<EOF\nit's valid shell\nEOF"),
                     item("done", "completed")]
    hooks.handle(event("Stop"))
    assert len(launches) == 1 and not messages
    job = json.loads(Path(launches[0][0][-1]).read_text())
    assert job["items"] == ["command"] and job["thread"] == target.thread


@pytest.mark.parametrize("code", [0, 7, None])
def test_observer_captures_result_once_and_has_no_os_pid_dependency(host, code):
    target, data, messages, _ = host
    folder = hooks.directory(target)
    generation = hooks.epoch(folder)
    data["items"] = [item(status="failed" if code else "completed", exitCode=code,
                          aggregatedOutput="captured output")]
    job = {"thread": "root", "home": "/codex-home", "generation": generation,
           "turn": "turn", "items": ["command"]}
    hooks.observe(job, folder)
    hooks.observe(job, folder)
    assert len(messages) == 1 and f"exit status {code if code is not None else 'unknown'}" in messages[0]
    log = next(folder.glob("*.log"))
    context, output = log.read_text().split("\n\n", 1)
    assert json.loads(context) == {"item_id": "command", "turn_id": "turn",
                                   "command": "make build", "cwd": "/workspace"}
    assert output == "captured output" and log.stat().st_mode & 0o777 == 0o600
    assert "Native item: command" in messages[0] and "make build" not in messages[0]


@pytest.mark.parametrize("name", ["Interrupt", "SessionEnd"])
def test_human_lifecycle_cancels_older_observers(host, name):
    target, data, messages, _ = host
    folder = hooks.directory(target)
    generation = hooks.epoch(folder)
    hooks.handle(event(name))
    hooks.observe({"thread": "root", "home": "/codex-home", "generation": generation,
                   "turn": "turn", "items": ["command"]}, folder)
    assert not messages


def test_input_blocked_parent_is_not_woken(host, monkeypatch):
    target, data, messages, _ = host
    folder = hooks.directory(target)
    data["status"] = "active"
    data["items"] = [item(status="completed", exitCode=0)]
    monkeypatch.setattr(hooks.time, "sleep", lambda seconds: hooks.handle(event("Interrupt")))
    hooks.observe({"thread": "root", "home": "/codex-home", "generation": hooks.epoch(folder),
                   "turn": "turn", "items": ["command"]}, folder)
    assert not messages


def test_subagent_finish_verifies_parent_and_deduplicates_by_child_turn(host):
    _, data, messages, _ = host
    hooks.handle(event("SubagentStart", agent_id="child"))
    hooks.handle(event("UserPromptSubmit", agent_id="child"))  # child's prompt must not cancel its parent
    stopped = event("SubagentStop", agent_id="child", last_assistant_message="Blocked: need a decision")
    hooks.handle(stopped)
    hooks.handle({**stopped, "last_assistant_message": "Same incident, updated wording"})
    assert len(messages) == 1 and "Subagent reported" in messages[0]
    data["turn"] = "later-child-turn"
    hooks.handle(stopped)
    assert len(messages) == 2


@pytest.mark.parametrize("condition", ["unverified", "wrong-parent", "active", "interrupted", "continued"])
def test_subagent_recovery_fails_closed(host, monkeypatch, condition):
    _, data, messages, _ = host
    if condition != "unverified":
        hooks.handle(event("SubagentStart", agent_id="child"))
    if condition == "wrong-parent":
        data["parent"] = "different-root"
    if condition == "active":
        data["status"] = "active"
    if condition == "interrupted":
        hooks.handle(event("Interrupt"))
    if condition == "continued":
        monkeypatch.setattr(hooks.time, "sleep", lambda seconds: data.update(parent_turn="already-continued"))
    if condition == "wrong-parent":
        with pytest.raises(RuntimeError, match="parent was not verified"):
            hooks.handle(event("SubagentStop", agent_id="child", last_assistant_message="result"))
    else:
        hooks.handle(event("SubagentStop", agent_id="child", last_assistant_message="result"))
    assert not messages


def test_bridge_worker_keeps_its_existing_delivery(host, monkeypatch):
    _, data, messages, launches = host
    data["items"] = [item()]
    monkeypatch.setenv("AGENT_BRIDGE_WORKER", "1")
    hooks.handle(event("Stop"))
    assert not launches and not messages


def test_uncertain_delivery_never_retries(host, monkeypatch):
    target, _, messages, _ = host
    folder = hooks.directory(target)

    def fail(message):
        messages.append(message)
        raise RuntimeError("receipt lost")

    monkeypatch.setattr(target, "send", fail)
    with pytest.raises(RuntimeError, match="receipt lost"):
        hooks.deliver(target, folder, hooks.epoch(folder), "incident", "Done", "output")
    hooks.deliver(target, folder, hooks.epoch(folder), "incident", "Done", "output")
    assert len(messages) == 1


def test_launcher_only_executes_the_fixed_delivery_observer(host):
    target, _, _, launches = host
    folder = hooks.directory(target)
    hooks.launch(target, folder, hooks.epoch(folder), "turn", ["command"])
    command, options = launches[0]
    assert command[:5] == ["systemd-run", "--user", "--quiet", "--collect", "--service-type=exec"]
    assert command[-3:-1] == ["-m", "codex_wake.hooks"]
    assert options == {"check": True, "capture_output": True, "timeout": 10}
    assert not any("make build" in argument for argument in command)


def test_pagination_rejects_cycles():
    with pytest.raises(RuntimeError, match="cursor"):
        list(hooks.pages(lambda *args: {"data": [], "nextCursor": "same"}, "method", {}))


def test_hook_entrypoint_reads_stdin_without_treating_hook_as_a_job_filename(host, monkeypatch, capsys):
    monkeypatch.setattr(hooks.sys, "stdin", StringIO(json.dumps(event("Interrupt"))))
    assert cli.main(["hook"]) == 0
    assert capsys.readouterr().out == "{}\n"


def test_service_entrypoint_uses_the_captured_job_and_state_directory(host):
    target, data, messages, _ = host
    folder = hooks.directory(target)
    data["items"] = [item(status="completed", exitCode=0, aggregatedOutput="done")]
    job = folder / "test-job.json"
    hooks.private_write(job, json.dumps({"thread": "root", "home": "/codex-home",
                                        "generation": hooks.epoch(folder), "turn": "turn",
                                        "items": ["command"]}))
    assert hooks.main(str(job)) == 0 and len(messages) == 1


def test_command_survives_a_new_prompt_and_wakes_once_after_completion(host, monkeypatch):
    target, data, messages, launches = host
    data["items"] = [item()]
    hooks.handle(event("Stop"))
    job = json.loads(Path(launches[0][0][-1]).read_text())
    hooks.handle(event("UserPromptSubmit", turn_id="later-turn"))
    data.update(status="active", parent_turn="later-turn")

    def finish(seconds):
        data.update(status="idle", items=[item(status="completed", exitCode=0)])

    monkeypatch.setattr(hooks.time, "sleep", finish)
    hooks.observe(job, hooks.directory(target))
    hooks.observe(job, hooks.directory(target))
    assert len(messages) == 1 and "exit status 0" in messages[0]


def test_stop_does_not_rearm_an_item_in_a_later_turn(host):
    _, data, _, launches = host
    data["items"] = [item()]
    hooks.handle(event("Stop"))
    hooks.handle(event("UserPromptSubmit", turn_id="later-turn"))
    hooks.handle(event("Stop", turn_id="later-turn"))
    assert len(launches) == 1


def test_subagent_result_survives_an_earlier_parent_prompt(host):
    _, data, messages, _ = host
    hooks.handle(event("SubagentStart", agent_id="child"))
    hooks.handle(event("UserPromptSubmit", turn_id="later-turn"))
    data["parent_turn"] = "later-turn"
    hooks.handle(event("SubagentStop", agent_id="child", last_assistant_message="Result"))
    assert len(messages) == 1


def test_observer_reuses_connection_reads_only_watched_items_and_backs_off(host, monkeypatch):
    target, data, messages, _ = host
    folder = hooks.directory(target)
    data["items"] = [item()] + [item(f"history-{i}", status="completed") for i in range(200)]
    waits = []

    def finish(seconds):
        waits.append(seconds)
        if len(waits) == 6:
            data["items"][0].update(status="completed", exitCode=0)

    monkeypatch.setattr(hooks.time, "sleep", finish)
    hooks.observe({"thread": "root", "home": "/codex-home", "generation": hooks.epoch(folder),
                   "turn": "turn", "items": ["command"]}, folder)
    assert data["connections"] == 1 and len(messages) == 1
    assert waits == [2, 4, 8, 16, 30, 30]
    assert all(method != "thread/items/list" for method, _ in data["calls"])
    assert all(params["itemIds"] == ["command"] for method, params in data["calls"]
               if method == "thread/items/read")


def test_running_terminal_can_be_absent_from_persisted_history_until_completion(host, monkeypatch):
    target, data, messages, _ = host
    folder = hooks.directory(target)
    data["items"] = [item(unpersisted=True)]
    waits = []

    def finish(seconds):
        waits.append(seconds)
        if len(waits) == 3:
            data["items"] = [item(status="failed", exitCode=7, aggregatedOutput="native completion")]

    monkeypatch.setattr(hooks.time, "sleep", finish)
    hooks.observe({"thread": "root", "home": "/codex-home", "generation": hooks.epoch(folder),
                   "turn": "turn", "items": ["command"]}, folder)
    assert waits == [2, 4, 8]
    assert len(messages) == 1 and "exit status 7" in messages[0]
    assert next(folder.glob("*.log")).read_text().split("\n\n", 1)[1] == "native completion"


def test_stop_page_budget_is_bounded():
    calls = []

    def next_page(method, params):
        calls.append(params)
        return {"data": [], "nextCursor": str(len(calls))}

    with pytest.raises(RuntimeError, match="page budget"):
        list(hooks.pages(next_page, "thread/backgroundTerminals/list", {}))
    assert len(calls) == hooks.STOP_PAGES and all(call["limit"] == 32 for call in calls)


def test_completed_output_is_not_refetched_while_parent_is_busy(host, monkeypatch):
    target, data, messages, _ = host
    folder = hooks.directory(target)
    data.update(status="active", items=[item(status="completed", exitCode=0, aggregatedOutput="cached")])
    waits = []

    def idle(seconds):
        waits.append(seconds)
        if len(waits) == 3:
            data["status"] = "idle"

    monkeypatch.setattr(hooks.time, "sleep", idle)
    hooks.observe({"thread": "root", "home": "/codex-home", "generation": hooks.epoch(folder),
                   "turn": "turn", "items": ["command"]}, folder)
    assert len(messages) == 1 and waits == [2, 4, 8]
    assert sum(method == "thread/items/read" for method, _ in data["calls"]) == 1


@pytest.mark.parametrize("collected_first", [True, False])
def test_final_native_poll_retires_only_its_command_across_parent_turns(host, monkeypatch, collected_first):
    target, data, messages, _ = host
    folder = hooks.directory(target)
    data.update(status="active", items=[item(status="failed", exitCode=7),
                                        item("uncollected", status="completed", exitCode=0)])

    def collect():
        hooks.handle(event("PostToolUse", turn_id="later-turn", tool_name="Bash",
                           tool_use_id="command", tool_response="collected native result"))

    if collected_first:
        collect()

    def idle(seconds):
        collect()
        data["status"] = "idle"

    monkeypatch.setattr(hooks.time, "sleep", idle)
    hooks.observe({"thread": "root", "home": "/codex-home", "generation": hooks.epoch(folder),
                   "turn": "turn", "items": ["command", "uncollected"]}, folder)
    assert len(messages) == 1 and "Native item: uncollected" in messages[0]
    assert "exit status 0" in messages[0]
    assert not (folder / (hooks.key("command:command") + ".sent")).exists()


def test_redirected_command_retains_identity_without_putting_arguments_in_notification(host):
    target, data, messages, _ = host
    folder = hooks.directory(target)
    command = "pytest > /private/results.log 2>&1"
    data["items"] = [item(command=command, status="failed", exitCode=1, aggregatedOutput=None)]
    hooks.observe({"thread": "root", "home": "/codex-home", "generation": hooks.epoch(folder),
                   "turn": "turn", "items": ["command"]}, folder)
    context, output = next(folder.glob("*.log")).read_text().split("\n\n", 1)
    assert json.loads(context)["command"] == command and output == ""
    assert "Native item: command" in messages[0] and "/private/results.log" not in messages[0]


def test_other_tool_completion_does_not_suppress_a_shell_result(host):
    target, _, _, _ = host
    folder = hooks.directory(target)
    hooks.handle(event("PostToolUse", tool_name="mcp__example__read", tool_use_id="command"))
    assert not (folder / (hooks.key("command:command") + ".handled")).exists()


MONITOR = "codex-wake monitor --cooldown 1m --max-events 2 --ttl 1h -- test -f /tmp/ready"


def test_a_running_monitor_wakes_an_idle_session_only_within_its_limits(host, monkeypatch):
    target, data, messages, launches = host
    data["items"] = [item("watch", command=MONITOR)]
    hooks.handle(event("Stop"))
    job = json.loads(Path(launches[0][0][-1]).read_text())
    policy = {"every": 10, "ttl": 3600, "cooldown": 60, "max_events": 2, "distinct": False}
    assert job["items"] == ["watch"] and job["monitors"] == {"watch": policy}

    clock, ticks = {"now": 1000.0}, {"n": 0}

    def sleep(seconds):  # every 20 s the monitor prints one more hit; after 8 ticks it ends on its own
        ticks["n"] += 1
        clock["now"] += 20
        output = "\n".join(f"{monitor.EVENT} {i} at={i}s suppressed=0" for i in range(1, ticks["n"] + 1))
        done = ticks["n"] >= 8
        closing = f"\n{monitor.END} reason=ttl events={ticks['n']}" if done else ""
        data["items"] = [item("watch", "completed" if done else "inProgress", command=MONITOR,
                              exitCode=0 if done else None, aggregatedOutput=output + closing)]

    monkeypatch.setattr(hooks, "time", types.SimpleNamespace(sleep=sleep, monotonic=lambda: clock["now"]))
    hooks.observe(job, hooks.directory(target))
    # the first hit at once; the next three arrive inside the cooldown and are coalesced into one
    # notice a minute later; the cap of two is then spent, so the rest wait for the closing notice
    assert len(messages) == 3
    assert "1 new hit(s), 1 so far" in messages[0]
    assert "3 new hit(s), 4 so far" in messages[1]
    assert "Background command ended" in messages[2]
    assert all("test -f" not in message for message in messages)  # the command's text is never in a notice


def test_a_monitor_that_cannot_be_trusted_gets_no_live_notices(host):
    _, data, _, launches = host
    data["items"] = [item("watch", command="codex-wake monitor --every 1s -- true")]  # under the floor
    hooks.handle(event("Stop"))
    # observed to the end as an ordinary command
    assert json.loads(Path(launches[0][0][-1]).read_text())["monitors"] == {}


@pytest.mark.parametrize("state_home", [None, "", "relative/state", "~/.state"])
def test_nonabsolute_state_home_uses_private_home_default(host, monkeypatch, tmp_path, state_home):
    target, _, _, _ = host
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "home")
    if state_home is None:
        monkeypatch.delenv("XDG_STATE_HOME", raising=False)
    else:
        monkeypatch.setenv("XDG_STATE_HOME", state_home)
    assert hooks.directory(target).is_relative_to(tmp_path / "home/.local/state/codex-wake")
