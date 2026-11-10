import subprocess
from importlib.metadata import version


def test_version():
    assert subprocess.check_output(["codex-wake", "--version"], text=True).strip() == version("codex-wake")
