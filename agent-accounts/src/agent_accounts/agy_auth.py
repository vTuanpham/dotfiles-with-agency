"""Materialize one agy-auth account into an isolated worker home."""

import fcntl
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path


def environment(environ=None):
    base = os.environ if environ is None else environ
    result = {name: value for name, value in base.items()
              if not re.search("KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE", name, re.I)
              or name in {"AGY_AUTH_HOME", "AGY_AUTH_STORAGE"}}
    result["AGY_AUTH_NO_UPDATE_CHECK"] = "1"
    return result


def current():
    result = subprocess.run(["agy-auth", "list", "--no-sync", "--no-usage", "--json"],
                            env=environment(), capture_output=True, text=True, timeout=30)
    if result.returncode or len(result.stdout.encode()) > 1048576:
        raise RuntimeError("current AGY login is unavailable")
    data = json.loads(result.stdout)
    rows = data.get("data", {}).get("accounts")
    if data.get("schema_version") != 1 or data.get("command") != "list" or not isinstance(rows, list):
        raise ValueError("invalid AGY account inventory")
    active = [row for row in rows if isinstance(row, dict) and row.get("active") is True
              and row.get("stored") is True]
    if len(active) != 1:
        raise ValueError("current AGY login is not registered; run `agy-auth add`")
    account = active[0]
    alias = account.get("alias")
    identity = (alias if isinstance(alias, str) and re.fullmatch(r"[A-Za-z0-9_-]+", alias)
                else account.get("id"))
    if not isinstance(identity, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", identity):
        raise ValueError("current AGY account identity is unavailable")
    return identity


def inventory():
    result = subprocess.run(["agy-auth", "list", "--no-sync", "--no-usage", "--json"],
                            env=environment(), capture_output=True, text=True, timeout=30)
    if result.returncode or len(result.stdout.encode()) > 1048576:
        raise RuntimeError("AGY account inventory is unavailable")
    data = json.loads(result.stdout)
    rows = data.get("data", {}).get("accounts")
    if data.get("schema_version") != 1 or data.get("command") != "list" or not isinstance(rows, list):
        raise ValueError("invalid AGY account inventory")
    names = {}
    for row in rows:
        if not isinstance(row, dict) or type(row.get("stored")) is not bool:
            raise ValueError("invalid AGY account inventory")
        if not row["stored"]:
            continue
        alias = row.get("alias")
        name = (alias if isinstance(alias, str) and re.fullmatch(r"[A-Za-z0-9_-]+", alias)
                else row.get("id"))
        identity = row.get("id")
        if (not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", name) or name in names
                or not isinstance(identity, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", identity)):
            raise ValueError("invalid AGY account identity")
        names[name] = identity
    return names


def accounts():
    return list(inventory())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def export(account, destination, *, environ=None):
    if not isinstance(account, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", account):
        raise ValueError("invalid AGY account selector")
    destination = Path(destination)
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".agy-auth-", dir=destination.parent) as temp:
        env = environment(environ)
        result = subprocess.run(["agy-auth", "export", "--dir", temp, account, "--json"],
                                env=env, capture_output=True, text=True, timeout=30)
        if result.returncode or len(result.stdout.encode()) > 1048576:
            raise RuntimeError("agy-auth export failed")
        data = json.loads(result.stdout)
        if data.get("schema_version") != 1 or data.get("command") != "export":
            raise ValueError("invalid agy-auth export response")
        files = data.get("data", {}).get("files", [])
        if len(files) != 1 or files[0].get("outcome") != "exported":
            raise ValueError("agy-auth did not export exactly one account")
        source = Path(files[0]["path"])
        if source.parent.resolve() != Path(temp).resolve() or source.is_symlink() or not source.is_file():
            raise ValueError("invalid agy-auth export path")
        identity = files[0].get("account", {}).get("id")
        if not isinstance(identity, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", identity):
            raise ValueError("invalid agy-auth account identity")
        source.chmod(0o600)
        os.replace(source, destination)
        return identity


def sync(account, token, identity, previous_digest):
    """Import a refreshed worker token only if the registry has not changed."""
    token = Path(token)
    if not token.is_file() or digest(token) == previous_digest:
        return True
    state = Path(os.environ.get("XDG_STATE_HOME") or "")
    if not state.is_absolute():
        state = Path.home() / ".local/state"
    state = state / "agent-accounts"
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor = os.open(state / "agy-auth-sync.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with tempfile.TemporaryDirectory(prefix=".agy-auth-sync-", dir=token.parent) as temp:
            current = Path(temp) / "token"
            if export(account, current) != identity or digest(current) != previous_digest:
                return False
            env = environment()
            result = subprocess.run(["agy-auth", "import", str(token), "--json"], env=env,
                                    capture_output=True, text=True, timeout=30)
            if result.returncode or len(result.stdout.encode()) > 1048576:
                return False
            data = json.loads(result.stdout)
            imported = data.get("data", {}).get("imported", [])
            return (data.get("schema_version") == 1 and data.get("command") == "import"
                    and len(imported) == 1 and imported[0].get("id") == identity)
