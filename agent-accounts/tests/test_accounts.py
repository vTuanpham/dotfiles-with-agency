import json
import subprocess
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from agent_accounts import codex, providers
from agent_accounts.readers import agy_quota


def test_codex_cache_keeps_reported_windows_freshness_and_omits_address(codex_data):
    rows = codex.decode(codex_data, datetime.now(timezone.utc).timestamp())
    assert len(rows) == 1 and rows[0].account == "03" and rows[0].active
    assert rows[0].freshness == "fresh" and rows[0].observed_at is not None
    assert [window.remaining_percent for window in rows[0].windows] == [62, 81]
    assert "example.invalid" not in repr(rows)
    assert [window.window_minutes for window in rows[0].windows] == [240, 2880]
    assert rows[0].plan == "unpublished plan" and rows[0].account_key_hash


@pytest.mark.parametrize("remaining", [True, -1, 101, "40"])
def test_invalid_observation_never_becomes_quota(remaining):
    data = {"account": "a1", "at": datetime.now(timezone.utc).isoformat(),
            "rows": [{"group": "Gemini Models", "limit": "weekly", "remaining": remaining,
                      "resets": "tomorrow"}]}
    with pytest.raises(ValueError):
        agy_quota(data, datetime.now(timezone.utc).timestamp())


def test_account_refresh_requires_existing_auth_and_keeps_cache_on_invalid_response(tmp_path, monkeypatch):
    account = tmp_path / "a1"
    account.mkdir()
    cache = account / "quota.json"
    cache.write_text("previous cache")
    calls = []

    def run(*args, **kwargs):
        calls.append(kwargs["env"])
        return SimpleNamespace(returncode=0, stdout='{"response":"invalid usage"}')

    monkeypatch.setattr(providers.subprocess, "run", run)
    with pytest.raises(ValueError, match="signed in"):
        providers.refresh("a1", root=tmp_path)
    assert calls == []
    token = account / providers.TOKEN
    token.parent.mkdir(parents=True)
    token.write_text("synthetic")
    with pytest.raises(ValueError):
        providers.refresh("a1", root=tmp_path)
    assert cache.read_text() == "previous cache"


def test_cached_inventory_needs_no_bridge_or_job_state(tmp_path, monkeypatch, codex_data):
    monkeypatch.setattr(providers.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(
        a, 0, json.dumps(codex_data), ""))
    rows, errors = providers.snapshot(root=tmp_path)
    assert errors == [] and len(rows) == 1 and rows[0].backend == "codex"
    assert rows[0].windows[0].remaining_percent == 62


def test_explicit_refresh_atomically_writes_private_validated_observation(tmp_path, monkeypatch):
    token = tmp_path / "a1" / providers.TOKEN
    token.parent.mkdir(parents=True)
    token.write_text("synthetic")
    monkeypatch.setattr(providers.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(
        a, 0, json.dumps({"num_turns": 0, "command": {"name": "usage", "data": {"groups": [
            {"name": "Native Group", "buckets": [{"id": "pool-1", "name": "Weekly",
                "window": "weekly", "remaining_fraction": 0.9,
                "reset_time": "2099-01-01T00:00:00Z"}]}]}}}), ""))
    observation = providers.refresh("a1", root=tmp_path)
    cache = tmp_path / "a1/quota.json"
    assert observation.freshness == "fresh" and observation.account == "a1"
    assert json.loads(cache.read_text())["groups"][0]["buckets"][0]["remaining_fraction"] == 0.9
    assert cache.stat().st_mode & 0o777 == 0o600
