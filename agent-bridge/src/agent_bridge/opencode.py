"""OpenCode CLI backend, confined by bubblewrap because OpenCode has no filesystem sandbox."""

import base64
import hashlib
import http.client
import json
import os
import secrets
import select
import shutil
import signal
import stat
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote, urlsplit

from agent_models.inventory import ZDR_FREE, unreviewed_free
from agent_resources.heavy import prepare as heavy_directory

from .core import (
    MESSAGING_RULE,
    POLL,
    REDELIVERED,
    capped,
    confirm_steer,
    log,
    log_turn_started,
    route_to_peers,
    runner_finished,
    runner_started,
    save,
    steer_lock,
    worker_env,
)
from .peers import message_fields

DECLINED = "The user declined this tool call"  # OpenCode's auto-reject; it then aborts the turn
# The only free-tier models OpenCode documents as zero-retention and never trained on. Any other free model
# may log or train on prompts, so the bridge refuses it. Refresh this list from OpenCode's model docs.


def binary():
    return shutil.which("opencode") or str(Path.home() / ".opencode/bin/opencode")


def command(state, job, prompt, resume=False, server_only=False):
    if not shutil.which("bwrap"):
        raise RuntimeError("bwrap is required for opencode; refusing to run unconfined")
    model = state.get("model") or ""
    if unreviewed_free(model):
        raise RuntimeError(
            f"{model or 'no --model'}: the free tier is limited to zero-retention models; "
            f"pass one of {', '.join(ZDR_FREE)}"
        )
    if state.get("effort"):  # OpenCode spells effort as a model variant: provider/model#variant
        if not model or "#" in model:
            raise RuntimeError("--effort needs --model without a #variant")
        model += "#" + state["effort"]
    cmd = [sys.executable, str(Path(__file__).with_name("opencode_supervisor.py")), binary()]
    if server_only:
        cmd += ["--server-only"]
    else:
        cmd += ["--format", "json"]
        if model:
            cmd += ["-m", model]
        if state.get("sessionId"):
            cmd += ["--session", state["sessionId"]]
        cmd += ["--title", state["title"]]
    env = worker_env(job)
    for key in list(env):
        if key in {"OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR"} or key.startswith(
            ("OPENCODE_SERVER", "OPENCODE_PASSWORD")
        ):
            del env[key]
    # bwrap confines writes; OpenCode's own outside-cwd check would otherwise reject reads anywhere and
    # writes to writable roots (headless "ask" means reject)
    permission = {"external_directory": {"*": "allow"}}
    if state["sandbox"] == "read-only":
        permission.update(edit="deny", bash="deny", webfetch="deny", websearch="deny")
    env["OPENCODE_CONFIG_CONTENT"] = json.dumps({"permission": permission})

    writable = []
    if state["sandbox"] == "workspace-write":
        writable = list(state["writableRoots"])
    home = Path(job) / "home"
    data, state_dir, cache = (home / name for name in ("data", "state", "cache"))
    for path in (data / "opencode", state_dir / "opencode", cache / "opencode"):
        path.mkdir(parents=True, exist_ok=True)
    home.chmod(0o700)
    shared = Path.home()
    auth = shared / ".local/share/opencode/auth.json"
    private_auth = data / "opencode/auth.json"
    if auth.is_file():
        shutil.copyfile(auth, private_auth)
        private_auth.chmod(stat.S_IRUSR | stat.S_IWUSR)
    else:
        private_auth.unlink(missing_ok=True)
    models = shared / ".cache/opencode/models.json"
    if models.is_file():
        shutil.copyfile(models, cache / "opencode/models.json")
    else:
        (cache / "opencode/models.json").unlink(missing_ok=True)
    cache_mounts = []
    for name in ("bin", "node_modules", "packages", "package.json"):
        source = shared / ".cache/opencode" / name
        if source.exists():
            target = cache / "opencode" / name
            if source.is_dir():
                target.mkdir(exist_ok=True)
            else:
                target.touch(exist_ok=True)
            cache_mounts.append((source, target))
    args = [
        "bwrap",
        "--ro-bind",
        "/",
        "/",
        "--dev",
        "/dev",
        "--proc",
        "/proc",
        "--tmpfs",
        "/tmp",
        "--die-with-parent",
        "--ro-bind",  # the fresh /tmp would otherwise hide a read-only cwd under /tmp
        state["cwd"],
        state["cwd"],
    ]
    # later mounts cover earlier ones: the read-only job root first, so writable roots inside it stay writable
    args += ["--ro-bind", str(job), str(job), "--bind", str(home), str(home)]
    for path in dict.fromkeys(writable):
        args += ["--bind", path, path]
    if state["sandbox"] == "workspace-write":
        shared_heavy = str(heavy_directory())
        args += ["--bind", shared_heavy, shared_heavy]
    for source, target in cache_mounts:
        args += ["--ro-bind", str(source), str(target)]
    env.update(
        XDG_DATA_HOME=str(data),
        XDG_STATE_HOME=str(state_dir),
        XDG_CACHE_HOME=str(cache),
    )
    args += ["--chdir", state["cwd"], "--"]
    args += cmd
    return args, env


