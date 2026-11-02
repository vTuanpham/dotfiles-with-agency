"""Continuous monitoring: probe a condition on an interval for a bounded time, with a cooldown.

`codex-wake monitor [limits] -- PROBE...` is a normal sandboxed command: it never talks to Codex.
Every `--every` it runs the probe (an argument list, no shell); exit 0 means the condition holds,
1 that it does not, anything else is a probe error. It prints one `wake-event:` line per announced
hit and one `wake-end:` line when it stops. The host observer (hooks.py) reads those lines from
the running command and wakes the idle session, applying the same limits itself, so a command
that edits its own flags still cannot spam or outlive the hard caps here.
"""

import re
import shlex
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

EVENT = "wake-event:"
END = "wake-end:"
MIN_EVERY, MAX_TTL, MIN_COOLDOWN, MAX_EVENTS = 2, 24 * 3600, 30, 20  # hard caps, in seconds and events
PROBE_TIMEOUT = 60
MAX_PROBE_FAILURES = 5  # consecutive errors before the monitor gives up and says so
# how much of the probe's first line an event line keeps (the log only; never in a notification)
DETAIL_BYTES = 120


@dataclass(frozen=True)
class Policy:
    every: int = 10  # seconds between probes
    ttl: int = 1800  # seconds the monitor may run in all
    cooldown: int = 300  # seconds between announced hits; hits inside it are counted, not announced
    max_events: int = 5  # announced hits before it stops
    distinct: bool = False  # announce only when the probe's output differs from the last announced hit


def duration(text):
    """'90', '30s', '5m' or '2h' in seconds."""
    match = re.fullmatch(r"([0-9]+)([smh]?)", str(text).strip())
    if not match:
        raise ValueError(f"not a duration: {text!r} (use 30s, 5m or 2h)")
    return int(match[1]) * {"": 1, "s": 1, "m": 60, "h": 3600}[match[2]]


def add_arguments(parser):
    parser.add_argument("--every", default="10s", help="seconds between probes (min 2s; default 10s)")
    parser.add_argument("--ttl", default="30m", help="stop after this long (max 24h; default 30m)")
    parser.add_argument(
        "--cooldown", default="5m", help="minimum time between announced hits (min 30s; default 5m)"
    )
    parser.add_argument(
        "--max-events", type=int, default=5, help="stop after this many announced hits (max 20; default 5)"
    )
    parser.add_argument(
        "--distinct",
        action="store_true",
        help="announce a hit only when the probe's output differs from the last announced one",
    )


def policy_of(every, ttl, cooldown, max_events, distinct=False):
    """The policy for typed values, clamped to the hard caps; nonsense is an error, not a silent default."""
    policy = Policy(duration(every), duration(ttl), duration(cooldown), int(max_events), bool(distinct))
    if policy.every < MIN_EVERY or policy.ttl < 1 or policy.max_events < 1:
        raise ValueError("every must be at least 2s, ttl at least 1s, max-events at least 1")
    return Policy(
        policy.every,
        min(policy.ttl, MAX_TTL),
        max(policy.cooldown, MIN_COOLDOWN),
        min(policy.max_events, MAX_EVENTS),
        policy.distinct,
    )


def of_command(command):
    """The policy of a `codex-wake monitor ...` command line, or None. The host calls this on the
    command text Codex reports, so it parses exactly the flags the command itself parsed."""
    import argparse

    try:
        words = shlex.split(command)
    except ValueError:
        return None
    for i, word in enumerate(words):
        if Path(word).name == "codex-wake" and words[i + 1 : i + 2] == ["monitor"]:
            parser = argparse.ArgumentParser(add_help=False, exit_on_error=False)
            add_arguments(parser)
            try:
                known, _ = parser.parse_known_args(
                    words[i + 2 : words.index("--", i)] if "--" in words[i:] else words[i + 2 :]
                )
                return policy_of(known.every, known.ttl, known.cooldown, known.max_events, known.distinct)
            except (ValueError, argparse.ArgumentError):
                return None
    return None


def probe_once(command):
    """(exit code, first stdout line) of one probe run; one that cannot start or hangs is an error (125)."""
    try:
        done = subprocess.run(command, capture_output=True, timeout=PROBE_TIMEOUT, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired):
        return 125, ""
    first = (done.stdout.decode("utf-8", "replace").splitlines() or [""])[0]
    return done.returncode, "".join(ch for ch in first if ch.isprintable())[:DETAIL_BYTES]


def run(policy, command, out=None, clock=time.monotonic, sleep=time.sleep, probe=probe_once):
    """Probe until the ttl, the event limit or repeated probe failure; returns 0, or 3 for probe failure."""
    start, last, events, suppressed, failures, previous = clock(), None, 0, 0, 0, None

    def say(line):
        print(line, file=out or sys.stdout, flush=True)

    while True:
        elapsed = clock() - start
        if elapsed >= policy.ttl:
            say(f"{END} reason=ttl events={events} suppressed={suppressed}")
            return 0
        code, detail = probe(command)
        if code == 0:
            failures = 0
            quiet = last is not None and clock() - last < policy.cooldown
            same = policy.distinct and detail == previous
            if quiet or same:
                suppressed += 1
            else:
                events += 1
                say(f"{EVENT} {events} at={int(clock() - start)}s suppressed={suppressed} {detail}".rstrip())
                last, previous, suppressed = clock(), detail, 0
                if events >= policy.max_events:
                    say(f"{END} reason=max-events events={events} suppressed=0")
                    return 0
        elif code == 1:
            failures = 0
        else:
            failures += 1
            if failures >= MAX_PROBE_FAILURES:
                say(f"{END} reason=probe-failed events={events} suppressed={suppressed}")
                return 3
        sleep(max(0.0, min(policy.every, policy.ttl - (clock() - start))))
