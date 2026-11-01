import pytest

from agent_session import native

ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def test_each_harness_reports_its_own_session():
    assert native({"CLAUDECODE": "1", "CLAUDE_CODE_SESSION_ID": ID}) == ("claude", ID)
    assert native({"ANTIGRAVITY_CONVERSATION_ID": ID}) == ("agy", ID)
    assert native({"CODEX_THREAD_ID": ID}) == ("codex", ID)
    assert native({"AGENT_BRIDGE_ROOT_HARNESS": "opencode", "AGENT_BRIDGE_ROOT_SESSION": "ses_1"}) == (
        "opencode", "ses_1")
    assert native({}) is None


def test_an_inherited_session_never_outranks_the_running_harness():
    codex_terminal = {"CODEX_THREAD_ID": "enclosing-codex", "CLAUDE_CODE_SESSION_ID": "enclosing-claude"}
    assert native({**codex_terminal, "CLAUDECODE": "1", "CLAUDE_CODE_SESSION_ID": ID}) == ("claude", ID)
    assert native({**codex_terminal, "ANTIGRAVITY_CONVERSATION_ID": ID}) == ("agy", ID)
    # Claude without its own id stays Claude with an unknown session, never the enclosing Codex thread.
    assert native({"CODEX_THREAD_ID": "enclosing-codex", "CLAUDECODE": "1"}) == ("claude", None)
    # A plain process that merely inherited a Claude id is not a Claude session.
    assert native({"CLAUDE_CODE_SESSION_ID": ID}) is None


@pytest.mark.parametrize("bad", [" x", "a b", "a\nb", "x" * 201, "a​b"])
def test_malformed_ids_are_rejected_not_reinterpreted(bad):
    with pytest.raises(ValueError):
        native({"CLAUDECODE": "1", "CLAUDE_CODE_SESSION_ID": bad, "CODEX_THREAD_ID": "enclosing"})


@pytest.mark.parametrize("harness", ["claude", "agy", "codex", "opencode"])
def test_environment_round_trips_through_native(harness):
    from agent_session import VARIABLES, environment

    assert set(environment(harness, ID)) <= set(VARIABLES)
    assert native(environment(harness, ID)) == (harness, ID)


def test_an_empty_id_means_unknown():
    assert native({"CLAUDECODE": "1", "CLAUDE_CODE_SESSION_ID": ""}) == ("claude", None)
    assert native({"AGENT_BRIDGE_ROOT_HARNESS": "opencode", "AGENT_BRIDGE_ROOT_SESSION": ""}) == (
        "opencode", None)
