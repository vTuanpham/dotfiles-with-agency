import json
import shutil
import subprocess
import time
from pathlib import Path

from agent_accounts import agy_auth

from .core import (
    link,
    log,
    save,
)

TOKEN = Path(".gemini/antigravity-cli/antigravity-oauth-token")
READ_ALL = ["read_file(/)"]  # a directory target is recursive: reads anywhere, like a codex sandbox
BURN_WINDOW = 60  # seconds per transcript sample
BURN_WINDOWS = 3  # consecutive windows of model requests the stream never showed before the urgent report
# agy caps a foreground command at 10 s (run_command's WaitMsBeforeAsync schema) and has no blocking wait for
# a background one, so a model that waits for a long command polls it, one full-context request per poll.
AGY_RULE = (
    "agy backgrounds any command still running after 10 seconds, and every poll of it (tail, ps, "
    "manage_task status, re-running a summary) is a full-context model request that spends quota. "
    "Never poll. Do not start a command that may take more than two minutes: send one message with the "
    "exact command, its working directory and what output to expect, then end your turn; the coordinator "
    "runs it and resumes you with the result. Report useful progress or blockers, not repeated wait updates."
)


def transcript_path(job, conversation):
    logs = Path(job) / "home/.gemini/antigravity-cli/brain" / conversation / ".system_generated/logs"
    return logs / "transcript.jsonl"


def burn_check(job, state, mon):
    """Count native transcript requests and warn on sustained unseen activity, when available."""
    now = time.monotonic()
    if now - mon["at"] < BURN_WINDOW:
        return
    seconds, mon["at"] = round(now - mon["at"]), now
    seen, mon["seen"] = mon["seen"], False
    try:
        with transcript_path(job, state.get("conversationId", "")).open("rb") as handle:
            handle.seek(mon["offset"])
            data = handle.read()
    except OSError:
        return
    data = data[: data.rfind(b"\n") + 1]  # a half-written last line waits for the next sample
    mon["offset"] += len(data)
    requests = []
    for line in data.splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict) and "input_tokens" in row:  # a model request; tool results carry none
            requests.append(row)
    if not requests:
        mon["hidden"] = 0
        return
    keys = ("input_tokens", "cache_read_tokens", "output_tokens")
    totals = {key: sum(r.get(key) or 0 for r in requests) for key in keys}
    log(job, "model_requests", requests=len(requests), seconds=seconds, streamed=seen, **totals)
    mon["hidden"] = 0 if seen else mon["hidden"] + 1
    if mon["hidden"] == BURN_WINDOWS:
        log(
            job,
            "quota_burn",
            level="urgent",
            message=(
                f"{len(requests)} model requests in the last {seconds}s and none streamed for "
                f"{BURN_WINDOWS} windows: the worker is likely polling a backgrounded command. "
                "Interrupt and resume it, or run that command yourself."
            ),
        )


def build_home(job, state):
    real, home = Path.home(), Path(job) / "home"
    gem, cli = home / ".gemini", home / ".gemini" / "antigravity-cli"
    cli.mkdir(parents=True, exist_ok=True)
    home.chmod(0o700)
    for entry in real.iterdir():
        if entry.name not in (".gemini", ".agy-accounts"):
            link(entry, home / entry.name)
    for entry in (real / ".gemini").iterdir() if (real / ".gemini").is_dir() else ():
        if entry.name not in ("antigravity-cli", "config"):
            link(entry, gem / entry.name)
    # agy rewrites config/projects on every run, so it is copied; the rest of config stays shared
    (gem / "config").mkdir(exist_ok=True)
    for entry in (real / ".gemini" / "config").iterdir() if (real / ".gemini" / "config").is_dir() else ():
        if entry.name == "projects":
            shutil.copytree(entry, gem / "config" / entry.name, dirs_exist_ok=True)
        else:
            link(entry, gem / "config" / entry.name)
    set_auth(job, state, state["account"])
    roots = state["writableRoots"]
    perms = (
        {
            "allow": [*(f"write_file({r})" for r in roots), "command(*)", *READ_ALL, *state.get("allow", [])],
            "deny": state.get("deny", []),
        }
        if state["sandbox"] == "workspace-write"
        else {
            "allow": [*READ_ALL, *state.get("allow", [])],
            "deny": ["write_file(*)", *state.get("deny", [])],
        }
    )
    (cli / "settings.json").write_text(
        json.dumps(
            {"colorScheme": "dark", "trustedWorkspaces": [state["cwd"]], "permissions": perms}, indent=2
        )
        + "\n",
        encoding="utf-8",
    )
    (cli / "settings.json").chmod(0o600)
    return home


def set_auth(job, state, account):
    token = Path(job) / "home" / TOKEN
    identity = agy_auth.export(account, token)
    state["agyAuthId"] = identity
    state["agyAuthDigest"] = agy_auth.digest(token)
    state["account"] = account


def sync_auth(job, state):
    identity, baseline = state.get("agyAuthId"), state.get("agyAuthDigest")
    token = Path(job) / "home" / TOKEN
    if not identity or not baseline:
        return True
    if not agy_auth.sync(state["account"], token, identity, baseline):
        return False
    state["agyAuthDigest"] = agy_auth.digest(token)
    return True


def run(job, state, path, prompt, resume=False, compact=False):
    from .agy_acp import run as run_acp

    if resume:
        if state.get("agyAuthId") and not sync_auth(job, state):
            raise RuntimeError("AGY worker credentials changed elsewhere; inspect before resuming")
        set_auth(job, state, agy_auth.current())
        save(path, state)
    try:
        return run_acp(job, state, path, prompt, resume=resume, compact=compact)
    finally:
        try:
            if not sync_auth(job, state):
                log(job, "auth_detached", level="urgent",
                    message="AGY account credentials changed elsewhere; this worker keeps its own login.")
            save(path, state)
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
            log(job, "auth_detached", level="urgent",
                message="AGY worker login could not be synchronized with agy-auth.")
