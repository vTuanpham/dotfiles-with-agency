"""Give a native subagent its cooperative resource-queue identity."""

import json
import os
import shlex
import sys


def valid(value):
    return (isinstance(value, str) and 0 < len(value) <= 400
            and value.isprintable() and all(not char.isspace() and char != "`" for char in value))


def context(payload):
    if not isinstance(payload, dict) or payload.get("hook_event_name") != "SubagentStart":
        return None
    agent = payload.get("agent_id")
    session = payload.get("session_id")
    owner = os.environ.get("AGENT_RESOURCES_OWNER", f"claude:{session}")
    if not valid(agent) or not valid(session) or not valid(owner):
        return None
    exports = " ".join(f"{key}={shlex.quote(value)}" for key, value in (
        ("AGENT_RESOURCES_WORKER", "1"), ("AGENT_RESOURCES_OWNER", owner),
        ("AGENT_RESOURCES_AGENT_ID", agent)))
    return {"hookSpecificOutput": {"hookEventName": "SubagentStart", "additionalContext": (
        "For each Bash call that invokes agent-resources (including via a script), start the call "
        f"with `export {exports}` followed by a newline or semicolon. This identifies your "
        "cooperative reservation and scopes queue access; it does not measure your memory.")}}


if __name__ == "__main__":
    try:
        result = context(json.load(sys.stdin))
        if result:
            print(json.dumps(result))
    except (ValueError, OSError):
        pass
