"""Bridge's private workers use its public status/steer contracts, across root harnesses."""

import os
import subprocess
import time
import uuid
from dataclasses import asdict
from threading import Lock

import agent_session

from . import origin
from .capabilities import AdapterCapabilities
from .context import SessionContext
from .models import DeliveryRejected, Message, Snapshot, Target, decode_json, text


def identity(target):
    return target.settings.get("bridge_backend", target.adapter), target.session_id


def decode(value):
    if (type(value) is not dict or type(value.get("schema_version")) is not int
            or value["schema_version"] != 1):
        raise ValueError("Unsupported Bridge status")
    for key in ("jobs", "owners", "events"):
        if type(value.get(key)) is not list or len(value[key]) > 100000:
            raise ValueError("Invalid Bridge status rows")
    jobs, owners, events = {}, {}, {}
    for row in value["owners"]:
        if type(row) is not dict:
            raise ValueError("Invalid Bridge owner")
        name = text(row.get("id"), "Bridge owner", 200)
        if name in owners:
            raise ValueError("Duplicate Bridge owner")
        backend, session = row.get("root_backend"), row.get("root_session_id")
        owners[name] = origin.identity({"backend": backend, "session_id": session}) if (
            backend is not None and session is not None) else None
    for row in value["jobs"]:
        if type(row) is not dict:
            raise ValueError("Invalid Bridge worker")
        identifier = text(row.get("id"), "Bridge job", 400)
        owner = text(row.get("owner"), "Bridge owner", 200)
        name = text(row.get("name"), "Bridge worker name", 200)
        if (identifier != owner + "/" + name or any(p in (".", "..") or "/" in p for p in (owner, name))
                or identifier in jobs or row.get("backend") not in origin.BACKENDS
                or type(row.get("running")) is not bool or type(row.get("awaiting_root")) is not bool):
            raise ValueError("Ambiguous Bridge worker identity")
        text(row.get("state"), "Bridge worker state", 200)
        for key in ("title", "reason"):
            if type(row.get(key)) is not str:
                raise ValueError("Invalid Bridge worker label")
        jobs[identifier] = row
    seen = set()
    for row in value["events"]:
        if (type(row) is not dict or type(row.get("text")) is not str
                or type(row.get("kind")) is not str):
            raise ValueError("Invalid Bridge event")
        identifier = text(row.get("id"), "Bridge event id", 400)
        job = text(row.get("job"), "Bridge event job", 400)
        if identifier in seen or job not in jobs:
            raise ValueError("Ambiguous Bridge event")
        seen.add(identifier)
        events.setdefault(job, []).append(row)
    return jobs, owners, events


def status(row):
    if row["awaiting_root"] or row["state"] in ("waiting_for_root", "blocked_on_question"):
        return "input-needed"
    if row["running"]:
        return "active" if row["state"] not in ("waiting_for_heavy", "waiting_for_peer") else "waiting"
    return "idle" if row["state"] in ("completed", "idle", "exited") else row["state"]


class Bridge:
    capabilities = AdapterCapabilities(
        queued_messages=False, mid_turn_steering=True, approvals_survive_restart=False,
        history_while_unloaded=True, images=False, interrupt=False, commands=False, questions=False,
        reply_mode="direct",
    )

    def __init__(self):
        self.lock = Lock()
        self.checked = 0
        self.value = None

    def inventory(self, fresh=False):
        with self.lock:
            if fresh or self.value is None or time.monotonic() - self.checked >= 10:
                result = subprocess.run([origin.command(), "status", "--json", "--no-quotas"],
                                        capture_output=True, timeout=8)
                if result.returncode or len(result.stdout) > 16 * 1024 * 1024:
                    raise ConnectionError("Bridge status unavailable")
                self.value = decode(decode_json(result.stdout))
                self.checked = time.monotonic()
            return self.value

    def targets(self, live, bindings):
        if not bindings:
            return []
        jobs, owners, _ = self.inventory()
        identities = {}
        for target in live.values():
            identities.setdefault(identity(target), []).append(target)
        result = []
        for (backend, session), binding in bindings.items():
            job = jobs.get(binding["job"])
            if (job is None or job.get("retired_at") or job["backend"] != backend
                    or (backend, session) in identities):
                continue
            parent = owners.get(job["owner"])
            if parent is None or len(identities.get(parent, [])) != 1:
                continue  # Only workers of an exact connected root, never a guessed cwd/title match.
            settings = {"job": job["id"], "bridge_backend": backend,
                        "parent": {"backend": parent[0], "session_id": parent[1]}}
            identifier = uuid.uuid5(uuid.NAMESPACE_URL, "agent-inbox:bridge:" + job["id"] + ":" + session).hex
            label = (job["title"] or binding["title"] or job["name"])[:200]
            target = Target(identifier, "bridge", origin.BACKENDS[backend], session, label, settings)
            capabilities = asdict(self.capabilities)
            result.append((target, {**target.public(), "status": status(job),
                                   "saved": not job["running"] and not job["awaiting_root"],
                                   "capabilities": capabilities}))
        return result

    def selected(self, target, fresh=False):
        jobs, owners, events = self.inventory(fresh)
        job = jobs.get(target.settings["job"])
        expected = origin.identity(target.settings["parent"])
        if (job is None or job.get("retired_at") or job["backend"] != target.settings["bridge_backend"]
                or owners.get(job["owner"]) != expected):
            raise DeliveryRejected("Bridge worker or its root changed; reload the conversation list")
        return job, events.get(job["id"], [])

    def snapshot(self, target, cursor=None, since=None):
        if cursor is not None or since is not None:
            raise ValueError("Bridge reports do not expose transcript pagination")
        job, events = self.selected(target)
        messages = [Message(row["id"], "assistant", row["text"]) for row in events
                    if row["kind"] in ("message", "question") and row["text"].strip()]
        return Snapshot(status(job), True, messages)

    def send(self, target, message):
        if message.images:
            raise DeliveryRejected("Bridge steering accepts text only")
        text(message.text, "Bridge worker message")
        job, _ = self.selected(target, fresh=True)
        found = origin.read().get(identity(target))
        if found is None or found["job"] != job["id"]:
            raise DeliveryRejected("This native worker session changed")
        if os.environ.get("AGENT_BRIDGE_JOB"):
            raise DeliveryRejected("A worker cannot dispatch as an Inbox root")
        parent = target.settings["parent"]
        env = {key: value for key, value in os.environ.items() if key not in agent_session.VARIABLES}
        env.update(agent_session.environment(parent["backend"], parent["session_id"]))
        result = subprocess.run([origin.command(), "steer", job["id"], "--prompt-file", "-"],
                                input=message.text.encode(), capture_output=True, timeout=15, env=env)
        if result.returncode:
            raise RuntimeError("Bridge could not confirm steering; check the native worker")
        return "forwarded"  # Durable Bridge admission, not proof that the worker read the message.

    def context(self, target):
        job, _ = self.selected(target)
        return SessionContext(notices=[
            "Bridge worker reports are recent updates, not the full native transcript.",
            "Replies use Bridge's native steering workflow; admission does not confirm reading.",
            job["reason"],
        ])
