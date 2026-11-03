"""Claude's authenticated native peer socket (SendMessage), priority=now."""

import hashlib
import json
import os
import secrets
import socket
import stat
import struct
import time
from pathlib import Path
from urllib.parse import quote

from .message_store import read
from .messages import envelope


def config():
    return Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude"))


def live():
    rows = []
    for item in (config() / "sessions").glob("*.json"):
        try:
            data = read(item, private=False)
            pid = data.get("pid")
            if type(pid) is not int or pid <= 0 or item.name != f"{pid}.json":
                continue
            start = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19]
            if data.get("procStart") != start:
                continue
            sock = data.get("messagingSocketPath")
            if not isinstance(sock, str) or not Path(sock).is_absolute():
                continue
            info = Path(sock).lstat()
            if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid():
                continue
            rows.append(data)
        except FileNotFoundError:
            continue
    return rows


def sessions():
    return [
        {"address": "claude:" + row["sessionId"], "title": row.get("name"), "status": row.get("status")}
        for row in live()
        if isinstance(row.get("sessionId"), str)
    ]


def key_path(pid, sock):
    return config() / "sessions" / f"{pid}.{hashlib.sha256(sock.encode()).hexdigest()}.key"


def target(session):
    rows = [row for row in live() if row.get("sessionId") == session]
    if len(rows) != 1:
        raise RuntimeError("Native Claude recipient is offline or ambiguous")
    row = rows[0]
    if row.get("peerProtocol") != 1:
        raise RuntimeError("Unsupported native Claude peer protocol")
    key = read(key_path(row["pid"], row["messagingSocketPath"]))
    token = key.get("peerToken")
    if (
        key.get("procStart") != row["procStart"]
        or key.get("pidDomain") != row.get("pidDomain")
        or not isinstance(token, str)
        or len(token) != 32
        or any(char not in "0123456789abcdef" for char in token)
    ):
        raise ValueError("Invalid native Claude peer credential")
    return row, token


def send(packet):
    session = packet["recipient"].removeprefix("claude:")
    row, token = target(session)
    parent = Path(row["messagingSocketPath"]).parent
    info = parent.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("Native Claude socket directory must be private")
    reply_path = parent / f"{os.getpid()}-{secrets.token_hex(4)}.sock"
    reply_key = key_path(os.getpid(), str(reply_path))
    reply_token = secrets.token_hex(16)
    start = Path(f"/proc/{os.getpid()}/stat").read_text().rsplit(")", 1)[1].split()[19]
    frame = {
        "type": "user",
        "message": {"role": "user", "content": envelope(packet)},
        "priority": "now",
        "session_id": session,
        "uuid": packet["id"],
        "msg_id": packet["id"],
        "from": "uds:" + quote(str(reply_path), safe=""),
        "from_plugin": "agent-bridge",
    }
    with socket.socket(socket.AF_UNIX) as receiver:
        receiver.settimeout(10)
        bound, published = False, False
        try:
            receiver.bind(str(reply_path))
            bound = True
            reply_path.chmod(0o600)
            receiver.listen(4)
            fd = os.open(reply_key, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
            published = True
            with os.fdopen(fd, "w") as stream:
                json.dump(
                    {"peerToken": reply_token, "procStart": start, "pidDomain": row.get("pidDomain")}, stream
                )
            with socket.socket(socket.AF_UNIX) as transport:
                transport.settimeout(8)
                transport.connect(row["messagingSocketPath"])
                pid, uid, _ = struct.unpack(
                    "3i", transport.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
                )
                actual_start = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19]
                if pid != row["pid"] or uid != os.getuid() or actual_start != row["procStart"]:
                    raise RuntimeError("Native Claude peer identity changed before delivery")
                transport.sendall(
                    (json.dumps({"type": "auth", "token": token}) + "\n" + json.dumps(frame) + "\n").encode()
                )
                transport.shutdown(socket.SHUT_WR)
                # Native socket closure is not a delivery receipt; status callbacks are optional.
                transport.recv(1)
            deadline = time.monotonic() + 0.5
            while time.monotonic() < deadline:
                receiver.settimeout(max(0.1, deadline - time.monotonic()))
                try:
                    peer, _ = receiver.accept()
                except TimeoutError:
                    break
                with peer:
                    peer.settimeout(8)
                    pid, uid, _ = struct.unpack(
                        "3i", peer.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
                    )
                    actual_start = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19]
                    if pid != row["pid"] or uid != os.getuid() or actual_start != row["procStart"]:
                        continue
                    with peer.makefile("rb") as stream:
                        auth = json.loads(stream.readline(4097))
                        if auth != {"type": "auth", "token": reply_token}:
                            raise RuntimeError("Native Claude receipt authentication failed")
                        receipt = json.loads(stream.readline(65537))
                    if (
                        not isinstance(receipt, dict)
                        or receipt.get("type") != "control"
                        or receipt.get("action") != "peer_message_status"
                        or receipt.get("orig_msg_id") != packet["id"]
                    ):
                        raise RuntimeError("Native Claude receipt does not match this message")
                    status = receipt.get("status")
                    if status not in {"held", "denied", "expired", "delivered", "refused", "dropped"}:
                        raise RuntimeError("Unsupported native Claude delivery receipt")
                    return {
                        "version": 1,
                        "id": packet["id"],
                        "sender": packet["sender"],
                        "recipient": packet["recipient"],
                        "status": status,
                        "reason": receipt.get("reason"),
                        "transport": "claude-native-peer",
                        "delivery": "steer",
                    }
        except (TimeoutError, OSError, ValueError):
            raise RuntimeError(
                "Claude native message receipt unavailable; delivery is uncertain; do not retry"
            ) from None
        finally:
            if bound:
                reply_path.unlink(missing_ok=True)
            if published:
                reply_key.unlink(missing_ok=True)
    return {
        "version": 1,
        "id": packet["id"],
        "sender": packet["sender"],
        "recipient": packet["recipient"],
        "status": "sent",
        "transport": "claude-native-peer",
        "delivery": "steer",
    }
