"""A request's controller is its exact root conversation, when known."""

import os

import agent_session


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
