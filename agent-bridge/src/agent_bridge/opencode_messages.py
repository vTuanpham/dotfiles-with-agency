"""OpenCode v2 synthetic agent messages, using its existing private local service."""

import base64
import http.client
import json
import os
from pathlib import Path
from urllib.parse import quote, urlsplit

from .message_store import read
from .messages import envelope


class Connection:
    def __init__(self):
        state = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state"))
        data = read(state / "opencode/service.json")
        if not isinstance(data.get("url"), str):
            raise ValueError("Invalid native OpenCode service URL")
        parsed = urlsplit(data.get("url", ""))
        if (
            parsed.scheme != "http"
            or parsed.hostname != "127.0.0.1"
            or parsed.username
            or parsed.password
            or parsed.path
            or parsed.query
            or parsed.fragment
            or not parsed.port
            or type(data.get("pid")) is not int
            or data["pid"] <= 0
            or data.get("version") != "2.2.2"
            or not isinstance(data.get("password"), str)
            or not data["password"]
            or len(data["password"]) > 1024
        ):
            raise ValueError("Unsupported private OpenCode service; expected local v2.2.2")
        self.port = parsed.port
        self.headers = {
            "Authorization": "Basic " + base64.b64encode(("opencode:" + data["password"]).encode()).decode(),
            "Content-Type": "application/json",
        }
        health = self.call("GET", "/api/info")
        if (
            health.get("version") != data["version"]
            or type(health.get("pid")) is not int
            or health["pid"] != data["pid"]
        ):
            raise ValueError("OpenCode service identity changed")

    def call(self, method, path, body=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=8)
        try:
            connection.request(method, path, json.dumps(body) if body is not None else None, self.headers)
            response = connection.getresponse()
            if response.status != 200:
                raise RuntimeError(f"OpenCode native message API rejected request (HTTP {response.status})")
            if response.getheader("Content-Type", "").split(";")[0] != "application/json":
                raise RuntimeError("Invalid OpenCode native response type")
            raw = response.read(1048577)
            if len(raw) > 1048576:
                raise RuntimeError("OpenCode native response exceeds the message limit")
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise RuntimeError("Invalid OpenCode native response")
            return data
        finally:
            connection.close()


def session_path(session):
    if not session.startswith("ses_") or any(
        not (char.isascii() and (char.isalnum() or char in "_-")) for char in session
    ):
        raise ValueError("Invalid native OpenCode session ID")
    return "/api/session/" + quote(session, safe="")


def send(packet):
    session = packet["recipient"].removeprefix("opencode:")
    path = session_path(session)
    api = Connection()
    info = api.call("GET", path).get("data")
    if (
        not isinstance(info, dict)
        or info.get("id") != session
        or not isinstance(info.get("time"), dict)
        or "archived" in info["time"]
    ):
        raise RuntimeError("OpenCode recipient is missing or archived")
    body = {
        "text": envelope(packet),
        "description": "Agent Bridge peer message",
        "metadata": {"bridge_sender": packet["sender"], "bridge_message_id": packet["id"]},
        "delivery": "steer",
    }
    result = api.call("POST", path + "/synthetic", body).get("data")
    if (
        not isinstance(result, dict)
        or result.get("sessionID") != session
        or result.get("type") != "synthetic"
        or not isinstance(result.get("id"), str)
        or not result["id"]
        or result.get("delivery") != "steer"
    ):
        raise RuntimeError("Invalid OpenCode synthetic receipt; delivery may have succeeded")
    return {
        "version": 1,
        "id": packet["id"],
        "sender": packet["sender"],
        "recipient": packet["recipient"],
        "status": "accepted",
        "native_id": result["id"],
        "transport": "opencode-synthetic-api",
    }


def sessions():
    api = Connection()
    data = api.call("GET", "/api/session/active").get("data")
    if not isinstance(data, dict):
        raise RuntimeError("Invalid OpenCode active session inventory")
    rows = []
    for session, value in data.items():
        session_path(session)
        if not isinstance(value, dict) or value.get("type") != "running":
            raise RuntimeError("Unsupported OpenCode active session state")
        rows.append({"address": "opencode:" + session, "status": "active"})
    return rows
