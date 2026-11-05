import os

import agent_session
import pytest

from agent_resources.identity import agent_id, identity


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    monkeypatch.setattr(os, "environ", {})


@pytest.mark.parametrize("root,thread,owner,child", [
    ("root", "child", "codex:root", "child"),
    ("root", "root", "codex:root", None),
    (None, "thread", "codex:thread", None),
    ("", "thread", "codex:thread", None),
])
def test_codex_native_controller_and_child(root, thread, owner, child, monkeypatch):
    monkeypatch.setenv("CODEX_THREAD_ID", thread)
    if root is not None:
        monkeypatch.setenv("CODEX_SESSION_ID", root)
    assert identity() == owner
    assert agent_id() == child
    assert agent_session.native() == ("codex", thread)


@pytest.mark.parametrize("harness", ["claude", "agy", "opencode"])
def test_other_harness_ignores_inherited_codex_pair(harness, monkeypatch):
    monkeypatch.setenv("CODEX_SESSION_ID", "enclosing-root")
    monkeypatch.setenv("CODEX_THREAD_ID", "enclosing-child")
    os.environ.update(agent_session.environment(harness, "own-session"))
    assert identity() == f"{harness}:own-session"
    assert agent_id() is None


def test_explicit_bridge_attribution_wins(monkeypatch):
    monkeypatch.setenv("CODEX_SESSION_ID", "native-root")
    monkeypatch.setenv("CODEX_THREAD_ID", "native-child")
    monkeypatch.setenv("AGENT_RESOURCES_OWNER", "claude:controller")
    assert identity() == "claude:controller"
    assert agent_id("explicit-child") == "explicit-child"
    monkeypatch.setenv("AGENT_RESOURCES_AGENT_ID", "inherited-child")
    assert agent_id() == "inherited-child"
    with pytest.raises(ValueError, match="conflicting"):
        agent_id("different-child")


@pytest.mark.parametrize("root", ["bad root", "bad\nroot", "x" * 201, "a\u200bb"])
def test_malformed_codex_controller_is_rejected(root, monkeypatch):
    monkeypatch.setenv("CODEX_SESSION_ID", root)
    monkeypatch.setenv("CODEX_THREAD_ID", "child")
    for read in (identity, agent_id):
        with pytest.raises(ValueError, match="invalid native controller identity"):
            read()


def test_root_id_without_native_thread_does_not_claim_identity(monkeypatch):
    monkeypatch.setenv("CODEX_SESSION_ID", "root")
    assert identity() is None
    assert agent_id() is None
