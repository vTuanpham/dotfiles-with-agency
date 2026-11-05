"""Account observations preserve source, account and freshness separately."""

import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone


def loads(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON field")
            result[key] = value
        return result

    def invalid(_):
        raise ValueError("non-finite JSON value")

    return json.loads(raw, object_pairs_hook=unique, parse_constant=invalid)


def timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", value
    ):
        raise ValueError("timestamp requires RFC3339 date, time and timezone")
    return datetime.fromisoformat(value).timestamp()


def text(value):
    if type(value) is not str or not value or len(value) > 4096 or any(ord(c) < 32 for c in value):
        raise ValueError("invalid native allowance text")
    return value


def number(value):
    try:
        valid = type(value) in (int, float) and math.isfinite(value) and value >= 0
    except OverflowError:
        valid = False
    if not valid:
        raise ValueError("invalid native allowance number")
    return value


def epoch(value):
    if value is None:
        return None
    if type(value) is not int or value < 0:
        raise ValueError("invalid native allowance timestamp")
    try:
        return datetime.fromtimestamp(value, timezone.utc).isoformat()
    except (ValueError, OverflowError, OSError) as error:
        raise ValueError("invalid native allowance timestamp") from error


def minutes(value):
    if value is not None and (type(value) is not int or value <= 0):
        raise ValueError("invalid native allowance duration")
    return value


def period(value):
    if value is None:
        return "duration unknown"
    for unit, divisor in (("d", 1440), ("h", 60)):
        if value % divisor == 0:
            return f"{value // divisor}{unit}"
    return f"{value}m"


@dataclass(frozen=True)
class QuotaWindow:
    label: str
    remaining_percent: int | None
    group: str
    limit: str
    resets: str | None
    window_minutes: int | None = None
    source_window: str | None = None
    pool_id: str | None = None
    model_ids: tuple[str, ...] | None = None
    scope_kind: str | None = None
    used_percent: float | None = None
    remaining_fraction: float | None = None


@dataclass(frozen=True)
class Quota:
    backend: str
    account: str
    plan: str | None
    active: bool
    windows: tuple[QuotaWindow, ...]
    status: str | None
    observed_at: str | None
    age_seconds: int | None
    freshness: str
    source: str | None = None
    source_version: str | None = None
    account_key_hash: str | None = None
    refresh_status: str | None = None
    last_refresh_status: str | None = None
    last_refresh_at: str | None = None
