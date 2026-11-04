import fcntl
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

from agent_resources import control, heavy
from agent_resources.identity import agent_id as resource_agent_id


def test_standalone_exec_preserves_environment_argv_stdin_and_exit(tmp_path):
    env = {"PATH": os.defpath, "HOME": str(tmp_path),
           "PYTHONPATH": str(Path(heavy.__file__).parents[1]),
           "AGENT_RESOURCES_HOME": str(tmp_path / "queue"), "AGENT_RESOURCES_MIN_AVAILABLE_MIB": "0",
           "AGENT_RESOURCES_MAX_LOAD": "1000000", "JOB_API_KEY": "synthetic-value"}
    script = ("import json,os,sys; "
              "print(json.dumps([os.environ['JOB_API_KEY'],sys.argv[1],sys.stdin.read()])); sys.exit(7)")
    result = subprocess.run([sys.executable, "-m", "agent_resources.cli", "run", "--mem", "1M", "--",
                             sys.executable, "-c", script, "$literal"], env=env, input="stdin payload",
                            capture_output=True, text=True, timeout=15)
    assert result.returncode == 7
    assert json.loads(result.stdout) == ["synthetic-value", "$literal", "stdin payload"]


@pytest.mark.parametrize(
    "agent_args,agent_env,expected",
    [(["--agent-id", "agent-cli"], None, "agent-cli"), ([], "agent-env", "agent-env")],
)
def test_run_records_agent_id_from_cli_or_environment(tmp_path, agent_args, agent_env, expected):
    env = {"PATH": os.defpath, "HOME": str(tmp_path),
           "PYTHONPATH": str(Path(heavy.__file__).parents[1]),
           "AGENT_RESOURCES_HOME": str(tmp_path / "queue"), "AGENT_RESOURCES_MIN_AVAILABLE_MIB": "0",
           "AGENT_RESOURCES_MAX_LOAD": "1000000", "AGENT_RESOURCES_OWNER": "claude:test-root"}
    if agent_env is not None:
        env["AGENT_RESOURCES_AGENT_ID"] = agent_env
    command = [sys.executable, "-c", "import time; time.sleep(3)"]
    process = subprocess.Popen([sys.executable, "-m", "agent_resources.cli", "run", "--mem", "1M",
                                *agent_args, "--", *command], env=env, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True)
    folder = Path(env["AGENT_RESOURCES_HOME"])
    rows = []
    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if folder.exists():
                with heavy.gate(folder):
                    rows = heavy.entries(folder)
            if rows:
                break
            time.sleep(0.05)
        assert len(rows) == 1
        assert rows[0][1]["owner"] == "claude:test-root"
        assert rows[0][1]["agent_id"] == expected
        request_path = rows[0][0]
        assert "agent_id" not in json.loads(request_path.read_text())
        assert json.loads(heavy.agent_path(request_path).read_text()) == {"agent_id": expected}
    finally:
        process.terminate()
        process.communicate(timeout=5)
    with heavy.gate(folder):
        assert heavy.entries(folder) == []


def test_entries_accepts_existing_request_without_agent_id(tmp_path):
    folder = tmp_path / "queue"
    folder.mkdir()
    path = folder / "000-legacy.request"
    fd = heavy.locked_file(path)
    fcntl.flock(fd, fcntl.LOCK_EX)
    namespace = os.readlink(heavy.PROC / "self/ns/pid")
    row = {"running": False, "slots": 1, "job": "", "owner": "claude:legacy",
           "command": "python3", "pid": os.getpid(), "namespace": namespace,
           "host_namespace": namespace, "host_pid": os.getpid(), "started_at": None,
           "started_ns": None}
    heavy.write_request(fd, row)
    heavy.write_state(heavy.reservation_path(path), {"need": 1, "exclusive": False,
                                                     "queued_ns": 1, "cap": None})
    heavy.write_state(heavy.control_path(path), {"group": False, "cancelled": False, "pause_ns": 0})
    try:
        rows = heavy.entries(folder)
        assert len(rows) == 1 and rows[0][1]["agent_id"] is None
    finally:
        os.close(fd)


def test_agent_id_validation_rejects_conflicts_and_control_characters(monkeypatch):
    monkeypatch.setenv("AGENT_RESOURCES_AGENT_ID", "agent-env")
    assert resource_agent_id() == "agent-env"
    with pytest.raises(ValueError, match="conflicting"):
        resource_agent_id("agent-cli")
    monkeypatch.delenv("AGENT_RESOURCES_AGENT_ID")
    with pytest.raises(ValueError, match="invalid"):
        resource_agent_id("agent\nforged")
    with pytest.raises(ValueError, match="invalid"):
        resource_agent_id("x" * 401)


def test_list_json_cli_emits_versioned_snapshot(tmp_path):
    env = {"PATH": os.defpath, "HOME": str(tmp_path),
           "PYTHONPATH": str(Path(heavy.__file__).parents[1]),
           "AGENT_RESOURCES_HOME": str(tmp_path / "queue"), "AGENT_RESOURCES_MIN_AVAILABLE_MIB": "0",
           "AGENT_RESOURCES_MAX_LOAD": "1000000", "AGENT_RESOURCES_OWNER": "claude:test-root",
           "AGENT_RESOURCES_WORKER": "1"}
    result = subprocess.run(
        [sys.executable, "-m", "agent_resources.cli", "list", "--json", "--owner", "claude:test-root"],
        env=env, capture_output=True, text=True, timeout=15,
    )
    assert result.returncode == 0
    snapshot = json.loads(result.stdout)
    assert snapshot["schema_version"] == 1 and snapshot["paused"] is None
    assert snapshot["requests"] == []
    assert set(snapshot["admission"]) == {
        "reserved_bytes", "budget_bytes", "free_bytes", "unavailable"
    }


def test_controller_identity_blocks_foreign_root_before_cancelling(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_RESOURCES_HOME", str(tmp_path / "queue"))
    monkeypatch.setenv("CODEX_THREAD_ID", "foreign-root")
    monkeypatch.delenv("CLAUDE_CODE_SESSION_ID", raising=False)
    monkeypatch.delenv("AGENT_RESOURCES_OWNER", raising=False)
    folder = heavy.prepare()
    request = folder / "000-abc.request"
    row = {"job": "group/job", "owner": "codex:original-root", "running": False}
    monkeypatch.setattr(heavy, "entries", lambda _: [(request, row)])
    monkeypatch.setattr(heavy, "write_state", lambda *_: pytest.fail("foreign root mutated request"))
    with pytest.raises(RuntimeError, match="different root"):
        control.cancel("abc")


def test_worker_cannot_control_queue(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_RESOURCES_HOME", str(tmp_path / "queue"))
    monkeypatch.setenv("AGENT_RESOURCES_WORKER", "1")
    with pytest.raises(RuntimeError, match="workers cannot control"):
        control.listing()
    assert not (tmp_path / "queue").exists()


def test_requested_scope_cap_is_required(monkeypatch):
    monkeypatch.setattr(heavy.shutil, "which", lambda _: None)
    with pytest.raises(RuntimeError, match="cannot be applied"):
        heavy.scope_prefix("10")
