"""Read-only SDK helper, isolated so each native profile retains its own environment."""

import json
import sys
import uuid
from dataclasses import asdict

from claude_agent_sdk import get_session_info, list_subagents

from . import claude_transcript
from .models import decode_json, fields, text


def read(request):
    fields(request, ("session", "directory", "operation"), ("cursor", "since"))
    identifier = text(request["session"], "Claude session id", 200)
    if str(uuid.UUID(identifier)) != identifier:
        raise ValueError("Invalid native session id")
    directory = text(request["directory"], "project directory", 4096)
    info = get_session_info(identifier, directory=directory)
    if info is None or info.session_id != identifier:
        raise ValueError("Only existing main sessions can be read")
    if request["operation"] == "info":
        return {"info": asdict(info)}
    if request["operation"] == "children":
        return {"info": asdict(info), "children": list_subagents(identifier, directory=directory)}
    if request["operation"] not in ("history", "overview"):
        raise ValueError("Unknown SDK read operation")
    # The native SDK's filesystem helper parses the whole file even with limit/offset.
    page = claude_transcript.page(identifier, directory, request.get("cursor"), request.get("since"))
    if request["operation"] == "overview":
        return {"info": asdict(info), "turn_ended": page["turn_ended"]}
    return {"info": asdict(info), **page}


def main():
    try:
        raw = sys.stdin.buffer.read(65537)
        if len(raw) > 65536:
            raise ValueError("Oversized SDK read request")
        result = json.dumps(read(decode_json(raw)), ensure_ascii=False).encode()
        if len(result) > 24 * 1024 * 1024:
            raise ValueError("Native SDK response is outside the inbox limit")
        sys.stdout.buffer.write(result)
    except (OSError, ValueError, TypeError, KeyError):
        sys.exit(1)  # private paths, transcript contents and native diagnostics never go to logs


if __name__ == "__main__":
    main()
