"""Worker-owned bounded declarations; serialized with runner state writes."""

import errno
import json
import os
import re
import stat
import time
from dataclasses import asdict

from . import core
from .assessment import MAX_DECLARED_WAIT_SECONDS
from .status_inputs import timestamp
from .status_model import DeclaredWait

KINDS = ("command", "peer", "root", "external", "dependency")


def decode(value, owner, now=None):
    if not isinstance(value, dict) or set(value) != {
        "kind", "note", "declared_at", "expected_seconds", "peer"
    }:
        raise ValueError("invalid waiting record")
    if value["kind"] not in KINDS:
        raise ValueError("unknown wait kind")
    note = value["note"]
    if not isinstance(note, str) or len(note) > 80 or any(ord(c) < 32 or ord(c) == 127 for c in note):
        raise ValueError("wait note must be at most 80 printable characters")
    if timestamp(value["declared_at"]) > (time.time() if now is None else now):
        raise ValueError("wait declaration cannot be in the future")
    seconds = value["expected_seconds"]
    if type(seconds) is not int or not 1 <= seconds <= MAX_DECLARED_WAIT_SECONDS:
        raise ValueError("wait duration must be between 1 second and 2 hours")
    peer = value["peer"]
    if peer is not None and (value["kind"] not in {"peer", "dependency"}
                             or not isinstance(peer, str)
                             or not re.fullmatch(re.escape(owner) + r"/[A-Za-z0-9][A-Za-z0-9_.-]*", peer)):
        raise ValueError("peer must name a sibling job")
    return DeclaredWait(**value)


DROP = "out/.waiting.json"  # the one job path a sandboxed worker can write
MAX_DROP_BYTES = 4096


def write(job, value):
    if value is not None:
        decode(asdict(value), job.parent.name)
    try:
        with core.state_lock(job):
            state = core.load_state(job)
            if value is None:
                if "waiting" in state:
                    state.pop("waiting")
                    core.atomic_save(job / "state.json", state)
            else:
                state["waiting"] = asdict(value)
                core.atomic_save(job / "state.json", state)
    except OSError as error:
        if error.errno not in (errno.EACCES, errno.EPERM, errno.EROFS):  # a sandbox says one of these (errno 30 is EROFS)
            raise
        # A worker in the command sandbox may write only its out directory, not state.lock: leave the declaration there for
        # the host side to read (`declared`), never widening what the worker may write.
        core.atomic_save(job / DROP, {"at": core.stamp(), "waiting": None if value is None else asdict(value)})
        return
    (job / DROP).unlink(missing_ok=True)  # an owner-side write supersedes any older drop


def declared(job, state):
    """The worker's current declaration: the state's, or a newer one the sandboxed worker left in `out/`. Strictly decoded by
    the caller; a missing, oversized, non-regular or unreadable drop is ignored."""
    current = state.get("waiting")
    try:
        fd = os.open(job / DROP, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError:
        return current
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_DROP_BYTES:
            return current
        with os.fdopen(fd, "r", encoding="utf-8") as stream:
            fd = -1
            drop = json.loads(stream.read(MAX_DROP_BYTES))
    except (OSError, ValueError):
        return current
    finally:
        if fd >= 0:
            os.close(fd)
    if not isinstance(drop, dict) or set(drop) != {"at", "waiting"}:
        return current
    try:
        at = timestamp(drop["at"])
        newer = not isinstance(current, dict) or at >= timestamp(current["declared_at"])
    except (ValueError, TypeError, KeyError):
        return current
    return drop["waiting"] if newer else current


def clear(job):
    if (job / "state.json").exists():
        write(job, None)


def notice(job, assessment):
    """Claim informational notices across concurrent watches and runner restarts."""
    with core.state_lock(job):
        state = core.load_state(job)
        seen = state.get("assessment_notices", [])
        if (not isinstance(seen, list) or len(seen) > 128
                or any(not isinstance(item, str) or len(item) > 1024 for item in seen)):
            raise ValueError("invalid assessment notice ledger")
        if assessment.notice_id in seen:
            return
        state["assessment_notices"] = [*seen, assessment.notice_id][-128:]
        core.atomic_save(job / "state.json", state)
        core.log(job, assessment.state.replace("-", "_"), level="info",
                 noticeId=assessment.notice_id, message=assessment.reason)
