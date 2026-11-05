"""codex-auth JSON v1; plan names never define quota windows or model access."""

import hashlib
import math
from datetime import datetime

from .models import Quota, QuotaWindow, epoch, minutes, number, period, text

FRESH_SECONDS = 600
SOURCE = "codex-auth list --skip-api --json"


def decode(data, now, *, source_command=SOURCE):
    if (type(data) is not dict or type(data.get("schema_version")) is not int
            or data["schema_version"] != 1 or data.get("command") != "list"
            or type(data.get("accounts")) is not list or len(data["accounts"]) > 512):
        raise ValueError("invalid codex-auth JSON document")
    active = data.get("active_account_key")
    if active is not None:
        text(active)
    result, keys, numbers = [], set(), set()
    for row in data["accounts"]:
        if type(row) is not dict:
            raise ValueError("invalid Codex account")
        key = text(row.get("account_key"))
        index = row.get("number")
        if type(index) is not int or index <= 0 or index in numbers or key in keys:
            raise ValueError("invalid or duplicate Codex account identity")
        numbers.add(index)
        keys.add(key)
        if type(row.get("active")) is not bool or row["active"] != (key == active):
            raise ValueError("inconsistent Codex active account")
        plan = text(row["plan"]) if row.get("plan") is not None else None
        usage = row.get("usage")
        if type(usage) is not dict:
            raise ValueError("invalid Codex usage")
        source = text(usage.get("source"))
        observed = epoch(usage.get("updated_at"))
        at = datetime.fromisoformat(observed).timestamp() if observed is not None else None
        if at is not None and at > now + 60:
            raise ValueError("invalid Codex observation time")
        age = max(0, int(now - at)) if at is not None else None
        freshness = "unknown" if age is None else "fresh" if age <= FRESH_SECONDS else "stale"
        refresh = usage.get("refresh")
        if type(refresh) is not dict or type(refresh.get("requested")) is not bool:
            raise ValueError("invalid Codex refresh status")
        refresh_status = text(refresh.get("status"))
        windows = []
        for name in ("primary", "secondary"):
            value = usage.get(name)
            if value is None:
                continue
            if type(value) is not dict:
                raise ValueError("invalid Codex window")
            used = number(value.get("used_percent"))
            length = minutes(value.get("window_minutes"))
            resets = epoch(value.get("resets_at"))
            elapsed = resets is not None and datetime.fromisoformat(resets).timestamp() <= now
            if elapsed:
                freshness = "stale"
            remaining = None if elapsed else math.floor(max(0, 100 - used))
            windows.append(QuotaWindow(period(length) if length is not None else name, remaining,
                "", period(length), resets, window_minutes=length, source_window=name,
                scope_kind="unknown: source does not expose bucket/model binding", used_percent=used))
        if source == "none" and windows:
            raise ValueError("missing Codex observation carries windows")
        status = None if windows else "usage unknown"
        if not windows and refresh_status not in ("ok", "not_requested"):
            status = "refresh " + refresh_status
        result.append(Quota("codex", f"{index:02d}", plan, row["active"], tuple(windows), status,
            observed, age, freshness, source=source_command + "; " + source, source_version="JSON v1",
            account_key_hash=hashlib.sha256(key.encode()).hexdigest(), refresh_status=refresh_status))
    if active is not None and active not in keys:
        raise ValueError("Codex active account absent")
    return tuple(result)
