"""Host-side lifecycle delivery; never executes a model's command."""

import hashlib
import json
import os
import shlex
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import asdict
from pathlib import Path

from . import monitor
from .client import Wake, connection, validate_message

POLL = 2
MAX_POLL = 30
MONITOR_POLL = 8
STOP_PAGES = 4


def key(value):
    return hashlib.sha256(value.encode()).hexdigest()


def identifier(value):
    if not isinstance(value, str) or not value or len(value) > 200 or any(ord(c) < 32 for c in value):
        raise RuntimeError("Invalid Codex hook identifier")
    return value


def private_write(path, text):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as output:
        temporary = Path(output.name)
        try:
            output.write(text)
            output.flush()
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def directory(target):
    base = Path(os.environ.get("XDG_STATE_HOME", ""))
    if not base.is_absolute():
        base = Path.home() / ".local/state"
    path = base / "codex-wake" / key(str(target.home) + "\0" + target.thread)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path


def epoch(folder):
    path = folder / "epoch"
    if not path.exists():
        private_write(path, uuid.uuid4().hex)
    return path.read_text()


def pages(call, method, params):
    cursor, seen = None, set()
    for _ in range(STOP_PAGES):
        page = call(method, {**params, "cursor": cursor, "limit": 32})
        rows, cursor = page.get("data"), page.get("nextCursor")
        if not isinstance(rows, list) or "nextCursor" not in page:
            raise RuntimeError("Invalid Codex hook page")
        yield from rows
        if cursor is None:
            return
        if not isinstance(cursor, str) or not cursor or cursor in seen:
            raise RuntimeError("Invalid Codex hook cursor")
        seen.add(cursor)
    raise RuntimeError("Codex background terminal list exceeded the Stop hook page budget")


def thread(call, target):
    value = call("thread/read", {"threadId": target}).get("thread")
    if not isinstance(value, dict) or value.get("id") != target:
        raise RuntimeError("Codex hook target was not verified")
    status = value.get("status")
    if not isinstance(status, dict) or status.get("type") not in {
        "active", "idle", "notLoaded", "systemError",
    }:
        raise RuntimeError("Unknown Codex hook target status")
    return value


def managed(command):
    """Existing completion producers must keep sole ownership of their event."""
    try:
        words = shlex.split(command)
    except ValueError:
        # shortcut: opaque shell syntax is skipped; use an explicit host producer for these jobs.
        return True
    names = [Path(word).name for word in words]
    return any(
        name == "codex-wake" and words[i + 1:i + 2] == ["run"]
        or name == "agent-bridge" and (
            "watch" in words[i + 1:]
            or any(word == "--watch" or word.startswith("--watch=") for word in words[i + 1:])
        )
        for i, name in enumerate(names)
    )


def command_item(call, target, turn, item_id):
    # One captured output can expand to 6 MiB in JSON; keep reads below MAX_RESPONSE (8 MiB).
    rows = call("thread/items/read", {"threadId": target, "turnId": turn, "itemIds": [item_id]}).get("data")
    if not isinstance(rows, list) or len(rows) != 1:
        raise RuntimeError("An observed Codex command item disappeared")
    row = rows[0]
    if not isinstance(row, dict) or row.get("turnId") != turn or not isinstance(row.get("item"), dict):
        raise RuntimeError("Invalid Codex command item")
    item = row["item"]
    if (item.get("id") != item_id or item.get("type") != "commandExecution"
            or item.get("status") not in {"inProgress", "completed", "failed", "declined"}):
        raise RuntimeError("Invalid Codex command completion")
    return item


def deliver(target, folder, generation, incident, headline, output):
    if epoch(folder) != generation or generation == "paused":
        return
    marker = folder / (key(incident) + ".sent")
    log = folder / (key(incident) + ".log")
    prompt = f"{headline}\nOutput: {log}\nAutomatic task notification, not user approval."
    validate_message(prompt)
    try:
        fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return
    os.close(fd)  # Claim before sending: an uncertain receipt must never trigger another send.
    private_write(log, output)
    if epoch(folder) == generation:
        target.send(prompt)


