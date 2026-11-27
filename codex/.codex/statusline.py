# SPDX-License-Identifier: Apache-2.0
"""Orbit, adapted from the OpenAI Codex create-statusline Python starter."""

import json
import sys
from pathlib import PurePath

URI = "ui://orbit-statusline/footer"
TOOL = {
    "name": "statusline",
    "title": "Orbit",
    "description": "Show model, workspace, context and allowance in the Codex footer.",
    "inputSchema": {"type": "object", "properties": {}},
    "_meta": {
        "openai/ui": {"entrypoints": [{"type": "statusline", "resourceUri": URI}]}
    },
}

AGENT_STATES = {
    "starting": ("◌ Starting", "status-state"),
    "ready": ("○ Ready", "status-state"),
    "working": ("✦ Working", "accent"),
    "waiting": ("◇ Waiting", "yellow"),
    "thinking": ("◐ Thinking", "magenta"),
}


def label(value, limit):
    printable = "".join(char for char in value if char.isprintable()).strip()
    return printable if len(printable) <= limit else printable[:limit - 1] + "…"


def text(value, color, *, bold=False):
    return {
        "type": "text",
        "props": {"color": color, "weight": "bold" if bold else "normal"},
        "children": [value],
    }


def row(*children, gap=1):
    return {"type": "row", "props": {"gap": gap}, "children": children}


def meter(name, used, color):
    if type(used) not in (int, float) or not 0 <= used < float("inf"):
        return None
    remaining = round(max(0, 100 - used))
    color = "red" if remaining <= 10 else "yellow" if remaining <= 25 else color
    filled = (remaining + 10) // 20
    return row(
        text(name, "status-metadata"),
        text("▰" * filled + "▱" * (5 - filled), color),
        text(f"{remaining}%", color),
    )


def render(state):
    """Return the UI tree for this resource read's thread."""
    thread = state.get("thread", {})
    model = thread.get("model", {})
    agent = thread.get("agent", {}).get("state")
    cwd = thread.get("workspace", {}).get("cwd")
    context = (thread.get("usage") or {}).get("context") or {}
    children = []

    if agent in AGENT_STATES:
        value, color = AGENT_STATES[agent]
        children.append(text(value, color, bold=True))

    model_name = label(model.get("display_name") or "Codex", 30) or "Codex"
    model_parts = [text(model_name, "status-model", bold=True)]
    if effort := label(model.get("reasoning_level") or "", 12):
        model_parts.append(text(effort, "status-metadata"))
    children.append(row(*model_parts))

    if context_meter := meter("ctx", context.get("used_percentage"), "status-usage"):
        children.append(context_meter)

    limits = (state.get("account") or {}).get("rate_limits") or []
    codex_limit = next((limit for limit in limits if limit.get("limit_id") == "codex"), {})
    for key in ("primary_limit", "secondary_limit"):
        window = codex_limit.get(key) or {}
        name = {300: "5h", 10080: "7d"}.get(window.get("window_minutes"))
        if name and (quota_meter := meter(name, window.get("used_percent"), "status-limit")):
            children.append(quota_meter)

    if cwd:
        directory = PurePath(cwd)
        if name := label(directory.name or directory.anchor, 22):
            children.append(text(f"⌂ {name}", "status-path"))

    return row(*children, gap=2)


def respond(method, params):
    if method == "initialize":
        return {
            "protocolVersion": "2025-06-18",
            "capabilities": {"tools": {}, "resources": {}},
            "serverInfo": {"name": "orbit-statusline", "version": "1.0"},
        }
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": [TOOL]}
    if method == "tools/call":
        if params.get("name") != TOOL["name"]:
            raise ValueError("Unknown tool name")
        return {
            "content": [{"type": "text", "text": f"The statusline resource is {URI}."}]
        }
    if method == "resources/list":
        return {
            "resources": [
                {"name": "footer", "uri": URI, "mimeType": "application/json"}
            ]
        }
    if method == "resources/templates/list":
        return {"resourceTemplates": []}
    if method == "resources/read":
        if params.get("uri") != URI:
            raise ValueError("Unknown resource URI")
        state = params.get("_meta", {}).get("com.openai/codex-statusline-state", {})
        return {
            "contents": [
                {
                    "uri": URI,
                    "mimeType": "application/json",
                    "text": json.dumps(render(state), ensure_ascii=False),
                }
            ]
        }
    raise KeyError(method)


def main():
    for line in sys.stdin.buffer:
        reply = {"jsonrpc": "2.0", "id": None}
        try:
            request = json.loads(line)
            if not isinstance(request, dict) or not isinstance(
                request.get("method"), str
            ):
                reply["error"] = {"code": -32600, "message": "Invalid request"}
            elif "id" not in request:
                continue
            else:
                reply["id"] = request["id"]
                reply["result"] = respond(request["method"], request.get("params", {}))
        except json.JSONDecodeError:
            reply["error"] = {"code": -32700, "message": "Parse error"}
        except KeyError:
            reply["error"] = {"code": -32601, "message": "Method not found"}
        except (TypeError, ValueError, AttributeError):
            reply["error"] = {"code": -32602, "message": "Invalid parameters"}
        print(json.dumps(reply), flush=True)


if __name__ == "__main__":
    main()
