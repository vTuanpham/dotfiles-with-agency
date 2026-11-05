import copy
import json
import subprocess
from datetime import datetime

import pytest

from agent_accounts import opencode, providers

AT = "2026-11-04T10:00:00Z"
NOW = datetime.fromisoformat(AT).timestamp()
RESET = (NOW + 3600) * 1000


def response():
    return {"data": {"workspace": {"id": "workspace-private", "name": "private name",
                                   "usageURL": "https://example.invalid/private"},
                     "go": {key: {"percent": pct, "limited": False, "resetsAt": RESET}
                            for key, pct in (("rolling", 25.2), ("weekly", 40), ("monthly", 10))},
                     "budgets": [{"id": "budget-private", "limit": 20, "spent": 5,
                                  "scope": "combined", "per": "set", "coverage": "models",
                                  "models": [{"providerID": "opencode", "modelID": "example",
                                              "name": "display"}], "vendors": [], "picked": True,
                                  "shared": True, "resetsAt": RESET}]}}


def test_workspace_go_and_console_budgets_preserve_scope_without_claiming_entitlement():
    saved = opencode.decode(response(), AT, "/tmp/project")
    row = opencode.quota(saved, NOW)
    assert row.backend == "opencode" and row.account.startswith("workspace-") and not row.active
    assert row.plan is None and row.freshness == "fresh"
    assert [w.remaining_percent for w in row.windows] == [74, 60, 90, 75]
    assert row.windows[0].group == "opencode-go workspace"
    assert "combined/set/models; shared=True" in row.windows[-1].group
    assert "opencode/example" in row.windows[-1].group
    serialized = json.dumps(saved)
    assert all(secret not in serialized for secret in
               ("workspace-private", "budget-private", "private name", "https://example.invalid"))


def test_limited_expired_missing_and_signed_out_states_never_invent_room():
    raw = response()
    raw["data"]["go"]["rolling"].update(limited=True, percent=0)
    saved = opencode.decode(raw, AT, "/tmp/project")
    assert opencode.quota(saved, NOW).windows[0].remaining_percent == 0
    expired = opencode.quota(saved, NOW + 3601)
    assert expired.freshness == "stale" and all(w.remaining_percent is None for w in expired.windows)
    raw["data"].pop("go")
    raw["data"]["budgets"] = []
    row = opencode.quota(opencode.decode(raw, AT, "/tmp/project"), NOW)
    assert row.status == "usage unknown" and row.windows == ()
    signed_out = opencode.quota(opencode.decode({"data": None}, AT, "/tmp/project"), NOW)
    assert signed_out.status == "no Console workspace" and signed_out.windows == ()


def test_per_model_budget_uses_each_published_counter_and_missing_stays_unknown():
    raw = response()
    budget = raw["data"]["budgets"][0]
    budget["per"] = "model"
    budget["models"] += [{"providerID": "opencode", "modelID": "second", "name": "second", "spent": 15}]
    row = opencode.quota(opencode.decode(raw, AT, "/tmp/project"), NOW)
    assert [w.remaining_percent for w in row.windows[-2:]] == [None, 25]
    assert "opencode/second" in row.windows[-1].group


@pytest.mark.parametrize("edit", [
    lambda r: r["data"]["go"]["rolling"].update(percent=True),
    lambda r: r["data"]["go"]["weekly"].update(percent=101),
    lambda r: r["data"]["go"]["monthly"].update(resetsAt=float("inf")),
    lambda r: r["data"]["go"]["monthly"].update(resetsAt=1e308),
    lambda r: r["data"]["go"].pop("rolling"),
    lambda r: r["data"]["budgets"][0].update(limit=-1),
    lambda r: r["data"]["budgets"][0].update(scope="unknown"),
    lambda r: r["data"]["budgets"][0]["models"][0].update(modelID="bad\x1b"),
    lambda r: r["data"]["budgets"].append(copy.deepcopy(r["data"]["budgets"][0])),
])
def test_malformed_native_usage_is_rejected(edit):
    raw = response()
    edit(raw)
    with pytest.raises(ValueError):
        opencode.quota(opencode.decode(raw, AT, "/tmp/project"), NOW)


