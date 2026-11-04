"""Ordinary form elicitations owned by one live ACP SDK connection."""

import asyncio
import uuid

from .commands import Choice
from .forms import FormField, Forms, QuestionForm
from .models import DeliveryRejected, NoLongerPending, fields, text


def choices(schema):
    variants = [key for key in ("enum", "oneOf", "anyOf") if key in schema]
    if len(variants) > 1:
        raise ValueError("Ambiguous native enum")
    if not variants:
        return []
    values = schema[variants[0]]
    if type(values) is not list or not 1 <= len(values) <= 200:
        raise ValueError("Invalid native enum")
    if variants[0] == "enum":
        result = [Choice(choice_value(value), value or "Empty value") for value in values]
    else:
        result = []
        for value in values:
            fields(value, ("const", "title"), ("description", "_meta"))
            result.append(
                Choice(choice_value(value["const"]), text(value["title"], "native choice label", 16384))
            )
    if len({choice.value for choice in result}) != len(result):
        raise ValueError("Duplicate native enum value")
    return result


def choice_value(value):
    if type(value) is not str or len(value) > 16384 or "\0" in value:
        raise ValueError("Invalid native choice")
    return value


def question(identifier, message, schema):
    fields(schema, ("type", "properties"), ("required", "title", "description", "_meta"))
    properties, required = schema["properties"], schema.get("required", [])
    if (
        schema["type"] != "object"
        or type(properties) is not dict
        or not 1 <= len(properties) <= 50
        or type(required) is not list
        or any(type(key) is not str or key not in properties for key in required)
        or len(set(required)) != len(required)
    ):
        raise ValueError("Invalid native form schema")
    result = []
    constraints = (
        "minimum",
        "maximum",
        "minLength",
        "maxLength",
        "minItems",
        "maxItems",
        "pattern",
        "format",
    )
    for key, value in properties.items():
        text(key, "question key", 200)
        fields(
            value,
            ("type",),
            ("title", "description", "default", "enum", "oneOf", "items", "_meta", *constraints),
        )
        kind = value["type"]
        if kind not in ("string", "integer", "number", "boolean", "array"):
            raise ValueError("Unsupported native form property")
        if value.get("format") == "password":
            raise ValueError("Secrets cannot use form elicitation")
        options = choices(value)
        if kind == "array":
            item = value.get("items")
            fields(item, (), ("type", "enum", "anyOf", "_meta"))
            if item.get("type", "string") != "string":
                raise ValueError("Unsupported native multiselect")
            options = choices(item)
            if not options:
                raise ValueError("Native multiselect requires choices")
            kind = "multiselect"
        if options and kind not in ("string", "multiselect"):
            raise ValueError("Unsupported native enum type")
        field = FormField(
            key,
            value.get("title", key),
            kind,
            key in required,
            options,
            default=value.get("default"),
            description=value.get("description", ""),
            constraints={key: value[key] for key in constraints if key in value},
        )
        if type(field.label) is not str or type(field.description) is not str:
            raise ValueError("Invalid native form label")
        if field.default is not None:
            field.validate(field.default)
        result.append(field)
    return QuestionForm(identifier, text(message, "native question"), result, can_decline=True)


class Questions:
    def __init__(self):
        self.ready = False
        self.pending = {}

    async def ask(self, message, schema):
        if not self.ready or len(self.pending) >= 16:
            return {"action": "decline"}
        identifier = "acp:" + uuid.uuid4().hex
        form = question(identifier, message, schema)
        answer = asyncio.get_running_loop().create_future()
        # This handle belongs to the exact SDK callback, not a guessed native RPC id.
        self.pending[identifier] = form, answer
        try:
            return await answer
        finally:
            self.pending.pop(identifier, None)

    def forms(self):
        return Forms([form for form, answer in self.pending.values() if not answer.done()])

    def answer(self, identifier, answer, cancel=False, decline=False):
        pending = self.pending.get(identifier)
        if pending is None or pending[1].done():
            raise NoLongerPending("Native callback is no longer pending")
        form, future = pending
        if (
            type(cancel) is not bool
            or type(decline) is not bool
            or cancel
            and decline
            or (cancel or decline)
            and answer
        ):
            raise DeliveryRejected("Invalid native question action")
        if not cancel and not decline:
            form.validate(answer)
        future.set_result(
            {
                "action": "cancel" if cancel else "decline" if decline else "accept",
                **({"content": answer} if not cancel and not decline else {}),
            }
        )
        return "applied"

    def cancel_all(self):
        for _, answer in self.pending.values():
            if not answer.done():
                answer.set_result({"action": "cancel"})
