import subprocess
from importlib.metadata import version


def test_version():
    assert subprocess.check_output(["agent-inbox", "--version"], text=True).strip() == version("agent-inbox")
