import subprocess
from importlib.metadata import version


def test_version():
    assert subprocess.check_output(["portlink", "--version"], text=True).strip() == version("portlink")
