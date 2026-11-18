"""Opt-in exposure of the WSL CUDA device through the worker's existing sandbox."""

import os
from pathlib import Path

BACKENDS = {"codex", "claude", "opencode"}
DEVICE = Path("/dev/dxg")
LAUNCHER = Path(__file__).resolve().with_name("gpu-bin") / "bwrap"
SYSTEM_TOOLS = (Path("/usr/bin/bwrap"), Path("/usr/bin/python3"))


def resume_hint(state, job):
    if (state.get("backend") in BACKENDS and state.get("sandbox") == "workspace-write"
            and not state.get("gpu") and DEVICE.is_char_device()):
        return f"For WSL CUDA, the coordinator can run `agent-bridge resume {job} --gpu` when idle."
    return None


def launcher(state):
    if state["sandbox"] != "workspace-write":
        raise RuntimeError("--gpu requires workspace-write")
    if state["backend"] not in BACKENDS:
        raise RuntimeError(f"--gpu is unavailable for {state['backend']}. Its sandbox manages devices.")
    if not DEVICE.is_char_device():
        raise RuntimeError("--gpu needs the WSL CUDA device /dev/dxg on the host")
    for program in (LAUNCHER, *SYSTEM_TOOLS):
        if not program.is_file() or not os.access(program, os.X_OK):
            raise RuntimeError(f"--gpu requires executable {program}")
    writable = [state["cwd"], *state["writableRoots"], "/tmp", os.environ.get("TMPDIR") or "/tmp"]
    if any(LAUNCHER.is_relative_to(Path(root).resolve()) for root in writable):
        raise RuntimeError("--gpu requires the Bridge launcher outside worker-writable directories")
    return LAUNCHER
