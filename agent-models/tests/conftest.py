import pytest

from agent_models import policy


@pytest.fixture
def no_policy_refresh(monkeypatch):
    monkeypatch.setattr(policy, "excerpts", lambda *a, **k: [])
