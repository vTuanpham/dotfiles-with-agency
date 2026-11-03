import json
import os
import socket
import threading
from pathlib import Path
from urllib.parse import unquote

import pytest

from agent_bridge import claude_messages, core


@pytest.fixture
def native_peer(monkeypatch, tmp_path):
    config = tmp_path / "config"
    (config / "sessions").mkdir(parents=True)
    parent = tmp_path / "sockets"
    parent.mkdir(mode=0o700)
    sock = parent / "recipient.sock"
    # Unix socket paths are bounded; pytest's default temp names can be long.
    if len(str(sock).encode()) > 90:
        pytest.skip("Temporary path is too long for a native Unix socket fixture")
    listener = socket.socket(socket.AF_UNIX)
    listener.bind(str(sock))
    listener.listen(1)
    listener.settimeout(3)
    row = {
        "pid": os.getpid(),
        "messagingSocketPath": str(sock),
        "sessionId": "recipient",
        "procStart": Path(f"/proc/{os.getpid()}/stat").read_text().rsplit(")", 1)[1].split()[19],
    }
    monkeypatch.setattr(claude_messages, "config", lambda: config)
    monkeypatch.setattr(claude_messages, "target", lambda _: (row, "a" * 32))
    return listener, row, config


@pytest.mark.parametrize("status", ["delivered", "held", None, "wrong-message"])
def test_native_peer_steers_authenticates_receipts_and_cleans_up(native_peer, status):
    listener, row, config = native_peer
    received, errors = [], []

    def server():
        try:
            with listener.accept()[0] as transport:
                stream = transport.makefile("rb")
                auth = json.loads(stream.readline())
                frame = json.loads(stream.readline())
                stream.close()
                assert auth == {"type": "auth", "token": "a" * 32}
                received.append(frame)
            if status is not None:
                reply_path = unquote(frame["from"].removeprefix("uds:"))
                key = json.loads(claude_messages.key_path(os.getpid(), reply_path).read_text())
                with socket.socket(socket.AF_UNIX) as reply:
                    reply.connect(reply_path)
                    receipt = {
                        "type": "control",
                        "action": "peer_message_status",
                        "orig_msg_id": "other" if status == "wrong-message" else frame["msg_id"],
                        "status": "delivered" if status == "wrong-message" else status,
                    }
                    reply.sendall(
                        (
                            json.dumps({"type": "auth", "token": key["peerToken"]})
                            + "\n"
                            + json.dumps(receipt)
                            + "\n"
                        ).encode()
                    )
        except Exception as error:
            errors.append(error)
        finally:
            listener.close()

    worker = threading.Thread(target=server)
    worker.start()
    packet = {
        "id": "native-message-id",
        "sender": "codex:sender",
        "recipient": "claude:recipient",
        "text": "One peer test",
    }
    if status == "wrong-message":
        with pytest.raises(RuntimeError, match="does not match"):
            claude_messages.send(packet)
    else:
        receipt = claude_messages.send(packet)
        assert receipt["status"] == (status or "sent")
        assert receipt["delivery"] == "steer"
    worker.join(timeout=3)
    assert not worker.is_alive() and not errors
    assert len(received) == 1
    assert received[0]["priority"] == "now" and received[0]["session_id"] == "recipient"
    assert received[0]["from_plugin"] == "agent-bridge"
    assert "From: codex:sender" in received[0]["message"]["content"]
    assert list((config / "sessions").iterdir()) == []
    assert list(Path(row["messagingSocketPath"]).parent.iterdir()) == [Path(row["messagingSocketPath"])]


def test_live_discovery_ignores_reused_pid_and_verifies_private_peer_key(monkeypatch, tmp_path):
    monkeypatch.setattr(claude_messages, "config", lambda: tmp_path)
    registry = tmp_path / "sessions"
    registry.mkdir()
    sock = tmp_path / "peer.sock"
    pid = os.getpid()
    start = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19]
    with socket.socket(socket.AF_UNIX) as peer:
        peer.bind(str(sock))
        row = {
            "pid": pid,
            "procStart": "reused",
            "pidDomain": "fixture",
            "sessionId": "recipient",
            "peerProtocol": 1,
            "messagingSocketPath": str(sock),
        }
        core.atomic_save(registry / f"{pid}.json", row)
        assert claude_messages.live() == []
        row["procStart"] = start
        core.atomic_save(registry / f"{pid}.json", row)
        core.atomic_save(
            claude_messages.key_path(pid, str(sock)),
            {
                "peerToken": "a" * 32,
                "procStart": start,
                "pidDomain": "fixture",
            },
        )
        assert claude_messages.target("recipient")[0] == row
        row["peerProtocol"] = 999
        core.atomic_save(registry / f"{pid}.json", row)
        with pytest.raises(RuntimeError, match="Unsupported"):
            claude_messages.target("recipient")


def test_changed_peer_process_is_rejected_before_message_or_credential_send(native_peer):
    listener, row, _ = native_peer
    row["procStart"] = "reused-pid"
    received = []

    def server():
        with listener.accept()[0] as transport:
            received.append(transport.recv(4096))
        listener.close()

    worker = threading.Thread(target=server)
    worker.start()
    with pytest.raises(RuntimeError, match="identity changed"):
        claude_messages.send(
            {"id": "one", "sender": "codex:sender", "recipient": "claude:recipient", "text": "test"}
        )
    worker.join(timeout=3)
    assert received == [b""] and not worker.is_alive()
