"""The calling conversation's own native identity: one owner for every host tool.

A process can inherit another harness's session variables (Claude Code started from a Codex
terminal still sees CODEX_THREAD_ID), so a harness's own marker wins over inherited IDs.
Tool-specific overrides (an explicit owner, a Bridge worker's job) stay with each tool.
"""

import os
from collections.abc import Mapping

HARNESSES = ("claude", "agy", "codex", "opencode")
VARIABLES = ("CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "ANTIGRAVITY_CONVERSATION_ID", "CODEX_THREAD_ID",
             "AGENT_BRIDGE_ROOT_HARNESS", "AGENT_BRIDGE_ROOT_SESSION")


def environment(harness: str, session: str) -> dict[str, str]:
    """Variables that make native() report exactly (harness, session); drop VARIABLES from the base first."""
    if harness not in HARNESSES:
        raise ValueError(f"unknown harness {harness!r}")
    return {
        "claude": {"CLAUDECODE": "1", "CLAUDE_CODE_SESSION_ID": session},
        "agy": {"ANTIGRAVITY_CONVERSATION_ID": session},
        "codex": {"CODEX_THREAD_ID": session},
    }.get(harness) or {"AGENT_BRIDGE_ROOT_HARNESS": harness, "AGENT_BRIDGE_ROOT_SESSION": session}


def native(environ: Mapping[str, str] | None = None) -> tuple[str, str | None] | None:
    """(harness, session) of this process's own harness; session is None when the harness hides it.

    Raises ValueError for a malformed session ID rather than guessing another identity.
    """
    env = os.environ if environ is None else environ
    if env.get("CLAUDECODE") == "1":
        harness, session = "claude", env.get("CLAUDE_CODE_SESSION_ID")
    elif env.get("ANTIGRAVITY_CONVERSATION_ID"):
        harness, session = "agy", env["ANTIGRAVITY_CONVERSATION_ID"]
    elif env.get("CODEX_THREAD_ID"):
        harness, session = "codex", env["CODEX_THREAD_ID"]
    elif env.get("AGENT_BRIDGE_ROOT_HARNESS") in HARNESSES:  # harnesses without a native variable declare it
        harness, session = env["AGENT_BRIDGE_ROOT_HARNESS"], env.get("AGENT_BRIDGE_ROOT_SESSION")
    else:
        return None
    session = session or None  # set-but-empty means unset
    if session is not None and (
        len(session) > 200 or any(c.isspace() or not c.isprintable() for c in session)
    ):
        raise ValueError(f"malformed {harness} session id")
    return harness, session
