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
    return validate_agent_id(value) if value is not None else None


def identity():
    explicit = os.environ.get("AGENT_RESOURCES_OWNER")
    if explicit is not None:
        if not explicit or len(explicit) > 400 or any(ord(c) < 33 for c in explicit):
            raise ValueError("invalid resource controller identity")
        return explicit
    try:
        found = agent_session.native()
    except ValueError:
        raise ValueError("invalid native controller identity") from None
    return f"{found[0]}:{found[1]}" if found and found[1] else None
