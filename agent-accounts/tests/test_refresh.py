import fcntl
import json
from dataclasses import replace

import pytest

from agent_accounts import cli, providers, refresh
from agent_accounts.models import Quota, QuotaWindow


def observation(backend="claude", account="01", freshness="fresh", **kwargs):
    return Quota(backend, account, None, True, (QuotaWindow("h", 42, "", "hourly", None),),
                 None, None, None, freshness, **kwargs)


def test_due_refresh_skips_fresh_sources_and_manual_refresh_is_explicit(monkeypatch):
    row = observation()
    monkeypatch.setattr(providers, "snapshot", lambda now=None: ([row], []))
    calls = []
    monkeypatch.setattr(providers, "refresh_claude", lambda: calls.append("claude") or [row])
    assert refresh.run(["claude"], now=1000) == []
    assert calls == []
    assert refresh.run(["claude"], if_stale=False, now=1000) == []
    assert calls == ["claude"]


def test_reset_unknown_window_is_refreshed_and_failures_back_off(monkeypatch):
    row = observation(freshness="stale")
    monkeypatch.setattr(providers, "snapshot", lambda now=None: ([row], []))
    calls = []

    def unavailable():
        calls.append("claude")
        raise RuntimeError("private native diagnostic")

    monkeypatch.setattr(providers, "refresh_claude", unavailable)
    assert refresh.run(["claude"], now=1000) == ["claude: awaiting a fresh usage reading"]
    assert "private" not in json.dumps(refresh.read_state(refresh.state_path()))
    assert refresh.run(["claude"], now=1299) == []
    assert calls == ["claude"]
    assert refresh.diagnostics() == ["claude: awaiting a fresh usage reading"]
    fresh = replace(row, freshness="fresh")
    monkeypatch.setattr(providers, "refresh_claude", lambda: calls.append("claude") or [fresh])
    assert refresh.run(["claude"], now=1300) == []
    assert len(calls) == 2 and refresh.diagnostics() == []


def test_failed_provider_and_agy_account_do_not_starve_others(tmp_path, monkeypatch):
    monkeypatch.setattr(providers, "ACCOUNTS", tmp_path / "accounts")
    for account in ("a1", "a2"):
        token = providers.ACCOUNTS / account / providers.TOKEN
        token.parent.mkdir(parents=True)
        token.touch()
    monkeypatch.setattr(providers, "snapshot", lambda now=None: ([], []))
    calls = []

    def agy(account):
        calls.append("agy:" + account)
        if account == "a1":
            raise ValueError("private provider error")
        return observation("agy", account)

    monkeypatch.setattr(providers, "refresh", agy)
    monkeypatch.setattr(providers, "refresh_codex", lambda: [
        observation("codex", refresh_status="http_error", account_key_hash="a" * 64)])
    monkeypatch.setattr(providers, "refresh_claude", lambda: calls.append("claude") or [observation()])
    monkeypatch.setattr(providers, "refresh_opencode",
                        lambda: calls.append("opencode") or observation("opencode"))
    errors = refresh.run(refresh.BACKENDS, now=1000)
    assert set(errors) == {"codex: awaiting a fresh usage reading", "agy: awaiting a fresh usage reading"}
    assert set(calls) == {"agy:a1", "agy:a2", "claude", "opencode"}
    assert len(refresh.read_state(refresh.state_path())) == 5


def test_overlapping_reader_does_not_refresh_twice(monkeypatch):
    cache = refresh.state_path()
    cache.parent.mkdir()
    monkeypatch.setattr(providers, "snapshot", lambda now=None: pytest.fail("busy reader queried providers"))
    with cache.with_suffix(".lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        assert refresh.run(["claude"], now=1000) == []


def test_missing_sources_refresh_and_opencode_directory_cooldowns_are_separate(tmp_path, monkeypatch):
    monkeypatch.setattr(providers, "snapshot", lambda now=None: ([], []))
    calls = []
    monkeypatch.setattr(providers, "refresh_opencode",
                        lambda: calls.append("opencode") or observation("opencode"))
    for directory in ("one", "two"):
        workspace = tmp_path / directory
        workspace.mkdir()
        monkeypatch.chdir(workspace)
        assert refresh.run(["opencode"], now=1000) == []
        assert refresh.run(["opencode"], now=1010) == []
    assert calls == ["opencode", "opencode"]


def test_partial_failures_follow_stable_account_identity_not_current_display_number(monkeypatch):
    good = observation("codex", "01", refresh_status="ok", account_key_hash="a" * 64)
    bad = observation("codex", "02", freshness="stale", refresh_status="http_error",
                      account_key_hash="b" * 64)
    monkeypatch.setattr(providers, "snapshot", lambda now=None: ([], []))
    monkeypatch.setattr(providers, "refresh_codex", lambda: [good, bad])
    refresh.run(["codex"], now=1000)
    assert refresh.diagnostics() == []
    rows = refresh.annotate([replace(good, account="02"), replace(bad, account="01")])
    assert [row.last_refresh_status for row in rows] == ["ok", "http_error"]
    newer = replace(bad, observed_at="1970-01-01T00:16:41Z")
    other = replace(bad, account_key_hash="c" * 64)
    assert all(row.last_refresh_status is None for row in refresh.annotate([newer, other]))


def test_signed_out_is_successful_observation_and_pending_refresh_is_not_failure(monkeypatch):
    row = replace(observation("opencode"), windows=(), status="no Console workspace")
    monkeypatch.setattr(providers, "snapshot", lambda now=None: ([], []))

    def query():
        assert refresh.diagnostics() == []
        return row

    monkeypatch.setattr(providers, "refresh_opencode", query)
    assert refresh.run(["opencode"], now=1000) == []
    assert refresh.diagnostics() == []


def test_cli_snapshot_stays_offline_and_all_refresh_exposes_diagnostics(monkeypatch, capsys):
    row = observation()
    monkeypatch.setattr(providers, "snapshot", lambda now=None: ([row], []))
    calls = []
    monkeypatch.setattr(refresh, "run", lambda backends, **kwargs: calls.append((backends, kwargs)) or [])
    monkeypatch.setattr(refresh, "diagnostics", lambda: ["agy: awaiting a fresh usage reading"])
    monkeypatch.setattr("sys.argv", ["agent-accounts", "snapshot"])
    assert cli.main() == 0 and not calls
    assert json.loads(capsys.readouterr().out)["errors"] == ["agy: awaiting a fresh usage reading"]
    monkeypatch.setattr("sys.argv", ["agent-accounts", "refresh", "--backend", "all", "--if-stale"])
    assert cli.main() == 0
    assert calls == [(refresh.BACKENDS, {"account": None, "if_stale": True})]


@pytest.mark.parametrize("data", [{"schema_version": 1, "attempts": {"claude": {"at": True, "ok": False}}},
                                  {"schema_version": 2, "attempts": {}},
                                  {"schema_version": 1, "attempts": {"unknown": {"at": 10, "ok": True}}}])
def test_invalid_refresh_state_is_not_used(data):
    providers.write_cache(refresh.state_path(), data)
    with pytest.raises(ValueError):
        refresh.read_state(refresh.state_path())