class NativeMessagePending(Exception):
    """An admitted prompt is not yet in the session history."""


def native_request(url, password, method, path, body=None):
    parsed = urlsplit(url)
    if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not parsed.port
            or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
        raise ValueError("invalid OpenCode worker server address")
    auth = base64.b64encode(("opencode:" + password).encode()).decode()
    connection = http.client.HTTPConnection("127.0.0.1", parsed.port, timeout=2)
    try:
        connection.request(method, path, json.dumps(body) if body is not None else None,
                           {"Authorization": "Basic " + auth, "Content-Type": "application/json"})
        response = connection.getresponse()
        if method == "GET" and response.status == 404:
            raise NativeMessagePending()
        if response.status != 200:
            raise RuntimeError(f"OpenCode worker request rejected (HTTP {response.status})")
        if response.getheader("Content-Type", "").split(";")[0] != "application/json":
            raise ValueError("invalid OpenCode worker response")
        raw = response.read(1048577)
        if len(raw) > 1048576:
            raise ValueError("OpenCode worker response too large")
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("invalid OpenCode worker response")
        return data.get("data")
    finally:
        connection.close()


def steer_live(job, state, url, password, *, resume=True, skip=()):
    """Admit one durable native steer without interrupting the active turn."""
    session = state.get("sessionId")
    if not isinstance(session, str) or not session.startswith("ses_") or not all(
        c.isascii() and (c.isalnum() or c in "_-") for c in session
    ):
        return
    pending = state.get("liveSteer")
    if pending is None:
        with steer_lock(job):
            excluded = (state.get("inflight") or {}).get("file")
            path = next((p for p in sorted((Path(job) / "steer").glob("[0-9]*.md"))
                         if p.stem.isdecimal() and p.name != excluded and p.name not in skip
                         and not p.with_suffix(".queue").exists()), None)
            if path is None:
                return
            identity = hashlib.sha256(f"{Path(job).resolve()}\0{session}\0{path.name}".encode()).hexdigest()
            pending = {"id": "msg_" + identity, "file": path.name, "session": session}
            state["liveSteer"] = pending
            save(Path(job) / "state.json", state)
    if not isinstance(pending, dict) or pending.get("session") != session:
        raise RuntimeError("OpenCode steer session changed; inspect delivery before continuing")
    filename = pending.get("file")
    if (not isinstance(filename, str) or not filename.endswith(".md")
            or not filename[:-3].isdecimal()):
        raise ValueError("invalid OpenCode steer identity")
    identity = hashlib.sha256(f"{Path(job).resolve()}\0{session}\0{filename}".encode()).hexdigest()
    if pending.get("id") != "msg_" + identity:
        raise ValueError("invalid OpenCode steer identity")
    path = Path(job) / "steer" / filename
    if path.is_symlink() or not path.is_file():
        raise ValueError("OpenCode steer file is unavailable")
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError("OpenCode steer is empty")
    data = native_request(url, password, "POST", "/api/session/" + quote(session, safe="") + "/prompt",
                          {"id": pending["id"], "text": text, "delivery": "steer", "resume": resume})
    if (not isinstance(data, dict) or data.get("id") != pending["id"]
            or data.get("sessionID") != session or data.get("type") != "user"
            or data.get("delivery") != "steer" or not isinstance(data.get("payload"), dict)
            or data["payload"].get("text") != text):
        raise ValueError("invalid OpenCode steer receipt")
    try:
        delivered = native_request(url, password, "GET", "/api/session/" + quote(session, safe="")
                                   + "/message/" + quote(pending["id"], safe=""))
    except NativeMessagePending:
        return False
    if (not isinstance(delivered, dict) or delivered.get("id") != pending["id"]
            or delivered.get("type") != "user" or delivered.get("text") != text):
        raise ValueError("invalid OpenCode delivered message")
    sent = path.parent / "sent"
    sent.mkdir(exist_ok=True)
    os.replace(path, sent / path.name)
    log(job, "steer_sent", file=path.name, **message_fields(text))
    state.pop("liveSteer", None)
    save(Path(job) / "state.json", state)
    return True


