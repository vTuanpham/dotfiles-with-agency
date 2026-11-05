import agent_session
import pytest


@pytest.fixture(autouse=True)
def isolated_native_identity(monkeypatch):
    for name in (*agent_session.VARIABLES, "AGENT_RESOURCES_OWNER", "AGENT_RESOURCES_AGENT_ID",
                 "AGENT_RESOURCES_WORKER"):
        monkeypatch.delenv(name, raising=False)
