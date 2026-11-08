from agent_accounts.runway import Reading, Runway

CLOCK = 1_800_000_000.0


def reading(offset, remaining, resets=7200, key="w"):
    return Reading(key, "5h", remaining, CLOCK + resets, CLOCK + offset)


def test_runway_warns_once_and_remembers_history_across_restarts(tmp_path):
    path = tmp_path / "runway.json"
    assert not Runway(path).observe([reading(0, 10)], CLOCK)
    due = Runway(path).observe([reading(300, 6)], CLOCK + 300)  # a new process, the same history
    assert len(due) == 1
    assert abs(due[0].seconds_to_empty - 450) < 1 and due[0].remaining == 6
    assert not Runway(path).observe([reading(360, 5)], CLOCK + 360)


def test_one_step_of_rounding_is_not_a_trend(tmp_path):
    runway = Runway(tmp_path / "runway.json")
    runway.observe([reading(0, 10)], CLOCK)
    assert not runway.observe([reading(300, 9)], CLOCK + 300)
    assert not Runway(tmp_path / "other.json").observe([reading(0, 10), reading(60, 4)], CLOCK + 60)


def test_a_window_that_resets_first_or_is_used_slowly_is_quiet(tmp_path):
    runway = Runway(tmp_path / "runway.json")
    runway.observe([reading(0, 10, resets=400)], CLOCK)
    assert not runway.observe([reading(300, 6, resets=400)], CLOCK + 300)
    slow = Runway(tmp_path / "slow.json")
    slow.observe([reading(0, 90)], CLOCK)
    assert not slow.observe([reading(600, 86)], CLOCK + 600)


def test_returned_quota_clears_the_old_rate_and_a_new_window_starts_fresh(tmp_path):
    runway = Runway(tmp_path / "runway.json")
    runway.observe([reading(0, 10)], CLOCK)
    assert not runway.observe([reading(300, 40)], CLOCK + 300)  # credit came back
    assert not runway.observe([reading(600, 38)], CLOCK + 600)  # one step since
    runway.observe([reading(0, 10, resets=90_000)], CLOCK)
    assert not runway.observe([reading(300, 9, resets=90_000)], CLOCK + 300)


def test_repeated_observation_and_hostile_values_change_nothing(tmp_path):
    runway = Runway(tmp_path / "runway.json")
    runway.observe([reading(0, 10)], CLOCK)
    assert not runway.observe([reading(0, 2)], CLOCK + 300)  # the same instant again
    assert not runway.observe([reading(300, -5), reading(300, 120), reading(300, 3, resets=-1)], CLOCK + 300)
    (tmp_path / "runway.json").write_text("not json")
    assert not Runway(tmp_path / "runway.json").observe([reading(0, 10)], CLOCK)


def test_valid_json_with_malformed_rows_starts_over_instead_of_failing(tmp_path):
    path = tmp_path / "runway.json"
    path.write_text('{"samples": {"w@1": [["x", 1]]}, "notified": {}}')
    assert not Runway(path).observe([reading(0, 10)], CLOCK)
    assert Runway(path).observe([reading(300, 6)], CLOCK + 300)
