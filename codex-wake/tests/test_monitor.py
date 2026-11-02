import io

import pytest

from codex_wake import cli, monitor
from codex_wake.monitor import Policy


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def play(policy, script):
    """Run the loop over a scripted probe: one (code, detail) per probe, then quiet forever."""
    clock, out, calls = Clock(), io.StringIO(), iter(script)
    code = monitor.run(
        policy, ["probe"], out=out, clock=clock, sleep=clock.sleep, probe=lambda command: next(calls, (1, ""))
    )
    return code, out.getvalue().splitlines()


def test_hits_inside_the_cooldown_are_counted_then_announced_with_the_count():
    policy = Policy(every=10, ttl=300, cooldown=60, max_events=5)
    code, lines = play(
        policy, [(0, "a")] * 12
    )  # a condition that holds for the first 12 probes (0 s to 110 s), every 10 s
    events = [line for line in lines if line.startswith(monitor.EVENT)]
    assert code == 0 and len(events) == 2  # announced at 0 s and 60 s: never more often than the cooldown
    assert events[0] == "wake-event: 1 at=0s suppressed=0 a"
    assert (
        events[1] == "wake-event: 2 at=60s suppressed=5 a"
    )  # the five probes between them are counted, not lost
    # and the five after the last announcement too, with what the probe last saw
    assert lines[-1] == "wake-end: reason=ttl events=2 suppressed=5 latest=a"


def test_a_changed_result_held_back_by_the_cooldown_is_still_named_when_it_ends():
    policy = Policy(every=2, ttl=14, cooldown=30, max_events=5, distinct=True)
    code, lines = play(policy, [(0, "one")] * 3 + [(0, "two")] * 4)
    assert [line.split()[0] for line in lines] == [monitor.EVENT, monitor.END]
    assert lines[-1] == "wake-end: reason=ttl events=1 suppressed=6 latest=two"


def test_the_event_limit_ends_the_monitor_with_a_closing_line():
    code, lines = play(Policy(every=2, ttl=10_000, cooldown=30, max_events=2), [(0, "x")] * 100)
    assert code == 0
    assert [line.split()[0] for line in lines] == [monitor.EVENT, monitor.EVENT, monitor.END]
    assert "reason=max-events" in lines[-1]


def test_the_ttl_is_a_hard_stop_even_when_nothing_happens():
    code, lines = play(Policy(every=10, ttl=45, cooldown=60, max_events=5), [])
    assert code == 0 and lines == ["wake-end: reason=ttl events=0 suppressed=0"]


def test_repeated_probe_errors_stop_it_and_a_single_one_does_not():
    code, lines = play(
        Policy(every=2, ttl=1000, cooldown=60, max_events=5), [(2, "")] * monitor.MAX_PROBE_FAILURES
    )
    assert code == 3 and "reason=probe-failed" in lines[-1]
    code, lines = play(
        Policy(every=2, ttl=20, cooldown=60, max_events=5), [(2, ""), (1, ""), (2, ""), (1, "")]
    )
    assert code == 0 and "reason=ttl" in lines[-1]  # errors that are not consecutive never add up


def test_distinct_announces_only_a_changed_result():
    code, lines = play(
        Policy(every=2, ttl=400, cooldown=30, max_events=5, distinct=True),
        [(0, "one client")] * 20 + [(0, "two clients")] * 20,
    )
    events = [line for line in lines if line.startswith(monitor.EVENT)]
    assert [line.split(maxsplit=4)[-1] for line in events] == ["one client", "two clients"]


def test_limits_are_clamped_to_the_hard_caps_and_nonsense_is_an_error():
    policy = monitor.policy_of("1h", "999h", "1s", 500)
    assert (policy.ttl, policy.cooldown, policy.max_events) == (
        monitor.MAX_TTL,
        monitor.MIN_COOLDOWN,
        monitor.MAX_EVENTS,
    )
    for bad in [("1s", "5m", "5m", 5), ("10s", "5m", "5m", 0), ("soon", "5m", "5m", 5)]:
        with pytest.raises(ValueError):
            monitor.policy_of(*bad)
    assert monitor.duration("90") == 90 and monitor.duration("2h") == 7200


def test_the_host_reads_the_policy_from_the_command_text_the_same_way():
    policy = monitor.of_command(
        "codex-wake monitor --every 5s --ttl 10m --cooldown 2m --max-events 3 --distinct -- test -f /tmp/x"
    )
    assert policy == Policy(every=5, ttl=600, cooldown=120, max_events=3, distinct=True)
    assert monitor.of_command("/home/u/.local/bin/codex-wake monitor -- true").ttl == 1800  # defaults
    assert monitor.of_command("codex-wake run -- make") is None and monitor.of_command("make test") is None
    assert (
        monitor.of_command("codex-wake monitor --every 1s -- true") is None
    )  # an invalid one is not trusted at all
    assert monitor.of_command("echo 'unterminated") is None


def test_cli_monitor_runs_the_probe_and_reports_through_its_exit_status(capsys):
    assert (
        cli.main(["monitor", "--every", "2s", "--ttl", "1s", "--", "false"]) == 0
    )  # a quiet probe, until the ttl lapses
    assert capsys.readouterr().out == "wake-end: reason=ttl events=0 suppressed=0\n"
    assert (
        cli.main(["monitor", "--every", "2s", "--ttl", "1s", "--max-events", "1", "--", "echo", "hit"]) == 0
    )
    assert capsys.readouterr().out.splitlines()[0] == "wake-event: 1 at=0s suppressed=0 hit"
    assert cli.main(["monitor", "--every", "2s", "--ttl", "1s", "--", "false"]) == 0
    assert "wake-end: reason=ttl" in capsys.readouterr().out
    with pytest.raises(SystemExit):
        cli.main(["monitor", "--every", "10s"])  # a probe is required
    with pytest.raises(SystemExit):
        cli.main(["monitor", "--every", "1s", "--", "true"])  # and the limits are validated
