import signal
import sys
from pathlib import Path

import pytest

from codex_wake import cli
from codex_wake.client import validate_message


@pytest.fixture
def target(monkeypatch, tmp_path):
    monkeypatch.setattr(cli.tempfile, "tempdir", str(tmp_path))
    class Target:
        def __init__(self, thread, home):
            self.thread, self.home = thread, home
            self.checked = False
            self.messages = []

        def check(self):
            self.checked = True

        def send(self, prompt):
            validate_message(prompt)
            self.messages.append(prompt)

    instance = Target("root-thread", None)
    monkeypatch.setattr(cli, "Wake", lambda thread, home: instance)
    return instance


def test_check_does_not_send(target, capsys):
    assert cli.main(["check"]) == 0
    assert target.checked and not target.messages
    assert "ready" in capsys.readouterr().out


def test_send_is_an_automatic_notification(target):
    assert cli.main(["send", "--message", "Build ready"]) == 0
    assert target.checked
    assert target.messages == [f"Build ready\n{cli.NOTICE}"]


@pytest.mark.parametrize("code", [0, 7])
def test_run_preserves_command_output_and_failure(target, capfd, code):
    assert (
        cli.main(
            [
                "run",
                "--message",
                "Check finished",
                "--",
                sys.executable,
                "-c",
                f"import sys; print(sys.argv[1]); sys.exit({code})",
                "$(must stay literal); hello",
            ]
        )
        == code
    )
    assert "$(must stay literal); hello" in capfd.readouterr().out
    assert f"status {code}" in target.messages[0]
    assert len(target.messages) == 1


def test_run_defaults_to_command_status_and_private_complete_output(target, capfd):
    payload = b"\x00\xff" + b"x" * 100000
    assert cli.main([
        "run", "--", sys.executable, "-c",
        "import os; os.write(1, b'out\\n'); os.write(2, b'err\\n'); "
        "os.write(1, b'\\x00\\xff' + b'x' * 100000)",
        "argument-not-for-notifications",
    ]) == 0
    assert len(target.messages) == 1
    message = target.messages[0]
    assert f"Command {Path(sys.executable).name}." in message and "status 0" in message
    assert "argument-not-for-notifications" not in message
    output = Path(message.split("Output: ", 1)[1].split("\n", 1)[0])
    assert output.read_bytes() == b"out\nerr\n" + payload
    assert output.stat().st_mode & 0o777 == 0o600
    captured = capfd.readouterr()
    assert "out\nerr\n" in captured.out and str(output) in captured.err


def test_log_setup_failure_never_starts_command(target, monkeypatch, tmp_path):
    def fail(**kwargs):
        raise OSError("no log storage")

    monkeypatch.setattr(cli.tempfile, "NamedTemporaryFile", fail)
    marker = tmp_path / "must-not-exist"
    assert cli.main([
        "run", "--", sys.executable, "-c",
        "from pathlib import Path; import sys; Path(sys.argv[1]).touch()", str(marker),
    ]) == 125
    assert not marker.exists() and not target.messages


def test_log_write_failure_stops_the_child_without_claiming_success(target, monkeypatch, tmp_path):
    popen = cli.subprocess.Popen
    started = []

    def start(*args, **kwargs):
        process = popen(*args, **kwargs)
        started.append(process)
        return process

    class FullLog:
        name = str(tmp_path / "full.log")

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def write(self, chunk):
            raise OSError("full disk")

    monkeypatch.setattr(cli.tempfile, "NamedTemporaryFile", lambda **kwargs: FullLog())
    monkeypatch.setattr(cli.subprocess, "Popen", start)
    assert cli.main([
        "run", "--", sys.executable, "-c",
        "import os, time; os.write(1, b'output'); time.sleep(60)",
    ]) == 125
    assert started[0].returncode == -signal.SIGKILL and not target.messages


def test_run_notifies_when_program_is_missing(target):
    assert cli.main(["run", "--message", "Import", "--", "/nonexistent/codex-wake-test"]) == 127
    assert "could not start (127)" in target.messages[0] and "Output:" in target.messages[0]


def test_signal_exit_is_reported(target):
    assert (
        cli.main(
            [
                "run",
                "--message",
                "Check",
                "--",
                sys.executable,
                "-c",
                "import os, signal; os.kill(os.getpid(), signal.SIGTERM)",
            ]
        )
        == 128 + signal.SIGTERM
    )
    assert "status -15" in target.messages[0]


def test_delivery_failure_is_not_reported_as_command_success(target, monkeypatch, capsys):
    def fail(_):
        raise RuntimeError("delivery failed")

    monkeypatch.setattr(target, "send", fail)
    assert cli.main(["run", "--message", "Check", "--", sys.executable, "-c", "pass"]) == 125
    assert "delivery failed" in capsys.readouterr().err


@pytest.mark.parametrize("failure", ["preflight", "message", "context"])
def test_invalid_setup_never_starts_command(target, monkeypatch, tmp_path, failure):
    def fail():
        raise RuntimeError("missing capability")

    if failure == "preflight":
        monkeypatch.setattr(target, "check", fail)
    marker = tmp_path / "must-not-exist"
    assert (
        cli.main(
            [
                "run",
                "--message",
                "x" * {"message": 1000, "context": 950}.get(failure, 5),
                "--",
                sys.executable,
                "-c",
                "from pathlib import Path; import sys; Path(sys.argv[1]).touch()",
                str(marker),
            ]
        )
        == 125
    )
    assert not marker.exists()


@pytest.mark.parametrize("text", ["", "   ", "é" * 501])
def test_invalid_message_never_sends(target, text):
    assert cli.main(["send", "--message", text]) == 125
    assert not target.messages


def test_explicit_target_overrides_session_environment(monkeypatch):
    monkeypatch.setenv("CODEX_THREAD_ID", "wrong-thread")
    captured = []

    class Target:
        def __init__(self, thread, home):
            captured.append((thread, home))
            self.thread = thread

        def check(self):
            pass

    monkeypatch.setattr(cli, "Wake", Target)
    assert cli.main(["check", "--thread", "target-thread", "--home", "/some/codex-home"]) == 0
    assert captured == [("target-thread", "/some/codex-home")]


def test_missing_target_fails_clearly(monkeypatch, capsys):
    monkeypatch.delenv("CODEX_THREAD_ID", raising=False)
    assert cli.main(["check"]) == 125
    assert "target thread" in capsys.readouterr().err


def test_run_requires_program_before_connecting(monkeypatch):
    monkeypatch.setattr(cli, "Wake", lambda *_: pytest.fail("connected with no program"))
    with pytest.raises(SystemExit) as error:
        cli.main(["run", "--message", "Check", "--"])
    assert error.value.code == 2
