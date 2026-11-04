import json
import os
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path

import pytest

from agent_resources import control, heavy, resources

GIB = 1024 * resources.MIB
NOW = 3600 * 10**9


def request(name, need=GIB, *, running=False, exclusive=False, age=600, cap=None, cancelled=False):
    return Path(f"000-{name}.request"), {
        "job": f"owner/{name}",
        "command": "python3",
        "need": need,
        "running": running,
        "exclusive": exclusive,
        "queued_ns": NOW - age * 10**9,
        "cap": cap,
        "started_ns": NOW - 10**9 if running else None,
        "control": {"cancelled": cancelled, "pause_ns": 0},
    }


@pytest.fixture
def queue(monkeypatch, tmp_path):
    monkeypatch.delenv("AGENT_RESOURCES_WORKER", raising=False)
    monkeypatch.delenv("AGENT_RESOURCES_SLOTS", raising=False)
    monkeypatch.setenv("AGENT_RESOURCES_HOME", str(tmp_path / "queue"))
    monkeypatch.setenv("AGENT_RESOURCES_MIN_AVAILABLE_MIB", "1024")
    monkeypatch.setenv("AGENT_RESOURCES_MAX_LOAD", "10")
    monkeypatch.setattr(control.time, "monotonic_ns", lambda: NOW)
    rows = []
    monkeypatch.setattr(heavy, "entries", lambda _: rows)
    monkeypatch.setattr(heavy, "pressure", lambda: resources.Pressure(10 * GIB, 6 * GIB, 0.1, 0, ()))
    monkeypatch.setattr(heavy, "write_state", lambda *_: pytest.fail("listing changed request metadata"))
    return rows


def test_stuck_head_explains_memory_fairness_and_requests_behind_it(queue, capsys):
    queue.extend(
        [
            request("head", 6 * GIB),
            request("timing", exclusive=True),
            request("small", 16 * resources.MIB),
            request("cancelled", cancelled=True),
        ]
    )
    before = deepcopy(queue)
    control.listing()
    lines = capsys.readouterr().out.splitlines()
    assert "position=1/3" in lines[0] and "waiting_behind=2" in lines[0]
    assert "6144MiB no queued wait=600s yes(kernel-lock)" in lines[0]
    assert "backfill paused: head has waited 5m; need exceeds live free memory" in lines[0]
    assert "reserved=0MiB budget=9216MiB free=5120MiB" in lines[0]
    assert 'reason="behind head;' in lines[1] and "waiting_behind=1" in lines[1]
    assert "position=3/3" in lines[2] and "waiting_behind=0" in lines[2]
    assert "cancelling" in lines[3] and "position=" not in lines[3]
    assert queue == before


@pytest.mark.parametrize(
    "rows,expected",
    [
        ([request("holder", running=True, exclusive=True), request("next")], "exclusive holder is running"),
        ([request("holder", running=True, cap=1), request("next")], "hard job cap reached"),
        (
            [request("holder", running=True), request("next", exclusive=True)],
            "earlier exclusive request is waiting for all holders",
        ),
        ([request("first"), request("next")], "waiting for first; FIFO"),
        ([request("large", 6 * GIB, age=20), request("small")], "eligible under current snapshot"),
    ],
)
def test_diagnostics_follow_the_actual_scheduler(queue, capsys, rows, expected):
    queue.extend(rows)
    control.listing()
    assert expected in capsys.readouterr().out


def test_pause_and_live_pressure_are_visible_on_each_queued_row(queue, monkeypatch, capsys):
    queue.append(request("head"))
    monkeypatch.setattr(heavy, "pressure", lambda: resources.Pressure(10 * GIB, 6 * GIB, 12, 0, ()))
    monkeypatch.setattr(heavy, "pause_state", lambda _: {"reason": "review", "since_ns": NOW, "total_ns": 0})
    control.listing()
    output = capsys.readouterr().out
    assert "paused by root: review; load1 12.00 >= 10" in output
    assert "eligible" not in output

    control.listing(json_output=True)
    snapshot = json.loads(capsys.readouterr().out)
    assert snapshot["paused"] == "review"
    assert snapshot["requests"][0]["reason"].startswith("paused by root: review")


def test_pressure_failure_keeps_requests_visible_without_inventing_readiness(queue, monkeypatch, capsys):
    queue.extend([request("holder", running=True), request("next")])

    def unavailable():
        raise ValueError("invalid host pressure readings")

    monkeypatch.setattr(heavy, "pressure", unavailable)
    control.listing()
    output = capsys.readouterr().out
    assert "owner/holder" in output and "owner/next" in output
    assert "admission diagnostics unavailable: invalid host pressure readings" in output
    assert "budget=unavailable free=unavailable" in output and "eligible" not in output

    control.listing(json_output=True)
    snapshot = json.loads(capsys.readouterr().out)
    assert snapshot["admission"]["budget_bytes"] is None
    assert snapshot["admission"]["free_bytes"] is None
    assert all(row["reason"] == "admission diagnostics unavailable: invalid host pressure readings"
               for row in snapshot["requests"] if row["state"] == "queued")


