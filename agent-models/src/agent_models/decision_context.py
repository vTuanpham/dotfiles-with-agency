"""Ephemeral caller facts and exact admission restrictions; never model preferences."""

from pathlib import Path

from . import coverage

BACKENDS = ("codex", "claude", "agy", "opencode")
MAX_BYTES = 65_536
HELP = """--context PATH|- reads an optional JSON object (stdin with -):
  allowed_backends: ["codex", "claude", "agy", "opencode"]
  allowed_routes: {"codex": ["gpt-6-luna"]}
  allowed_efforts: {"codex": {"gpt-6-luna": ["low", "medium"]}}
  accounts: {"claude": {"plan": "...", "allowance": "scarce", "billing": "...",
                        "entitlement": "...", "note": "..."}}
  task: {"scope": "...", "deadline": "...", "verification": "...",
         "failure_cost": "...", "details": "..."}
  session: {"backend": "codex", "model": "...", "context": "...", "switching_cost": "..."}
  priorities: ["..."]
All fields are optional caller observations, not saved. allowed_backends is a
closed restriction when supplied (including []); allowed_routes restricts only
listed backends. Route/alias admission is exact, never fuzzy. Missing route keys
mean entitlement unknown, not permission to spend. Effort restrictions intersect
native controls. Plan names, scarcity and deadlines do not infer model access,
quality or speed. Use allowed_routes/backends to express actual account limits.
Task/session/account prose informs the selecting agent; it does not rank models.
"""


def strings(value):
    if type(value) is not list or any(type(v) is not str or not v.strip() for v in value):
        raise ValueError("context requires arrays of nonempty strings")
    if len(value) > 512 or len(set(value)) != len(value):
        raise ValueError("context array too large or duplicated")


def fields(value, permitted):
    if type(value) is not dict or set(value) - set(permitted):
        raise ValueError("unknown or invalid context fields")
    if any(type(v) is not str or not v.strip() or len(v) > 4096 for v in value.values()):
        raise ValueError("context descriptions require nonempty strings of at most 4096 characters")


def validate(value):
    if type(value) is not dict or set(value) - {
            "allowed_backends", "allowed_routes", "allowed_efforts", "accounts", "task", "session",
            "priorities"}:
        raise ValueError("unknown or invalid decision context; see suggest --help")
    if "allowed_backends" in value:
        strings(value["allowed_backends"])
        if set(value["allowed_backends"]) - set(BACKENDS):
            raise ValueError("unknown context backend")
    for key in ("allowed_routes", "allowed_efforts", "accounts"):
        if key not in value:
            continue
        mapping = value[key]
        if type(mapping) is not dict or set(mapping) - set(BACKENDS):
            raise ValueError("invalid context backend mapping")
        for item in mapping.values():
            if key == "allowed_routes":
                strings(item)
            elif key == "accounts":
                fields(item, ("plan", "allowance", "billing", "entitlement", "note"))
            else:
                if type(item) is not dict or any(type(k) is not str or not k.strip() for k in item):
                    raise ValueError("invalid context effort mapping")
                for efforts in item.values():
                    strings(efforts)
    for key, permitted in (("task", ("scope", "deadline", "verification", "failure_cost", "details")),
                           ("session", ("backend", "model", "context", "switching_cost"))):
        if key in value:
            fields(value[key], permitted)
    if "session" in value and value["session"].get("backend", "codex") not in BACKENDS:
        raise ValueError("unknown context session backend")
    if "priorities" in value:
        strings(value["priorities"])
    return value


def read(path, stdin):
    from agent_accounts.models import loads

    if path is None:
        return {}
    if path == "-":
        raw = stdin.read(MAX_BYTES + 1)
    else:
        with Path(path).open() as stream:
            raw = stream.read(MAX_BYTES + 1)
    if len(raw.encode()) > MAX_BYTES:
        raise ValueError("decision context exceeds 64 KiB")
    return validate(loads(raw))


def exact(model, name):
    return name in (model["id"], *model.get("aliases", []))


def bound(model, name, backend):
    return exact(model, name) or (backend != "opencode" and name == model["model"])


def admit(model, backend, context):
    routes = context.get("allowed_routes", {})
    if backend in routes and not any(bound(model, v, backend) for v in routes[backend]):
        return None
    controls = model["efforts"]
    restrictions = context.get("allowed_efforts", {}).get(backend, {})
    matched = [levels for name, levels in restrictions.items() if bound(model, name, backend)]
    if matched:
        controls = ([v for v in controls if all(v in levels for levels in matched)]
                    if controls is not None else None)
    return {**model, "efforts": controls,
            "admission": "caller allowed" if backend in routes else "conditional: entitlement unknown",
            "effort_restriction": matched, "native_efforts": model.get("native_efforts", model["efforts"])}


def restrict(catalog, context, preferred=None):
    models = coverage.canonical_catalog(catalog, preferred)["models"]
    admitted = [admit(model, catalog["backend"], context) for model in models]
    return {**catalog, "models": [model for model in admitted if model is not None],
            "excluded_by_context": sum(model is None for model in admitted),
            "choice_excluded_by_context": bool(preferred and any(
                bound(model, preferred, catalog["backend"]) and result is None
                for model, result in zip(models, admitted)))}
