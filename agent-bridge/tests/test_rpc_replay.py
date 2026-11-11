import io
import json
import os
from collections import deque
from pathlib import Path
from types import SimpleNamespace

import pytest

from agent_bridge import codex
from agent_bridge.codex import Rpc


def transport(payload):
    reader, writer = os.pipe()
    os.write(writer, payload)
    os.close(writer)
    rpc = Rpc.__new__(Rpc)
    rpc.p = SimpleNamespace(stdin=io.BytesIO(), stdout=os.fdopen(reader, "rb", buffering=0))
    rpc.buf, rpc.events, rpc.seq = b"", deque(), 0
    return rpc


def test_interrupt_ack_is_separate_from_terminal_event_and_keeps_interleaved_requests():
    fixture = Path(__file__).parent / "fixtures/codex-interrupt.ndjson"
    rpc = transport(fixture.read_bytes())
    try:
        assert rpc.call("turn/interrupt", {"threadId": "thread-1", "turnId": "turn-1"}) == {}
        request = json.loads(rpc.p.stdin.getvalue())
        assert request["id"] == "live-1" and request["method"] == "turn/interrupt"
        assert [frame["method"] for frame in rpc.events] == [
            "item/commandExecution/outputDelta",
            "item/commandExecution/requestApproval",
        ]
        assert rpc.events[-1]["id"] == 7
        terminal = rpc.read(timeout=1)
        assert terminal["method"] == "turn/completed"
        assert terminal["params"]["turn"]["status"] == "interrupted"
    finally:
        rpc.p.stdout.close()


def test_disconnect_during_rpc_fails_without_spinning_or_retrying(monkeypatch):
    rpc = transport(b"")
    original, calls = rpc.read, []

    def bounded_read(timeout):
        calls.append(timeout)
        assert len(calls) <= 2, "RPC kept reading EOF instead of reporting disconnection"
        return original(timeout)

    monkeypatch.setattr(rpc, "read", bounded_read)
    try:
        with pytest.raises(RuntimeError, match="disconnected"):
            rpc.call("turn/steer", {"expectedTurnId": "turn-1"})
        assert len(calls) == 1
        assert len(rpc.p.stdin.getvalue().splitlines()) == 1
    finally:
        rpc.p.stdout.close()


def test_server_rejection_retains_its_error_code():
    rpc = transport(b'{"id":"live-1","error":{"code":-32600,"message":"turn mismatch"}}\n')
    try:
        with pytest.raises(codex.RpcError) as caught:
            rpc.call("turn/steer")
        assert caught.value.code == -32600
    finally:
        rpc.p.stdout.close()


def test_unrelated_notifications_cannot_extend_the_rpc_deadline(monkeypatch):
    rpc = transport(b'{"method":"item/started","params":{}}\n')
    times = iter([0, 0, 0, 0, 0, 301])
    monkeypatch.setattr(codex, "time", SimpleNamespace(monotonic=lambda: next(times)))
    try:
        with pytest.raises(TimeoutError, match="timed out: turn/steer"):
            rpc.call("turn/steer")
        assert len(rpc.events) == 1
        assert len(rpc.p.stdin.getvalue().splitlines()) == 1
    finally:
        rpc.p.stdout.close()


def test_partial_frame_cannot_restart_the_read_timeout(monkeypatch):
    rpc = transport(b"{")
    times = iter([0, 0, 301])
    monkeypatch.setattr(codex, "time", SimpleNamespace(monotonic=lambda: next(times)))
    original, calls = codex.select.select, []

    def bounded_select(*arguments):
        calls.append(arguments[-1])
        assert len(calls) == 1, "Partial data restarted the read timeout"
        return original(*arguments)

    monkeypatch.setattr(codex.select, "select", bounded_select)
    try:
        assert rpc.read(timeout=300) is None
        assert rpc.buf == b"{" and calls == [300]
    finally:
        rpc.p.stdout.close()
