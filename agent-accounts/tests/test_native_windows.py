import copy
import json
import time

import pytest

from agent_accounts import agy, codex, providers
from agent_accounts.models import timestamp
from agent_accounts.readers import agy_quota, claude_quotas

AT = "2026-11-04T12:00:00Z"
RESET = "2026-11-05T12:00:00Z"
NOW = timestamp(AT)


@pytest.mark.parametrize("plan", ["free", "plus", "prolite", "ultra-new", "unpublished"])
def test_plan_never_overrides_reported_duration_or_creates_missing_windows(codex_data, plan):
    row = codex_data["accounts"][0]
    row["plan"] = plan
    usage = row["usage"]
    usage.update(updated_at=int(NOW), primary={"used_percent": 12.5, "window_minutes": 15,
                                             "resets_at": int(NOW + 100)})
    usage["secondary"] = None
    quota = codex.decode(codex_data, NOW)[0]
    assert quota.plan == plan and quota.freshness == "fresh"
    assert len(quota.windows) == 1 and quota.windows[0].label == "15m"
    assert quota.windows[0].window_minutes == 15 and quota.windows[0].remaining_percent == 87
    assert quota.windows[0].pool_id is None and quota.windows[0].model_ids is None
    assert "private@example.invalid" not in repr(quota) and "synthetic-key" not in repr(quota)


def test_codex_expired_reset_never_describes_new_window_and_unknown_duration_stays_unknown(codex_data):
    usage = codex_data["accounts"][0]["usage"]
    usage.update(updated_at=int(NOW - 700), primary={"used_percent": 1, "window_minutes": 43200,
                                                  "resets_at": int(NOW)}, secondary={
        "used_percent": 25, "window_minutes": None, "resets_at": None})
    quota = codex.decode(codex_data, NOW)[0]
    assert quota.freshness == "stale" and quota.age_seconds == 700
    assert quota.windows[0].label == "30d" and quota.windows[0].remaining_percent is None
    assert quota.windows[1].window_minutes is None and quota.windows[1].label == "secondary"


def test_codex_failed_refresh_keeps_cached_windows_and_separate_failure(codex_data):
    usage = codex_data["accounts"][0]["usage"]
    usage["updated_at"] = int(NOW)
    usage["refresh"] = {"requested": True, "status": "http_error"}
    quota = codex.decode(codex_data, NOW)[0]
    assert quota.windows and quota.status is None and quota.refresh_status == "http_error"
    usage.update(source="none", primary=None, secondary=None)
    quota = codex.decode(codex_data, NOW)[0]
    assert quota.status == "refresh http_error" and not quota.windows


def test_codex_refresh_uses_native_api_without_new_cache(monkeypatch, codex_data):
    calls = []

    def run(command, **kwargs):
        calls.append((command, kwargs["timeout"]))
        return type("Result", (), {"returncode": 0, "stdout": json.dumps(codex_data)})()

    monkeypatch.setattr(providers.subprocess, "run", run)
    result = providers.refresh_codex()
    assert calls == [(["codex-auth", "list", "--api", "--json"], 120)]
    assert result[0].source.startswith("codex-auth list --api")


def test_agy_empty_refresh_preserves_prior_cache(tmp_path, monkeypatch):
    token = tmp_path / "a1" / providers.TOKEN
    token.parent.mkdir(parents=True)
    token.write_text("synthetic")
    cache = tmp_path / "a1" / "quota.json"
    cache.write_text("previous")
    raw = native_usage()
    raw["command"]["data"]["groups"] = []
    monkeypatch.setattr(providers.subprocess, "run", lambda *a, **k:
                        type("Result", (), {"returncode": 0, "stdout": json.dumps(raw)})())
    with pytest.raises(ValueError, match="no quota windows"):
        providers.refresh("a1", root=tmp_path)
    assert cache.read_text() == "previous"


