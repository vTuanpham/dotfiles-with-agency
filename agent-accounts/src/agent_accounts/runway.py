"""Depletion warnings from repeated readings of one quota window.

A caller feeds readings as its harness reports them. History lives in one small
file owned by the caller, so the rate survives restarts and new turns.
Quota moves in whole-percent steps: a rate needs a long enough span and a large
enough drop, or it is noise. The rate is the account's, not one session's.
"""

import json
import os
from dataclasses import dataclass
from pathlib import Path

LOOKBACK = 1800  # seconds of history the rate is measured over
MIN_SPAN = 120  # a shorter span cannot separate a trend from a single step
MIN_DROP = 2.0  # percentage points; one step of rounding is not a trend
LEAD = 1800  # warn when the window is on course to empty within this many seconds
BUCKET = 300  # a reset time is the same window within this many seconds
MAX_SAMPLES = 64


@dataclass(frozen=True)
class Reading:
    key: str  # which window, scoped to what it covers
    label: str
    remaining: float  # percent of the window left
    resets: float  # epoch seconds
    observed: float  # epoch seconds the source measured it
    note: str = ""  # how the window was matched to its worker, when that was inferred


@dataclass(frozen=True)
class Depletion:
    id: str
    label: str
    remaining: float
    seconds_to_empty: float
    seconds_to_reset: float
    note: str = ""


class Runway:
    def __init__(self, path):
        self.path = Path(path)

    def observe(self, readings, now) -> tuple[Depletion, ...]:
        """Record readings; return windows newly on course to empty before they reset."""
        before = self._load()
        data = json.loads(json.dumps(before))
        samples, notified = data["samples"], data["notified"]
        due = []
        for reading in readings:
            if reading.resets <= now or not 0 <= reading.remaining <= 100:
                continue
            window = f"{reading.key}@{round(reading.resets / BUCKET)}"
            rows = samples.setdefault(window, [])
            if rows and reading.observed <= rows[-1][0]:
                continue  # the same observation again
            if rows and reading.remaining > rows[-1][1]:
                rows.clear()  # quota came back: the old rate no longer applies
            if not rows or reading.remaining != rows[-1][1] or reading.observed - rows[-1][0] >= 60:
                rows.append([reading.observed, reading.remaining])
            del rows[: max(0, len(rows) - MAX_SAMPLES)]
            rows[:] = [row for row in rows if row[0] >= reading.observed - LOOKBACK]
            if window in notified:
                continue
            first, last = rows[0], rows[-1]
            span, drop = last[0] - first[0], first[1] - last[1]
            if span < MIN_SPAN or drop < MIN_DROP:
                continue
            # What is left lasts until the reading's age is spent too.
            empty = last[1] * span / drop - (now - last[0])
            reset = reading.resets - now
            if empty <= LEAD and empty < reset:
                notified[window] = reading.resets
                due.append(Depletion(window, reading.label, last[1], max(0.0, empty), reset, reading.note))
        for window in [w for w, rows in samples.items() if not rows or rows[-1][0] < now - LOOKBACK]:
            del samples[window]
        data["notified"] = {w: at for w, at in notified.items() if at > now}
        if data != before:
            self._save(data)
        return tuple(due)

    def _load(self):
        try:
            data = json.loads(self.path.read_text())
            if (isinstance(data, dict) and isinstance(data.get("samples"), dict)
                    and isinstance(data.get("notified"), dict)
                    and all(isinstance(rows, list) and all(
                        isinstance(row, list) and len(row) == 2 and all(type(v) in (int, float) for v in row)
                        for row in rows) for rows in data["samples"].values())
                    and all(type(at) in (int, float) for at in data["notified"].values())):
                return data
        except (OSError, ValueError):
            pass
        return {"samples": {}, "notified": {}}

    def _save(self, data):
        temporary = self.path.with_name(f".{self.path.name}.{os.getpid()}.tmp")
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "w") as handle:
            json.dump(data, handle, allow_nan=False)
        os.replace(temporary, self.path)
