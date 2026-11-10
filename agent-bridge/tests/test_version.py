import subprocess
from importlib.metadata import version


def test_version():
    output = subprocess.check_output(["agent-bridge", "--version"], text=True)
    assert output.strip() == version("agent-bridge")
