import os
import runpy
import sys
from pathlib import Path

import pytest

from agent_bridge import core, gpu


@pytest.mark.parametrize("backend", sorted(gpu.BACKENDS))
def test_gpu_is_opt_in_and_the_launcher_must_be_outside_the_worker_scope(monkeypatch, tmp_path, backend):
    monkeypatch.setattr(gpu, "DEVICE", Path("/dev/null"))
    monkeypatch.setattr(gpu, "SYSTEM_TOOLS", ())
    monkeypatch.setenv("PATH", os.defpath)
    state = {"backend": backend, "sandbox": "workspace-write", "cwd": str(tmp_path), "writableRoots": []}

    assert core.worker_env(state=state)["PATH"] == os.defpath
    state["gpu"] = True
    assert core.worker_env(state=state)["PATH"].split(os.pathsep)[0] == str(gpu.LAUNCHER.parent)

    state["writableRoots"] = [str(gpu.LAUNCHER.parent.parent)]
    with pytest.raises(RuntimeError, match="outside worker-writable"):
        core.worker_env(state=state)


@pytest.mark.parametrize(
    ("sandbox", "backend", "error"),
    [("read-only", "codex", "requires workspace-write"), ("workspace-write", "agy", "unavailable")],
)
def test_gpu_rejects_jobs_without_a_supported_sandbox(sandbox, backend, error):
    with pytest.raises(RuntimeError, match=error):
        gpu.launcher({"sandbox": sandbox, "backend": backend})


def test_bwrap_adds_only_the_device_and_keeps_mounts_and_command_intact(monkeypatch):
    args = ["--ro-bind", "/", "/", "--dev", "/dev", "--unshare-net", "--", "echo", "--dev", "/dev"]
    actual = []
    monkeypatch.setattr(sys, "argv", [str(gpu.LAUNCHER), *args])
    monkeypatch.setattr(os, "execv", lambda binary, argv: actual.extend(argv))
    runpy.run_path(str(gpu.LAUNCHER))
    assert actual == ["/usr/bin/bwrap", *args[:5], "--dev-bind", "/dev/dxg", "/dev/dxg", *args[5:]]
