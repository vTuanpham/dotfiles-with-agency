import json
from copy import deepcopy
from types import SimpleNamespace

import pytest

from agent_inbox import bridge, origin
from agent_inbox.models import DeliveryRejected, Outgoing, Target


def inventory(root="claude", worker="codex"):
    return {"schema_version": 1, "owners": [{"id": "team", "root_backend": root,
                                             "root_session_id": "parent"}],
            "jobs": [{"id": "team/review", "owner": "team", "name": "review", "title": "Review",
                      "backend": worker, "running": True, "awaiting_root": False,
                      "retired_at": None, "state": "working", "reason": "Worker is running"}],
            "events": [{"id": "review:1", "job": "team/review", "kind": "message", "text": "Report"},
                       {"id": "review:2", "job": "team/review", "kind": "tool", "text": "hidden tool"}]}


def bindings(worker="codex"):
    return {(worker, "child"): {"job": "team/review", "title": "Review",
                                "tool": "Agent Bridge", "parent": ("claude", "parent")}}


def provider(monkeypatch, root="claude", worker="codex"):
    adapter = bridge.Bridge()
    value = bridge.decode(inventory(root, worker))
    monkeypatch.setattr(adapter, "inventory", lambda fresh=False: value)
    return adapter, value


@pytest.mark.parametrize("root", list(origin.BACKENDS))
@pytest.mark.parametrize("worker", list(origin.BACKENDS))
def test_private_workers_are_discovered_for_every_connected_root_harness(monkeypatch, root, worker):
    adapter, _ = provider(monkeypatch, root, worker)
    parent = Target("p", "acp" if root == "agy" else root, origin.BACKENDS[root], "parent", "Root",
                    {"bridge_backend": "agy"} if root == "agy" else {})
    [(target, row)] = adapter.targets({"p": parent}, bindings(worker))
    assert target.harness == origin.BACKENDS[worker] and target.settings["parent"] == {
        "backend": root, "session_id": "parent"}
    assert row["status"] == "active" and not row["saved"]
    assert row["capabilities"]["mid_turn_steering"] == (worker != "agy")
    view = adapter.snapshot(target)
    assert [m.text for m in view.messages] == ["Report"] and view.can_send
    assert adapter.targets({}, bindings(worker)) == []
    assert adapter.targets({"p": parent, "duplicate": parent}, bindings(worker)) == []
    assert adapter.targets({"p": parent, "w": target}, bindings(worker)) == []
    if worker == "agy":
        with pytest.raises(DeliveryRejected, match="mid-turn"):
            adapter.send(target, Outgoing("request", "Continue", [], "steer"))


def test_catalog_adds_worker_and_exact_parent_origin(monkeypatch, tmp_path):
    from agent_inbox import adapters, catalog
    from agent_inbox.models import RootInfo
    from agent_inbox.store import Store

    parent = Target("parent-root", "fixture", "Claude", "parent", "Root", {"bridge_backend": "claude"})
    store = Store(tmp_path / "inbox")
    store.register(parent)
    native = SimpleNamespace(capabilities=bridge.Bridge.capabilities,
                             discover=lambda seed: [RootInfo("parent", "Root", "active")])
    workers, _ = provider(monkeypatch)
    monkeypatch.setitem(adapters.ADAPTERS, "fixture", native)
    monkeypatch.setitem(adapters.ADAPTERS, "bridge", workers)
    monkeypatch.setattr(catalog, "read", bindings)
    found = catalog.Catalog(store)
    rows = found.listing()["roots"]
    row = next(row for row in rows if row["id"] != "parent-root")
    assert row["origin"]["parent"]["id"] == "parent-root" and row["origin"]["job"] == "team/review"
    assert found.target(row["id"]).adapter == "bridge"


def test_steering_revalidates_native_worker_and_current_root_and_uses_no_ui(monkeypatch):
    adapter, value = provider(monkeypatch)
    parent = Target("p", "claude", "Claude", "parent", "Root", {})
    [(target, _)] = adapter.targets({"p": parent}, bindings())
    monkeypatch.setattr(origin, "read", bindings)
    monkeypatch.setattr(origin, "command", lambda: "/bin/agent-bridge")
    monkeypatch.setenv("CODEX_THREAD_ID", "inherited-wrong-root")
    monkeypatch.delenv("AGENT_BRIDGE_JOB", raising=False)
    calls = []

    def run(args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(bridge.subprocess, "run", run)
    assert adapter.send(target, Outgoing("request", "Continue", [], "steer")) == "forwarded"
    args, params = calls[0]
    assert args == ["/bin/agent-bridge", "steer", "team/review", "--prompt-file", "-"]
    assert params["input"] == b"Continue"
    assert bridge.agent_session.native(params["env"]) == ("claude", "parent")
    value[1]["team"] = ("opencode", "different")
    with pytest.raises(DeliveryRejected):
        adapter.send(target, Outgoing("second", "Continue", []))
    assert len(calls) == 1


def test_native_identity_changes_and_worker_role_never_dispatch(monkeypatch):
    adapter, _ = provider(monkeypatch)
    parent = Target("p", "claude", "Claude", "parent", "Root", {})
    [(target, _)] = adapter.targets({"p": parent}, bindings())
    monkeypatch.setattr(origin, "read", lambda: {})
    with pytest.raises(DeliveryRejected):
        adapter.send(target, Outgoing("request", "Continue", []))
    monkeypatch.setattr(origin, "read", bindings)
    monkeypatch.setenv("AGENT_BRIDGE_JOB", "other/worker")
    with pytest.raises(DeliveryRejected):
        adapter.send(target, Outgoing("request", "Continue", []))


def test_status_boundary_rejects_ambiguous_or_malformed_rows():
    for change in (lambda value: value.update(schema_version=True),
                   lambda value: value["jobs"].append(deepcopy(value["jobs"][0])),
                   lambda value: value["jobs"][0].update(id="../escape"),
                   lambda value: value["events"][0].update(text=None)):
        value = inventory()
        change(value)
        with pytest.raises(ValueError):
            bridge.decode(json.loads(json.dumps(value)))
