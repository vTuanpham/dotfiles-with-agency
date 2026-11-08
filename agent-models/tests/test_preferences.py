from types import SimpleNamespace

import pytest

from agent_models import cli, preferences


def test_preferences_are_private_attributed_and_expire(tmp_path, monkeypatch):
    monkeypatch.setattr(preferences.state, "HOME", tmp_path / "state")
    def record(**changes):
        values = dict(source="agent", note="Use when suitable", backend="codex", model=None,
                      account=None, task=None, reason=None, expires=None)
        return preferences.add(SimpleNamespace(**(values | changes)))
    old = record(expires="2000-01-01")
    agent = record()
    user = record(source="user", backend=None, reason="Limited allowance")
    assert [p["id"] for p in preferences.applicable("codex")] == [user["id"], agent["id"]]
    assert [p["id"] for p in preferences.applicable("claude")] == [user["id"]]
    assert "Limited allowance" in preferences.lines([user])[0]
    assert (tmp_path / "state/preferences.json").stat().st_mode & 0o777 == 0o600
    preferences.remove(old["id"])
    assert len(preferences.read()) == 2
    with pytest.raises(ValueError):
        preferences.remove(old["id"])


def test_preferences_reject_invalid_dates_and_malformed_data(tmp_path, monkeypatch):
    monkeypatch.setattr(preferences.state, "HOME", tmp_path)
    for invalid in ("bad", "20270101"):
        with pytest.raises(ValueError):
            preferences.add(SimpleNamespace(source="user", note="x", backend=None, model=None,
                                            account=None, task=None, reason=None, expires=invalid))
    (tmp_path / "preferences.json").write_text('[{"id": "a", "id": "b"}]')
    with pytest.raises(ValueError):
        preferences.read()


def test_task_relevance_orders_notes_without_hiding_or_overriding_user(tmp_path, monkeypatch):
    monkeypatch.setattr(preferences.state, "HOME", tmp_path)
    def record(source, task):
        return preferences.add(SimpleNamespace(source=source, note="Context", backend=None, model=None,
                                               account=None, task=task, reason=None, expires=None))
    general = record("user", None)
    other = record("agent", "database locking")
    matching = record("agent", "visual interface")
    assert [item["id"] for item in preferences.applicable(task="visual interface layout")] == [
        general["id"], matching["id"], other["id"],
    ]


def test_cli_add_list_remove(tmp_path, monkeypatch, capsys):
    import json
    import sys

    monkeypatch.setattr(preferences.state, "HOME", tmp_path / "state")
    monkeypatch.setattr(sys, "argv", ["model-guide", "preferences", "add", "--source", "user",
                                      "--note", "Conserve this account"])
    assert cli.main() == 0
    identifier = json.loads(capsys.readouterr().out)["id"]
    monkeypatch.setattr(sys, "argv", ["model-guide", "preferences", "list"])
    assert cli.main() == 0
    assert json.loads(capsys.readouterr().out)[0]["id"] == identifier
    monkeypatch.setattr(sys, "argv", ["model-guide", "preferences", "remove", identifier])
    assert cli.main() == 0
    assert preferences.read() == []
