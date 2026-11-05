import time

import pytest

from agent_accounts import providers


@pytest.fixture(autouse=True)
def isolate_claude_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(providers, "CLAUDE_CACHE", tmp_path / "state/claude.json")
    monkeypatch.setattr(providers, "OPENCODE_CACHE", tmp_path / "state/opencode.json")


@pytest.fixture
def codex_data():
    now = int(time.time())
    return {"schema_version": 1, "command": "list", "active_account_key": "synthetic-key", "accounts": [
        {"number": 3, "account_key": "synthetic-key", "email": "private@example.invalid", "active": True,
         "plan": "unpublished plan", "usage": {"source": "local", "updated_at": now - 30,
             "primary": {"used_percent": 38, "window_minutes": 240, "resets_at": now + 1000},
             "secondary": {"used_percent": 19, "window_minutes": 2880, "resets_at": now + 2000},
             "refresh": {"requested": True, "status": "ok"}}}]}
