import json
import subprocess
import uuid
from types import SimpleNamespace

import pytest

from agent_bridge import agy_messages, core, messages, opencode_messages


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    monkeypatch.setattr(core, "HOME", tmp_path / "bridge")
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path / "state"))
    for name in ("ANTIGRAVITY_CONVERSATION_ID", "OPENCODE", "OPENCODE_SESSION_ID"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("CODEX_THREAD_ID", "sender")


def packet(target):
    return {
        "version": 1,
        "id": str(uuid.uuid4()),
        "sender": "codex:sender",
        "recipient": target,
        "text": "Check the shared work; this is peer content",
    }


def test_opencode_steers_synthetic_input_and_validates_native_target(monkeypatch):
    calls = []

    class API:
        def call(self, method, path, body=None):
            calls.append((method, path, body))
            if method == "GET":
                return {"data": {"id": "ses_recipient", "time": {"created": 1}}}
            return {
                "data": {
                    "id": "msg_native",
                    "sessionID": "ses_recipient",
                    "type": "synthetic",
                    "delivery": "steer",
                }
            }

    monkeypatch.setattr(opencode_messages, "Connection", API)
    receipt = messages.send("opencode:ses_recipient", "Please inspect the shared file")
    assert receipt["status"] == "accepted" and receipt["native_id"] == "msg_native"
    method, path, body = calls[1]
    assert (method, path) == ("POST", "/api/session/ses_recipient/synthetic")
    assert body["delivery"] == "steer"
    assert body["metadata"]["bridge_sender"] == "codex:sender"
    assert "From: codex:sender" in body["text"]
    assert not any("prompt" in row[1] for row in calls)


@pytest.mark.parametrize(
    "bad",
    [
        {"id": "msg_x", "sessionID": "ses_other", "type": "synthetic", "delivery": "steer"},
        {"id": "msg_x", "sessionID": "ses_recipient", "type": "user", "delivery": "steer"},
        {"id": "msg_x", "sessionID": "ses_recipient", "type": "synthetic", "delivery": "queue"},
    ],
)
def test_opencode_wrong_or_queued_receipt_never_retries(monkeypatch, bad):
    calls = []

    class API:
        def call(self, method, path, body=None):
            calls.append(method)
            return {"data": {"id": "ses_recipient", "time": {}} if method == "GET" else bad}

    monkeypatch.setattr(opencode_messages, "Connection", API)
    with pytest.raises(RuntimeError, match="may have succeeded"):
        opencode_messages.send(packet("opencode:ses_recipient"))
    assert calls == ["GET", "POST"]


def test_opencode_private_service_auth_and_process_identity(monkeypatch, tmp_path):
    path = tmp_path / "state/opencode/service.json"
    path.parent.mkdir(parents=True)
    core.atomic_save(
        path, {"url": "http://127.0.0.1:12345", "pid": 42, "version": "2.2.2", "password": "fixture-secret"}
    )
    calls = []

    def call(self, method, route, body=None):
        calls.append((method, route, self.port, self.headers))
        return {"pid": 42, "version": "2.2.2"}

    monkeypatch.setattr(opencode_messages.Connection, "call", call)
    api = opencode_messages.Connection()
    assert calls[0][:3] == ("GET", "/api/info", 12345)
    assert api.headers["Authorization"].startswith("Basic ")
    core.atomic_save(
        path,
        {"url": "http://external.invalid:12345", "pid": 42, "version": "2.2.2", "password": "fixture-secret"},
    )
    with pytest.raises(ValueError, match="local"):
        opencode_messages.Connection()
    assert len(calls) == 1


@pytest.fixture
def agy(monkeypatch):
    session = "00000000-0000-0000-0000-000000000001"
    monkeypatch.setenv("ANTIGRAVITY_CONVERSATION_ID", session)
    monkeypatch.setenv("ANTIGRAVITY_LS_ADDRESS", "127.0.0.1:12345")
    monkeypatch.setenv("ANTIGRAVITY_CSRF_TOKEN", "fixture-native-credential")
    monkeypatch.setattr(agy_messages.shutil, "which", lambda _: "/native/agy")
    calls = []

    def run(args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(returncode=0, stdout=b'{"response":{}}')

    monkeypatch.setattr(agy_messages.subprocess, "run", run)
    return session, calls


def test_agy_registers_private_connection_and_uses_native_agentapi(agy):
    session, calls = agy
    result = agy_messages.register()
    assert result["address"] == "agy:" + session
    assert "credential" not in json.dumps(result)
    assert agy_messages.sessions() == [
        {"address": "agy:" + session, "status": "registered; liveness checked when sending"}
    ]
    binding = next((core.HOME / "messages").glob("*/endpoint.json"))
    assert binding.stat().st_mode & 0o777 == 0o600
    result = agy_messages.send(packet("agy:" + session))
    assert result["status"] == "accepted"
    assert calls[0][0] == ["/native/agy", "agentapi", "get-conversation-metadata", session]
    assert calls[1][0][:4] == ["/native/agy", "agentapi", "send-message", session]
    assert "From: codex:sender" in calls[1][0][4]
    assert calls[1][1]["env"]["ANTIGRAVITY_CSRF_TOKEN"] == "fixture-native-credential"
    assert "credential" not in json.dumps(result)


def test_agy_rejection_prevents_send_and_never_uses_human_prompt(agy, monkeypatch):
    session, calls = agy
    agy_messages.register()

    def reject(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=1, stdout=b'{"error":"private diagnostic"}')

    monkeypatch.setattr(agy_messages.subprocess, "run", reject)
    with pytest.raises(RuntimeError, match="no chat fallback") as error:
        agy_messages.send(packet("agy:" + session))
    assert "private diagnostic" not in str(error.value)
    assert len(calls) == 1 and calls[0][2] == "get-conversation-metadata"


def test_agy_unknown_delivery_never_retries(agy, monkeypatch):
    session, calls = agy
    agy_messages.register()
    original = agy_messages.subprocess.run

    def timeout(args, **kwargs):
        if args[2] == "send-message":
            calls.append((args, kwargs))
            raise subprocess.TimeoutExpired(args, 10)
        return original(args, **kwargs)

    monkeypatch.setattr(agy_messages.subprocess, "run", timeout)
    with pytest.raises(RuntimeError, match="do not retry"):
        agy_messages.send(packet("agy:" + session))
    assert len(calls) == 2


def test_agy_rejects_remote_connection_before_saving(agy, monkeypatch):
    monkeypatch.setenv("ANTIGRAVITY_LS_ADDRESS", "https://external.invalid:443")
    with pytest.raises(ValueError, match="loopback"):
        agy_messages.register()
    assert not core.HOME.exists()


def test_agy_accepts_native_localhost_and_rejects_nonlocal_resolution(agy, monkeypatch):
    monkeypatch.setenv("ANTIGRAVITY_LS_ADDRESS", "localhost:12345")
    assert agy_messages.register()["transport"] == "agy-agentapi"
    monkeypatch.setattr(
        agy_messages.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [
            (2, 1, 6, "", ("203.0.113.1", 12345)),
        ],
    )
    with pytest.raises(ValueError, match="outside loopback"):
        agy_messages.register()