def read_effective_variant(state, url, password, message):
    session, identifier = state.get("sessionId"), message.get("messageID")
    if not all(isinstance(value, str) and value and all(
        c.isascii() and (c.isalnum() or c in "_-") for c in value
    ) for value in (session, identifier)):
        return None
    if not session.startswith("ses_") or not identifier.startswith("msg_"):
        return None
    try:
        data = native_request(url, password, "GET", "/api/session/" + quote(session, safe="")
                              + "/message/" + quote(identifier, safe=""))
    except NativeMessagePending:
        return None
    if (not isinstance(data, dict) or data.get("id") != identifier
            or data.get("sessionID") != session or data.get("type") != "assistant"):
        return None
    model = data.get("model")
    if not isinstance(model, dict):
        return None
    provider, identifier = model.get("providerID"), model.get("id")
    variant = model.get("variant")
    if not all(isinstance(value, str) and value and value == value.strip() and value.isprintable()
               for value in (provider, identifier)):
        return None
    state["resolvedModel"] = provider + "/" + identifier
    return (variant if isinstance(variant, str) and variant and variant == variant.strip()
            and variant.isprintable() else None)


def record_live_steer(job, filename, text):
    log_path = Path(job) / "live.jsonl"
    if log_path.exists():
        with log_path.open(encoding="utf-8") as stream:
            for line in stream:
                try:
                    event = json.loads(line)
                    if event.get("kind") == "steer_sent" and event.get("file") == filename:
                        return
                except (ValueError, AttributeError):
                    continue
    log(job, "steer_sent", file=filename, **message_fields(text))


def recover_live_steer(job, state):
    pending = state["liveSteer"]
    session, filename = state.get("sessionId"), pending.get("file") if isinstance(pending, dict) else None
    if (not isinstance(session, str) or not isinstance(filename, str) or not filename.endswith(".md")
            or not filename[:-3].isdecimal() or pending.get("session") != session):
        raise ValueError("invalid OpenCode steer recovery state")
    identity = hashlib.sha256(f"{Path(job).resolve()}\0{session}\0{filename}".encode()).hexdigest()
    if pending.get("id") != "msg_" + identity:
        raise ValueError("invalid OpenCode steer recovery identity")
    original = Path(job) / "steer" / filename
    sent = original.parent / "sent" / filename
    if not original.exists() and sent.is_file() and not sent.is_symlink():
        record_live_steer(job, filename, sent.read_text(encoding="utf-8").strip())
        state.pop("liveSteer", None)
        save(Path(job) / "state.json", state)
        return
    cmd, env = command(state, job, "", resume=True, server_only=True)
    password = secrets.token_urlsafe(32)
    env["OPENCODE_PASSWORD"] = password
    with (Path(job) / "opencode.stderr.log").open("ab") as stderr:
        proc = subprocess.Popen(capped(cmd, state), cwd=state["cwd"], env=env, stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=stderr, start_new_session=True)
        try:
            ready, _, _ = select.select([proc.stdout], [], [], 20)
            if not ready:
                raise TimeoutError("OpenCode recovery server did not become ready")
            line = proc.stdout.readline(65537)
            if len(line) > 65536:
                raise ValueError("OpenCode recovery response too large")
            info = json.loads(line)
            if (not isinstance(info, dict) or set(info) != {"bridge_server"}
                    or not isinstance(info["bridge_server"], str)):
                raise ValueError("invalid OpenCode recovery server announcement")
            steer_live(job, state, info["bridge_server"], password, resume=False)
        finally:
            try:
                proc.stdin.close()
            except BrokenPipeError:
                pass
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                proc.wait(timeout=5)


