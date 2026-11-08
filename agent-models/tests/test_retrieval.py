import pytest

from agent_models import queries, retrieval


def test_policy_lookup_keeps_plan_numbers_separate():
    paragraphs = [
        "Pro 100 provides a monthly allowance.",
        "Pro 200 provides an expanded allowance.",
        "This document describes endpoint authentication.",
    ]
    assert retrieval.lexical_rank("Pro 200 allowance", paragraphs)[0] == 1
    assert retrieval.lexical_rank("weekly quota", ["Available on desktop."]) == []


@pytest.mark.parametrize("task,expected,excluded", [
    ("Rewrite API documentation; do not implement code.", {"writing", "documents"}, {"coding"}),
    ("Improve CSS typography; do not change backend APIs.", {"design"}, {"backend"}),
    ("Records vanish when two writers save at the same time.", {"debugging"}, {"writing"}),
    ("Calculate the deductible amount for a quarterly filing.", {"tax"}, set()),
    ("Debug a concurrency bug in a large codebase, and write tests.",
     {"debugging", "coding", "long-context"}, set()),
    ("Build and visually inspect a responsive web interface in a browser.",
     {"design", "browser", "coding"}, set()),
    ("Find why the deployment keeps failing", {"debugging"}, set()),
    ("Investigate why the native session cannot be messaged mid turn", set(), {"finance"}),
    ("Make the service save drafts automatically", set(), {"writing"}),
    ("Do not touch the UI, instead fix the database concurrency error", {"backend", "debugging"}, {"design"}),
    ("Research recent regulatory changes and write a cited report", {"research", "legal", "writing"}, set()),
])
def test_task_routing_retrieves_relevant_areas_and_ignores_negative_clauses(
        task, expected, excluded, monkeypatch):
    from agent_models import semantic

    monkeypatch.setattr(semantic, "domains", lambda task, **kwargs: [])
    result = queries.resolve(task=task)
    assert expected <= set(result["domains"])
    assert not excluded.intersection(result["domains"])
    if expected:
        assert result["method"] == "task cues" and "inferred" in result["note"]


def test_unclear_task_falls_back_to_general_evidence(monkeypatch):
    from agent_models import semantic

    monkeypatch.setattr(semantic, "domains", lambda task, **kwargs: [])
    result = queries.resolve(task="Make this better")
    assert result["domains"] == ["overall"] and "No clear" in result["note"]


def test_semantic_supplements_regex_and_respects_exclusions(monkeypatch):
    from agent_models import semantic

    calls = []
    monkeypatch.setattr(semantic, "domains", lambda task, **kw: calls.append((task, kw)) or ["performance"])
    assert queries.resolve(task="the app takes ages to open; do not edit code")["domains"] == ["performance"]
    assert calls == [("the app takes ages to open", {"download": True})]
    assert queries.resolve(task="debug a crash")["domains"] == ["debugging", "performance"]
    assert calls[-1][1] == {"download": False}
    assert queries.resolve()["domains"] == ["overall"]
    assert len(calls) == 2


def test_unavailable_semantic_model_degrades_to_general_evidence(monkeypatch):
    from agent_models import semantic

    def unavailable(task, **kwargs):
        raise OSError("offline")

    monkeypatch.setattr(semantic, "domains", unavailable)
    assert queries.resolve(task="the app takes ages to open")["domains"] == ["overall"]


def test_caller_scope_preserves_order_and_ignores_negated_task_vocabulary():
    result = queries.resolve(["writing", "documents", "writing"], "Do not refactor backend API code")
    assert result == {"domains": ["writing", "documents"], "method": "explicit domains"}
