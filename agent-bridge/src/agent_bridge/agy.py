import json
import os
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

from .core import (
    command_env,
    link,
    log,
    save,
)

ACCOUNTS = Path.home() / ".agy-accounts"
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


def account_env(account):
    home = ACCOUNTS / account
    if not (home / TOKEN).is_file():
        raise RuntimeError(f"account {account!r} has no login: run `HOME={home} agy` in a terminal")
    return command_env(HOME=str(home))


def build_home(job, state):
    real, home = Path.home(), Path(job) / "home"
    token = ACCOUNTS / state["account"] / TOKEN
    if not token.is_file():
        raise RuntimeError(
            f"account {state['account']!r} has no login: run `HOME={ACCOUNTS / state['account']} agy` "
            "in a terminal"
        )
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
    link(token, cli / TOKEN.name)
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


def switch_account(job, state, account):
    token = ACCOUNTS / account / TOKEN
    if not token.is_file():
        raise RuntimeError(
            f"account {account!r} has no login: run `HOME={ACCOUNTS / account} agy` in a terminal"
        )
    link = Path(job) / "home" / TOKEN
    link.unlink(missing_ok=True)
    link.symlink_to(token)
    state["account"] = account


def run(job, state, path, prompt, resume=False):
    from .agy_acp import run as run_acp

    return run_acp(job, state, path, prompt, resume=resume)


def fallback(job, state, state_path):
    if os.environ.get("AGENT_BRIDGE_AGY_FALLBACK") == "0":
        return
    model = state.get("model")
    cooldowns = state.get("agyFallbackCooldowns", {})

    def quota_cache(account_dir):
        from agent_accounts import providers
        from agent_accounts.readers import agy_quota

        try:
            data = json.loads((account_dir / "quota.json").read_text())
            cached = agy_quota(data, time.time())
            if cached.freshness != "fresh" or cached.account != account_dir.name:
                raise ValueError("stale quota")
        except (OSError, ValueError, KeyError, TypeError):
            providers.refresh(account_dir.name, root=ACCOUNTS, environ=account_env(account_dir.name))
            data = json.loads((account_dir / "quota.json").read_text())
            cached = agy_quota(data, time.time())
            if cached.account != account_dir.name:
                raise ValueError("quota account mismatch")
        return [window for window in cached.windows if window.model_ids is not None
                and model in window.model_ids]

    while True:
        completed = []
        try:
            for line in (Path(job) / "live.jsonl").read_text(encoding="utf-8").splitlines():
                event = json.loads(line)
                if event.get("kind") == "turn_completed":
                    completed.append(event)
        except (OSError, json.JSONDecodeError):
            return
        error = str(completed[-1].get("error", "")) if completed else ""
        if (
            "quota" not in error.casefold()
            or "reach" not in error.casefold()
            or state.get("agyFallbackEvent") == len(completed)
        ):
            return
        state["agyFallbackEvent"] = len(completed)
        save(state_path, state)
        previous = state.get("account")
        try:
            current_rows = quota_cache(ACCOUNTS / str(previous))
            if not current_rows:
                log(job, "account_fallback_unavailable", level="urgent",
                    message="Native exact model-to-quota-pool binding unavailable; account unchanged.")
                return
            current_row = min(current_rows, key=lambda row: row.resets or "")
        except (OSError, ValueError, KeyError, TypeError):
            log(job, "account_fallback_unavailable", level="urgent",
                message="Native account/model quota binding unavailable; account unchanged.")
            return
        reset = current_row.resets if current_row and current_row.resets else error
        cooldowns[previous] = reset
        for account_dir in sorted(ACCOUNTS.iterdir()):
            account = account_dir.name
            if account == previous or not (account_dir / TOKEN).is_file():
                continue
            try:
                rows = quota_cache(account_dir)
            except Exception as exc:
                log(job, "account_quota_unavailable", account=account, message=str(exc))
                continue
            until = cooldowns.get(account)
            if until:
                try:
                    expires = datetime.fromisoformat(until)
                    if expires.tzinfo is None or expires.astimezone(timezone.utc) > datetime.now(
                        timezone.utc
                    ):
                        continue
                except ValueError:
                    continue
            available = rows and all(
                row.remaining_percent is not None
                and (row.remaining_fraction > 0 if row.remaining_fraction is not None
                     else row.remaining_percent > 0) for row in rows)
            if available:
                switch_account(job, state, account)
                state["agyFallbackCooldowns"] = cooldowns
                save(state_path, state)
                log(
                    job,
                    "account_switched",
                    level="urgent",
                    **{"from": previous, "to": account, "reset": reset},
                )
                run(job, state, state_path, "Continue where you left off.", resume=True)
                break
        else:
            state["agyFallbackCooldowns"] = cooldowns
            save(state_path, state)
            return