def test_cpu_quota_is_sampled_outside_queue_lock(queue, monkeypatch, capsys):
    queue.append(request("head"))
    held, samples = [], []
    group = resources.Group(Path("/fixture/limited.slice"), None, None, None, 1, 0, 0, 0, None, False)
    first = resources.Pressure(10 * GIB, 6 * GIB, 0.1, 0, (group,))
    busy = resources.Group(group.path, None, None, None, 1, 900000, 0, 0, 0.9, False)

    def pressure(previous=None):
        samples.append(previous)
        return first if previous is None else resources.Pressure(10 * GIB, 6 * GIB, 0.1, 1, (busy,))

    @contextmanager
    def gate(_):
        held.append(True)
        try:
            yield
        finally:
            held.pop()

    def sleep(seconds):
        assert seconds == 1 and not held

    monkeypatch.setattr(heavy, "pressure", pressure)
    monkeypatch.setattr(heavy, "gate", gate)
    monkeypatch.setattr(control.time, "sleep", sleep)
    control.listing()
    assert samples == [None, first]
    assert "limited.slice CPU busy/throttled" in capsys.readouterr().out


def test_json_listing_filters_owner_and_keeps_shared_admission_totals(queue, capsys):
    native, foreign = request("native"), request("foreign", running=True)
    native[1].update(owner="claude:root", agent_id="agent-1")
    foreign[1].update(owner="codex:other", agent_id="agent-2")
    queue.extend([native, foreign])

    control.listing(json_output=True, owner="claude:root")

    snapshot = json.loads(capsys.readouterr().out)
    assert snapshot["schema_version"] == 1
    assert snapshot["paused"] is None
    assert snapshot["admission"]["reserved_bytes"] == GIB
    assert snapshot["admission"]["budget_bytes"] == 9 * GIB
    assert len(snapshot["requests"]) == 1
    row = snapshot["requests"][0]
    assert row["owner"] == "claude:root" and row["agent_id"] == "agent-1"
    assert row["state"] == "queued" and row["need_bytes"] == GIB
    assert row["queue_position"] == 1 and row["queue_length"] == 1


def test_worker_can_read_only_its_owner_filtered_json_rows(queue, monkeypatch, capsys):
    native, foreign = request("native"), request("foreign", running=True)
    native[1].update(owner="claude:root", agent_id="agent-1")
    foreign[1].update(owner="codex:other", agent_id="agent-2")
    queue.extend([native, foreign])
    monkeypatch.setenv("AGENT_RESOURCES_WORKER", "1")
    monkeypatch.setenv("AGENT_RESOURCES_OWNER", "claude:root")

    control.listing(json_output=True, owner="claude:root")

    snapshot = json.loads(capsys.readouterr().out)
    assert snapshot["admission"]["reserved_bytes"] == GIB
    assert [row["agent_id"] for row in snapshot["requests"]] == ["agent-1"]
    for call in (
        lambda: control.listing(),
        lambda: control.listing(json_output=True),
        lambda: control.listing(json_output=True, owner="codex:other"),
        lambda: control.cancel("native"),
        lambda: control.pause("maintenance"),
        control.resume,
    ):
        with pytest.raises(RuntimeError, match="workers cannot control"):
            call()


def test_json_listing_does_not_trust_a_stale_request_with_a_reused_pid(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("AGENT_RESOURCES_HOME", str(tmp_path / "queue"))
    monkeypatch.setenv("AGENT_RESOURCES_MIN_AVAILABLE_MIB", "0")
    monkeypatch.setenv("AGENT_RESOURCES_MAX_LOAD", "1000000")
    folder = heavy.prepare()
    path = folder / "000-stale.request"
    namespace = os.readlink(heavy.PROC / "self/ns/pid")
    fd = heavy.locked_file(path)
    heavy.write_request(fd, {
        "running": True, "slots": 1, "job": "", "owner": "claude:stale",
        "command": "sleep", "pid": os.getpid(),
        "namespace": namespace, "host_namespace": namespace, "host_pid": os.getpid(),
        "started_at": "2026-11-04T00:00:00+00:00", "started_ns": NOW,
    })
    agent_fd = os.open(heavy.agent_path(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.write(agent_fd, json.dumps({"agent_id": "agent-stale"}).encode())
    os.close(agent_fd)
    heavy.write_state(heavy.reservation_path(path), {"need": GIB, "exclusive": False,
                                                     "queued_ns": NOW, "cap": None})
    heavy.write_state(heavy.control_path(path), {"group": True, "cancelled": False, "pause_ns": 0})
    os.close(fd)

    monkeypatch.setattr(heavy, "pressure", lambda: resources.Pressure(10 * GIB, 6 * GIB, 0.1, 0, ()))
    control.listing(json_output=True, owner="claude:stale")

    snapshot = json.loads(capsys.readouterr().out)
    assert snapshot["requests"] == []
    assert not path.exists() and not heavy.agent_path(path).exists()
