"""Bounded local reads; the public SDK still chooses the native conversation chain."""

import asyncio
import json
import os
from pathlib import Path

from claude_agent_sdk import get_session_messages_from_store, project_key_for_directory

from .claude_history import cursor, display_content, encode_cursor
from .models import decode_json

LINE_LIMIT = 16 * 1024 * 1024
INDEX_LIMIT = 32 * 1024 * 1024
PAGE_SIZE = 100
ENTRY_TYPES = {"user", "assistant", "progress", "system", "attachment"}
CHAIN_FIELDS = (
    "type",
    "uuid",
    "parentUuid",
    "logicalParentUuid",
    "sessionId",
    "timestamp",
    "isSidechain",
    "isMeta",
    "teamName",
    "agentId",
    "sourceToolAssistantUUID",
    "subtype",
    "isCompactSummary",
)


def transcript_path(identifier, directory):
    projects = Path(os.environ["CLAUDE_CONFIG_DIR"]) / "projects"
    exact = projects / project_key_for_directory(directory) / (identifier + ".jsonl")
    if exact.is_file():
        return exact
    # Worktrees and long-path hash variants may store the same native UUID elsewhere.
    matches = list(projects.glob("*/" + identifier + ".jsonl"))
    if len(matches) != 1:
        raise ValueError("Native transcript path is missing or ambiguous")
    return matches[0]


def chain_metadata(entry):
    value = {key: entry[key] for key in CHAIN_FIELDS if key in entry}
    message = entry.get("message")
    if type(message) is dict:
        content = message.get("content")
        if type(content) is str:
            blocks = [{"type": "text"}] if content else []
        elif type(content) is list:
            blocks = [
                {key: block[key] for key in ("type", "id", "tool_use_id") if key in block}
                for block in content
                if type(block) is dict
            ]
        else:
            raise ValueError("Invalid native message content")
        value["message"] = {"id": message.get("id"), "content": blocks}
    return value


class ChainView:
    """Derived metadata only. Never pass this view to query/resume or a writable store."""

    def __init__(self, identifier, directory, entries):
        self.key = {"session_id": identifier, "project_key": project_key_for_directory(directory)}
        self.entries = entries

    async def load(self, key):
        if key != self.key:
            raise ValueError("Wrong native transcript identity")
        return self.entries

    async def append(self, key, entries):
        raise ValueError("Native history view is read-only")


def page(identifier, directory, older=None, since=None):
    if older is not None and since is not None:
        raise ValueError("Choose earlier history or catch-up")
    entries, offsets, retained = [], {}, 0
    with transcript_path(identifier, directory).open("rb") as stream:
        end = os.fstat(stream.fileno()).st_size
        while stream.tell() < end:
            offset = stream.tell()
            line = stream.readline(min(LINE_LIMIT + 1, end - offset))
            if len(line) > LINE_LIMIT:
                raise ValueError("A native transcript record exceeds the read limit")
            try:
                entry = decode_json(line)
            except ValueError:
                if not line.endswith(b"\n") and stream.tell() == end:
                    break  # The native writer has not finished its last record yet.
                raise
            if (
                type(entry) is not dict
                or entry.get("type") not in ENTRY_TYPES
                or type(entry.get("uuid")) is not str
            ):
                continue
            metadata = chain_metadata(entry)
            retained += len(json.dumps(metadata).encode())
            if retained > INDEX_LIMIT or len(entries) >= 100000:
                raise ValueError("Native conversation index exceeds the read limit")
            entries.append(metadata)
            offsets[entry["uuid"]] = offset, len(line)
        rows = asyncio.run(
            get_session_messages_from_store(
                ChainView(identifier, directory, entries), identifier, directory=directory
            )
        )
        start, stop = max(0, len(rows) - PAGE_SIZE), len(rows)
        anchor = since if since is not None else older
        if anchor is not None:
            position, reference = cursor(anchor)
            if position > len(rows) or not position or rows[position - 1].uuid != reference:
                raise ValueError("Native history changed; reload")
            start, stop = (
                (position - 1, min(len(rows), position - 1 + PAGE_SIZE))
                if since is not None
                else (max(0, position - PAGE_SIZE), position)
            )
        else:
            # Match other native adapters: a tool-heavy page still needs useful recent chat.
            while start and stop - start < 3 * PAGE_SIZE:
                chat = sum(
                    any(block.get("type") == "text" for block in row.message["content"])
                    for row in rows[start:stop]
                )
                if chat >= 12:
                    break
                start = max(0, start - PAGE_SIZE)
        messages = []
        for row in rows[start:stop]:
            offset, length = offsets[row.uuid]
            stream.seek(offset)
            entry = decode_json(stream.read(length))
            if entry["uuid"] != row.uuid or entry.get("sessionId") != identifier:
                raise ValueError("Native history changed while reading")
            messages.append(
                {
                    "type": row.type,
                    "uuid": row.uuid,
                    "session_id": identifier,
                    "message": {
                        **entry["message"],
                        "content": display_content(entry["message"].get("content")),
                    },
                    "parent_tool_use_id": row.parent_tool_use_id,
                    "parent_agent_id": row.parent_agent_id,
                }
            )
    return {
        "messages": messages,
        "older": encode_cursor(start, rows[start - 1].uuid) if start else None,
        "newer": encode_cursor(stop, rows[stop - 1].uuid) if stop else None,
        "catching_up": since is not None and stop < len(rows),
    }
