"""A stable identity for the login a harness runs under, to notice that it changed between two turns."""

import hashlib
import json
from pathlib import Path

from agent_accounts import agy_auth

from . import codex


def current(backend):
    """Hash of the login `backend`'s next run would use; None when it has none to name or none is readable."""
    try:
        if backend == "codex":
            identity = json.loads((codex.real_home() / "auth.json").read_text())["tokens"]["account_id"]
        elif backend == "claude":
            identity = json.loads((Path.home() / ".claude.json").read_text())["oauthAccount"]["accountUuid"]
        elif backend == "agy":
            identity = agy_auth.inventory()[agy_auth.current()]
        else:
            return None
    except (OSError, ValueError, KeyError, TypeError, RuntimeError):
        return None
    return hashlib.sha256(f"{backend}:{identity}".encode()).hexdigest() if isinstance(identity, str) else None