def process(event, state, job, turn=None):
    turn = turn if turn is not None else {"denied": [], "errors": [], "finished": False, "session": False}
    kind = event.get("type")
    part = event.get("part") or {}
    sid = event.get("sessionID")
    if sid and sid != state.get("sessionId"):
        state["sessionId"] = sid
        save(Path(job) / "state.json", state)
        log(job, "thread_started", sessionId=sid, model=state.get("model"))
    if sid:
        turn["session"] = True
    if kind == "step_start" and sid and not turn.get("accepted"):
        turn["accepted"] = True
        log(job, "prompt_accepted")
    elif kind == "text":
        text = (part.get("text") or "").strip()
        if text:
            turn["finished"] = True  # some provider routes emit no step events, only the reply
            urgent = text.lstrip().upper().startswith("URGENT:")
            routed = text.lstrip()[7:].lstrip() if urgent else text
            log(job, "message", level="urgent" if urgent else "info", text=routed)
            route_to_peers(job, routed)
    elif kind == "tool_use":
        tool = part.get("tool") or "tool"
        data = part.get("state") or {}
        inp = data.get("input") or {}
        log(job, "command_start", tool=tool, command=inp.get("command") or inp or data.get("title"))
        log(
            job,
            "command_end",
            tool=tool,
            status=data.get("status"),
            output=data.get("output")[:2000] if isinstance(data.get("output"), str) else data.get("output"),
            error=data.get("error"),
        )
        if data.get("status") == "error" and data.get("error") == DECLINED:
            turn["denied"].append(inp.get("command") or inp or tool)
    elif kind == "error":
        error = event.get("error") or {}
        if error.get("type") == "aborted" and turn["denied"]:
            return
        turn["errors"].append(error)
        message = error.get("message") or json.dumps(error)
        if error.get("type") == "provider.no-route":
            message += (
                ". The worker found no route to this provider. If its key comes from an environment "
                "variable (see `opencode auth list`), Bridge drops secret-like names from workers: "
                "opt that name in with AGENT_BRIDGE_PASS_ENV, or pick a model that needs no such key."
            )
        log(job, "error", message=message)
    elif kind == "step_finish":  # one per model step; the turn ends when the process exits
        turn["finished"] = True
        log(
            job,
            "step_finished",
            reason=part.get("reason"),
            usage=part.get("tokens"),
            cost=part.get("cost"),
        )


def compact_session(job, state, path):
    session = state.get("sessionId")
    if not isinstance(session, str) or not session.startswith("ses_") or not all(
        c.isascii() and (c.isalnum() or c in "_-") for c in session
    ):
        raise RuntimeError("OpenCode session ID is missing or invalid")
    if state.get("liveSteer") or state.get("inflight"):
        raise RuntimeError("OpenCode delivery is uncertain; inspect the session before compacting")
    cmd, env = command(state, job, "", resume=True, server_only=True)
    password = secrets.token_urlsafe(32)
    env["OPENCODE_PASSWORD"] = password
    runner_started(state, path)
    try:
        with (Path(job) / "opencode.stderr.log").open("ab") as stderr:
            proc = subprocess.Popen(capped(cmd, state), cwd=state["cwd"], env=env, stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE, stderr=stderr, start_new_session=True)
            try:
                ready, _, _ = select.select([proc.stdout], [], [], 20)
                if not ready:
                    raise TimeoutError("OpenCode compaction server did not become ready")
                line = proc.stdout.readline(65537)
                if len(line) > 65536:
                    raise ValueError("OpenCode server response too large")
                info = json.loads(line)
                if not isinstance(info, dict) or set(info) != {"bridge_server"}:
                    raise ValueError("invalid OpenCode server announcement")
                compact_over_api(job, session, info["bridge_server"], password)
            finally:
                try:
                    proc.stdin.close()
                except BrokenPipeError:
                    pass
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    proc.wait(timeout=5)
    finally:
        runner_finished(state, path)


def compact_over_api(job, session, url, password):
    parsed = urlsplit(url)
    if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not parsed.port
            or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
        raise ValueError("invalid OpenCode worker server address")
    auth = base64.b64encode(("opencode:" + password).encode()).decode()
    connection = http.client.HTTPConnection("127.0.0.1", parsed.port, timeout=300)
    try:
        connection.request("GET", "/api/event", headers={"Authorization": "Basic " + auth})
        stream = connection.getresponse()
        if stream.status != 200 or stream.getheader("Content-Type", "").split(";")[0] != "text/event-stream":
            raise RuntimeError("OpenCode event subscription failed")
        compact_path = "/api/session/" + quote(session, safe="") + "/compact"
        data = native_request(url, password, "POST", compact_path, {})
        if not isinstance(data, dict) or data.get("sessionID") != session or data.get("type") != "compaction":
            raise ValueError("invalid OpenCode compaction receipt")
        log(job, "compact_started")
        while True:
            line = stream.readline(1048577)
            if not line or len(line) > 1048576:
                raise RuntimeError("OpenCode compaction event stream ended")
            if not line.startswith(b"data:"):
                continue
            event = json.loads(line[5:].strip())
            if not isinstance(event, dict) or not isinstance(event.get("data"), dict):
                continue
            if event["data"].get("sessionID") != session:
                continue
            if event.get("type") == "session.compaction.ended":
                log(job, "compacted")
                print("compacted")
                return
            if event.get("type") == "session.compaction.failed":
                error = event["data"].get("error") or {}
                raise RuntimeError(f"OpenCode compaction failed: {error.get('message', 'unknown error')}")
    finally:
        connection.close()


