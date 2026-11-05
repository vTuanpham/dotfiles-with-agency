import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from dataclasses import replace
from pathlib import Path

import pytest
from test_inbox import request

from agent_inbox import claude, claude_questions
from agent_inbox.claude_channel import channel_path, profile_channels
from agent_inbox.models import NoLongerPending, Target
from agent_inbox.server import App, Server
from agent_inbox.store import Store

INPUT = {"questions": [
    {"question": "Which checks?", "header": "Checks", "multiSelect": True,
     "options": [{"label": "Unit", "description": "Focused"}, {"label": "API", "description": "Native"}]},
    {"question": "Any constraints?", "header": "Constraints", "multiSelect": False,
     "options": [{"label": "Keep state", "description": "Preserve the draft"},
                 {"label": "Fresh state", "description": "Reset the draft"}]}],
         "annotations": {"source": "native"}}


def target(home):
    config = home / "profile"
    return Target("claude", "claude", "Claude", str(uuid.uuid4()), "Root", {
        "command": "/bin/claude", "config_dir": str(config),
        "channels": str(profile_channels(home, config))})


@pytest.mark.parametrize("cancel", [False, True])
def test_real_hook_process_exposes_native_question_and_returns_exact_answer_or_denial(cancel):
    with tempfile.TemporaryDirectory(prefix="iq-") as directory:
        home = Path(directory)
        selected = target(home)
        store = Store(home)
        store.register(selected)
        store.pair(store.pair_code(), "Test phone")
        native = {"hook_event_name": "PreToolUse", "session_id": selected.session_id,
                  "tool_name": "AskUserQuestion", "tool_use_id": "tool-native", "tool_input": INPUT}
        env = {**os.environ, "CLAUDE_CONFIG_DIR": selected.settings["config_dir"]}
        process = subprocess.Popen([sys.executable, "-m", "agent_inbox.cli", "--state", str(home),
                                    "claude-question"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, env=env)
        try:
            process.stdin.write(json.dumps(native).encode())
            process.stdin.close()
            path = channel_path(selected.settings["channels"], selected.session_id).with_suffix(".q")
            deadline = time.monotonic() + 5
            while not path.exists() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(0.01)
            assert path.exists(), "Native hook did not publish its callback"
            forms = claude_questions.forms(selected).forms
            assert len(forms) == 1 and forms[0].id == "tool-native"
            assert forms[0].fields[0].kind == "multiselect" and forms[0].fields[1].custom
            foreign = replace(selected, settings={**selected.settings, "config_dir": str(home / "foreign")})
            with pytest.raises(RuntimeError):
                claude_questions.forms(foreign)
            values = {} if cancel else {"0": ["API", "Unit"], "1": "Keep the draft"}
            assert claude_questions.answer(selected, forms[0].id, values, cancel) == "applied"
            assert process.wait(timeout=5) == 0
            output = json.loads(process.stdout.read())["hookSpecificOutput"]
            assert output["hookEventName"] == "PreToolUse"
            if cancel:
                assert output["permissionDecision"] == "deny" and "updatedInput" not in output
            else:
                assert output["permissionDecision"] == "allow"
                assert output["updatedInput"] == {**INPUT, "answers": {
                    "Which checks?": "API, Unit", "Any constraints?": "Keep the draft"}}
            assert claude_questions.forms(selected).forms == []
            with pytest.raises(NoLongerPending):
                claude_questions.answer(selected, forms[0].id, values, cancel)
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
            process.stdout.close()
            process.stderr.close()


def test_unanswered_callback_expires_without_answering_or_denying_native_question():
    with tempfile.TemporaryDirectory(prefix="iq-") as directory:
        selected, result = target(Path(directory)), []
        thread = threading.Thread(target=lambda: result.append(
            claude_questions.serve(selected, "native", INPUT, timeout=0.05)))
        thread.start()
        thread.join(timeout=2)
        assert not thread.is_alive() and result == [{}]
        assert claude_questions.forms(selected).forms == []


@pytest.mark.parametrize("cancel", [False, True])
def test_paired_http_answer_completes_real_hook_and_cannot_resurrect_on_restart(cancel, monkeypatch):
    with tempfile.TemporaryDirectory(prefix="iq-") as directory:
        home = Path(directory)
        selected = target(home)
        monkeypatch.setattr(claude, "root", lambda selected: {"status": "waiting"})
        store = Store(home)
        store.register(selected)
        _, token = store.pair(store.pair_code(), "Test phone")
        app = App(store)
        app.catalog.checked = time.monotonic()
        app.catalog.live = {selected.id: selected}
        server = Server(app, 0)
        serving = threading.Thread(target=server.serve_forever)
        serving.start()
        process = subprocess.Popen([sys.executable, "-m", "agent_inbox.cli", "--state", str(home),
                                    "claude-question"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE,
                                   env={**os.environ, "CLAUDE_CONFIG_DIR": selected.settings["config_dir"]})
        try:
            native = {"hook_event_name": "PreToolUse", "session_id": selected.session_id,
                      "tool_name": "AskUserQuestion", "tool_use_id": "tool-http", "tool_input": INPUT}
            process.stdin.write(json.dumps(native).encode())
            process.stdin.close()
            path = channel_path(selected.settings["channels"], selected.session_id).with_suffix(".q")
            deadline = time.monotonic() + 5
            while not path.exists() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(0.01)
            assert path.exists(), "Native hook did not publish its callback"
            cookie = "inbox=" + token
            status, _, forms = request(server, "GET", "/api/forms?id=" + selected.id, cookie=cookie)
            assert status == 200 and [form["id"] for form in forms["forms"]] == ["tool-http"]
            payload = {"id": str(uuid.uuid4()), "target": selected.id, "form": "tool-http",
                       "answer": {} if cancel else {"0": ["API"], "1": "Keep the draft"},
                       "cancel": cancel}
            status, _, result = request(server, "POST", "/api/answer", payload, cookie)
            assert status == 200 and result["status"] == "applied"
            assert process.wait(timeout=5) == 0
            output = json.loads(process.stdout.read())["hookSpecificOutput"]
            assert output["permissionDecision"] == ("deny" if cancel else "allow")
            if not cancel:
                assert output["updatedInput"]["answers"] == {
                    "Which checks?": "API", "Any constraints?": "Keep the draft"}
            assert request(server, "GET", "/api/forms?id=" + selected.id, cookie=cookie)[2]["forms"] == []
            restarted = App(Store(home))
            assert restarted.answer(payload)["status"] == "applied"
            assert restarted.answer({**payload, "id": str(uuid.uuid4())})["status"] == "already_answered"
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
            process.stdout.close()
            process.stderr.close()
            server.shutdown()
            server.server_close()
            serving.join(timeout=5)


def test_malformed_question_and_duplicate_native_labels_fail_closed():
    with pytest.raises(ValueError):
        claude_questions.question("native", {"questions": "wrong"})
    with pytest.raises(ValueError):
        claude_questions.question("native", {"questions": [INPUT["questions"][0]] * 2})


def test_unregistered_profile_unpaired_devices_and_other_tools_stay_native(tmp_path, monkeypatch):
    store = Store(tmp_path)
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "profile"))
    for value in ({"tool_name": "Bash"}, {"hook_event_name": "PreToolUse", "tool_name": "AskUserQuestion"}):
        assert claude_questions.hook(store, json.dumps(value)) == {}
