"""Native AGY read-only /usage command payload; pool names never imply model membership."""

import hashlib
import math
import re
from decimal import Decimal

from .models import Quota, QuotaWindow, minutes, number, text, timestamp

FRESH_SECONDS = 600


def decode(raw, account, observed):
    if type(raw) is not dict:
        raise ValueError("invalid AGY command response")
    body = raw.get("result", raw)
    if type(body) is not dict or type(body.get("num_turns")) is not int or body["num_turns"] != 0:
        raise ValueError("AGY quota response is not a read-only command")
    command = body.get("command")
    if type(command) is not dict or command.get("name") not in ("usage", "quota"):
        raise ValueError("AGY quota structured command missing")
    payload = command.get("data")
    if type(payload) is not dict or type(payload.get("groups")) is not list:
        raise ValueError("AGY quota groups missing")
    groups = []
    for group in payload["groups"]:
        if type(group) is not dict or type(group.get("buckets")) is not list:
            raise ValueError("invalid AGY quota group")
        groups.append({"name": group.get("name"), "buckets": [
            {key: bucket[key] for key in ("id", "name", "window", "remaining_fraction", "reset_time",
                                          "window_minutes", "model_ids") if key in bucket}
            for bucket in group["buckets"] if type(bucket) is dict]})
        if len(groups[-1]["buckets"]) != len(group["buckets"]):
            raise ValueError("invalid AGY quota bucket")
    data = {"schema_version": 2, "account": account, "at": observed, "groups": groups}
    quota(data, timestamp(observed))
    return data


def quota(data, now):
    if (type(data) is not dict or type(data.get("schema_version")) is not int
            or data["schema_version"] != 2 or type(data.get("account")) is not str
            or not re.fullmatch(r"[A-Za-z0-9_-]+", data["account"])
            or type(data.get("groups")) is not list or len(data["groups"]) > 128):
        raise ValueError("invalid AGY structured cache")
    at = timestamp(data.get("at"))
    if at > now + 60:
        raise ValueError("invalid AGY observation time")
    age = max(0, int(now - at))
    freshness = "fresh" if age <= FRESH_SECONDS else "stale"
    windows, seen = [], set()
    for group in data["groups"]:
        if type(group) is not dict or type(group.get("buckets")) is not list or len(group["buckets"]) > 128:
            raise ValueError("invalid AGY quota group")
        name = text(group.get("name"))
        for bucket in group["buckets"]:
            if type(bucket) is not dict:
                raise ValueError("invalid AGY quota bucket")
            identity = text(bucket.get("id"))
            label = text(bucket.get("name"))
            window = text(bucket["window"]) if bucket.get("window") is not None else None
            # These are native period enums, not subscription-plan rules.
            length = minutes(bucket.get("window_minutes", {"weekly": 10080, "five_hour": 300}.get(window)))
            key = (identity, window, length)
            if key in seen:
                raise ValueError("duplicate AGY quota window")
            seen.add(key)
            fraction = bucket.get("remaining_fraction")
            if fraction is not None and number(fraction) > 1:
                raise ValueError("invalid AGY remaining fraction")
            resets = bucket.get("reset_time")
            elapsed = resets is not None and timestamp(resets) <= now
            if elapsed:
                freshness = "stale"
            remaining = None if fraction is None or elapsed else math.floor(Decimal(str(fraction)) * 100)
            models = bucket.get("model_ids")
            if models is not None:
                if type(models) is not list or len(models) > 512:
                    raise ValueError("invalid AGY native model membership")
                models = tuple(text(model) for model in models)
                if len(set(models)) != len(models):
                    raise ValueError("duplicate AGY native model membership")
            windows.append(QuotaWindow(identity, remaining, name, label, resets,
                window_minutes=length, source_window=window, pool_id=identity, model_ids=models,
                scope_kind="reported model set" if models is not None else "model membership unknown",
                remaining_fraction=None if elapsed else fraction))
    account_id = data.get("account_id")
    if account_id is not None:
        account_id = text(account_id)
    return Quota("agy", data["account"], None, False, tuple(windows),
                 None if windows else "usage unknown", data["at"], age, freshness,
                 source="agy -p=/usage structured command.data", source_version=None,
                 account_key_hash=hashlib.sha256(account_id.encode()).hexdigest() if account_id else None)
