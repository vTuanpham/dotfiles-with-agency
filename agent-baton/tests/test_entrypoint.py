import json
import os
import subprocess
import sys

import pytest


@pytest.mark.parametrize(
    "event",
    [
        {"tool_name": "Read", "tool_input": {}},
        {"tool_name": "mcp__computer__screenshot", "tool_input": {"url": "https://bitwarden.com"}},
        {"tool_name": "Bash", "tool_input": {"command": "agent-baton back"}},
    ],
)
def test_fast_guard_preserves_native_cli_verdict_and_streams(tmp_path, event):
    environment = {
        **os.environ,
        "AGENT_BATON_HOME": str(tmp_path / "state"),
        "AGENT_BATON_CONFIG": str(tmp_path / "config.toml"),
    }
    results = []
    for module in ("agent_baton.cli", "agent_baton"):
        result = subprocess.run(
            [sys.executable, "-c", f"from {module} import main; raise SystemExit(main())", "guard"],
            input=json.dumps(event),
            text=True,
            capture_output=True,
            timeout=10,
            env=environment,
        )
        results.append((result.returncode, result.stdout, result.stderr))
    assert results[0] == results[1]
    assert results[0][0] == (0 if event["tool_name"] == "Read" else 2)


def test_guard_help_still_uses_the_normal_command_parser():
    result = subprocess.run(
        [sys.executable, "-c", "from agent_baton import main; raise SystemExit(main())", "guard", "--help"],
        text=True,
        capture_output=True,
        timeout=10,
    )
    assert result.returncode == 0
    assert "usage:" in result.stdout and "guard" in result.stdout


def test_guard_does_not_initialize_human_page_or_injection_dependencies(tmp_path):
    code = (
        "import sys; from agent_baton import main; result=main(); "
        "assert result == 0; assert not {'agent_baton.cli','agent_baton.serve',"
        "'agent_baton.inject','agent_baton.notify','http.server'} & sys.modules.keys()"
    )
    result = subprocess.run(
        [sys.executable, "-c", code, "guard"],
        input='{"tool_name":"Read","tool_input":{}}',
        text=True,
        capture_output=True,
        timeout=10,
        env={
            **os.environ,
            "AGENT_BATON_HOME": str(tmp_path / "state"),
            "AGENT_BATON_CONFIG": str(tmp_path / "config.toml"),
        },
    )
    assert (result.returncode, result.stdout, result.stderr) == (0, "", "")
