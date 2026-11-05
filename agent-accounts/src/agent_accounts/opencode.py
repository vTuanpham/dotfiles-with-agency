"""OpenCode 2.2.2 location-scoped usage; no credential or inference endpoints."""

import hashlib
import math
import re
from datetime import datetime, timezone

from .models import Quota, QuotaWindow, minutes, timestamp

FRESH_SECONDS = 600


def number(value):
    try:
        valid = type(value) in (int, float) and math.isfinite(value) and value >= 0
    except OverflowError:
        valid = False
    if not valid:
        raise ValueError("invalid OpenCode usage number")
    return value


def text(value):
    if type(value) is not str or not value or len(value) > 300 or any(ord(c) < 32 for c in value):
        raise ValueError("invalid OpenCode usage identity")
    return value


def alias(value):
    return hashlib.sha256(text(value).encode()).hexdigest()[:16]


def decode(raw, observed, directory):
    """Keep workspace Go meters and Console budget scopes separate, removing names/URLs."""
    if type(raw) is not dict or "data" not in raw:
        raise ValueError("invalid OpenCode usage response")
    data = raw["data"]
    windows = []
    result = {"at": observed, "directory": directory, "account": "current-location",
              "windows": windows, "status": "no Console workspace"}
    if data is None:
        return result
    if (type(data) is not dict or type(data.get("workspace")) is not dict
            or type(data.get("budgets")) is not list or len(data["budgets"]) > 64):
        raise ValueError("invalid OpenCode usage data")
    result["account"] = "workspace-" + alias(data["workspace"].get("id"))
    result["status"] = None

    def window(label, group, limit, remaining, resets, **scope):
        try:
            reset = datetime.fromtimestamp(number(resets) / 1000, timezone.utc).isoformat()
        except (OverflowError, OSError) as error:
            raise ValueError("invalid OpenCode reset time") from error
        windows.append({"label": label, "group": group, "limit": limit,
                        "remaining_percent": remaining, "resets": reset, **scope})

    if "go" in data:
        go = data["go"]
        if type(go) is not dict:
            raise ValueError("invalid OpenCode Go meters")
        for key, label, limit in (("rolling", "Goh", "five hour"), ("weekly", "Gow", "weekly"),
                                  ("monthly", "Gom", "monthly")):
            meter = go.get(key)
            if type(meter) is not dict or type(meter.get("limited")) is not bool:
                raise ValueError("invalid OpenCode Go meter")
            used = number(meter.get("percent"))
            if used > 100:
                raise ValueError("invalid OpenCode Go percentage")
            window(label, "opencode-go workspace", limit,
                   0 if meter["limited"] else math.floor(100 - used), meter.get("resetsAt"),
                   source_window=key, window_minutes={"rolling": 300, "weekly": 10080}.get(key),
                   scope_kind="workspace Go allowance", used_percent=used)
    seen = set()
    for budget in data["budgets"]:
        if (type(budget) is not dict or budget.get("scope") not in ("each", "combined")
                or budget.get("per") not in ("set", "model")
                or budget.get("coverage") not in ("all", "models")
                or type(budget.get("models")) is not list or len(budget["models"]) > 256
                or type(budget.get("vendors")) is not list
                or any(type(budget.get(k)) is not bool for k in ("picked", "shared"))):
            raise ValueError("invalid OpenCode Console budget")
        identity = alias(budget.get("id"))
        if identity in seen:
            raise ValueError("duplicate OpenCode budget")
        seen.add(identity)
        cap, spent = number(budget.get("limit")), number(budget.get("spent"))
        routes = []
        for model in budget["models"]:
            if type(model) is not dict:
                raise ValueError("invalid OpenCode budget model")
            route = text(model.get("providerID")) + "/" + text(model.get("modelID"))
            amount = number(model["spent"]) if "spent" in model else None
            routes.append((route, amount))
        if len({route for route, _ in routes}) != len(routes):
            raise ValueError("duplicate OpenCode budget model")
        vendors = ",".join(text(v) for v in budget["vendors"])
        price = (f"; input >= {number(budget['inputPriceAtLeast'])}/M"
                 if "inputPriceAtLeast" in budget else "")
        scope = (f"Console {budget['scope']}/{budget['per']}/{budget['coverage']}"
                 f"; shared={budget['shared']}; picked={budget['picked']}; vendors={vendors or '-'}{price}")
        entries = routes if budget["per"] == "model" else [(
            ",".join(route for route, _ in routes) or budget["coverage"], spent)]
        for index, (route, amount) in enumerate(entries):
            remaining = (None if amount is None else 0 if cap == 0
                         else math.floor(max(0, 100 * (1 - amount / cap))))
            window(f"B{identity}:{index}", scope + "; " + route, "monthly spend budget",
                   remaining, budget.get("resetsAt"), pool_id="console-budget-" + identity,
                   source_window="monthly spend budget",
                   scope_kind=f"Console {budget['scope']}/{budget['per']}/{budget['coverage']}",
                   model_ids=[route] if budget["per"] == "model" else
                             [r for r, _ in routes] if budget["coverage"] == "models" else None)
    return result


def quota(data, now):
    if (type(data) is not dict or type(data.get("directory")) is not str
            or type(data.get("account")) is not str
            or not re.fullmatch(r"workspace-[a-f0-9]{16}|current-location", data["account"])
            or data.get("status") not in (None, "no Console workspace")
            or type(data.get("windows")) is not list or len(data["windows"]) > 16387):
        raise ValueError("invalid OpenCode usage cache")
    at = timestamp(data.get("at"))
    if at > now + 60:
        raise ValueError("invalid OpenCode observation time")
    age = max(0, int(now - at))
    freshness = "fresh" if age <= FRESH_SECONDS else "stale"
    windows = []
    for window in data["windows"]:
        if type(window) is not dict:
            raise ValueError("invalid OpenCode cached window")
        for key in ("label", "group", "limit"):
            value = window.get(key)
            if type(value) is not str or not value or len(value) > 4096 or any(ord(c) < 32 for c in value):
                raise ValueError("invalid OpenCode cached window text")
        remaining = window.get("remaining_percent")
        if remaining is not None and (type(remaining) is not int or not 0 <= remaining <= 100):
            raise ValueError("invalid OpenCode remaining percentage")
        resets = window.get("resets")
        if timestamp(resets) <= now:
            remaining, freshness = None, "stale"
        models = window.get("model_ids")
        if models is not None:
            if type(models) is not list or len(models) > 256:
                raise ValueError("invalid OpenCode model scope")
            models = tuple(text(model) for model in models)
            if len(set(models)) != len(models):
                raise ValueError("duplicate OpenCode model scope")
        extra = {key: text(window[key]) for key in ("source_window", "pool_id", "scope_kind")
                 if window.get(key) is not None}
        used = number(window["used_percent"]) if window.get("used_percent") is not None else None
        windows.append(QuotaWindow(window["label"], remaining, window["group"], window["limit"], resets,
            window_minutes=minutes(window.get("window_minutes")), model_ids=models,
            used_percent=used, **extra))
    if data.get("status") is not None and windows:
        raise ValueError("unavailable OpenCode account carries usage")
    return Quota("opencode", data["account"], None, False, tuple(windows),
                 data.get("status") or ("usage unknown" if not windows else None), data["at"], age, freshness,
                 source="opencode api GET /api/experimental/usage/limits; current directory",
                 source_version="usage-limits schema 098aa7f")
