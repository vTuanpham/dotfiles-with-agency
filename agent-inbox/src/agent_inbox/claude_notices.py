"""Display native Claude provenance without treating injected input as human chat."""

import html
import re

from .models import Message


def unwrap(body, tag):
    match = re.fullmatch(r"\s*<" + tag + r">([\s\S]*)</" + tag + r">\s*", body)
    return match[1] if match else None


def command_kind(entry):
    if entry.get("type") != "user":
        return None
    content = entry.get("message", {}).get("content")
    if type(content) is not str:
        return None
    if entry.get("isMeta") is True and unwrap(content, "local-command-caveat") is not None:
        return "caveat"
    if re.fullmatch(
        r"\s*<command-name>[^<]+</command-name>\s*"
        r"<command-message>[\s\S]*?</command-message>\s*"
        r"<command-args>[\s\S]*?</command-args>\s*",
        content,
    ):
        return "input"
    for tag in ("local-command-stdout", "local-command-stderr"):
        if unwrap(content, tag) is not None:
            return tag
    return None


def notice(row, body):
    if row["type"] != "user":
        return None
    identifier = "claude:" + row["uuid"]
    origin = row.get("origin")
    if origin is not None and (type(origin) is not dict or type(origin.get("kind")) is not str):
        raise ValueError("Invalid Claude message origin")
    kind = origin["kind"] if origin else None
    if kind == "human":
        return None
    label = None
    if kind == "task-notification":
        label = {"scheduled-trigger": "Scheduled prompt", "peer-send-message": "Peer message"}.get(
            origin.get("subkind"), "Background task"
        )
        wrapped = unwrap(body, "task-notification")
        if wrapped is not None:
            parts, remaining = {}, wrapped.strip()
            while remaining:
                field = re.match(r"<([a-z][a-z-]*)>([\s\S]*?)</\1>\s*", remaining)
                if field is None or field[1] in parts:
                    parts = {}
                    break
                parts[field[1]] = field[2]
                remaining = remaining[field.end() :]
            status = parts.get("status", "").strip()
            if status in ("completed", "failed", "stopped"):
                label += " · " + status
            meaningful = [parts[key] for key in ("summary", "result") if parts.get(key, "").strip()]
            # Native envelopes encode result markup; decode once, then use the HTML-disabled renderer.
            body = "\n\n".join(html.unescape(part).strip() for part in meaningful) or (
                "Task details are available in the native conversation."
            )
        elif body.lstrip().startswith("<task-notification>"):
            body = "Task details are available in the native conversation."
    elif kind == "peer":
        label = "Peer message"
        if type(origin.get("body")) is str:
            body = origin["body"]  # The SDK supplies the decoded peer body; do not parse its envelope.
        name = origin.get("name")
        if type(name) is str and name.strip():
            label += " · " + name
    elif kind == "channel" and origin.get("server") != "agent-inbox":
        label = "Channel message"
        channel = re.fullmatch(r"\s*<channel\b[^>]*>([\s\S]*)</channel>\s*", body)
        if channel:
            body = channel[1].strip()
    elif kind and kind != "channel":
        label = {
            "coordinator": "Coordinator message",
            "auto-continuation": "Session continuation",
            "observer": "Observer message",
            "observer-activity": "Observer activity",
        }.get(kind, "Session event")
    elif row.get("local_command") is True:
        command = re.fullmatch(
            r"\s*<command-name>([^<]+)</command-name>\s*"
            r"<command-message>[\s\S]*?</command-message>\s*"
            r"<command-args>([\s\S]*?)</command-args>\s*",
            body,
        )
        if command:
            label, body = "Local command", (command[1] + " " + command[2]).strip()
        else:
            for tag in ("local-command-stdout", "local-command-stderr"):
                output = unwrap(body, tag)
                if output is not None:
                    label, body = "Command output", output.strip()
                    break
    elif row.get("isCompactSummary") is True:
        label = "Context summary"
        summary = re.search(r"<summary>([\s\S]*?)</summary>", body)
        if summary:
            body = summary[1].strip()
    elif row.get("isSynthetic") is True:
        label = "Session event"
    if label is None:
        return None
    return Message(identifier, "system", body, label=label)
