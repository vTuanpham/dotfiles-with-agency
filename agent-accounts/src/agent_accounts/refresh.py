"""Refresh due native observations once across concurrent account displays."""

import fcntl
import hashlib
import math
import os
import re
import stat
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

from . import agy_auth, providers
from .models import loads, timestamp

BACKENDS = ("codex", "claude", "agy", "opencode")


def state_path():
    return providers.CLAUDE_CACHE.with_name("refresh.json")


def read_state(path):
    if path.is_symlink() or path.parent.is_symlink():
        raise ValueError("unsafe refresh state")
    if not path.exists():
        return {}
    if path.stat().st_size > 1048576:
        raise ValueError("refresh state exceeds limit")
    data = loads(path.read_text())
    if (type(data) is not dict or type(data.get("schema_version")) is not int or data["schema_version"] != 1
            or type(data.get("attempts")) is not dict or len(data["attempts"]) > 2048):
        raise ValueError("invalid refresh state")
    for key, row in data["attempts"].items():
        if (type(key) is not str or len(key) > 200 or key.split(":", 1)[0] not in BACKENDS
                or type(row) is not dict or not {"at", "ok"} <= set(row)
                or set(row) - {"at", "ok", "accounts", "pending"}
                or type(row["at"]) not in (int, float) or not math.isfinite(row["at"])
                or row["at"] < 0 or type(row["ok"]) is not bool):
            raise ValueError("invalid refresh attempt")
        if "pending" in row and type(row["pending"]) is not bool:
            raise ValueError("invalid refresh attempt state")
        if "accounts" in row and (type(row["accounts"]) is not dict
                or any(type(identity) is not str or not re.fullmatch(r"[a-f0-9]{64}", identity)
                       or type(status) is not str or not re.fullmatch(r"[a-z_]{1,64}", status)
                       for identity, status in row["accounts"].items())):
            raise ValueError("invalid account refresh result")
    return data["attempts"]


def diagnostics():
    try:
        return sorted({key.split(":", 1)[0] + ": awaiting a fresh usage reading"
                       for key, row in read_state(state_path()).items()
                       if not row["ok"] and not row.get("pending") and "accounts" not in row
                       and ":" not in key})
    except (OSError, ValueError):
        return ["account refresh history unavailable"]


def annotate(quotas):
    """A failed account refresh never spills onto another account's observation."""
    try:
        attempts, result = read_state(state_path()), []
        for row in quotas:
            key = ("agy:" + row.account if row.backend == "agy" else
                   "opencode:" + hashlib.sha256(str(Path.cwd().resolve()).encode()).hexdigest()
                   if row.backend == "opencode" else row.backend)
            attempt = attempts.get(key, {})
            status = (attempt.get("accounts", {}).get(row.account_key_hash)
                      if "accounts" in attempt else "error" if attempt and not attempt["ok"] else None)
            if (status is not None and not attempt.get("pending")
                    and (row.observed_at is None or timestamp(row.observed_at) <= attempt["at"])):
                row = replace(row, last_refresh_status=status,
                              last_refresh_at=datetime.fromtimestamp(attempt["at"], timezone.utc).isoformat())
            result.append(row)
        return tuple(result)
    except (OSError, ValueError, OverflowError):
        return quotas


def run(backends, *, account=None, if_stale=True, max_age=None, now=None):
    """Snapshots stay read-only; callers opt into this bounded background refresh.

    `max_age` (seconds) tightens "fresh" for callers that know the account is in use; the per-source
    cooldown below still bounds how often a provider is asked."""
    if any(backend not in BACKENDS for backend in backends):
        raise ValueError("unknown quota backend")
    now = time.time() if now is None else now
    cache = state_path()
    if cache.parent.is_symlink():
        raise ValueError("unsafe refresh directory")
    cache.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(cache.with_suffix(".lock"), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as lock:
        info = os.fstat(lock.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1:
            raise ValueError("unsafe refresh lock")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | (fcntl.LOCK_NB if if_stale else 0))
        except BlockingIOError:
            return []
        observations, _ = providers.snapshot(now)
        attempts, jobs, inventory_errors = read_state(cache), [], []
        for backend in dict.fromkeys(backends):
            try:
                accounts = ([account] if account else agy_auth.accounts()) if backend == "agy" else [None]
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
                attempts["agy"] = {"at": now, "ok": False}
                inventory_errors.append("agy: awaiting a fresh usage reading")
                continue
            for selected in accounts:
                key = backend + (":" + selected if selected else "")
                if backend == "opencode":
                    key += ":" + hashlib.sha256(str(Path.cwd().resolve()).encode()).hexdigest()
                rows = [row for row in observations if row.backend == backend
                        and (selected is None or row.account == selected)]
                if if_stale and rows and all(
                        row.status == "disabled"
                        or row.freshness == "fresh" and (max_age is None or (row.age_seconds or 0) <= max_age)
                        for row in rows):
                    continue
                previous = attempts.get(key)
                cooldown = (60 if rows else 600) if previous and previous["ok"] else 300
                if if_stale and previous and now - previous["at"] < cooldown:
                    continue
                jobs.append((key, backend, selected))
                attempts[key] = {"at": now, "ok": False, "pending": True}
        if not jobs:
            if inventory_errors:
                providers.write_cache(cache, {"schema_version": 1, "attempts": attempts})
            return inventory_errors
        providers.write_cache(cache, {"schema_version": 1, "attempts": attempts})

        def query(job):
            key, backend, selected = job
            try:
                if backend == "agy":
                    rows = [providers.refresh(selected)]
                elif backend == "opencode":
                    rows = [providers.refresh_opencode()]
                else:
                    rows = getattr(providers, "refresh_" + backend)()
                ok = all(row.refresh_status in (None, "ok", "not_requested") for row in rows)
                results = ({row.account_key_hash: row.refresh_status for row in rows
                            if row.account_key_hash and row.refresh_status is not None}
                           if backend == "codex" else None)
            except (OSError, ValueError, RuntimeError, TypeError, subprocess.SubprocessError):
                ok, results = False, None
            return key, ok, results

        with ThreadPoolExecutor(max_workers=4) as pool:
            for future in as_completed([pool.submit(query, job) for job in jobs]):
                key, ok, results = future.result()
                attempts[key] = {"at": now, "ok": ok}
                if results is not None:
                    attempts[key]["accounts"] = results
                providers.write_cache(cache, {"schema_version": 1, "attempts": attempts})
        return inventory_errors + [backend + ": awaiting a fresh usage reading" for key, backend, _ in jobs
                                   if not attempts[key]["ok"]]