def run(job, state, path, prompt, resume=False, compact=False):
    if compact:
        return compact_session(job, state, path)
    if state.get("liveSteer"):
        recover_live_steer(job, state)
        if not prompt:
            prompt = "Continue."
    if not prompt and not list((Path(job) / "steer").glob("[0-9]*.md")):
        return
    runner_started(state, path)
    reason, turn = "normal", 0
    try:
        followup = f"{MESSAGING_RULE}\n\n---\n\n{prompt}" if prompt and not resume else prompt
        inflight = state.get("inflight")
        if inflight:
            steer = Path(job) / "steer" / inflight["file"]
            if not steer.exists() and (steer.parent / "sent" / steer.name).exists():
                confirm_steer(job, state)
                inflight = None
        pending = (
            f"{REDELIVERED}\n{(Path(job) / 'steer' / inflight['file']).read_text(encoding='utf-8').strip()}"
            if inflight
            else followup
        )
        if not inflight:
            followup = ""
        if inflight:
            log(job, "steer_redelivered", file=inflight["file"])
        pending_steer = inflight
        while pending or list((Path(job) / "steer").glob("[0-9]*.md")):
            if not pending:
                steer = next(iter(sorted((Path(job) / "steer").glob("[0-9]*.md"))))
                pending = steer.read_text(encoding="utf-8").strip()
                state["inflight"] = {"id": f"steer-{steer.stem}", "file": steer.name}
                save(path, state)
                pending_steer = state["inflight"]
            continuing = turn > 0 or resume
            if continuing and not state.get("sessionId"):
                raise RuntimeError("OpenCode session ID is missing; refusing to start a new session")
            cmd, env = command(state, job, pending, resume=continuing)
            password = secrets.token_urlsafe(32)
            env["OPENCODE_PASSWORD"] = password
            with steer_lock(job):
                initial_queue = {p.name for p in (Path(job) / "steer").glob("[0-9]*.md")}
            stderr_path = Path(job) / "opencode.stderr.log"
            stderr_file = stderr_path.open("ab")
            proc = None
            try:
                proc = subprocess.Popen(
                    capped(cmd, state),
                    cwd=state["cwd"],
                    env=env,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=stderr_file,
                    bufsize=0,
                    start_new_session=True,
                )
                proc.stdin.write(pending.encode())
                proc.stdin.close()
                state["activeTurnId"] = f"turn-{turn + 1}"
                state["effectiveEffort"] = None
                state["resolvedModel"] = None
                log_turn_started(job, state, state["activeTurnId"])
                save(path, state)
                buf, interrupted, server_url, retry_at, warned = b"", False, None, 0.0, False
                variant_messages = set()
                turn_data = {"denied": [], "errors": [], "finished": False, "session": False}
                while True:
                    ready, _, _ = select.select([proc.stdout], [], [], POLL)
                    if ready:
                        data = os.read(proc.stdout.fileno(), 1 << 20)
                        if not data:
                            break
                        buf += data
                        batch, native_events = [], []
                        while b"\n" in buf:
                            line, buf = buf.split(b"\n", 1)
                            try:
                                event = json.loads(line)
                            except json.JSONDecodeError:
                                event = None
                            if isinstance(event, dict) and set(event) == {"bridge_server"}:
                                if server_url is not None or not isinstance(event["bridge_server"], str):
                                    raise RuntimeError("invalid OpenCode worker server announcement")
                                server_url = event["bridge_server"]
                                continue
                            batch.append(line + b"\n")
                            if event is not None:
                                native_events.append(event)
                        if batch:
                            with (Path(job) / "stream.ndjson").open("ab") as stream:
                                stream.write(b"".join(batch))
                        for event in native_events:
                            process(event, state, job, turn_data)
                            part = event.get("part")
                            message_id = part.get("messageID") if isinstance(part, dict) else None
                            if (server_url
                                    and (not state.get("effectiveEffort") or not state.get("resolvedModel"))
                                    and isinstance(message_id, str) and message_id not in variant_messages):
                                variant_messages.add(message_id)
                                try:
                                    variant = read_effective_variant(state, server_url, password, part)
                                    if variant:
                                        state["effectiveEffort"] = variant
                                        log(job, "effort_observed", turnId=state.get("activeTurnId"),
                                            effort=variant, source="opencode_message")
                                    save(path, state)
                                except (OSError, ValueError, KeyError, TypeError, RuntimeError):
                                    pass
                    if server_url and state.get("sessionId") and time.monotonic() >= retry_at:
                        try:
                            delivered = steer_live(job, state, server_url, password, skip=initial_queue)
                            if delivered is False:
                                retry_at = time.monotonic() + 1
                            warned = False
                        except (OSError, ValueError, KeyError, TypeError, RuntimeError):
                            retry_at = time.monotonic() + 2
                            if not warned:
                                log(job, "steer_queued", level="urgent", message=(
                                    "OpenCode steer delivery not confirmed; retrying while the turn runs"))
                                warned = True
                    if (Path(job) / "interrupt").exists():
                        (Path(job) / "interrupt").unlink()
                        try:
                            os.killpg(proc.pid, signal.SIGINT)
                        except ProcessLookupError:
                            pass
                        interrupted = True
                        log(job, "interrupt_sent")
                    if (Path(job) / "stop").exists():
                        (Path(job) / "stop").unlink()
                        log(job, "stopped")
                        reason = "stopped"
                        return
                code = proc.wait()
                if buf.strip():
                    with (Path(job) / "stream.ndjson").open("ab") as stream:
                        stream.write(buf)
                    try:
                        process(json.loads(buf), state, job, turn_data)
                    except json.JSONDecodeError:
                        pass
            finally:
                if proc is not None and proc.poll() is None:
                    try:
                        os.killpg(proc.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    try:
                        proc.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        try:
                            os.killpg(proc.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        try:
                            proc.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            log(job, "error", message="opencode process group did not exit after SIGKILL")
                stderr_file.close()
            denied = turn_data["denied"]
            if continuing and not turn_data["session"]:
                raise RuntimeError("OpenCode turn had no session ID; refusing to start a new session")
            if code and not interrupted and (not denied or turn_data["errors"]):
                tail = stderr_path.read_text(encoding="utf-8", errors="replace").strip()[-300:]
                raise RuntimeError(f"opencode exited with code {code}: {tail}")
            # exit 0 with no reply and no finished step (e.g. headless OpenCode cancelled a question form):
            # report it, but end normally so the session can be resumed (and lingering can answer).
            incomplete = not interrupted and not denied and not turn_data["finished"]
            if incomplete:
                log(job, "error", message="OpenCode turn ended without a reply")
            log(
                job,
                "turn_completed",
                status="interrupted"
                if interrupted
                else "denied"
                if denied
                else "incomplete"
                if incomplete
                else "completed",
            )
            if pending_steer:
                queue_marker = Path(job) / "steer" / Path(pending_steer["file"]).with_suffix(".queue")
                confirm_steer(job, state)
                queue_marker.unlink(missing_ok=True)
                pending_steer = None
            if state.get("liveSteer"):
                reason = "error"
                log(job, "error", level="urgent", message=(
                    "OpenCode steer delivery is uncertain; inspect history"))
                return
            turn += 1
            state["activeTurnId"] = None
            pending = ""
            if followup and not pending:
                pending, followup = followup, ""
            if denied:
                log(job, "permission_denied", level="urgent", denied=denied)
                continues = state.get("autoContinues", 0)
                if continues < 3:
                    state["autoContinues"] = continues + 1
                    pending = (
                        "The runner auto-denied these actions (outside this job's permissions): "
                        + json.dumps(denied)
                        + ". Continue without them. If one is essential, finish everything else, "
                        "then send a message starting with 'URGENT:' that names the exact command "
                        "or path you need."
                    )
            else:
                state["autoContinues"] = 0
            save(path, state)
            queued = None if pending else next(iter(sorted((Path(job) / "steer").glob("[0-9]*.md"))), None)
            if queued:
                pending = queued.read_text(encoding="utf-8").strip()
                state["inflight"] = {"id": f"steer-{queued.stem}", "file": queued.name}
                save(path, state)
                pending_steer = state["inflight"]
            resume = True
    except Exception as exc:
        reason = "error"
        log(job, "error", message=str(exc))
        raise
    finally:
        state["activeTurnId"] = None
        log(job, "runner_exit", reason=reason, turnsDone=turn)
        runner_finished(state, path)
