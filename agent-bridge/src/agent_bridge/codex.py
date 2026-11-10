"""Codex app-server transport."""

import json
import os
import select
import shutil
import signal
import subprocess
import time
import uuid
from collections import deque
from pathlib import Path

from . import quota_pressure
from .core import (
    MESSAGING_RULE,
    POLL,
    capped,
    command_env,
    confirm_steer,
    link,
    log,
    log_turn_started,
    poll_steers,
    route_to_peers,
    runner_finished,
    runner_started,
    save,
    worker_env,
)

QUESTION_TIMEOUT = 120
QUOTA_READ = 120  # seconds between account limit reads while a turn runs
SHARED = ("AGENTS.md", "skills", "plugins", "rules", "hooks.json", "model-catalogs")


def real_home():
    return Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")


def home_dir(job):
    return Path(job) / "home" / "codex"


def build_home(job):
    """Private CODEX_HOME: sessions, sqlite and logs live and die with the job; instructions stay shared."""
    real, home = real_home(), home_dir(job)
    home.mkdir(parents=True, exist_ok=True)
    sync_auth(job)  # a runner killed before its finally still hands its refreshed login back
    for path in (home.parent, home):
        path.chmod(0o700)
    for name in (*SHARED, "auth.json"):  # the login is shared too, so a refresh reaches both
        link(real / name, home / name)
    if (real / "config.toml").is_file():  # a fresh copy per turn: codex writes trust decisions into it
        shutil.copy2(real / "config.toml", home / "config.toml")
    return home


def sync_auth(job):
    """If codex replaced the auth.json symlink while refreshing, hand a same-account login back."""
    mine, theirs = home_dir(job) / "auth.json", real_home() / "auth.json"
    if mine.is_symlink() or not mine.is_file():
        return
    try:
        new, old = json.loads(mine.read_text()), json.loads(theirs.read_text())
        same = new["tokens"]["account_id"] == old["tokens"]["account_id"]
        if same and new["last_refresh"] > old["last_refresh"]:
            tmp = theirs.with_name(f".{theirs.name}.{os.getpid()}.tmp")
            tmp.write_text(mine.read_text())
            tmp.chmod(0o600)
            os.replace(tmp, theirs)  # atomic: a crash never leaves a half-written login
            mine.unlink()
            mine.symlink_to(theirs)
            return
    except (OSError, KeyError, ValueError):
        pass
    log(
        job,
        "auth_detached",
        level="urgent",
        message="codex replaced auth.json; the shared login may be stale",
    )


