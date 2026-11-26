"""Antigravity's native agentapi transport; private recipient connection bindings."""

import ipaddress
import json
import os
import re
import shutil
import socket
import subprocess
import uuid
from urllib.parse import urlsplit

from . import core, inbox_messages, messages
from .message_store import directory, read

CONNECTION_ENV = ("ANTIGRAVITY_LS_ADDRESS", "ANTIGRAVITY_CSRF_TOKEN")
RPC_CODE = re.compile(
    r"^rpc error: code = (Canceled|Unknown|InvalidArgument|DeadlineExceeded|NotFound|"
    r"AlreadyExists|PermissionDenied|ResourceExhausted|FailedPrecondition|Aborted|"
    r"OutOfRange|Unimplemented|Internal|Unavailable|DataLoss|Unauthenticated) desc = "
)


def validate(environment):
    if not isinstance(environment, dict) or set(environment) != set(CONNECTION_ENV):
        raise ValueError("Invalid Antigravity native connection binding")
    for name in CONNECTION_ENV:
        value = environment[name]
        if (
            not isinstance(value, str)
            or not value
            or len(value) > 4096
            or any(ord(char) < 32 for char in value)
        ):
            raise ValueError("Antigravity native connection unavailable")
    value = environment["ANTIGRAVITY_LS_ADDRESS"]
    parsed = urlsplit(value if "://" in value else "//" + value)
    if (
        parsed.scheme not in ("", "http", "https")
        or parsed.hostname not in ("127.0.0.1", "::1", "localhost")
        or not parsed.port
        or parsed.username
        or parsed.password
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Antigravity native connection must use a local loopback server")
    if parsed.hostname == "localhost" and any(
        not ipaddress.ip_address(item[4][0]).is_loopback
        for item in socket.getaddrinfo("localhost", parsed.port, type=socket.SOCK_STREAM)
    ):
        raise ValueError("Antigravity localhost connection resolves outside loopback")


def register():
    target = messages.identity()
    harness, session = messages.address(target)
    if harness != "agy" or str(uuid.UUID(session)) != session:
        raise ValueError("Registration requires the originating native Antigravity session")
    environment = {name: os.environ.get(name) for name in CONNECTION_ENV}
    validate(environment)
    core.atomic_save(directory(target) / "endpoint.json", {"address": target, "environment": environment})
    return {"version": 1, "address": target, "transport": "agy-agentapi"}


def refresh_registration(target):
    environment = {name: os.environ.get(name) for name in CONNECTION_ENV}
    if not all(environment.values()):
        return
    try:
        binding = read(directory(target) / "endpoint.json")
        if binding.get("address") == target and binding.get("environment") != environment:
            register()
    except (OSError, ValueError):
        # A missing or unwritable inbound registration should not block an outbound message.
        pass


def failure(command, error, fallback):
    preflight = command == "get-conversation-metadata"
    prefix = "Antigravity recipient check failed" if preflight else "Antigravity send was not confirmed"
    match = RPC_CODE.match(error) if isinstance(error, str) else None
    code = match[1] if match else None
    reason = f"gRPC {code}" if code else fallback
    remedy = "No message was sent." if preflight else "Delivery may be uncertain. Check before retrying."
    if code == "Unavailable" and "while dialing:" in error:
        if "connect: connection refused" in error:
            reason += ", connection refused"
            remedy += " Run `agent-bridge message register` from the active Antigravity recipient session."
        elif "socket: operation not permitted" in error or "connect: permission denied" in error:
            reason += ", local socket access denied"
    elif preflight and code == "Unauthenticated":
        remedy += " Run `agent-bridge message register` from the active Antigravity recipient session."
    return RuntimeError(f"{prefix} ({reason}). {remedy}")


def call(environment, command, session, text=None):
    validate(environment)
    binary = shutil.which("agy")
    if not binary:
        raise RuntimeError("Native agy CLI is unavailable")
    args = [binary, "agentapi", command, session]
    if text is not None:
        args.append(text)
    try:
        result = subprocess.run(args, env={**os.environ, **environment}, capture_output=True, timeout=10)
    except subprocess.TimeoutExpired:
        raise failure(command, None, "agentapi timed out") from None
    if len(result.stdout) > 1048576:
        raise failure(command, None, "oversized agentapi reply")
    try:
        data = json.loads(result.stdout)
    except ValueError:
        data = None
    error = data.get("error") if isinstance(data, dict) else None
    response = data.get("response") if isinstance(data, dict) else None
    if result.returncode or error not in (None, "") or not isinstance(response, dict):
        fallback = f"agentapi exit {result.returncode}" if result.returncode else "invalid agentapi reply"
        raise failure(command, error, fallback)
    return response


def send(packet):
    target = packet["recipient"]
    _, session = messages.address(target)
    if str(uuid.UUID(session)) != session:
        raise ValueError("Invalid native Antigravity conversation ID")
    inbox_denied = None
    try:
        receipt = inbox_messages.send(packet)
        if receipt is not None:
            return receipt
    except inbox_messages.InboxAccessDenied as error:
        inbox_denied = error
    try:
        binding = read(directory(target) / "endpoint.json")
    except FileNotFoundError:
        if inbox_denied is not None:
            raise inbox_denied from None
        raise RuntimeError("Antigravity recipient must run agent-bridge message register first") from None
    if binding.get("address") != target:
        raise ValueError("Antigravity connection belongs to a different conversation")
    environment = binding.get("environment")
    # The native CLI owns gRPC/auth details; a read-only preflight catches stale server bindings.
    call(environment, "get-conversation-metadata", session)
    call(
        environment,
        "send-message",
        session,
        "Forwarded by Bridge through Antigravity agentapi.\n" + messages.envelope(packet),
    )
    return {
        "version": 1,
        "id": packet["id"],
        "sender": packet["sender"],
        "recipient": target,
        "status": "accepted",
        "transport": "agy-agentapi",
    }


def sessions():
    rows = []
    for path in (core.HOME / "messages").glob("*/endpoint.json"):
        binding = read(path)
        target = binding.get("address")
        harness, _ = messages.address(target)
        if harness != "agy" or directory(target) != path.parent:
            raise ValueError("Invalid Antigravity connection binding")
        validate(binding.get("environment"))
        rows.append({"address": target, "status": "registered; liveness checked when sending"})
    return rows
