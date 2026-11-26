"""Send to a live AGY root on the Inbox-owned ACP connection."""

import json
import os
import socket
import stat

from agent_session.peer import INBOX_FRAME_LIMIT, INBOX_VERSION, address, inbox_socket, require_same_user


class InboxAccessDenied(RuntimeError):
    """The socket could not be reached before sending a request."""


def request(operation, **data):
    path = inbox_socket()
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    if info.st_uid != os.getuid() or not stat.S_ISSOCK(info.st_mode) or stat.S_IMODE(info.st_mode) & 0o077:
        raise ValueError("Inbox peer socket must be private and owned by this user")
    frame = json.dumps({"version": INBOX_VERSION, "operation": operation, **data}).encode() + b"\n"
    if len(frame) > INBOX_FRAME_LIMIT:
        raise ValueError("Inbox peer request is too large")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(8)
        try:
            connection.connect(str(path))
        except (FileNotFoundError, ConnectionRefusedError):
            return None
        except PermissionError:
            raise InboxAccessDenied("Inbox socket access denied. Use an authorized host context.") from None
        require_same_user(connection)
        try:
            connection.sendall(frame)
            with connection.makefile("rb") as stream:
                line = stream.readline(INBOX_FRAME_LIMIT + 1)
            if len(line) > INBOX_FRAME_LIMIT or not line.endswith(b"\n"):
                raise ValueError("Incomplete Inbox peer reply")
            reply = json.loads(line)
            if (type(reply) is not dict or type(reply.get("version")) is not int
                    or reply["version"] != INBOX_VERSION):
                raise ValueError("Unsupported Inbox peer reply")
        except (OSError, ValueError):
            raise RuntimeError(
                "Inbox peer outcome is unconfirmed. Check the recipient before retrying."
            ) from None
    return reply


def sessions():
    reply = request("list")
    if reply is None:
        return []
    rows = reply.get("sessions")
    if not isinstance(rows, list) or len(rows) > 50:
        raise ValueError("Invalid Inbox peer inventory")
    seen = set()
    for row in rows:
        if (type(row) is not dict or set(row) != {"address", "status"}
                or address(row["address"])[0] != "agy" or row["status"] not in ("idle", "active")
                or row["address"] in seen):
            raise ValueError("Invalid Inbox peer session")
        seen.add(row["address"])
        row["transport"] = "agy-inbox-acp"
    return rows


def send(packet):
    reply = request("send", **{key: packet[key] for key in ("id", "sender", "recipient", "text")})
    if reply is None:
        return None
    if reply.get("id") == packet["id"] and reply.get("recipient") == packet["recipient"]:
        status = reply.get("status")
        if status == "missing":
            return None
        if status == "sent":
            return {key: packet[key] for key in ("version", "id", "sender", "recipient")} | {
                "status": "sent", "transport": "agy-inbox-acp",
            }
        if status == "busy":
            raise RuntimeError("AGY Inbox root is busy or waiting for input. No message was sent.")
        if status == "ambiguous":
            raise RuntimeError("Multiple live AGY Inbox roots share this address. No message was sent.")
    raise RuntimeError("Inbox peer send is unconfirmed. Check the recipient before retrying.")
