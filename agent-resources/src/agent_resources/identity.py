"""A request's controller is its exact root conversation, when known."""

import os

import agent_session


def validate_agent_id(value):
    if type(value) is not str or not value or len(value) > 400 or any(ord(c) < 33 for c in value):
        raise ValueError("invalid resource agent identity")
    return value


def agent_id(explicit=None):
    inherited = os.environ.get("AGENT_RESOURCES_AGENT_ID")
    if explicit is not None and inherited is not None and explicit != inherited:
        raise ValueError("conflicting resource agent identities")
    value = explicit if explicit is not None else inherited
    return validate_agent_id(value) if value is not None else native_attribution()[1]


def native_attribution():
    try:
        found = agent_session.native()
        if not found or not found[1]:
            return None, None
        harness, session = found
        child = None
        if harness == "codex" and (root := os.environ.get("CODEX_SESSION_ID")):
            # Codex exposes one root session and a distinct thread ID for each native child.
            controller = agent_session.native({"CODEX_THREAD_ID": root})
            assert controller is not None
            child = session if controller[1] != session else None
            session = controller[1]
        return f"{harness}:{session}", child
    except ValueError:
        raise ValueError("invalid native controller identity") from None


def identity():
    explicit = os.environ.get("AGENT_RESOURCES_OWNER")
    if explicit is not None:
        if not explicit or len(explicit) > 400 or any(ord(c) < 33 for c in explicit):
            raise ValueError("invalid resource controller identity")
        return explicit
    return native_attribution()[0]
