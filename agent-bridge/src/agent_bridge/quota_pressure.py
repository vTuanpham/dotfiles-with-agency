"""Tell root when a worker's account window is on course to empty.

Claude and Codex report the quota of the account a worker is running on in
their own streams, so those readings need no account lookup. AGY reports none;
its worker reads the cached observation for its own login and asks agent-accounts
for a refresh. Readings go to one Runway history per job.
"""

import subprocess
import sys
import time
from pathlib import Path

from agent_accounts import providers
from agent_accounts.models import period, timestamp
from agent_accounts.runway import Reading, Runway

from .core import log

AGY_SAMPLE = 120  # seconds between reads of the AGY cache; refreshes are rate limited by agent-accounts
REFRESH = (sys.executable, "-c", "from agent_accounts.cli import main; raise SystemExit(main())",
           "refresh", "--backend", "agy", "--if-stale", "--account")


def number(value):
    return value if type(value) in (int, float) else None


def claude(event, now):
    """Windows from a `rate_limit_event`: utilization is the used fraction of each named window."""
    info = event.get("rate_limit_info")
    if not isinstance(info, dict):
        return []
    windows = dict(info["unifiedWindows"]) if isinstance(info.get("unifiedWindows"), dict) else {}
    if isinstance(info.get("rateLimitType"), str):
        windows.setdefault(info["rateLimitType"], info)
    readings = []
    for name, window in windows.items():
        if not isinstance(window, dict):
            continue
        used, resets = number(window.get("utilization")), number(window.get("resetsAt"))
        if used is not None and 0 <= used <= 1 and resets:
            readings.append(Reading(f"claude:{name}", name.replace("_", " "), 100 * (1 - used), resets, now))
    return readings


def codex(snapshots, model, now):
    """Windows from app-server rate-limit snapshots; a model-specific limit counts only for that model."""
    readings = []
    for snapshot in snapshots:
        if not isinstance(snapshot, dict):
            continue
        slug = snapshot.get("normalModelSlug")
        if slug is not None and slug != model:
            continue
        for name in ("primary", "secondary"):
            window = snapshot.get(name)
            if not isinstance(window, dict):
                continue
            used, resets = number(window.get("usedPercent")), number(window.get("resetsAt"))
            if used is not None and 0 <= used <= 100 and resets:
                key = f"codex:{snapshot.get('limitId') or 'codex'}:{name}"
                length = window.get("windowDurationMins")
                label = period(length) if type(length) is int and length > 0 else name
                readings.append(Reading(key, label, 100 - used, resets, now))
    return readings


FAMILIES = ("gemini", "claude", "gpt")  # the model families AGY serves, as its /usage names its groups


def agy_match(window, model):
    """How a window applies to the worker's model: 'reported' by AGY, 'inferred' from its group name, or None.

    AGY's /usage does not list a group's models, only a name ("Gemini Models", "Claude and GPT models").
    A model whose family the group names is taken to be in it; any other model matches nothing."""
    if window.model_ids is not None:
        return "reported" if model in window.model_ids else None
    family = next((name for name in FAMILIES if str(model).lower().startswith(name)), None)
    return "inferred" if family and family in (window.group or "").lower() else None


def agy(observation, model):
    """Windows of the worker's model, by AGY's reported model set or else by its group's name."""
    if observation is None or observation.freshness != "fresh" or not observation.observed_at:
        return []
    readings = []
    for window in observation.windows:
        remaining = (100 * window.remaining_fraction if window.remaining_fraction is not None
                     else window.remaining_percent)
        how = agy_match(window, model)
        if not how or remaining is None or not window.resets:
            continue
        note = (f"matched by the group name {window.group!r}; AGY does not list its models"
                if how == "inferred" else "")
        key = f"agy:{window.pool_id or window.label}"
        readings.append(Reading(key, window.limit or window.label, remaining,
                                timestamp(window.resets), timestamp(observation.observed_at), note))
    return readings


def advice(job, state, hit):
    name = f"{Path(job).parent.name}/{Path(job).name}"
    context = state.get("contextTokens")
    return (
        f"{state.get('backend')} {hit.label} window: {hit.remaining:.0f}% left, about "
        f"{max(1, round(hit.seconds_to_empty / 60))} min at the recent rate of use "
        "(the whole account's, other sessions included). "
        f"Worker model {state.get('model') or 'default'}"
        + (f", context about {round(context / 1000)}k tokens" if isinstance(context, int) else "")
        + (f" ({hit.note})" if hit.note else "")
        + ". Once its turn ends (or after `agent-bridge interrupt "
        f"{name}`) the options, none of them the default, are: let it finish if it will; change model "
        f"on the same thread with `agent-bridge resume {name} --model M [--compact]` (the new model "
        "prefills the whole context uncached; --compact first shrinks it on the current model, spending "
        "this window and trading detail for a summary); or change account with "
        f"`agent-bridge compact {name}`, the harness's auth CLI, then `agent-bridge resume {name}`, or "
        "resume at once and prefill the whole context on a possibly cold cache. A restart ends "
        "background commands."
    )


def feed(job, state, readings, now=None):
    now = time.time() if now is None else now
    if not readings:
        return
    try:
        due = Runway(Path(job) / "quota-runway.json").observe(readings, now)
        for hit in due:
            log(job, "quota_pressure", level="urgent", noticeId=hit.id, message=advice(job, state, hit))
    except (OSError, ValueError, TypeError, KeyError):
        return  # a warning is advisory; the worker must not stop for it


def sample_agy(job, state, monitor):
    """Called from the AGY runner's poll loop: read this login's cache and keep it fresh."""
    now = time.monotonic()
    if now - monitor.get("quota_at", -AGY_SAMPLE) < AGY_SAMPLE:
        return
    monitor["quota_at"] = now
    account, identity = state.get("account"), state.get("agyAuthId")
    if not account or not identity:
        return
    observation = providers.agy_observation(account, identity)
    feed(job, state, agy(observation, state.get("model")))
    if observation is not None and not any(agy_match(w, state.get("model")) for w in observation.windows):
        return  # no window of this observation covers the worker's model, so refreshing it cannot help
    refresh = monitor.get("refresh")
    if refresh is None or refresh.poll() is not None:  # agent-accounts holds the lock and cooldowns
        try:
            monitor["refresh"] = subprocess.Popen([*REFRESH, account], stdin=subprocess.DEVNULL,
                                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                                  start_new_session=True)
        except OSError:
            pass
