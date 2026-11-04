import json
import uuid
from dataclasses import asdict

import pytest
from claude_agent_sdk import get_session_messages, project_key_for_directory

from agent_inbox import claude_history, claude_transcript


@pytest.fixture
def transcript(tmp_path, monkeypatch):
    identifier, directory = str(uuid.uuid4()), str(tmp_path / "workspace")
    config = tmp_path / "profile"
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(config))
    path = config / "projects" / project_key_for_directory(directory) / (identifier + ".jsonl")
    path.parent.mkdir(parents=True)
    return identifier, directory, path


def entry(identifier, key, parent, kind="assistant", content=None, **extra):
    return {
        "type": kind,
        "uuid": key,
        "parentUuid": parent,
        "sessionId": identifier,
        "message": {
            "id": "response-" + key,
            "role": kind,
            "content": content or [{"type": "text", "text": "Reply " + key}],
        },
        **extra,
    }


def write(path, rows):
    with path.open("w") as stream:
        for row in rows:
            stream.write(json.dumps(row) + "\n")


def test_large_archived_tool_output_does_not_hide_current_chat_and_matches_sdk(transcript):
    identifier, directory, path = transcript
    rows = [entry(identifier, "start", None, "user")]
    for index in range(20):
        rows.append(
            {
                "type": "progress",
                "uuid": f"progress-{index}",
                "parentUuid": "start",
                "data": {"output": "ordinary tool output " * 50000},
            }
        )
    rows += [
        entry(identifier, "summary", None, "user", isCompactSummary=True),
        entry(identifier, "current", "summary"),
    ]
    write(path, rows)
    assert path.stat().st_size > 16 * 1024 * 1024
    expected = [asdict(message) for message in get_session_messages(identifier, directory=directory)]
    actual = claude_transcript.page(identifier, directory)
    assert actual["messages"] == expected
    assert [message["uuid"] for message in actual["messages"]] == ["summary", "current"]
    assert len(json.dumps(actual)) < 2000


def test_parallel_tools_and_sidechains_keep_sdk_identity_and_order(transcript):
    identifier, directory, path = transcript

    def call(key):
        return [{"type": "tool_use", "id": key, "name": "Read", "input": {"path": key}}]

    def result(key):
        return [{"type": "tool_result", "tool_use_id": key, "content": "output " + key}]

    rows = [
        entry(identifier, "u", None, "user"),
        entry(identifier, "a1", "u", content=call("t1")),
        entry(identifier, "a2", "a1", content=call("t2")),
        entry(identifier, "r1", "a1", "user", result("t1")),
        entry(identifier, "r2", "a2", "user", result("t2")),
        entry(identifier, "final", "r1"),
        entry(identifier, "side", "u", isSidechain=True),
    ]
    rows[1]["message"]["id"] = rows[2]["message"]["id"] = "parallel-response"
    write(path, rows)
    expected = [asdict(message) for message in get_session_messages(identifier, directory=directory)]
    actual = claude_transcript.page(identifier, directory)
    assert [message["uuid"] for message in actual["messages"]] == [message["uuid"] for message in expected]
    assert {message["uuid"] for message in actual["messages"]} == {"u", "a1", "a2", "r2", "r1", "final"}
    assert claude_history.decode(actual["messages"], identifier) == claude_history.decode(
        expected, identifier
    )


def test_large_current_tool_results_do_not_expand_the_wire_page(transcript):
    identifier, directory, path = transcript
    rows = [entry(identifier, "start", None, "user")]
    for index in range(25):
        rows.append(
            entry(
                identifier,
                str(index),
                str(index - 1) if index else "start",
                "user",
                [{"type": "tool_result", "tool_use_id": "tool", "content": "private tool output " * 50000}],
            )
        )
    rows.append(entry(identifier, "reply", "24"))
    write(path, rows)
    assert path.stat().st_size > 16 * 1024 * 1024
    result = claude_transcript.page(identifier, directory)
    wire = json.dumps(result)
    assert len(wire) < 16384 and "private tool output" not in wire
    messages, _, _ = claude_history.decode(result["messages"], identifier)
    assert [message.id for message in messages] == ["claude:start", "claude:reply"]


def test_pages_catch_up_partial_append_and_rewritten_anchor(transcript):
    identifier, directory, path = transcript
    rows = [entry(identifier, str(index), str(index - 1) if index else None) for index in range(220)]
    write(path, rows)
    first = claude_transcript.page(identifier, directory)
    assert len(first["messages"]) == 100 and first["messages"][0]["uuid"] == "120"
    older = claude_transcript.page(identifier, directory, first["older"])
    assert older["messages"][0]["uuid"] == "20" and older["messages"][-1]["uuid"] == "119"
    rows.append(entry(identifier, "220", "219"))
    write(path, rows)
    with path.open("ab") as stream:
        stream.write(b'{"unfinished":')
    forward = claude_transcript.page(identifier, directory, since=first["newer"])
    assert [message["uuid"] for message in forward["messages"]] == ["219", "220"]
    rows[219]["uuid"] = "rewritten"
    write(path, rows)
    with pytest.raises(ValueError, match="history changed"):
        claude_transcript.page(identifier, directory, since=first["newer"])


def test_profile_path_ambiguity_and_record_budget_fail_closed(transcript, monkeypatch):
    identifier, directory, path = transcript
    write(path, [entry(identifier, "m", None)])
    monkeypatch.setattr(claude_transcript, "LINE_LIMIT", 100)
    with pytest.raises(ValueError, match="record exceeds"):
        claude_transcript.page(identifier, directory)
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(path.parents[2] / "other-profile"))
    with pytest.raises(ValueError, match="missing or ambiguous"):
        claude_transcript.page(identifier, directory)
