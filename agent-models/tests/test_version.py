import subprocess
from importlib.metadata import version


def test_version():
    assert subprocess.check_output(["model-guide", "--version"], text=True).strip() == version("agent-models")
