import hashlib
import json
from dataclasses import replace
from datetime import datetime, timezone
from types import SimpleNamespace

from agent_accounts.models import Quota, QuotaWindow

from agent_bridge import quota_pressure
from agent_bridge.acknowledgements import urgent


def test_pressure_wakes_once_on_observed_account_burn(tmp_path, monkeypatch):
    clock = 1_800_000_000.0
    def stamp(value):
        return datetime.fromtimestamp(value, timezone.utc).isoformat()

    job = tmp_path / "owner" / "worker"
    job.mkdir(parents=True)
    (job / "state.json").write_text(json.dumps({"agyAuthId": "fixture"}))
    window = QuotaWindow("5h", 6, "pool", "5h", stamp(clock + 7200),
                         remaining_fraction=0.06)
    quota = Quota("agy", "a1", None, False, (window,), None, stamp(clock), 0, "fresh",
                  account_key_hash=hashlib.sha256(b"fixture").hexdigest())
    current = [quota]
    monkeypatch.setattr(quota_pressure, "quotas", lambda *_: current)
    worker = SimpleNamespace(running=True, backend="agy", account="a1",
                             model="gemini", directory=str(job))
    pressure = quota_pressure.Pressure()
    def emit(owner, callback):
        callback()
    pressure.sample([worker], clock, emit)
    current[:] = [replace(quota, observed_at=stamp(clock + 120),
                          windows=(replace(window, remaining_fraction=0.05),))]
    pressure.sample([worker], clock + 120, emit)
    rows = list(quota_pressure.event_lines(job))
    assert len(rows) == 1
    assert urgent(rows[0][1]) and "shared burn rate" in rows[0][1]["message"]
    current[:] = [replace(quota, observed_at=stamp(clock + 240),
                          windows=(replace(window, remaining_fraction=0.04),))]
    pressure.sample([worker], clock + 240, emit)
    assert len(list(quota_pressure.event_lines(job))) == 1


def test_pressure_does_not_notify_if_reset_arrives_before_exhaustion(tmp_path, monkeypatch):
    clock = 1_800_000_000.0
    def stamp(value):
        return datetime.fromtimestamp(value, timezone.utc).isoformat()

    window = QuotaWindow("5h", 10, "", "", stamp(clock + 500), remaining_fraction=0.1)
    quota = Quota("agy", "a1", None, False, (window,), None, stamp(clock), 0, "fresh",
                  account_key_hash="fixture")
    current = [quota]
    monkeypatch.setattr(quota_pressure, "quotas", lambda *_: current)
    worker = SimpleNamespace(running=True, backend="agy", account="a1",
                             model="gemini", directory=str(tmp_path))
    pressure = quota_pressure.Pressure()
    pressure.sample([worker], clock, lambda _, callback: callback())
    current[:] = [replace(quota, observed_at=stamp(clock + 120),
                          windows=(replace(window, remaining_fraction=0.09),))]
    pressure.sample([worker], clock + 120, lambda _, callback: callback())
    assert not (tmp_path / "live.jsonl").exists()


def test_pressure_does_not_assign_account_after_alias_is_reused(tmp_path, monkeypatch):
    clock = 1_800_000_000.0
    def stamp(value):
        return datetime.fromtimestamp(value, timezone.utc).isoformat()

    (tmp_path / "state.json").write_text(json.dumps({"agyAuthId": "old-account"}))
    window = QuotaWindow("5h", 6, "pool", "5h", stamp(clock + 7200), remaining_fraction=0.06)
    quota = Quota("agy", "a1", None, False, (window,), None, stamp(clock), 0, "fresh",
                  account_key_hash=hashlib.sha256(b"new-account").hexdigest())
    current = [quota]
    monkeypatch.setattr(quota_pressure, "quotas", lambda *_: current)
    worker = SimpleNamespace(running=True, backend="agy", account="a1",
                             model="gemini", directory=str(tmp_path))
    pressure = quota_pressure.Pressure()
    pressure.sample([worker], clock, lambda _, callback: callback())
    current[:] = [replace(quota, observed_at=stamp(clock + 120),
                          windows=(replace(window, remaining_fraction=0.05),))]
    pressure.sample([worker], clock + 120, lambda _, callback: callback())
    assert not (tmp_path / "live.jsonl").exists()
