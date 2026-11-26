"""Same-user Bridge ingress for already-loaded Antigravity roots."""

import json
import os
import socket
import stat
import sys
import uuid
from contextlib import contextmanager
from socketserver import StreamRequestHandler, UnixStreamServer
from threading import Thread

from agent_session.peer import (
    INBOX_FRAME_LIMIT,
    INBOX_VERSION,
    address,
    envelope,
    inbox_socket,
    require_same_user,
)

from .models import DeliveryRejected, decode_json, fields, text


class Handler(StreamRequestHandler):
    timeout = 4

    def handle(self):
        try:
            require_same_user(self.request)
            line = self.rfile.readline(INBOX_FRAME_LIMIT + 1)
            if not line or len(line) > INBOX_FRAME_LIMIT or not line.endswith(b"\n"):
                return
            reply = self.route(decode_json(line))
        except (ValueError, KeyError, TypeError):
            reply = {"status": "invalid"}
        except OSError:
            return
        except Exception:
            reply = {"status": "unknown"}
        try:
            self.wfile.write(json.dumps({"version": INBOX_VERSION, **reply}).encode() + b"\n")
        except OSError:
            pass

    def route(self, data):
        fields(data, ("version", "operation"), ("id", "sender", "recipient", "text"))
        if type(data["version"]) is not int or data["version"] != INBOX_VERSION:
            raise ValueError("Unsupported Inbox peer request")
        operation = data["operation"]
        runtimes = self.server.runtimes.live_roots("agy")
        if operation == "list":
            fields(data, ("version", "operation"))
            rows = {}
            for runtime in runtimes:
                name = "agy:" + runtime.target.session_id
                rows[name] = None if name in rows else ("active" if runtime.busy else "idle")
            return {"sessions": [
                {"address": name, "status": status} for name, status in rows.items() if status
            ]}
        if operation != "send":
            raise ValueError("Unknown Inbox peer operation")
        fields(data, ("version", "operation", "id", "sender", "recipient", "text"))
        identifier = text(data["id"], "peer message ID", 36)
        if str(uuid.UUID(identifier)) != identifier:
            raise ValueError("Invalid peer message ID")
        recipient = data["recipient"]
        harness, session = address(recipient)
        address(data["sender"])
        if (harness != "agy" or str(uuid.UUID(session)) != session
                or len(text(data["text"], "peer message").encode()) > 16384):
            raise ValueError("Invalid AGY peer message")
        matching = [runtime for runtime in runtimes if runtime.target.session_id == session]
        status = "missing" if not matching else "ambiguous"
        if len(matching) == 1:
            status = self.send(matching[0], data)
        return {"id": identifier, "recipient": recipient, "status": status}

    def send(self, runtime, data):
        identifier = data["id"]
        body = envelope(data)
        store = self.server.store
        fresh, status = store.reserve(identifier, runtime.target.id, body)
        if fresh:
            try:
                status = runtime.request("peer", [{"type": "text", "text": body}], timeout=4)
                if status != "forwarded":
                    raise RuntimeError("Unexpected ACP peer receipt")
            except DeliveryRejected:
                status = "failed"
            except Exception:
                status = "unknown"
            store.finish(identifier, status)
        return {"forwarded": "sent", "failed": "busy"}.get(status, "unknown")


@contextmanager
def serving(store, runtimes):
    if not hasattr(socket, "SO_PEERCRED"):
        yield
        return
    path = inbox_socket(store.home)
    parent = path.parent.stat()
    if parent.st_uid != os.getuid() or stat.S_IMODE(parent.st_mode) & 0o077:
        raise ValueError("Inbox peer state directory must be private and owned by this user")
    try:
        info = path.lstat()
    except FileNotFoundError:
        pass
    else:
        if info.st_uid != os.getuid() or not stat.S_ISSOCK(info.st_mode):
            raise ValueError("Unsafe Inbox peer socket")
        path.unlink()  # The caller already holds the Inbox state directory's server lock.
    try:
        server = UnixStreamServer(str(path), Handler)
    except OSError as error:
        reason = error.strerror or type(error).__name__
        print(f"agent-inbox: Bridge socket unavailable ({reason})", file=sys.stderr)
        yield
        return
    with server:
        try:
            path.chmod(0o600)
            server.store, server.runtimes = store, runtimes
            thread = Thread(target=server.serve_forever, name="agent-inbox-peers", daemon=True)
            thread.start()
            try:
                yield
            finally:
                server.shutdown()
                thread.join()
        finally:
            path.unlink(missing_ok=True)
