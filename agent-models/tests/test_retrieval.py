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


@pytest.mark.parametrize(
    "task",
    [
        "Rewrite API documentation; do not implement code.",
        "Improve CSS typography; do not change backend APIs.",
        "Records vanish when two writers save at the same time.",
        "Calculate the deductible amount for a quarterly filing.",
    ],
)
def test_task_words_do_not_silently_establish_evidence_scope(task):
    result = queries.resolve(task=task)
    assert result["domains"] == ["overall"] and result["method"] == "overall reference"
    assert "--domain" in result["note"]


def test_caller_scope_preserves_order_and_ignores_negated_task_vocabulary():
    result = queries.resolve(["writing", "documents", "writing"], "Do not refactor backend API code")
    assert result == {"domains": ["writing", "documents"], "method": "explicit domains"}
