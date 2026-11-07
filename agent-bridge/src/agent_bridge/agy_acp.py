"""AGY's ACP worker transport, including native concurrent-prompt steering."""

import subprocess
import time
from collections import deque
from pathlib import Path

from . import agy
from .codex import Rpc as CodexRpc
from .core import (
    MESSAGING_RULE,
    POLL,
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


class Rpc(CodexRpc):
    def __init__(self, job, state):
        self.err = (Path(job) / "agy.stderr.log").open("a", encoding="utf-8")
        command = ["agy", "acp", "--sandbox", "--disable-telemetry"]
        if state["sandbox"] == "workspace-write":
            for root in state.get("writableRoots", []):
                if root != state["cwd"]:
                    command.extend(["--add-dir", root])
        try:
            self.p = subprocess.Popen(
                capped(command, state),
                cwd=state["cwd"], env=worker_env(job, HOME=str(Path(job) / "home")),
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.err,
                bufsize=0, start_new_session=True,
            )
        except Exception:
            self.err.close()
            raise
        self.buf, self.events, self.seq = b"", deque(), 0

    def send(self, message):
        super().send({"jsonrpc": "2.0", **message})


def config_value(result, identifier):
    options = result.get("configOptions", [])
    return next((option.get("currentValue") for option in options
                 if isinstance(option, dict) and option.get("id") == identifier), None)


def configure(rpc, session, result, state):
    for key, option in (("model", "model"), ("effort", "thought_level")):
        requested = state.get(key)
        if requested and config_value(result, option) != requested:
            result = rpc.call("session/set_config_option", {
                "sessionId": session, "configId": option, "value": requested,
            })
            if config_value(result, option) != requested:
                raise RuntimeError(f"AGY did not confirm requested {key}")
    for key, option in (("model", "model"), ("effort", "thought_level")):
        if state.get(key) and config_value(result, option) != state[key]:
            raise RuntimeError(f"AGY changed requested {key} while configuring the session")
    value = config_value(result, "thought_level")
    state["effectiveEffort"] = value if isinstance(value, str) and value else None


def reject(rpc, event, job):
    method, params = event.get("method"), event.get("params") or {}
    if method == "session/request_permission":
        options = params.get("options") or []
        denied = next((item for item in options if isinstance(item, dict)
                       and item.get("kind") in {"reject_once", "reject_always"}), None)
        outcome = ({"outcome": "selected", "optionId": denied["optionId"]}
                   if denied and isinstance(denied.get("optionId"), str) else {"outcome": "cancelled"})
        rpc.send({"id": event["id"], "result": {"outcome": outcome}})
        log(job, "permission_denied", level="urgent",
            message="AGY requested an action outside its allow rules")
    elif method in {"session/request_elicitation", "elicitation/create"}:
        rpc.send({"id": event["id"], "result": {"action": "decline"}})
        log(job, "question", level="urgent", message="AGY requested input; resume with an answer")
    else:
        rpc.send({"id": event["id"], "error": {"code": -32601, "message": "Method not supported"}})


def flush_message(job, texts):
    message = "".join(texts).strip()
    texts.clear()
    if message:
        urgent = message.upper().startswith("URGENT:")
        message = message[7:].lstrip() if urgent else message
        log(job, "message", level="urgent" if urgent else "info", text=message)
        route_to_peers(job, message)


def run(job, state, path, prompt, resume=False):
    job = Path(job)
    if "gpt-oss" in (state.get("model") or "").lower():
        raise RuntimeError("GPT-OSS models are excluded; pick a Gemini or Claude model")
    if resume and not state.get("conversationId"):
        raise RuntimeError("AGY session ID is missing; refusing to start a new session")
    if not resume:
        agy.build_home(job, state)
    if state.get("inflight"):
        raise RuntimeError("AGY steer delivery is uncertain; inspect the native session before retrying")
    rpc = Rpc(job, state)
    try:
        runner_started(state, path)
    except Exception:
        rpc.close()
        raise
    reason, turns_done = "normal", 0
    session = None
    pending, texts, echo, awaiting_echo = {}, [], "", deque()
    queue_dir = job / "steer"
    queue_dir.mkdir(exist_ok=True)
    try:
        init = rpc.call("initialize", {"protocolVersion": 1, "clientCapabilities": {
            "fs": {"readTextFile": False, "writeTextFile": False}, "terminal": False,
        }})
        if init.get("protocolVersion") != 1:
            raise RuntimeError("AGY ACP protocol version is unsupported")
        session = state.get("conversationId") if resume else None
        if session:
            result = rpc.call("session/resume", {"sessionId": session, "cwd": state["cwd"], "mcpServers": []})
        else:
            result = rpc.call("session/new", {"cwd": state["cwd"], "mcpServers": []})
            session = result.get("sessionId")
            if not isinstance(session, str) or not session:
                raise RuntimeError("AGY ACP did not return a session ID")
            state["conversationId"] = session
        configure(rpc, session, result, state)
        save(path, state)
        log(job, "thread_started", conversationId=session, model=state.get("model"))
        try:
            offset = agy.transcript_path(job, session).stat().st_size
        except OSError:
            offset = 0
        monitor = {"at": time.monotonic(), "offset": offset, "seen": False, "hidden": 0}

        def send(text, filename=None):
            rpc.seq += 1
            identifier = f"prompt-{rpc.seq}"
            pending[identifier] = filename
            awaiting_echo.append((text, filename))
            rpc.send({"id": identifier, "method": "session/prompt", "params": {
                "sessionId": session, "prompt": [{"type": "text", "text": text}],
            }})
            state["activeTurnId"] = identifier
            log_turn_started(job, state, identifier)
            save(path, state)

        if (job / "stop").exists():
            (job / "stop").unlink()
            log(job, "stopped")
            reason = "stopped"
            return
        if prompt:
            send(prompt if resume else f"{MESSAGING_RULE}\n\n{agy.AGY_RULE}\n\n---\n\n{prompt}")
        cancelling = False
        while True:
            if (job / "stop").exists():
                (job / "stop").unlink()
                log(job, "stopped")
                reason = "stopped"
                return
            if (job / "interrupt").exists():
                (job / "interrupt").unlink()
                if pending:
                    cancelling = True
                    rpc.send({"method": "session/cancel", "params": {"sessionId": session}})
                    log(job, "interrupt_sent")
            if not state.get("inflight") and not cancelling:
                with steer_lock(job):
                    candidate = next((p for p in sorted(queue_dir.glob("[0-9]*.md"))
                                      if p.stem.isdecimal() and not p.is_symlink()
                                      and (not pending or not p.with_suffix(".queue").exists())), None)
                    if candidate:
                        text = candidate.read_text(encoding="utf-8").strip()
                        if not text:
                            raise ValueError("AGY steer is empty")
                        state["inflight"] = {"id": f"steer-{candidate.stem}", "file": candidate.name}
                        save(path, state)
                        send(text, candidate.name)
            if not pending and not state.get("inflight") and not list(queue_dir.glob("[0-9]*.md")):
                break
            agy.burn_check(job, state, monitor)
            event = rpc.events.popleft() if rpc.events else rpc.read(POLL)
            if event is None:
                continue
            if event.get("eof"):
                raise RuntimeError("AGY ACP disconnected; pending delivery may be uncertain")
            if "method" in event and "id" in event:
                request_session = (event.get("params") or {}).get("sessionId")
                if request_session is not None and request_session != session:
                    raise ValueError("AGY ACP request belongs to another session")
                reject(rpc, event, job)
            elif event.get("method") == "session/update":
                params = event.get("params") or {}
                if params.get("sessionId") != session:
                    continue
                update = params.get("update") or {}
                kind = update.get("sessionUpdate")
                monitor["seen"] = True
                content = update.get("content") or {}
                text = content.get("text") if isinstance(content, dict) else None
                if kind == "user_message_chunk" and isinstance(text, str):
                    flush_message(job, texts)
                    echo += text
                    if awaiting_echo:
                        expected, filename = awaiting_echo[0]
                        if echo == expected:
                            awaiting_echo.popleft()
                            marker = (queue_dir / filename).with_suffix(".queue") if filename else None
                            if filename and (state.get("inflight") or {}).get("file") == filename:
                                confirm_steer(job, state)
                            if marker:
                                marker.unlink(missing_ok=True)
                            echo = ""
                            log(job, "prompt_accepted")
                        elif len(echo) >= len(expected):
                            raise RuntimeError("AGY prompt echo did not match the submitted input")
                elif kind == "agent_message_chunk" and isinstance(text, str):
                    texts.append(text)
                elif kind in {"tool_call", "tool_call_update"}:
                    status = update.get("status")
                    if kind == "tool_call":
                        flush_message(job, texts)
                        log(job, "command_start", tool=update.get("title") or "tool",
                            stepId=update.get("toolCallId"))
                    if status in {"completed", "failed"}:
                        log(job, "command_end", status=status, stepId=update.get("toolCallId"))
            elif event.get("id") in pending:
                filename = pending.pop(event["id"])
                if "error" in event:
                    message = event["error"].get("message", "unknown error")
                    raise RuntimeError(f"AGY ACP prompt failed: {message}")
                result = event.get("result") or {}
                stop = result.get("stopReason")
                if stop not in {"end_turn", "max_tokens", "max_turn_requests", "refusal", "cancelled"}:
                    raise ValueError("AGY ACP returned an invalid prompt receipt")
                flush_message(job, texts)
                if filename and (state.get("inflight") or {}).get("file") == filename:
                    raise RuntimeError("AGY did not confirm steer delivery; inspect the native session")
                if not pending:
                    cancelling = False
                    status = "completed" if stop == "end_turn" else "failed" if stop == "refusal" else stop
                    log(job, "turn_completed", status=status, usage=result.get("usage"),
                        error="AGY refused the request" if stop == "refusal" else None)
                    turns_done += 1
                    state["activeTurnId"] = None
                    save(path, state)
    except Exception as error:
        reason = "error"
        log(job, "error", message=str(error))
        raise
    finally:
        state["activeTurnId"] = None
        try:
            rpc.close()
        except (OSError, subprocess.SubprocessError):
            pass
        log(job, "runner_exit", reason=reason, turnsDone=turns_done)
        runner_finished(state, path)
