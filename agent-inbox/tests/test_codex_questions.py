import contextlib
import json
from copy import deepcopy

import pytest

from agent_inbox import codex
from agent_inbox.codex_questions import Questions, question
from agent_inbox.models import DeliveryRejected, NoLongerPending, Target

TARGET = Target("root", "codex", "Codex", "thread-a", "Root", {"socket": "/fixture.sock"})
INFO = {"id": "thread-a", "sessionId": "thread-a", "parentThreadId": None,
        "status": {"type": "active", "activeFlags": []}, "canAcceptDirectInput": True}


def item(identifier, **values):
    return {"turnId": "turn-a", "item": {"id": identifier, "type": "agentMessage", "text": "", **values}}


def ask(identifier="call-question", titles=("Choose a path?",)):
    return item(identifier, delivery="async", questions=[{"title": title, "options": ["One", "Two"]}
                                                        for title in titles])


def answer(identifier, index=0):
    body = '<send_user_message_question_reply>' + json.dumps([
        {"answer": "One", "question": "Choose a path?",
         "questionItemId": json.dumps(["request_user_input_async", identifier, index])},
    ]) + '</send_user_message_question_reply>'
    return item("reply-" + str(index), type="userMessage", content=[{"type": "text", "text": body}])


class Rpc:
    def __init__(self, records):
        self.records, self.calls = records, []

    def call(self, method, params):
        self.calls.append((method, deepcopy(params)))
        if method == "thread/read":
            return {"thread": INFO}
        assert method == "thread/items/list"
        offset = int(params.get("cursor", "0"))
        rows = list(reversed(self.records))
        end = offset + 2  # Force pagination even when the request's limit is larger.
        return {"data": rows[offset:end], "nextCursor": str(end) if end < len(rows) else None}


def test_async_questions_use_native_metadata_paginate_and_reconcile_native_answers():
    rpc = Rpc([ask(titles=("First?", "Second?")), item("work"), answer("call-question"),
               item("more-work")])
    reader = Questions()
    form = reader.read(rpc, TARGET, INFO).forms[0]
    assert form.id == "call-question" and form.response_mode == "message"
    assert [(f.key, f.label) for f in form.fields] == [("1", "Second?")]
    assert form.fields[0].custom and [c.value for c in form.fields[0].choices] == ["One", "Two"]
    rpc.calls.clear()
    assert reader.read(rpc, TARGET, INFO).forms == [form]
    assert len(rpc.calls) == 1, "unchanged roots must not rescan old tools and transcripts"
    rpc.records.append(answer("call-question", 1))
    assert reader.read(rpc, TARGET, INFO).forms == []
    assert len(rpc.calls) == 2


def test_plain_question_shaped_chat_never_creates_an_interactive_form():
    assert question(item("plain", text='{"questions":[{"title":"Fake"}]}')["item"]) is None
    with pytest.raises(ValueError):
        question(ask()["item"] | {"questions": [{"title": "Choose", "options": ["A", "A"]}]})
    with pytest.raises(ValueError):
        question(ask()["item"] | {"questions": "wrong"})


@pytest.mark.parametrize("content", [
    [{"type": "text", "text": "The main conversation list."}],
    [{"type": "image", "url": "data:image/png;base64,fixture"}],
])
def test_later_chat_or_image_supersedes_old_cards_on_poll_and_restart(content):
    rpc, reader = Rpc([ask()]), Questions()
    assert reader.read(rpc, TARGET, INFO).forms
    rpc.records.append(item("normal-input", type="userMessage", content=content))
    assert reader.read(rpc, TARGET, INFO).forms == []
    assert Questions().read(rpc, TARGET, INFO).forms == []
    rpc.records.append(ask("new-question"))
    assert [form.id for form in reader.read(rpc, TARGET, INFO).forms] == ["new-question"]
    assert [form.id for form in Questions().read(rpc, TARGET, INFO).forms] == ["new-question"]


def test_question_caches_and_native_item_ids_are_scoped_to_selected_connection():
    reader = Questions()
    rpc = Rpc([ask()])
    assert reader.read(rpc, TARGET, INFO).forms
    reader.dismiss(TARGET, "call-question")
    assert reader.read(rpc, TARGET, INFO).forms == []
    other = Target("other", "codex", "Codex", "thread-a", "Other", {"socket": "/other.sock"})
    assert reader.read(rpc, other, INFO).forms
    # Repeated ordinary IDs in different turns must not collide with the event cursor.
    rpc.records += [{"turnId": "turn-b", "item": {"id": "call-question", "type": "userMessage",
                                                 "content": [{"type": "text", "text": "Continue"}]}}]
    assert reader.read(rpc, TARGET, INFO).forms == []


def test_async_answer_uses_native_steering_and_dismissal_sends_no_chat(monkeypatch):
    rpc = Rpc([ask()])
    provider = codex.Codex()

    @contextlib.contextmanager
    def connection(_target):
        yield rpc

    monkeypatch.setattr(codex, "connection", connection)
    sent = []
    monkeypatch.setattr(provider, "send",
                        lambda selected, message: sent.append((selected, message)) or "steered")
    assert provider.capabilities.questions
    assert provider.answer(TARGET, "call-question", {"0": "My custom choice"}) == "applied"
    assert sent[0][0] == TARGET
    assert sent[0][1].delivery == "steer" and sent[0][1].text == "Choose a path?\nMy custom choice"
    assert "send_user_message_question_reply" not in sent[0][1].text
    with pytest.raises(NoLongerPending):
        provider.answer(TARGET, "call-question", {"0": "One"})
    rpc.records.append(ask("call-next"))
    assert provider.answer(TARGET, "call-next", {}, cancel=True) == "applied"
    assert len(sent) == 1


def test_native_answer_already_observed_rejects_dispatch_and_blocking_requests_remain_native(monkeypatch):
    provider, rpc = codex.Codex(), Rpc([ask(), answer("call-question")])

    @contextlib.contextmanager
    def connection(_target):
        yield rpc

    monkeypatch.setattr(codex, "connection", connection)
    with pytest.raises(NoLongerPending):
        provider.answer(TARGET, "call-question", {"0": "Two"})
    forms = provider.questions.read(rpc, TARGET, INFO | {
        "status": {"type": "active", "activeFlags": ["waitingOnUserInput"]}})
    assert forms.forms == [] and "native Codex client" in forms.unavailable
    with pytest.raises(DeliveryRejected):
        provider.answer(TARGET, "call-question", {}, decline=True)
