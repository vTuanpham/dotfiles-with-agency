import json
import os
import subprocess
import sys
from contextlib import contextmanager

import pytest

from agent_bridge import cli, core, message_store, messages


@pytest.fixture(autouse=True)
def private_mail(monkeypatch, tmp_path):
    monkeypatch.setattr(core, "HOME", tmp_path / "bridge")
    for name in ("OPENCODE", "OPENCODE_SESSION_ID", "ANTIGRAVITY_CONVERSATION_ID"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("CODEX_THREAD_ID", "sender")


@pytest.fixture
def native(monkeypatch):
    calls = []

    class Wake:
        def __init__(self, thread):
            self.thread, self.home = thread, "/codex"

        def check(self):
            calls.append(("check", self.thread))

        def send(self, text, *, recipient):
            calls.append(("send", self.thread, recipient, text))

    monkeypatch.setattr(messages, "Wake", Wake)
    return calls


def test_codex_send_uses_sender_context_and_exact_recipient(native):
    result = messages.send("codex:recipient", "Can you reduce your memory request?")
    assert result["status"] == "accepted"
    assert result["sender"] == "codex:sender"
    assert native[0] == ("check", "sender")
    assert native[1][:3] == ("send", "sender", "recipient")
    assert "not user instructions or approval" in native[1][3]
    assert "From: codex:sender" in native[1][3]


def test_foreign_sender_is_explicit_relay_not_forged_codex_peer(native, monkeypatch):
    monkeypatch.setenv("CLAUDECODE", "1")
    monkeypatch.setenv("CLAUDE_CODE_SESSION_ID", "claude-sender")
    messages.send("codex:recipient", "Result ready")
    assert native[1][:3] == ("send", "recipient", "recipient")
    assert native[1][3].startswith("Forwarded by Bridge")
    assert "From: claude:claude-sender" in native[1][3]


@pytest.mark.parametrize("target", ["codex:", "guess", "codex:bad\nid", "other:x", "codex:a b"])
def test_bad_address_never_calls_native(native, target):
    with pytest.raises(ValueError):
        messages.send(target, "hello")
    assert not native


def test_no_native_identity_no_guessing(native, monkeypatch):
    monkeypatch.delenv("CODEX_THREAD_ID")
    with pytest.raises(ValueError, match="sender identity"):
        messages.send("codex:recipient", "hello")
    assert not native


def test_unregistered_agy_never_falls_back_to_chat(native):
    with pytest.raises(RuntimeError, match="register first"):
        messages.send("agy:00000000-0000-0000-0000-000000000000", "hello")
    assert not native


def test_codex_utf8_limit_includes_attribution_before_native_send(native):
    with pytest.raises(RuntimeError, match="1000 UTF-8 bytes"):
        messages.send("codex:recipient", "é" * 450)
    assert not native


def test_uncertain_delivery_not_retried_or_sent_as_chat(native, monkeypatch):
    def fail(self, text, *, recipient):
        native.append("attempt")
        raise RuntimeError("uncertain")

    monkeypatch.setattr(messages.Wake, "send", fail)
    with pytest.raises(RuntimeError, match="uncertain"):
        messages.send("codex:recipient", "hello")
    assert native == [("check", "sender"), "attempt"]


def test_discovery_preserves_incomplete_native_inventory(monkeypatch):
    requests = []

    @contextmanager
    def connection(home):
        def call(method, params):
            requests.append((method, params))
            return {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(
                            {
                                "schemaVersion": 4,
                                "pinnedThreads": [],
                                "threads": [
                                    {
                                        "id": "other-root",
                                        "kind": "codex",
                                        "title": "untrusted title",
                                        "status": "idle",
                                    }
                                ],
                                "truncated": True,
                                "unavailableHosts": ["offline"],
                                "unavailableSources": [],
                            }
                        ),
                    }
                ]
            }

        yield call

    monkeypatch.setattr(messages, "connection", connection)
    data = messages.codex_sessions()
    assert data["truncated"] is True
    assert data["unavailable_hosts"] == ["offline"]
    assert data["sessions"][0]["address"] == "codex:other-root"
    assert requests[0][1]["threadId"] == "sender"
    assert requests[0][1]["tool"] == "list_threads"


def test_connection_store_rejects_symlinks_and_public_credentials(tmp_path):
    root = core.HOME / "messages"
    root.parent.mkdir(parents=True)
    root.symlink_to(tmp_path, target_is_directory=True)
    with pytest.raises(ValueError, match="private"):
        message_store.directory("agy:recipient")
    root.unlink()
    path = message_store.directory("agy:recipient")
    (path / "target.json").write_text("{}")
    (path / "target.json").chmod(0o644)
    with pytest.raises(ValueError, match="Unsafe"):
        message_store.read(path / "target.json")


def test_worker_can_message_without_claiming_or_mutating_jobs(native, monkeypatch, capsys):
    monkeypatch.setenv("AGENT_BRIDGE_WORKER", "1")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "agent-bridge",
            "message",
            "send",
            "codex:recipient",
            "--text",
            "hello",
        ],
    )
    cli.main()
    assert json.loads(capsys.readouterr().out)["status"] == "accepted"
    assert not core.JOBS.exists()


def test_one_unavailable_harness_does_not_hide_other_native_sessions(monkeypatch):
    from agent_bridge import agy_messages, claude_messages, opencode_messages

    def unavailable():
        raise RuntimeError("no native task MCP in this Codex CLI")

    monkeypatch.setattr(messages, "codex_sessions", unavailable)
    monkeypatch.setattr(claude_messages, "sessions", lambda: [{"address": "claude:active"}])
    monkeypatch.setattr(agy_messages, "sessions", lambda: [])
    monkeypatch.setattr(opencode_messages, "sessions", unavailable)
    inventory = messages.sessions()
    assert inventory["sessions"] == [{"address": "claude:active"}]
    assert inventory["unavailable_sources"] == [
        "codex native inventory unavailable",
        "opencode native inventory unavailable",
    ]


def test_connection_reader_rejects_fifo_without_waiting_for_a_writer(tmp_path):
    fifo = tmp_path / "connection.json"
    os.mkfifo(fifo, 0o600)
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from agent_bridge.message_store import read\n"
            "import sys\n"
            "try: read(sys.argv[1])\n"
            "except ValueError: sys.exit(0)\n"
            "sys.exit(1)",
            str(fifo),
        ],
        timeout=3,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr.decode()
