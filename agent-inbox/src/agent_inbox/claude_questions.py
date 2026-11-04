"""Own a PreToolUse callback until a paired user answers, then return the native hook result."""

import fcntl
import json
import os
import socket
import stat
import time
from dataclasses import replace
from pathlib import Path

from .claude_channel import channel_call, channel_path, profile_id
from .commands import Choice
from .forms import FormField, Forms, QuestionForm
from .models import DeliveryRejected, NoLongerPending, decode_json, fields, text


def question(identifier, value):
    if type(value) is not dict or type(value.get("questions")) is not list:
        raise ValueError("Invalid native question input")
    if not 1 <= len(value["questions"]) <= 4:
        raise ValueError("Invalid native question count")
    result, labels = [], set()
    for index, row in enumerate(value["questions"]):
        if type(row) is not dict or type(row.get("multiSelect")) is not bool:
            raise ValueError("Invalid native question")
        label = text(row.get("question"), "native question")
        text(row.get("header"), "native question header", 12)
        if (label in labels or type(row.get("options")) is not list
                or not 2 <= len(row["options"]) <= 4):
            raise ValueError("Ambiguous native question")
        labels.add(label)
        choices = []
        for option in row["options"]:
            if type(option) is not dict:
                raise ValueError("Invalid native question option")
            native = text(option.get("label"), "native option")
            description = option.get("description")
            if type(description) is not str or len(description) > 16384:
                raise ValueError("Invalid native option description")
            choices.append(Choice(native, native + (" — " + description if description else "")))
        if len({choice.value for choice in choices}) != len(choices):
            raise ValueError("Ambiguous native options")
        result.append(FormField(str(index), label, "multiselect" if row["multiSelect"] else "string",
                                required=True, choices=choices, custom=True,
                                constraints={"minItems" if row["multiSelect"] else "minLength": 1}))
    return QuestionForm(text(identifier, "native question id", 200), "Claude question", result)


def forms(target):
    if not channel_path(target.settings["channels"], target.session_id).with_suffix(".q").exists():
        return Forms([])
    try:
        value = channel_call(target, "get", question=True)
    except (FileNotFoundError, ConnectionRefusedError):
        return Forms([])
    return Forms([question(value["id"], value["input"])])


def answer(target, identifier, values, cancel=False):
    if not channel_path(target.settings["channels"], target.session_id).with_suffix(".q").exists():
        raise NoLongerPending("This native question is no longer pending")
    try:
        result = channel_call(target, "answer", {"id": identifier, "answer": values, "cancel": cancel},
                              question=True)
    except (FileNotFoundError, ConnectionRefusedError):
        raise NoLongerPending("This native question is no longer pending") from None
    if result != {"id": identifier, "status": "applied"}:
        raise RuntimeError("Native hook did not confirm the answer")
    return "applied"


def serve(target, identifier, tool_input, timeout=295):
    form = question(identifier, tool_input)
    path = channel_path(target.settings["channels"], target.session_id).with_suffix(".q")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.parent.chmod(0o700)
    profile = profile_id(target.settings["config_dir"])
    descriptor = os.open(path.with_suffix(".qlock"), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if path.exists():
            if not stat.S_ISSOCK(path.lstat().st_mode):
                raise ValueError("Question path is not a socket")
            path.unlink()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
            listener.bind(str(path))
            path.chmod(0o600)
            listener.listen(4)
            deadline = time.monotonic() + timeout
            try:
                while time.monotonic() < deadline:
                    listener.settimeout(max(0.001, deadline - time.monotonic()))
                    try:
                        connection, _ = listener.accept()
                    except TimeoutError:
                        break
                    output = None
                    with connection:
                        connection.settimeout(min(5, max(0.001, deadline - time.monotonic())))
                        try:
                            with connection.makefile("rb") as stream:
                                raw = stream.readline(1024 * 1024 + 1)
                            if len(raw) > 1024 * 1024 or not raw.endswith(b"\n"):
                                raise ValueError("Invalid question request")
                            request = decode_json(raw)
                            fields(request, ("session_id", "profile", "method"), ("message",))
                            if request["session_id"] != target.session_id or request["profile"] != profile:
                                raise ValueError("Wrong native question scope")
                            if request["method"] == "get" and "message" not in request:
                                result = {"id": form.id, "input": tool_input}
                            elif request["method"] == "answer":
                                reply = fields(request["message"], ("id", "answer", "cancel"))
                                if reply["id"] != form.id or type(reply["cancel"]) is not bool:
                                    raise ValueError("Wrong native question")
                                if reply["cancel"]:
                                    if reply["answer"] != {}:
                                        raise ValueError("Cancellation has no answer")
                                    output = {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                              "permissionDecisionReason": "The user cancelled this question."}
                                else:
                                    form.validate(reply["answer"])
                                    answers = {f.label: ", ".join(reply["answer"][f.key])
                                               if f.kind == "multiselect" else reply["answer"][f.key]
                                               for f in form.fields}
                                    output = {"hookEventName": "PreToolUse", "permissionDecision": "allow",
                                              "updatedInput": {**tool_input, "answers": answers}}
                                result = {"id": form.id, "status": "applied"}
                            else:
                                raise ValueError("Unknown question operation")
                            response = {"session_id": target.session_id, "profile": profile,
                                        "ok": True, "result": result}
                        except (ValueError, KeyError, TypeError, DeliveryRejected):
                            response = {"session_id": target.session_id, "profile": profile,
                                        "ok": False, "result": {"rejected": True}}
                        try:
                            connection.sendall(json.dumps(response).encode() + b"\n")
                        except OSError:
                            pass  # The callback outcome is uncertain; never reopen an answered request.
                    if output is not None:
                        return {"hookSpecificOutput": output}
            finally:
                path.unlink(missing_ok=True)
    return {}  # No answer: leave the native question flow unchanged.


def hook(store, raw):
    value = decode_json(raw)
    if (type(value) is not dict or value.get("hook_event_name") != "PreToolUse"
            or value.get("tool_name") != "AskUserQuestion"):
        return {}
    config = str(Path(os.environ.get("CLAUDE_CONFIG_DIR", str(Path.home() / ".claude"))).resolve())
    selected = [t for t in store.targets() if t.adapter == "claude"
                and str(Path(t.settings["config_dir"]).resolve()) == config]
    if len(selected) != 1 or not store.devices():
        return {}
    if type(value.get("tool_input")) is not dict:
        raise ValueError("Invalid native question input")
    if value["tool_input"].get("answers"):
        return {}
    target = replace(selected[0], session_id=value["session_id"])
    return serve(target, value["tool_use_id"], value["tool_input"])
