"""Project Codex async question items and format plain-text message replies."""

import hashlib
import json
import time
from dataclasses import dataclass, field, replace
from threading import Lock

from .codex_history import cursor, question_reply_records
from .commands import Choice
from .forms import FormField, Forms, QuestionForm
from .models import text


def question(item):
    if item.get("type") != "agentMessage" or item.get("delivery") != "async":
        return None
    rows = item.get("questions")
    if rows is None or rows == []:
        return None
    if type(rows) is not list or len(rows) > 100:
        raise ValueError("Invalid native async questions")
    fields = []
    for index, row in enumerate(rows):
        if type(row) is not dict:
            raise ValueError("Invalid native async question")
        title = text(row.get("title"), "native question", 16384)
        options = row.get("options")
        if options is not None and (type(options) is not list or len(options) > 100):
            raise ValueError("Invalid native question choices")
        choices = [Choice(text(option, "native choice"), option) for option in options or []]
        if len({choice.value for choice in choices}) != len(choices):
            raise ValueError("Duplicate native question choice")
        fields.append(FormField(str(index), title, "string", required=True, choices=choices, custom=True,
                                constraints={"minLength": 1}))
    return QuestionForm(text(item.get("id"), "native question id", 200), "Question", fields,
                        response_mode="message")


def answered_questions(item):
    if item.get("type") != "userMessage":
        return set()
    parts = item.get("content")
    if type(parts) is not list:
        raise ValueError("Invalid native user message")
    if any(type(part) is not dict or part.get("type") == "text" and type(part.get("text")) is not str
           for part in parts):
        raise ValueError("Invalid native user message content")
    body = "\n".join(part["text"] for part in parts if part.get("type") == "text")
    try:
        rows = question_reply_records(body) or []
        calls = set()
        for row in rows:
            identifier = json.loads(row["questionItemId"])
            if (type(identifier) is list and len(identifier) == 3
                    and identifier[0] == "request_user_input_async" and type(identifier[1]) is str
                    and type(identifier[2]) is int and identifier[2] >= 0):
                calls.add((identifier[1], identifier[2]))
        return calls
    except (ValueError, TypeError):
        return set()  # Literal or malformed question-shaped user text is not a native answer.


@dataclass
class Projection:
    head: tuple[str, str] | None = None
    pending: dict[str, QuestionForm] = field(default_factory=dict)
    answered: set[tuple[str, int]] = field(default_factory=set)


class Questions:
    def __init__(self):
        self.lock = Lock()
        self.roots = {}

    def read(self, rpc, target, info):
        key = (target.settings["socket"], target.session_id)
        with self.lock:
            previous = self.roots.get(key, Projection())
            state = replace(previous, pending=dict(previous.pending), answered=set(previous.answered))
            records, seen, next_cursor = [], set(), None
            deadline = time.monotonic() + 8
            reached = False
            while True:
                if time.monotonic() > deadline or len(records) >= 20000:
                    raise TimeoutError("Native question history is still catching up")
                params = {"threadId": target.session_id, "limit": 100, "sortDirection": "desc"}
                if next_cursor is not None:
                    params["cursor"] = next_cursor
                page = rpc.call("thread/items/list", params)
                if type(page.get("data")) is not list:
                    raise ValueError("Invalid native question history")
                for record in page["data"]:
                    if type(record) is not dict or type(record.get("item")) is not dict:
                        raise ValueError("Invalid native question item")
                    item = record["item"]
                    identifier = (text(record.get("turnId"), "native turn id", 200),
                                  text(item.get("id"), "native item id", 200))
                    if identifier in seen:
                        raise ValueError("Duplicate native item id")
                    seen.add(identifier)
                    records.append(record)
                    if identifier == state.head:
                        reached = True
                        break
                if reached:
                    break
                following = cursor(page.get("nextCursor"))
                if following is None:
                    break
                if following == next_cursor:
                    raise ValueError("Native question cursor did not advance")
                next_cursor = following
            if not reached:
                state = Projection()  # Initial load or native history replacement/compaction.
            for record in reversed(records):
                item = record["item"]
                answered = answered_questions(item)
                # shortcut: no async pending-state API; later ordinary input supersedes older cards.
                if item.get("type") == "userMessage" and not answered:
                    state.pending.clear()
                state.answered.update(answered)
                found = question(item)
                if found:
                    state.pending[found.id] = found
            for identifier, form in list(state.pending.items()):
                remaining = [f for f in form.fields if (identifier, int(f.key)) not in state.answered]
                if remaining:
                    state.pending[identifier] = replace(form, fields=remaining)
                else:
                    state.pending.pop(identifier)
            state.head = (records[0]["turnId"], records[0]["item"]["id"]) if records else None
            if len(self.roots) >= 128 and key not in self.roots:
                self.roots.pop(next(iter(self.roots)))
            self.roots[key] = state
            unavailable = ""
            if not state.pending and "waitingOnUserInput" in info["status"].get("activeFlags", []):
                unavailable = "This blocking request belongs to the native Codex client. Answer it there."
            return Forms(list(state.pending.values()), unavailable)

    def dismiss(self, target, identifier):
        with self.lock:
            state = self.roots.get((target.settings["socket"], target.session_id))
            if state and identifier in state.pending:
                form = state.pending.pop(identifier)
                state.answered.update((identifier, int(f.key)) for f in form.fields)


def reply(form, answer):
    form.validate(answer)
    body = "\n\n".join(f"{field.label}\n{answer[field.key]}" for field in form.fields)
    text(body, "question reply")
    identifier = hashlib.sha256(json.dumps([form.id, answer], sort_keys=True).encode()).hexdigest()
    return "inbox-answer:" + identifier, body
