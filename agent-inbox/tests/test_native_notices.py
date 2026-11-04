from agent_inbox import acp_history, claude_history, codex_history, opencode_history
from agent_inbox.models import Snapshot
from agent_inbox.presentation import render_snapshot

TASK = (
    "<task-notification><task-id>task-a</task-id><tool-use-id>tool-a</tool-use-id>"
    "<output-file>/tmp/native-private-task.output</output-file><status>completed</status>"
    '<summary>Background check "Run validation" completed (exit code 0)</summary>'
    "<result>Use &lt;button&gt; &amp; keep `x &lt; 2`.</result></task-notification>"
)


def row(body, **metadata):
    return {
        "type": "user",
        "uuid": "native-a",
        "session_id": "session-a",
        "message": {"content": body},
        **metadata,
    }


def test_claude_native_task_and_peer_provenance_is_display_only():
    messages, activity, timeline = claude_history.decode(
        [
            row(TASK, origin={"kind": "task-notification"}),
        ],
        "session-a",
    )
    notice = messages[0]
    assert notice.role == "system" and notice.label == "Background task · completed"
    assert "Run validation" in notice.text and "<button> & keep `x < 2`." in notice.text
    assert "output-file" not in notice.text and "native-private" not in notice.text
    assert "task-a" not in notice.text and "tool-a" not in notice.text
    assert activity == [] and timeline == [notice.id]
    rendered = render_snapshot(Snapshot("idle", False, messages))["messages"][0]
    assert "<button>" not in rendered["html"] and "&lt;button&gt;" in rendered["html"]
    peer, _, _ = claude_history.decode(
        [
            row(
                '<teammate-message sender="untrusted">wrapper</teammate-message>',
                origin={"kind": "peer", "name": "Reviewer", "body": "Use the native decoded body"},
            ),
        ],
        "session-a",
    )
    assert peer[0].label == "Peer message · Reviewer"
    assert peer[0].text == "Use the native decoded body"
    assert peer[0].answers is None


def test_human_and_assistant_markup_are_never_blanket_stripped():
    for kind in ("user", "assistant"):
        message = row(TASK, origin={"kind": "human"})
        message["type"] = kind
        messages, _, _ = claude_history.decode([message], "session-a")
        assert messages[0].text == TASK and messages[0].role == kind
    code = "Example:\n```xml\n<task-notification>literal</task-notification>\n```"
    assert claude_history.decode([row(code)], "session-a")[0][0].text == code
    malformed = row(
        "<task-notification><output-file>/tmp/private</output-file>", origin={"kind": "task-notification"}
    )
    # Even an incomplete native envelope must not become a human message or an answer.
    assert claude_history.decode([malformed], "session-a")[0][0].role == "system"


def test_opencode_synthetic_and_compaction_records_use_native_type_and_metadata():
    records = [
        {"id": "user", "type": "user", "text": TASK},
        {
            "id": "report",
            "type": "synthetic",
            "text": '<subagent id="a">Finished the check.</subagent>',
            "metadata": {"source": "subagent"},
        },
        {"id": "context", "type": "system", "text": "Native context update"},
        {"id": "compact", "type": "compaction", "status": "completed", "summary": "Retained context"},
    ]
    messages, _, timeline = opencode_history.projection(records)
    assert messages[0].role == "user" and messages[0].text == TASK
    assert messages[1].role == "system" and messages[1].text == "Finished the check."
    assert messages[1].label == "Subagent report" and messages[1].answers is None
    assert messages[-1].label == "Context compaction"
    assert timeline == ["user", "report", "context", "compact"]


def test_codex_native_events_and_acp_literal_text_stay_in_their_own_protocol():
    page = codex_history.decode_page(
        {
            "data": [
                {"turnId": "turn", "item": {"id": "compact", "type": "contextCompaction"}},
                {"turnId": "turn", "item": {"id": "hook", "type": "hookPrompt", "fragments": []}},
                {"turnId": "turn", "item": {"id": "agent", "type": "subAgentActivity", "kind": "completed"}},
                {
                    "turnId": "turn",
                    "item": {
                        "id": "literal",
                        "type": "userMessage",
                        "content": [{"type": "text", "text": TASK}],
                    },
                },
            ],
            "nextCursor": None,
            "backwardsCursor": None,
        },
        descending=False,
    )
    assert page.messages[0].text == TASK
    assert [event.label for event in page.activity] == [
        "Context compaction",
        "Hook context",
        "Subagent activity · completed",
    ]
    assert page.timeline == [
        "activity:turn:compact",
        "activity:turn:hook",
        "activity:turn:agent",
        "turn:literal",
    ]
    history = acp_history.History("root")
    history.update(
        {
            "sessionId": "root",
            "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": TASK}},
        }
    )
    assert history.page()[0][0].text == TASK
