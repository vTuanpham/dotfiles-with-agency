"""Reuse existing provider CLIs and caches; never switch accounts or create auth stores."""

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from . import agy, agy_auth, codex, opencode
from .models import loads
from .readers import agy_quota, claude_quotas

ACCOUNTS = Path.home() / ".agy-accounts"
TOKEN = Path(".gemini/antigravity-cli/antigravity-oauth-token")
_STATE = Path(os.environ.get("XDG_STATE_HOME", ""))  # XDG: an empty or relative value is ignored
CLAUDE_CACHE = ((_STATE if _STATE.is_absolute() else Path.home() / ".local/state")
                / "agent-accounts/claude.json")
OPENCODE_CACHE = CLAUDE_CACHE.with_name("opencode.json")
AGY_CACHE = CLAUDE_CACHE.parent / "agy"


def account_env(account, root=None, *, environ=None):
    if not isinstance(account, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", account):
        raise ValueError("invalid account identifier")
    home = (root or ACCOUNTS) / account
    if home.is_symlink() or not (home / TOKEN).is_file():
        raise ValueError("account must already be signed in")
    # Explicit account queries use that account's existing file auth, not inherited API credentials.
    base = os.environ if environ is None else environ
    env = {name: value for name, value in base.items()
           if not re.search("KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE", name, re.I)}
    return {**env, "HOME": str(home)}


def snapshot(now=None, *, root=None, environ=None, claude_cache=None, opencode_cache=None):
    now = time.time() if now is None else now
    managed_agy = root is None
    root = root if root is not None else AGY_CACHE
    result, errors = [], []
    try:
        run = subprocess.run(["codex-auth", "list", "--skip-api", "--json"], capture_output=True, text=True,
                             timeout=5, env=environ)
        if run.returncode or len(run.stdout.encode()) > 1048576:
            raise ValueError("unavailable")
        result.extend(codex.decode(loads(run.stdout), now))
    except (OSError, ValueError, subprocess.SubprocessError):
        errors.append("codex quota unavailable")
    cache = CLAUDE_CACHE if claude_cache is None else claude_cache
    try:
        if cache.is_symlink() or cache.parent.is_symlink() or cache.stat().st_size > 1048576:
            raise ValueError("unsafe Claude quota cache")
        result.extend(claude_quotas(loads(cache.read_text()), now))
    except FileNotFoundError:
        pass
    except (OSError, ValueError, TypeError, OverflowError):
        errors.append("claude quota cache invalid")
    cache = OPENCODE_CACHE if opencode_cache is None else opencode_cache
    try:
        if cache.is_symlink() or cache.parent.is_symlink() or cache.stat().st_size > 1048576:
            raise ValueError("unsafe OpenCode quota cache")
        data = loads(cache.read_text())
        row = opencode.quota(data, now)
        if data["directory"] == str(Path.cwd().resolve()):
            result.append(row)
    except FileNotFoundError:
        pass
    except (OSError, ValueError, TypeError, OverflowError):
        errors.append("opencode quota cache invalid")
    if managed_agy:
        try:
            inventory = agy_auth.inventory()
            paths = [root / account / "quota.json" for account in inventory]
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            paths = []
            errors.append("agy account inventory unavailable")
    else:
        paths = sorted(root.glob("*/quota.json"))
    for path in paths:
        try:
            if (path.is_symlink() or not path.resolve().is_relative_to(root.resolve())
                    or path.stat().st_size > 1048576):
                raise ValueError("unsafe quota cache")
            data = loads(path.read_text())
            if managed_agy and data.get("account_id") != inventory[path.parent.name]:
                continue
            observation = agy_quota(data, now)
            if observation.account != path.parent.name:
                raise ValueError("quota account mismatch")
            result.append(observation)
        except FileNotFoundError:
            pass
        except (OSError, ValueError, TypeError):
            errors.append("agy quota cache invalid")
    return tuple(result), errors


def context():
    """Local profile hints, not a claim about an already-running session's identity."""
    quotas, errors = snapshot()
    profiles = {}
    try:
        run = subprocess.run(["claude", "auth", "status", "--json"], capture_output=True,
                             text=True, timeout=10)
        if run.returncode or len(run.stdout.encode()) > 65536:
            raise ValueError("Claude auth status unavailable")
        data = loads(run.stdout)
        if type(data) is not dict or type(data.get("loggedIn")) is not bool:
            raise ValueError("invalid Claude auth status")
        profile = {"logged_in": data["loggedIn"]}
        for key in ("authMethod", "apiProvider", "subscriptionType"):
            value = data.get(key)
            if value is not None and (type(value) is not str or not re.fullmatch(r"[\w .-]{1,100}", value)):
                raise ValueError("invalid Claude profile value")
            profile[key] = value
        profiles["claude"] = profile
    except (OSError, ValueError, subprocess.SubprocessError):
        errors.append("Claude native profile unavailable")
    return {"quotas": [asdict(row) for row in quotas], "profiles": profiles, "errors": errors,
            "scope": "local profiles; current session account binding unverified",
            "access": "Plan labels are observed, not hardcoded. Active-profile markers do not prove "
                      "an existing session uses that account. Confirm native session account, model "
                      "picker and billing mode before selecting. Optional paid credits are not "
                      "included allowance or permission to spend.",
            "reference": "model-guide read subscriptions"}


def refresh_codex(*, environ=None):
    run = subprocess.run(["codex-auth", "list", "--api", "--json"], capture_output=True, text=True,
                         timeout=120, env=environ)
    if run.returncode or len(run.stdout.encode()) > 1048576:
        raise ValueError("Codex quota query failed")
    return codex.decode(loads(run.stdout), time.time(), source_command="codex-auth list --api --json")


def refresh_claude(*, cache=None, environ=None):
    """Only this explicit refresh invokes cswap; snapshots never consume OAuth grants."""
    cache = CLAUDE_CACHE if cache is None else cache
    run = subprocess.run(["cswap", "list", "--json"], capture_output=True, text=True,
                         timeout=120, env=environ)
    if run.returncode or len(run.stdout.encode()) > 1048576:
        raise ValueError("Claude quota query failed")
    data = loads(run.stdout)
    observations = claude_quotas(data, time.time())
    # Persist only allowance fields, never addresses, aliases, credentials or vendor extras.
    public = {"schemaVersion": 1, "activeAccountNumber": data.get("activeAccountNumber"), "accounts": []}
    for row in data["accounts"]:
        account = {key: row[key] for key in
                   ("number", "active", "usageStatus", "usageFetchedAt", "disabled") if key in row}
        usage = row.get("usage")
        if usage is None:
            account["usage"] = None
        else:
            public_usage: dict[str, object] = {
                key: {field: usage[key][field] for field in ("pct", "resetsAt") if field in usage[key]}
                for key in ("fiveHour", "sevenDay") if key in usage}
            if "scoped" in usage:
                public_usage["scoped"] = [
                    {key: window[key] for key in ("name", "pct", "resetsAt") if key in window}
                    for window in usage["scoped"]]
            account["usage"] = public_usage
        public["accounts"].append(account)
    write_cache(cache, public)
    return observations


def write_cache(cache, data):
    if cache.is_symlink() or cache.parent.is_symlink():
        raise ValueError("unsafe quota cache")
    cache.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    cache.parent.chmod(0o700)
    descriptor, name = tempfile.mkstemp(prefix=".quota-", dir=cache.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(data, stream, allow_nan=False)
        os.replace(name, cache)
    finally:
        Path(name).unlink(missing_ok=True)


def refresh_opencode(*, cache=None):
    cache = OPENCODE_CACHE if cache is None else cache
    directory = str(Path.cwd().resolve())
    command = [shutil.which("opencode") or str(Path.home() / ".opencode/bin/opencode"), "api", "GET",
               "/api/experimental/usage/limits", "--param", "location[directory]=" + directory]
    with tempfile.TemporaryFile(mode="w+") as output:
        run = subprocess.run(command, stdout=output, stderr=subprocess.PIPE, text=True, timeout=30)
        output.seek(0)
        raw = output.read(1048577)
    if run.returncode or len(raw.encode()) > 1048576:
        raise ValueError("OpenCode quota query failed")
    now = time.time()
    data = opencode.decode(loads(raw), datetime.fromtimestamp(now, timezone.utc).isoformat(), directory)
    observation = opencode.quota(data, now)
    if len(json.dumps(data, allow_nan=False).encode()) > 1048576:
        raise ValueError("OpenCode quota cache exceeds size limit")
    write_cache(cache, data)
    return observation


def refresh(account, *, root=None, environ=None):
    if root is None:
        return refresh_managed_agy(account, environ=environ)
    env = account_env(account, root, environ=environ)
    directory = root / account
    if directory.is_symlink() or not (directory / TOKEN).is_file():
        raise ValueError("account must already be signed in")
    result = subprocess.run(["agy", "--output-format", "json", "-p=/usage"], env=env,
                            capture_output=True, text=True, timeout=120, cwd=str(directory))
    if result.returncode:
        raise RuntimeError(f"agy usage query failed (exit {result.returncode})")
    if len(result.stdout.encode()) > 1048576:
        raise ValueError("AGY usage response exceeds size limit")
    data = agy.decode(loads(result.stdout), account, datetime.now(timezone.utc).isoformat())
    observation = agy_quota(data, time.time())
    if not observation.windows:
        raise ValueError("AGY usage response has no quota windows")
    descriptor, name = tempfile.mkstemp(prefix=".quota-", dir=directory)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(data, stream)
        os.replace(name, directory / "quota.json")
    finally:
        Path(name).unlink(missing_ok=True)
    return observation


def refresh_managed_agy(account, *, environ=None):
    if account not in agy_auth.accounts():
        raise ValueError("AGY account must already be registered")
    with tempfile.TemporaryDirectory(prefix="agy-quota-") as temp:
        home = Path(temp)
        token = home / TOKEN
        identity = agy_auth.export(account, token, environ=environ)
        baseline = agy_auth.digest(token)
        env = agy_auth.environment(environ)
        env["HOME"] = str(home)
        result = subprocess.run(["agy", "--output-format", "json", "-p=/usage"], env=env,
                                capture_output=True, text=True, timeout=120, cwd=str(home))
        try:
            synchronized = agy_auth.sync(account, token, identity, baseline)
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            synchronized = False
        if not synchronized:
            recovery = AGY_CACHE.parent / "recovery"
            recovery.mkdir(mode=0o700, parents=True, exist_ok=True)
            descriptor, name = tempfile.mkstemp(prefix="agy-", dir=recovery)
            os.close(descriptor)
            token_descriptor = os.open(token, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                os.fchmod(token_descriptor, 0o600)
            finally:
                os.close(token_descriptor)
            os.replace(token, name)
            raise RuntimeError("AGY quota login changed elsewhere; credential retained for recovery")
        if result.returncode or len(result.stdout.encode()) > 1048576:
            raise RuntimeError("AGY usage query failed")
        data = agy.decode(loads(result.stdout), account, datetime.now(timezone.utc).isoformat())
        data["account_id"] = identity
        observation = agy_quota(data, time.time())
        if not observation.windows:
            raise ValueError("AGY usage response has no quota windows")
        write_cache(AGY_CACHE / account / "quota.json", data)
        return observation