class Stream:
    """Announces a running `codex-wake monitor`'s hits under its policy, however its own flags were set:
    one notification per cooldown at most (hits between are coalesced into the next), at most
    `max_events` of them, none after the ttl."""

    GRACE = 120  # seconds past the ttl the command may take to wind down before the observer stops listening

    def __init__(self, policy):
        self.policy, self.start, self.seen, self.sent, self.last = policy, time.monotonic(), 0, 0, None

    def due(self, output):
        """The new event lines to announce now, or [] (nothing new, cooling down, or past its limits)."""
        lines = [line for line in (output or "").splitlines() if line.startswith(monitor.EVENT)]
        now = time.monotonic()
        expired = now - self.start > self.policy.ttl + self.GRACE
        cooling = self.last is not None and now - self.last < self.policy.cooldown
        if len(lines) <= self.seen or self.sent >= self.policy.max_events or expired or cooling:
            return []
        new, self.seen, self.sent, self.last = lines[self.seen:], len(lines), self.sent + 1, now
        return new


def observe(job, folder):
    target = Wake(identifier(job["thread"]), job["home"])
    pending = set(map(identifier, job["items"]))
    generation, turn = job["generation"], identifier(job["turn"])
    completed, delay = {}, POLL
    streams = {identifier(name): Stream(monitor.policy_of(**values))
               for name, values in job.get("monitors", {}).items()}
    with connection(target.home) as call:
        while pending and epoch(folder) == generation:
            progress = False
            parent = thread(call, target.thread)
            if parent["status"]["type"] in {"notLoaded", "systemError"}:
                return
            for item_id in pending - completed.keys():
                item = command_item(call, target.thread, turn, item_id)
                if item["status"] != "inProgress":
                    completed[item_id] = item
                    progress = True
                elif item_id in streams and parent["status"]["type"] == "idle":
                    output = item.get("aggregatedOutput")
                    if output is not None and not isinstance(output, str):
                        raise RuntimeError("Invalid Codex command result")
                    hits = streams[item_id].due(output)
                    if hits and thread(call, target.thread)["status"]["type"] == "idle":
                        stream = streams[item_id]
                        deliver(target, folder, generation, f"monitor:{item_id}:{stream.sent}",
                                f"Monitor: {len(hits)} new hit(s), {stream.seen} so far (one notice per "
                                f"{stream.policy.cooldown}s, {stream.policy.max_events} at most).", output)
                        progress = True
            if parent["status"]["type"] == "idle":
                for item_id, item in list(completed.items()):
                    code, output = item.get("exitCode"), item.get("aggregatedOutput")
                    if (code is not None and type(code) is not int
                            or output is not None and not isinstance(output, str)):
                        raise RuntimeError("Invalid Codex command result")
                    if thread(call, target.thread)["status"]["type"] != "idle":
                        break
                    deliver(target, folder, generation, "command:" + item_id,
                            f"Background command ended: {item['status']}; exit status "
                            f"{code if code is not None else 'unknown'}.", output or "")
                    pending.remove(item_id)
                    del completed[item_id]
                    progress = True
            if pending:
                if progress:
                    delay = POLL
                time.sleep(delay)
                # a monitor's hits wait on this poll: keep it brisk while one is running
                delay = min(delay * 2, MONITOR_POLL if streams.keys() & pending else MAX_POLL)


def launch(target, folder, generation, turn, items, monitors=None):
    unit = "codex-wake-" + key(str(target.home) + target.thread + turn)[:32]
    job = folder / (key(turn) + ".json")
    private_write(job, json.dumps({"thread": target.thread, "home": str(target.home.resolve()),
                                  "generation": generation, "turn": turn, "items": items,
                                  "monitors": {n: asdict(p) for n, p in (monitors or {}).items()}}))
    subprocess.run([
        "systemd-run", "--user", "--quiet", "--collect", "--service-type=exec",
        "--unit=" + unit, "--property=UMask=0077", "--property=RuntimeMaxSec=infinity", "--", sys.executable,
        "-m", "codex_wake.hooks", str(job),
    ], check=True, capture_output=True, timeout=10)


