"""Local, attributed selection notes; never treated as provider entitlements."""

import fcntl
import json
import os
import tempfile
from contextlib import contextmanager
from datetime import date, datetime, timezone

from agent_accounts.models import loads

from . import state

FIELDS = {"id", "source", "note", "backend", "model", "account", "task", "reason", "created", "expires"}


def validate(item):
    if not isinstance(item, dict) or set(item) != FIELDS:
        raise ValueError("invalid preference record")
    for key, value in item.items():
        if value is not None and (not isinstance(value, str) or not value.strip()
                                  or len(value) > 1000 or not value.isprintable()):
            raise ValueError("invalid preference field: " + key)
    if item["source"] not in ("user", "agent") or not item["id"] or not item["note"]:
        raise ValueError("preference requires an id, source and note")
    if item["backend"] not in (None, "codex", "claude", "agy", "opencode"):
        raise ValueError("invalid preference backend")
    if not item["created"] or datetime.fromisoformat(item["created"]).tzinfo is None:
        raise ValueError("preference creation time requires a timezone")
    if item["expires"] is not None and date.fromisoformat(item["expires"]).isoformat() != item["expires"]:
        raise ValueError("preference expiry must be YYYY-MM-DD")
    return item


def read():
    path = state.HOME / "preferences.json"
    if not path.exists():
        return []
    if path.is_symlink() or path.stat().st_size > 262144:
        raise ValueError("invalid preference store")
    items = loads(path.read_text(encoding="utf-8"))
    if not isinstance(items, list) or len(items) > 256:
        raise ValueError("invalid preference store")
    for item in items:
        validate(item)
    if len({item["id"] for item in items}) != len(items):
        raise ValueError("duplicate preference id")
    return items


def applicable(backend=None):
    today = date.today().isoformat()
    items = [item for item in read() if (not item["expires"] or item["expires"] >= today)
             and (not backend or not item["backend"] or item["backend"] == backend)]
    return sorted(items, key=lambda item: (item["source"] != "user", item["created"]))


def lines(items):
    result = []
    for item in items:
        scope = ", ".join(f"{key}={item[key]}" for key in ("backend", "model", "account", "task")
                          if item[key]) or "general"
        validity = item["created"][:10] + (f", through {item['expires']}" if item["expires"] else "")
        result.append(f"Preference ({item['source']}, {validity}, {scope}): {item['note']}"
                      + (f" — {item['reason']}" if item["reason"] else ""))
    return result


@contextmanager
def locked():
    state.HOME.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(state.HOME / "preferences.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        os.close(descriptor)


def write(items):
    data = json.dumps(items, ensure_ascii=False, indent=2) + "\n"
    if len(items) > 256 or len(data.encode()) > 262144:
        raise ValueError("preference store is full")
    fd, name = tempfile.mkstemp(prefix=".preferences-", dir=state.HOME)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(data)
        os.replace(name, state.HOME / "preferences.json")
    finally:
        if os.path.exists(name):
            os.unlink(name)


def add(args):
    import secrets

    item = validate({"id": secrets.token_hex(6), "source": args.source, "note": args.note,
                     "backend": args.backend, "model": args.model, "account": args.account,
                     "task": args.task, "reason": args.reason,
                     "created": datetime.now(timezone.utc).isoformat(), "expires": args.expires})
    with locked():
        items = read()
        items.append(item)
        write(items)
    return item


def remove(identifier):
    with locked():
        items = read()
        remaining = [item for item in items if item["id"] != identifier]
        if len(remaining) == len(items):
            raise ValueError("preference id not found")
        write(remaining)
