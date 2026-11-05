"""Decode provider observations once; missing freshness stays unknown."""

import math
import re

from . import agy
from .models import Quota, QuotaWindow, timestamp

AGY_QUOTA_FRESH_SECONDS = 600
CLAUDE_QUOTA_FRESH_SECONDS = 600


def claude_quotas(data, now):
    """cswap JSON v1 reports percent used; shared observations report remaining."""
    if (type(data) is not dict or type(data.get("schemaVersion")) is not int
            or data["schemaVersion"] != 1 or "activeAccountNumber" not in data
            or type(data.get("accounts")) is not list):
        raise ValueError("invalid Claude account document")
    active = data.get("activeAccountNumber")
    if active is not None and (type(active) is not int or active < 1):
        raise ValueError("invalid Claude active account")
    result, seen = [], set()
    for row in data["accounts"]:
        if type(row) is not dict or type(row.get("number")) is not int or row["number"] < 1:
            raise ValueError("invalid Claude account number")
        number = row["number"]
        if number in seen or type(row.get("active")) is not bool or row["active"] != (active == number):
            raise ValueError("inconsistent Claude account identity")
        seen.add(number)
        status = row.get("usageStatus")
        if (type(status) is not str or not re.fullmatch(r"[a-z_]{1,64}", status)
                or type(row.get("disabled", False)) is not bool):
            raise ValueError("invalid Claude account status")
        observed = row.get("usageFetchedAt")
        at = timestamp(observed) if observed is not None else None
        if at is not None and at > now + 60:
            raise ValueError("invalid Claude observation time")
        age = max(0, int(now - at)) if at is not None else None
        freshness = ("unknown" if age is None else
                     "fresh" if age <= CLAUDE_QUOTA_FRESH_SECONDS else "stale")
        windows = []
        usage = row.get("usage")
        if status == "ok":
            if type(usage) is not dict:
                raise ValueError("missing Claude usage")
            scoped = usage.get("scoped", [])
            if type(scoped) is not list:
                raise ValueError("invalid Claude model windows")
            entries = [(key, label, "", limit, usage[key]) for key, label, limit in
                       (("fiveHour", "h", "five hour"), ("sevenDay", "w", "weekly")) if key in usage]
            for window in scoped:
                if (type(window) is not dict or type(window.get("name")) is not str
                        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._/-]{0,63}", window["name"])):
                    raise ValueError("invalid Claude model name")
                entries.append(("scoped", window["name"], window["name"],
                                "model scoped; duration not exposed", window))
            for _, label, group, limit, window in entries:
                if type(window) is not dict:
                    raise ValueError("invalid Claude quota window")
                used = window.get("pct")
                if (type(used) not in (int, float) or used < 0
                        or (type(used) is float and not math.isfinite(used))):
                    raise ValueError("invalid Claude usage percentage")
                resets = window.get("resetsAt")
                elapsed = resets is not None and timestamp(resets) <= now
                if elapsed:
                    freshness = "stale"
                remaining = None if elapsed else math.floor(max(0, 100 - used))
                length = 300 if label == "h" else 10080 if label == "w" else None
                windows.append(QuotaWindow(label, remaining, group, limit, resets,
                    window_minutes=length, source_window="scoped" if group else
                    "fiveHour" if label == "h" else "sevenDay", used_percent=used,
                    scope_kind="provider-named model scope" if group else "account-shared"))
        elif usage is not None:
            raise ValueError("unavailable Claude account carries actionable usage")
        state = ("disabled" if row.get("disabled", False) else
                 None if status == "ok" else status.replace("_", " "))
        if not windows and state is None:
            state = "usage unknown"
        result.append(Quota("claude", f"{number:02d}", None, row["active"], tuple(windows),
                            state, observed, age, freshness,
                            source="cswap list --json", source_version="JSON v1"))
    if active is not None and active not in seen:
        raise ValueError("Claude active account is absent")
    return tuple(result)


def agy_quota(data, now):
    if type(data) is dict and "schema_version" in data:
        return agy.quota(data, now)
    if (type(data) is not dict or type(data.get("account")) is not str
            or not re.fullmatch(r"[A-Za-z0-9_-]+", data["account"])):
        raise ValueError("invalid quota account")
    at = timestamp(data.get("at"))
    if at > now + 60 or type(data.get("rows")) is not list or not data["rows"]:
        raise ValueError("invalid quota time or rows")
    parts = []
    for row in data["rows"]:
        if (type(row) is not dict
                or any(type(row.get(k)) is not str for k in ("group", "limit", "resets"))
                or type(row.get("remaining")) is not int or not 0 <= row["remaining"] <= 100):
            raise ValueError("invalid quota row")
        if any(len(row[k]) > 4096 or any(ord(c) < 32 for c in row[k])
               for k in ("group", "limit", "resets")):
            raise ValueError("invalid quota row text")
        resets = row["resets"] or None
        elapsed = resets is not None and timestamp(resets) <= now
        parts.append(QuotaWindow(row["group"] + "/" + row["limit"],
                                None if elapsed else row["remaining"], row["group"], row["limit"], resets,
                                scope_kind="legacy text; binding unknown"))
    age = max(0, int(now - at))
    return Quota("agy", data["account"], None, False, tuple(parts), None, data["at"], age,
                 "fresh" if age <= AGY_QUOTA_FRESH_SECONDS and all(
                     p.resets is None or timestamp(p.resets) > now for p in parts) else "stale",
                 source="legacy AGY /usage text cache")