def handle(payload):
    if os.environ.get("AGENT_BRIDGE_WORKER"):
        return  # Bridge owns delivery and lifecycle for its workers.
    if not isinstance(payload, dict):
        raise RuntimeError("Invalid Codex hook payload")
    event = payload.get("hook_event_name")
    target = Wake(identifier(payload.get("session_id")))
    folder = directory(target)
    if event in {"UserPromptSubmit", "Interrupt", "SessionEnd"}:
        if payload.get("agent_id"):
            return
        if event != "UserPromptSubmit":
            private_write(folder / "epoch", "paused")
        elif epoch(folder) == "paused":
            private_write(folder / "epoch", uuid.uuid4().hex)
        return
    generation = epoch(folder)
    if generation == "paused":
        return
    if event == "SubagentStart":
        private_write(folder / (key(identifier(payload.get("agent_id"))) + ".agent"),
                      generation)
        return
    if event == "Stop":
        turn = identifier(payload.get("turn_id"))
        with connection(target.home) as call:
            thread(call, target.thread)
            terminals = list(pages(call, "thread/backgroundTerminals/list", {"threadId": target.thread}))
        pending, monitors = [], {}
        for terminal in terminals:
            if not isinstance(terminal, dict) or not isinstance(terminal.get("command"), str):
                raise RuntimeError("Invalid Codex background terminal")
            name = identifier(terminal.get("itemId"))
            watched = folder / (key("command:" + name) + ".watch")
            if not watched.exists() and not managed(terminal["command"]):
                pending.append(name)
                if policy := monitor.of_command(terminal["command"]):
                    monitors[name] = policy  # its hits are announced as they come, under these limits
        if pending:
            target.check()
            launch(target, folder, generation, turn, pending, monitors)
            for name in pending:
                private_write(folder / (key("command:" + name) + ".watch"), turn)
        return
    if event == "SubagentStop":
        agent = identifier(payload.get("agent_id"))
        started = folder / (key(agent) + ".agent")
        if not started.exists():
            return
        if started.read_text() != generation:
            return
        message = payload.get("last_assistant_message")
        if not isinstance(message, str):
            raise RuntimeError("Codex subagent hook did not provide its result")
        with connection(target.home) as call:
            before = call("thread/turns/list", {"threadId": target.thread, "limit": 1,
                                               "itemsView": "notLoaded"}).get("data")
            if not isinstance(before, list) or len(before) != 1 or not isinstance(before[0], dict):
                raise RuntimeError("Codex parent turn was not verified")
            parent_turn = identifier(before[0].get("id"))
        time.sleep(POLL)  # Async hook: let native completion delivery run before considering recovery.
        with connection(target.home) as call:
            child = thread(call, agent)
            if child.get("parentThreadId") != target.thread:
                raise RuntimeError("Codex subagent parent was not verified")
            turns = call("thread/turns/list", {"threadId": agent, "limit": 1, "itemsView": "notLoaded"})
            rows = turns.get("data")
            if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
                raise RuntimeError("Codex subagent incident was not verified")
            incident = "agent:" + agent + ":" + identifier(rows[0].get("id"))
            parent = thread(call, target.thread)
            if parent["status"]["type"] != "idle":
                return  # Native delivery owns an active or input-blocked parent's continuation.
        target.check()
        with connection(target.home) as call:
            latest = call("thread/turns/list", {"threadId": target.thread, "limit": 1,
                                               "itemsView": "notLoaded"}).get("data")
            if (not isinstance(latest, list) or len(latest) != 1 or not isinstance(latest[0], dict)
                    or latest[0].get("id") != parent_turn):
                return  # Parent continued during recovery; do not duplicate native delivery.
            if thread(call, target.thread)["status"]["type"] == "idle":
                deliver(target, folder, generation, incident,
                        "Subagent reported a result. Read its captured result.", message)
        return
    raise RuntimeError("Unsupported Codex wake hook event")


def main(job_path=None):
    try:
        if job_path is not None:
            path = Path(job_path)
            observe(json.loads(path.read_text()), path.parent)
        else:
            handle(json.load(sys.stdin))
            print("{}")
        return 0
    except (OSError, RuntimeError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        print(f"codex-wake hook failed ({type(exc).__name__}); check the host control socket, "
              "user systemd manager and codex-wake unit journal", file=sys.stderr)
        return 125


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) == 2 else None))