class Rpc:
    def __init__(self, cwd, stderr, state=None):
        self.err = Path(stderr).open("a", encoding="utf-8")
        try:
            self.p = subprocess.Popen(
                capped(["codex", "app-server", "--stdio"], state),
                cwd=cwd,
                # every command the agent runs inherits it
                env=worker_env(Path(stderr).parent, CODEX_HOME=str(build_home(Path(stderr).parent))),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=self.err,
                bufsize=0,
                start_new_session=True,
            )
        except Exception:
            self.err.close()
            raise
        self.buf = b""
        self.events = deque()
        self.seq = 0

    def send(self, m):
        self.p.stdin.write((json.dumps(m, separators=(",", ":")) + "\n").encode())
        self.p.stdin.flush()

    def read(self, timeout=None):
        deadline = None if timeout is None else time.monotonic() + timeout
        while b"\n" not in self.buf:
            remaining = None if deadline is None else max(0, deadline - time.monotonic())
            r, _, _ = select.select([self.p.stdout], [], [], remaining)
            if not r:
                return None
            data = os.read(self.p.stdout.fileno(), 1 << 20)
            if not data:
                return {"eof": True}
            self.buf += data
            if deadline is not None and time.monotonic() >= deadline and b"\n" not in self.buf:
                return None
        line, self.buf = self.buf.split(b"\n", 1)
        return json.loads(line)

    def call(self, method, params=None):
        self.seq += 1
        rid = f"live-{self.seq}"
        self.send({"id": rid, "method": method, "params": params or {}})
        end = time.monotonic() + 300
        while True:
            remaining = end - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"timed out: {method}")
            m = self.read(remaining)
            if m is None:
                raise TimeoutError(f"timed out: {method}")
            if m.get("eof"):
                raise RuntimeError(f"Codex app-server disconnected: {method}")
            if m.get("id") == rid and "method" not in m:
                if "error" in m:
                    raise RuntimeError(f"{method}: {m['error']}")
                return m.get("result") or {}
            self.events.append(m)

    def close(self):
        self.p.stdin.close()
        if self.p.poll() is None:
            try:
                os.killpg(self.p.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        try:
            self.p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(self.p.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                self.p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass
        self.err.close()


def active_account():
    try:
        out = subprocess.run(["codex-auth", "list", "--skip-api"], env=command_env(),
                             capture_output=True, text=True, timeout=20).stdout
    except (OSError, subprocess.TimeoutExpired):
        return ""
    row = next((line.split() for line in out.splitlines() if line.lstrip().startswith("*")), [])
    return row[1] if len(row) > 1 else ""


def read_quota(rpc, job, state):
    """The account's current limits, as this worker's app-server sees them; advisory, never fatal."""
    try:
        result = rpc.call("account/rateLimits/read")
    except (RuntimeError, TimeoutError):
        return
    snapshots = list((result.get("rateLimitsByLimitId") or {}).values()) or [result.get("rateLimits")]
    model = state.get("resolvedModel") or state.get("model")
    quota_pressure.feed(job, state, quota_pressure.codex(snapshots, model, time.time()))


def reported_setting(response, key):
    value = response.get(key)
    return (value if isinstance(value, str) and value and value == value.strip() and value.isprintable()
            else None)


def record_settings(state, response):
    state["resolvedModel"] = reported_setting(response, "model")
    state["effectiveEffort"] = reported_setting(response, "reasoningEffort")


def run(job, state, path, prompt, resume=False, compact=False):
    rpc = Rpc(state["cwd"], Path(job) / "codex.stderr.log", state)
    thread = state.get("threadId", "")
    turn = state.get("activeTurnId")
    usage = {}
    quota_read = time.monotonic()
    awaiting = False
    pending = {}
    known = None
    runner_started(state, path)

    def persist():
        state.update(threadId=thread, activeTurnId=turn)
        save(path, state)

    def send(text, cid=None):
        nonlocal turn
        base = {
            "threadId": thread,
            "input": [{"type": "text", "text": text}],
            "clientUserMessageId": cid or f"prompt-{uuid.uuid4().hex}",
        }
        if turn:
            turn = rpc.call("turn/steer", {**base, "expectedTurnId": turn}).get("turnId", turn)
        else:
            policy = {"type": "readOnly", "networkAccess": False}
            if state["sandbox"] == "workspace-write":
                policy = {
                    "type": "workspaceWrite",
                    "writableRoots": state["writableRoots"],
                    "networkAccess": True,
                }
            args = {**base, "sandboxPolicy": policy}
            for k in ("model", "effort"):
                if state.get(k):
                    args[k] = state[k]
            turn = rpc.call("turn/start", args).get("turn", {}).get("id")
            if state.get("model") or state.get("effort"):
                record_settings(state, {})
                try:
                    current = rpc.call("thread/read", {"threadId": thread}).get("thread") or {}
                    record_settings(state, current)
                except (RuntimeError, TimeoutError):
                    pass  # Configuration observation must not undo an accepted turn.
            log_turn_started(job, state, turn)
            if turn:
                log(job, "prompt_accepted", turnId=turn)
        persist()

    try:
        rpc.call(
            "initialize",
            {
                "clientInfo": {"name": "agent-bridge", "version": "1"},
                "capabilities": {"experimentalApi": True},
            },
        )
        rpc.send({"method": "initialized", "params": {}})
        if resume:
            resumed = rpc.call("thread/resume", {"threadId": thread})
            thread = resumed.get("thread", {}).get("id", thread)
            record_settings(state, resumed)
            turns = rpc.call(
                "thread/turns/list",
                {"threadId": thread, "limit": 10, "sortDirection": "desc", "itemsView": "full"},
            ).get("data", [])
            known = set()
            turn = None
            for history_turn in turns:
                if history_turn.get("status") == "inProgress":
                    turn = history_turn.get("id")
                    state["lastTurnId"] = turn
                known.update(
                    item["clientId"] for item in history_turn.get("items", []) if item.get("clientId")
                )
            inflight = state.get("inflight")
            if inflight:
                if inflight["id"] not in known:
                    raise RuntimeError("steer delivery is uncertain; inspect history before retrying")
                confirm_steer(job, state)
            persist()
        else:
            p = {"cwd": state["cwd"], "sandbox": state["sandbox"], "developerInstructions": MESSAGING_RULE}
            if state.get("model"):
                p["model"] = state["model"]
            if state.get("config"):
                p["config"] = state["config"]
            started = rpc.call("thread/start", p)
            thread = started["thread"]["id"]
            record_settings(state, started)
            persist()
        if compact:
            awaiting = True
            rpc.call("thread/compact/start", {"threadId": thread})
            log(job, "compact_started")
        if prompt:
            send(prompt)
        while True:
            m = rpc.events.popleft() if rpc.events else rpc.read(POLL)
            if m and m.get("eof"):
                raise RuntimeError("app-server closed stdout")
            if m:
                method, p = m.get("method"), m.get("params") or {}
                item = p.get("item") or {}
                if method == "thread/tokenUsage/updated":
                    usage[p.get("turnId")] = p.get("tokenUsage", {})
                    context = ((p.get("tokenUsage") or {}).get("last") or {}).get("inputTokens")
                    if type(context) is int and context >= 0:  # one request's prompt is the thread's context
                        state["contextTokens"] = context
                elif method == "account/rateLimits/updated":
                    quota_pressure.feed(job, state, quota_pressure.codex(
                        [p.get("rateLimits")], state.get("resolvedModel") or state.get("model"), time.time()))
                elif method == "thread/settings/updated" and p.get("threadId") == thread:
                    settings = p.get("threadSettings") or {}
                    record_settings(state, {"model": settings.get("model"),
                                            "reasoningEffort": settings.get("effort")})
                    persist()
                elif method == "turn/started":
                    turn = (p.get("turn") or {}).get("id")
                    if turn:
                        state["lastTurnId"] = turn
                    persist()
                elif method == "item/started" and item.get("type") == "commandExecution":
                    log(job, "command_start", turnId=p.get("turnId"), itemId=item.get("id"),
                        command=item.get("command"))
                elif method == "item/completed" and item.get("type") == "agentMessage":
                    text = item.get("text", "")
                    urgent = text.lstrip().upper().startswith("URGENT:")
                    routed = text.lstrip()[7:].lstrip() if urgent else text
                    log(
                        job,
                        "message",
                        level="urgent" if urgent else "info",
                        turnId=p.get("turnId"),
                        text=routed,
                    )
                    route_to_peers(job, routed)
                elif method == "item/completed" and item.get("type") == "commandExecution":
                    log(
                        job,
                        "command_end",
                        itemId=item.get("id"),
                        turnId=p.get("turnId"),
                        status=item.get("status"),
                        exitCode=item.get("exitCode"),
                    )
                elif method == "item/completed" and item.get("type") == "contextCompaction":
                    log(job, "compacted", turnId=p.get("turnId"))
                    state.pop("contextTokens", None)  # unknown until the next request reports it
                elif method == "serverRequest/resolved":
                    pending.pop(str(p.get("requestId", "")), None)
                elif method == "turn/completed":
                    t = p.get("turn") or {}
                    log(
                        job,
                        "turn_completed",
                        turnId=t.get("id"),
                        status=t.get("status"),
                        error=t.get("error"),
                        usage=usage.get(t.get("id")),
                    )
                    awaiting = False
                    read_quota(rpc, job, state)
                    if turn == t.get("id"):
                        turn = None
                        persist()
                elif method == "item/tool/requestUserInput" and "id" in m:
                    pending[str(m["id"])] = (m["id"], p, time.monotonic() + QUESTION_TIMEOUT)
                    from .peers import message_fields

                    question_text = json.dumps(
                        p.get("questions", []), ensure_ascii=False, separators=(",", ":")
                    )
                    log(
                        job,
                        "question",
                        requestId=str(m["id"]),
                        turnId=p.get("turnId"),
                        questions=p.get("questions", []),
                        **message_fields(question_text),
                    )
                elif method and "id" in m:
                    if method == "item/permissions/requestApproval":
                        rpc.send({"id": m["id"], "result": {"permissions": {}}})
                    elif "requestApproval" in method:
                        log(
                            job,
                            "approval_declined",
                            requestId=str(m["id"]),
                            turnId=p.get("turnId"),
                            command=p.get("command"),
                        )
                        rpc.send({"id": m["id"], "result": {"decision": "decline"}})
                    else:
                        rpc.send({"id": m["id"], "error": {"code": -32601, "message": "unsupported request"}})
            for key, (request_id, params, deadline) in list(pending.items()):
                answer_file = Path(job) / "inbox" / f"{key}.md"
                body = answer_file.read_text(encoding="utf-8").strip() if answer_file.is_file() else ""
                questions = params.get("questions", [])
                answers = {}
                if body and len(questions) == 1:
                    answers[str(questions[0]["id"])] = {"answers": [body]}
                elif body:
                    for line in body.splitlines():
                        qid, sep, answer = line.partition(":")
                        if sep and answer.strip():
                            answers[qid.strip()] = {"answers": [answer.strip()]}
                expired = time.monotonic() >= deadline
                if expired:
                    for question in questions:
                        answers.setdefault(
                            str(question["id"]),
                            {
                                "answers": [
                                    "No human reply arrived before the timeout; proceed using "
                                    "your best judgment."
                                ]
                            },
                        )
                if len(answers) == len(questions):
                    rpc.send({"id": request_id, "result": {"answers": answers}})
                    pending.pop(key)
                    answer_file.unlink(missing_ok=True)
                    if body:
                        log(job, "question_answered", requestId=key)
                    if expired and not body:
                        log(job, "question_timeout", requestId=key)
            if (Path(job) / "stop").exists() or (Path(job) / "interrupt").exists():
                marker = "stop" if (Path(job) / "stop").exists() else "interrupt"
                (Path(job) / marker).unlink(missing_ok=True)
                if turn:
                    rpc.call("turn/interrupt", {"threadId": thread, "turnId": turn})
                if marker == "stop":
                    log(job, "stopped")
                    return
            if turn and time.monotonic() - quota_read >= QUOTA_READ:
                quota_read = time.monotonic()
                read_quota(rpc, job, state)
            if not compact:
                poll_steers(job, send, known, state)
                known = None
            if (
                not turn
                and not awaiting
                and not pending
                and (compact or not list((Path(job) / "steer").glob("[0-9]*.md")))
            ):
                return
    except Exception as exc:
        log(job, "error", message=str(exc))
        raise
    finally:
        rpc.close()
        sync_auth(job)
        runner_finished(state, path)
