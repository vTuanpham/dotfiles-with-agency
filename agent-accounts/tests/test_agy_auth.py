import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from agent_accounts import agy_auth


def test_current_uses_native_active_account_without_switch(monkeypatch):
    def run(command, **kwargs):
        assert command == ["agy-auth", "list", "--no-sync", "--no-usage", "--json"]
        return SimpleNamespace(returncode=0, stdout=json.dumps({
            "schema_version": 1, "command": "list",
            "data": {"accounts": [{"id": "acct_fixture", "alias": "a2",
                                   "active": True, "stored": True}]}}))
    monkeypatch.setattr(subprocess, "run", run)
    assert agy_auth.current() == "a2"


def test_export_uses_private_one_account_file_and_filters_credentials(tmp_path, monkeypatch):
    monkeypatch.setenv("UNRELATED_API_KEY", "fixture")
    destination = tmp_path / "worker" / "token"

    def run(command, **kwargs):
        assert "UNRELATED_API_KEY" not in kwargs["env"]
        temp = Path(command[3])
        source = temp / "fixture"
        source.write_text("synthetic credential")
        return SimpleNamespace(returncode=0, stdout=json.dumps({
            "schema_version": 1, "command": "export", "data": {"files": [{
                "path": str(source), "outcome": "exported", "account": {"id": "acct_fixture"}}]}}))

    monkeypatch.setattr(subprocess, "run", run)
    assert agy_auth.export("a1", destination) == "acct_fixture"
    assert destination.read_text() == "synthetic credential"
    assert destination.stat().st_mode & 0o777 == 0o600
    with pytest.raises(ValueError):
        agy_auth.export("../other", destination)


def test_sync_does_not_overwrite_newer_registry_token(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path / "state"))
    token = tmp_path / "worker-token"
    token.write_text("changed worker token")

    def export(account, destination):
        destination.write_text("newer registry token")
        return "acct_fixture"

    monkeypatch.setattr(agy_auth, "export", export)
    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: pytest.fail("stale sync imported"))
    assert not agy_auth.sync("a1", token, "acct_fixture", "old-digest")


def test_sync_imports_only_matching_account_and_unchanged_registry(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path / "state"))
    token = tmp_path / "worker-token"
    token.write_text("refreshed")
    baseline = tmp_path / "baseline"
    baseline.write_text("old")

    def export(account, destination):
        destination.write_text("old")
        return "acct_fixture"

    def run(command, **kwargs):
        assert command[:2] == ["agy-auth", "import"]
        assert "UNRELATED_API_KEY" not in kwargs["env"]
        return SimpleNamespace(returncode=0, stdout=json.dumps({
            "schema_version": 1, "command": "import",
            "data": {"imported": [{"id": "acct_fixture"}]}}))

    monkeypatch.setenv("UNRELATED_API_KEY", "fixture")
    monkeypatch.setattr(agy_auth, "export", export)
    monkeypatch.setattr(subprocess, "run", run)
    assert agy_auth.sync("a1", token, "acct_fixture", agy_auth.digest(baseline))
