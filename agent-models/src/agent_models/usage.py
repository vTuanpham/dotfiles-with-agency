"""Summarize attributable Bridge turn outcomes without exporting conversation content."""

import json
import os
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import cast

from .decision_context import BACKENDS


def time_of(value):
    try:
        result = datetime.fromisoformat(value)
        return result if result.tzinfo is not None else None
    except (ValueError, TypeError):
        return None


def summary(root=None, backend=None):
    root = Path(root or os.environ.get("AGENT_BRIDGE_HOME", "~/.local/state/agent-bridge")).expanduser()
    jobs = root / "jobs"
    totals = {}
    skipped = Counter()
    for log in jobs.glob("*/*/live.jsonl"):
        if log.is_symlink() or log.parent.is_symlink() or log.parent.parent.is_symlink():
            skipped["unsafe_logs"] += 1
            continue
        active = None
        ambiguous = False
        try:
            with log.open(encoding="utf-8") as stream:
                for line in stream:
                    if not line.endswith("\n"):
                        break
                    try:
                        event = json.loads(line)
                    except ValueError:
                        skipped["invalid_events"] += 1
                        continue
                    if not isinstance(event, dict):
                        continue
                    kind = event.get("kind")
                    if kind == "runner_exit":
                        if active is not None:
                            skipped["unfinished_turns"] += 1
                        active, ambiguous = None, False
                    elif kind == "turn_started":
                        if active is not None or ambiguous:
                            skipped["overlapping_turns"] += 1
                            active, ambiguous = None, True
                            continue
                        fields = [event.get(key) for key in ("backend", "requestedModel", "requestedAccount",
                                                            "requestedEffort", "effectiveEffort")]
                        if (fields[0] not in BACKENDS or any(value is not None and
                                (not isinstance(value, str) or len(value) > 256 or not value.isprintable())
                                for value in fields)):
                            skipped["missing_provenance"] += 1
                            active, ambiguous = None, True
                            continue
                        active = (tuple(fields), time_of(event.get("at")), event.get("turnId"))
                    elif kind == "effort_observed" and active is not None and not ambiguous:
                        fields, started, turn_id = active
                        level = event.get("effort")
                        if (turn_id is not None and isinstance(level, str) and level
                                and len(level) <= 256 and level.isprintable()
                                and event.get("turnId") == turn_id):
                            active = (fields[:4] + (level,), started, turn_id)
                    elif kind in ("turn_completed", "turn_failed", "attempt_failed"):
                        if active is None or ambiguous:
                            continue
                        fields, started, turn_id = active
                        terminal_id = event.get("turnId")
                        if terminal_id is not None and turn_id is not None and terminal_id != turn_id:
                            skipped["mismatched_turns"] += 1
                            active, ambiguous = None, True
                            continue
                        status = event.get("status")
                        if kind in ("turn_failed", "attempt_failed") or event.get("is_error") is True:
                            status = "failed"
                        elif status not in ("completed", "failed", "interrupted", "cancelled", "denied",
                                            "incomplete", "max_tokens", "max_turn_requests"):
                            status = "unknown"
                        if backend is None or fields[0] == backend:
                            entry = totals.setdefault(fields, {"outcomes": Counter(), "seconds": 0,
                                                               "timed_turns": 0, "token_turns": 0,
                                                               "input_tokens": 0, "output_tokens": 0})
                            entry["outcomes"][status] += 1
                            reported = event.get("usage")
                            if fields[0] == "claude" and isinstance(reported, dict) and all(
                                type(reported.get(key)) is int and reported[key] >= 0
                                for key in ("input_tokens", "output_tokens")
                            ):
                                entry["input_tokens"] += reported["input_tokens"]
                                entry["output_tokens"] += reported["output_tokens"]
                                entry["token_turns"] += 1
                            ended = time_of(event.get("at"))
                            if started and ended and ended >= started:
                                entry["seconds"] += (ended - started).total_seconds()
                                entry["timed_turns"] += 1
                        active = None
        except (OSError, UnicodeError):
            skipped["unreadable_logs"] += 1
    rows = [{"backend": key[0], "requested_model": key[1], "requested_account": key[2],
             "requested_effort": key[3], "observed_effort": key[4],
             **value, "outcomes": dict(value["outcomes"]),
             "seconds": value["seconds"] if value["timed_turns"] else None,
             "input_tokens": value["input_tokens"] if value["token_turns"] else None,
             "output_tokens": value["output_tokens"] if value["token_turns"] else None}
            for key, value in totals.items()]
    rows.sort(key=lambda row: (-sum(cast(dict[str, int], row["outcomes"]).values()),
                               str(row["requested_model"])))
    return {"scope": "Bridge turns with unambiguous requested settings; completion is not task quality",
            "rows": rows, "skipped": dict(skipped)}
