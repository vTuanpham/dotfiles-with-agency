import asyncio
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from test_acp_lifecycle import fake_target, wait_until

from agent_inbox import acp, acp_runtime, adapters
from agent_inbox.acp_questions import Questions, question
from agent_inbox.models import DeliveryRejected, NoLongerPending
from agent_inbox.server import App
from agent_inbox.store import Store

SCHEMA = {
    "type": "object",
    "properties": {
        "choice": {"type": "string", "enum": ["", "focused", "full"]},
        "confirm": {"type": "boolean"},
        "tags": {
            "type": "array",
            "items": {
                "anyOf": [
                    {"const": "native-a", "title": "Same label"},
                    {"const": "native-b", "title": "Same label"},
                ]
            },
        },
    },
    "required": ["choice", "confirm"],
}


@pytest.mark.parametrize("action", ["accept", "decline", "cancel"])
def test_owned_callback_receives_exact_native_action_and_values_once(action):
    async def check():
        requests = Questions()
        requests.ready = True
        callback = asyncio.create_task(requests.ask("Choose a scope", SCHEMA))
        await asyncio.sleep(0)
        form = requests.forms().forms[0]
        assert form.can_decline and form.fields[0].default is None
        answer = {"choice": "", "confirm": False, "tags": ["native-b"]} if action == "accept" else {}
        assert requests.answer(form.id, answer, action == "cancel", action == "decline") == "applied"
        assert requests.forms().forms == []
        with pytest.raises(NoLongerPending):
            requests.answer(form.id, answer)
        result = await callback
        assert result == {"action": action, **({"content": answer} if action == "accept" else {})}
        assert requests.pending == {}

    asyncio.run(check())


def test_callback_cancellation_and_connection_shutdown_remove_authority():
    async def check():
        one, other = Questions(), Questions()
        one.ready = other.ready = True
        callback = asyncio.create_task(one.ask("Choose", SCHEMA))
        await asyncio.sleep(0)
        identifier = one.forms().forms[0].id
        with pytest.raises(NoLongerPending):
            other.answer(identifier, {"choice": "full", "confirm": True})
        callback.cancel()
        with pytest.raises(asyncio.CancelledError):
            await callback
        with pytest.raises(NoLongerPending):
            one.answer(identifier, {})
        second = asyncio.create_task(one.ask("Choose again", SCHEMA))
        await asyncio.sleep(0)
        assert one.forms().forms[0].id != identifier
        one.cancel_all()
        assert await second == {"action": "cancel"}
        assert one.forms().forms == []

    asyncio.run(check())


def test_schema_and_answer_boundaries_do_not_coerce_or_invent_native_values():
    form = question("owned", "Choose", SCHEMA)
    assert [choice.value for choice in form.fields[2].choices] == ["native-a", "native-b"]
    for answer in (
        {"choice": True, "confirm": False},
        {"choice": "guessed", "confirm": False},
        {"choice": "full"},
        {"choice": "full", "confirm": False, "extra": "ignored"},
    ):
        with pytest.raises(DeliveryRejected):
            form.validate(answer)
    for schema in (
        {"type": "object", "properties": {"secret": {"type": "string", "format": "password"}}},
        {"type": "object", "properties": {"nested": {"type": "object"}}},
    ):
        with pytest.raises(ValueError):
            question("owned", "Choose", schema)


def test_sdk_callback_declines_unsupported_modes_and_rejects_other_sessions():
    from acp.exceptions import RequestError
    from acp.schema import ElicitationFormSessionMode, ElicitationSchema, ElicitationUrlSessionMode

    async def check():
        client = acp_runtime._Client("owned")
        form = ElicitationFormSessionMode(
            session_id="other", requested_schema=ElicitationSchema.model_validate(SCHEMA)
        )
        with pytest.raises(ValueError, match="another session"):
            await client.create_elicitation("Choose", form)
        url = ElicitationUrlSessionMode(
            session_id="owned", elicitation_id="external", url="https://example.com/"
        )
        with pytest.raises(RequestError) as unsupported:
            await client.create_elicitation("Open", url)
        assert unsupported.value.code == -32602
        form.session_id = "owned"
        assert await client.create_elicitation("Choose", form) == {"action": "decline"}
        assert client.questions.forms().forms == []

    asyncio.run(check())


def test_real_connection_shutdown_expires_callback_before_reconnection():
    selected = fake_target()
    pool = acp_runtime.RuntimePool()
    provider = acp.ACP(pool)
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            turn = executor.submit(pool.call, selected, "send", [{"type": "text", "text": "ask question"}])
            try:
                wait_until(lambda: provider.forms(selected).forms)
                identifier = provider.forms(selected).forms[0].id
                pool.close()
                assert turn.result(timeout=5) == "cancelled"
                pool = acp_runtime.RuntimePool()
                provider = acp.ACP(pool)
                assert provider.forms(selected).forms == []
                with pytest.raises(NoLongerPending):
                    provider.answer(selected, identifier, {"choice": "focused", "confirm": False})
            finally:
                if not turn.done():
                    pool.close()
    finally:
        pool.close()


def test_decline_receipt_survives_restart_and_claims_the_callback_once(tmp_path, monkeypatch):
    selected = fake_target()
    pool = acp_runtime.RuntimePool()
    provider = acp.ACP(pool)
    monkeypatch.setitem(adapters.ADAPTERS, "acp", provider)
    store = Store(tmp_path)
    store.register(selected)
    app = App(store)
    app.catalog.checked = time.monotonic()
    app.catalog.live = {selected.id: selected}
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            turn = executor.submit(pool.call, selected, "send", [{"type": "text", "text": "ask question"}])
            try:
                wait_until(lambda: provider.forms(selected).forms)
                form = provider.forms(selected).forms[0]
                payload = {
                    "id": str(uuid.uuid4()),
                    "target": selected.id,
                    "form": form.id,
                    "answer": {},
                    "decline": True,
                }
                assert app.answer(payload)["status"] == "applied"
                assert turn.result(timeout=5) == "end_turn"
                restarted = App(Store(tmp_path))
                assert restarted.answer(payload)["status"] == "applied"
                assert restarted.answer({**payload, "id": str(uuid.uuid4())})["status"] == "already_answered"
                with pytest.raises(ValueError):
                    restarted.answer({**payload, "decline": False, "cancel": True})
            finally:
                if not turn.done():
                    pool.close()
    finally:
        pool.close()