@pytest.mark.parametrize("change", [
    lambda d: d.update(schema_version=True),
    lambda d: d["accounts"][0]["usage"]["primary"].update(used_percent=True),
    lambda d: d["accounts"][0]["usage"]["primary"].update(window_minutes="300"),
    lambda d: d["accounts"][0]["usage"]["primary"].update(resets_at=float("nan")),
    lambda d: d["accounts"][0].update(active=False),
    lambda d: d["accounts"].append(copy.deepcopy(d["accounts"][0])),
])
def test_codex_structured_identity_and_numeric_corruption_is_rejected(codex_data, change):
    change(codex_data)
    with pytest.raises(ValueError):
        codex.decode(codex_data, time.time())


def native_usage():
    return {"num_turns": 0, "response": "rounded text is not used", "command": {"name": "usage", "data": {
        "groups": [{"name": "Native group", "buckets": [
            {"id": "pool-a", "name": "Weekly", "window": "weekly", "remaining_fraction": 0.9476,
             "reset_time": RESET},
            {"id": "pool-b", "name": "Weekly", "window": "weekly", "remaining_fraction": 0.9476,
             "reset_time": RESET}]}]}}}


def test_equal_native_fractions_and_resets_never_merge_distinct_pools_or_infer_membership():
    cached = agy.decode(native_usage(), "a1", AT)
    quota = agy_quota(cached, NOW)
    assert len(quota.windows) == 2
    assert [w.pool_id for w in quota.windows] == ["pool-a", "pool-b"]
    assert all(w.remaining_percent == 94 and w.remaining_fraction == 0.9476 for w in quota.windows)
    assert all(w.window_minutes == 10080 and w.model_ids is None for w in quota.windows)
    assert all(w.remaining_percent is None for w in agy_quota(cached, timestamp(RESET)).windows)
    cached["groups"][0]["buckets"][0]["remaining_fraction"] = 0.29
    assert agy_quota(cached, NOW).windows[0].remaining_percent == 29
    cached["groups"][0]["buckets"][1].update(id="pool-a", window="five_hour")
    windows = agy_quota(cached, NOW).windows
    assert len(windows) == 2 and [w.window_minutes for w in windows] == [10080, 300]


def test_reported_exact_model_membership_is_preserved_without_family_expansion():
    raw = native_usage()
    raw["command"]["data"]["groups"][0]["buckets"][0]["model_ids"] = ["native-model-v2"]
    quota = agy_quota(agy.decode(raw, "a1", AT), NOW)
    assert quota.windows[0].model_ids == ("native-model-v2",)
    assert quota.windows[1].model_ids is None
    raw["num_turns"] = 1
    with pytest.raises(ValueError, match="read-only"):
        agy.decode(raw, "a1", AT)


def test_claude_absent_five_hour_and_new_named_scope_are_not_plan_rules():
    data = {"schemaVersion": 1, "activeAccountNumber": 1, "accounts": [{"number": 1, "active": True,
        "usageStatus": "ok", "usageFetchedAt": AT, "usage": {
            "sevenDay": {"pct": 40, "resetsAt": RESET},
            "scoped": [{"name": "Future model pool", "pct": 20, "resetsAt": RESET}]}}]}
    quota = claude_quotas(data, NOW)[0]
    assert len(quota.windows) == 2 and quota.windows[0].window_minutes == 10080
    scoped = quota.windows[1]
    assert scoped.group == "Future model pool" and scoped.window_minutes is None
    assert scoped.pool_id is None and scoped.model_ids is None


def test_codex_provider_requests_only_supported_local_structured_source(tmp_path, monkeypatch, codex_data):
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        return type("Result", (), {"returncode": 0, "stdout": json.dumps(codex_data)})()

    monkeypatch.setattr(providers.subprocess, "run", run)
    quotas, errors = providers.snapshot(root=tmp_path)
    assert calls == [["codex-auth", "list", "--skip-api", "--json"]] and not errors
    assert quotas[0].source.startswith("codex-auth")


def test_explicit_account_refresh_cannot_reintroduce_another_environment_credential(tmp_path):
    token = tmp_path / "a1" / providers.TOKEN
    token.parent.mkdir(parents=True)
    token.write_text("synthetic")
    env = providers.account_env("a1", tmp_path, environ={"PATH": "/bin", "GEMINI_API_KEY": "synthetic",
                                                       "HOME": "/other", "GOOGLE_AUTH_TOKEN": "synthetic"})
    assert env == {"PATH": "/bin", "HOME": str(tmp_path / "a1")}
