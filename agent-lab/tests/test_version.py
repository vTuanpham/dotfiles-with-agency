import subprocess
from importlib.metadata import version


def test_version():
    assert subprocess.check_output(["agent-lab", "--version"], text=True).strip() == version("agent-lab")
