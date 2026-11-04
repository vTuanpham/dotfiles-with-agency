"""Recorded metadata plus explicitly authored history and delivery fault schedules."""

import copy
import json
import time
from collections import deque
from contextlib import contextmanager
from pathlib import Path

import pytest

from agent_inbox import codex
from agent_inbox.models import Target
from agent_inbox.presentation import render_snapshot
from agent_inbox.server import App
from agent_inbox.store import Store

RECORDED = json.loads((Path(__file__).parent / "fixtures/codex-0.166.0-metadata.json").read_text())
TARGET = Target(
    "replay",
    "codex",
    "Codex",
    "root-id",
    "Replay root",
    {"socket": "/tmp/replay.sock", "command": ["/usr/bin/codex"]},
)
MESSAGE = {
    "id": "62c72a25-46ab-48ac-8aac-250cb6e1882d",
    "target": "replay",
    "text": "Focus on the failing test",
    "delivery": "steer",
}


def exchange(method, params, result):
    return {"request": {"method": method, "params": params}, "response": {"result": result}}


def history(rows=None):
    return exchange(
        "thread/items/list",
        {"threadId": "root-id", "limit": 100, "sortDirection": "desc"},
        {"data": rows or [], "nextCursor": None, "backwardsCursor": "head"},
    )


@pytest.fixture
def replay(monkeypatch):
    connections, sent = deque(), []

    @contextmanager
    def connect(path, **options):
        assert path == TARGET.settings["socket"]
        assert options["max_size"] == 16 * 1024 * 1024
        frames = deque(copy.deepcopy(connections.popleft()))

        class Stream:
            pending = None
            sequence = 0

            def send(self, payload):
                value = json.loads(payload)
                sent.append(value)
                if value.get("method") == "initialized":
                    assert value == {"method": "initialized", "params": {}}
                    return
                self.sequence += 1
                frame = frames.popleft()
                assert value == {**frame["request"], "id": self.sequence}
                self.pending = frame["response"]

            def recv(self, timeout):
                assert 0 < timeout <= 10
                response, self.pending = self.pending, None
                if response == "disconnect":
                    raise TimeoutError("Reply lost after native dispatch")
                return json.dumps({**response, "id": self.sequence})

        yield Stream()
        assert not frames, "adapter stopped before consuming the scheduled protocol"

    monkeypatch.setattr(codex, "unix_connect", connect)
    yield connections, sent
    assert not connections, "unused connection schedule"


def app(tmp_path):
    store = Store(tmp_path / "state")
    store.register(TARGET)
    result = App(store)
    # Discovery is tested elsewhere; keep this test's schedule on the exact selected root.
    result.catalog.checked = time.monotonic()
    result.catalog.live = {TARGET.id: TARGET}
    return result


def test_recorded_metadata_passes_real_connection_and_rpc_boundaries(replay):
    connections, _ = replay
    connections.append(RECORDED)
    with codex.connection(TARGET) as rpc:
        info = codex.root(rpc, TARGET)
        turn = codex.active_turn(codex.turns(rpc, TARGET.session_id))
    assert info["canAcceptDirectInput"] is True
    assert info["status"]["type"] == "active"
    assert turn == "turn-0"


@pytest.mark.parametrize(
    "outcome,status",
    [
        ({"result": {"turnId": "turn-0"}}, "steered"),
        ({"error": {"code": -32600, "message": "no active turn to steer"}}, "failed"),
        ("disconnect", "unknown"),
    ],
)
def test_native_turn_race_and_lost_ack_replay_through_durable_receipts(tmp_path, replay, outcome, status):
    connections, sent = replay
    connections.extend(
        [
            [*RECORDED[:2], history()],
            [
                *RECORDED,
                {
                    "request": {
                        "method": "turn/steer",
                        "params": {
                            "threadId": "root-id",
                            "expectedTurnId": "turn-0",
                            "clientUserMessageId": MESSAGE["id"],
                            "input": [{"type": "text", "text": MESSAGE["text"]}],
                        },
                    },
                    "response": outcome,
                },
            ],
        ]
    )
    first = app(tmp_path)
    assert first.send(MESSAGE)["status"] == status
    # Re-open the database as a restarted Inbox; replay must not connect or dispatch again.
    restarted = App(Store(first.store.home))
    restarted.store.recover()
    assert restarted.send(MESSAGE)["status"] == status
    assert [frame["method"] for frame in sent].count("turn/steer") == 1
    assert not any(frame["method"] in ("thread/queue/add", "turn/start", "thread/resume") for frame in sent)
    assert MESSAGE["text"].encode() not in first.store.path.read_bytes()


def test_tool_heavy_page_budget_measures_production_snapshot_projection(replay):
    rows = []
    for index in range(100):
        identity = {"id": f"item-{index}"}
        if index % 5 == 0:
            item = {
                **identity,
                "type": "agentMessage",
                "phase": "commentary",
                "text": "Measured progress.\n\n```python\nassert result == expected\n```\n" * 8,
            }
        elif index % 2:
            item = {
                **identity,
                "type": "commandExecution",
                "status": "completed",
                "command": "pytest -q",
                "aggregatedOutput": "PRIVATE_TOOL_OUTPUT" * 1200,
                "durationMs": 42,
            }
        else:
            item = {**identity, "type": "reasoning", "summary": ["PRIVATE_REASONING" * 1200]}
        rows.append({"turnId": "turn-0", "item": item})
    replay[0].append([*RECORDED[:2], history(rows)])
    wire = json.dumps(render_snapshot(codex.Codex().snapshot(TARGET))).encode()
    raw = json.dumps(rows).encode()
    value = json.loads(wire)
    assert len(rows) == 100 and len(value["messages"]) == 20 and len(value["activity"]) == 40
    assert value["timeline"][0] == "activity:turn-0:item-99"
    assert value["newer_cursor"] == "head"
    assert b"PRIVATE_TOOL_OUTPUT" not in wire and b"PRIVATE_REASONING" not in wire
    # Workload budget, not a new global cap: preserve all human-visible message text.
    assert len(wire) < 64 * 1024 < len(raw)
    assert len(wire) < len(raw) // 10
    print(f"native_bytes={len(raw)} rendered_bytes={len(wire)} rows={len(rows)}")
