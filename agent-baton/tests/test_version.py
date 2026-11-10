import subprocess
from importlib.metadata import version


def test_version():
    assert subprocess.check_output(["agent-baton", "--version"], text=True).strip() == version("agent-baton")