def test_native_refresh_is_private_and_atomic_and_snapshot_does_not_refresh(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        assert command[1:4] == ["api", "GET", "/api/experimental/usage/limits"]
        assert command[-1] == "location[directory]=" + str(tmp_path)
        assert kwargs["timeout"] == 30 and kwargs["stderr"] == subprocess.PIPE
        kwargs["stdout"].write(json.dumps(response()))
        return subprocess.CompletedProcess(command, 0, stderr="private stderr")

    monkeypatch.setattr(providers.subprocess, "run", run)
    monkeypatch.setattr(providers.time, "time", lambda: NOW)
    row = providers.refresh_opencode()
    cache = providers.OPENCODE_CACHE
    assert row.freshness == "fresh" and cache.stat().st_mode & 0o777 == 0o600
    assert cache.parent.stat().st_mode & 0o777 == 0o700

    def offline(command, **kwargs):
        assert command == ["codex-auth", "list", "--skip-api", "--json"]
        return subprocess.CompletedProcess(command, 0, json.dumps({"schema_version": 1,
            "command": "list", "active_account_key": None, "accounts": []}), "")

    monkeypatch.setattr(providers.subprocess, "run", offline)
    rows, errors = providers.snapshot(NOW, root=tmp_path / "agy")
    assert errors == [] and len(rows) == 1 and rows[0].backend == "opencode"
    other = tmp_path / "other"
    other.mkdir()
    monkeypatch.chdir(other)
    assert providers.snapshot(NOW, root=tmp_path / "agy")[0] == ()
    assert len(calls) == 1


@pytest.mark.parametrize("failure", ["malformed", "failure", "oversized"])
def test_failed_refresh_preserves_previous_observation(failure, monkeypatch):
    cache = providers.OPENCODE_CACHE
    cache.parent.mkdir()
    cache.write_text("previous")

    def run(command, **kwargs):
        kwargs["stdout"].write("{" if failure == "malformed" else "x" * 1048577)
        return subprocess.CompletedProcess(command, 1 if failure == "failure" else 0)

    monkeypatch.setattr(providers.subprocess, "run", run)
    with pytest.raises(ValueError):
        providers.refresh_opencode()
    assert cache.read_text() == "previous"


def test_signed_out_response_replaces_prior_workspace(monkeypatch):
    cache = providers.OPENCODE_CACHE
    cache.parent.mkdir()
    cache.write_text("previous")

    def run(command, **kwargs):
        kwargs["stdout"].write(json.dumps({"data": None}))
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(providers.subprocess, "run", run)
    row = providers.refresh_opencode()
    assert row.status == "no Console workspace" and row.windows == ()
    assert json.loads(cache.read_text())["status"] == "no Console workspace"


def test_normalization_cannot_replace_cache_with_an_oversized_expansion(monkeypatch):
    raw = response()
    budget = raw["data"]["budgets"][0]
    budget.update(per="model", vendors=["v" * 150 for _ in range(8)],
                  models=[{"providerID": "opencode", "modelID": f"model-{i}", "name": "n", "spent": 1}
                          for i in range(256)])
    raw["data"]["budgets"] = [{**copy.deepcopy(budget), "id": f"budget-{i}"} for i in range(4)]
    encoded = json.dumps(raw)
    assert len(encoded.encode()) < 1048576
    cache = providers.OPENCODE_CACHE
    cache.parent.mkdir()
    cache.write_text("previous")

    def run(command, **kwargs):
        kwargs["stdout"].write(encoded)
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(providers.subprocess, "run", run)
    monkeypatch.setattr(providers.time, "time", lambda: NOW)
    with pytest.raises(ValueError, match="cache exceeds size limit"):
        providers.refresh_opencode()
    assert cache.read_text() == "previous"
