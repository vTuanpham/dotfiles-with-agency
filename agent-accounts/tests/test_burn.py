from dataclasses import replace
from datetime import datetime, timezone

from agent_accounts.burn import Burn
from agent_accounts.models import Quota, QuotaWindow


def at(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def test_rate_requires_fresh_comparable_samples_and_preserves_subpercent_precision():
    clock = 1_800_000_000.0
    window = QuotaWindow("5h", 10, "", "5h", at(clock + 3600), source_window="primary",
                         used_percent=89.1)
    quota = Quota("codex", "01", "plus", True, (window,), None, at(clock), 0, "fresh",
                  account_key_hash="abc")
    burn = Burn()
    assert not burn.observe((quota,), clock)
    second = replace(quota, observed_at=at(clock + 120),
                     windows=(replace(window, used_percent=89.3),))
    result = burn.observe((second,), clock + 120)
    assert len(result) == 1
    assert abs(result[0].seconds_to_empty - 6420) < 0.01
    assert not burn.observe((replace(second, freshness="stale"),), clock + 121)
    assert not burn.observe((replace(second, account_key_hash="other", observed_at=at(clock + 240)),),
                            clock + 240)
    assert not burn.observe((replace(second, observed_at=at(clock + 360),
                                    windows=(replace(window, resets=at(clock + 7200),
                                                     used_percent=90),)),), clock + 360)


def test_increase_resets_baseline_and_missing_identity_is_not_attributed():
    clock = 1_800_000_000.0
    window = QuotaWindow("weekly", 20, "", "weekly", at(clock + 10000), remaining_fraction=0.2)
    quota = Quota("agy", "a1", None, False, (window,), None, at(clock), 0, "fresh",
                  account_key_hash="fixture")
    burn = Burn()
    assert not burn.observe((quota,), clock)
    reset = replace(quota, observed_at=at(clock + 120),
                    windows=(replace(window, remaining_fraction=0.3),))
    assert not burn.observe((reset,), clock + 120)
    current = replace(reset, observed_at=at(clock + 240),
                      windows=(replace(window, remaining_fraction=0.29),))
    assert abs(burn.observe((current,), clock + 240)[0].seconds_to_empty - 3480) < 0.01
    assert not Burn().observe((replace(quota, backend="claude", account_key_hash=None),), clock)


def test_slow_rounded_window_uses_last_distinct_value():
    clock = 1_800_000_000.0
    window = QuotaWindow("monthly", 10, "", "monthly", at(clock + 2_000_000), source_window="secondary")
    quota = Quota("codex", "01", "free", True, (window,), None, at(clock), 0, "fresh",
                  account_key_hash="fixture")
    burn = Burn()
    for minutes in range(5):
        row = replace(quota, observed_at=at(clock + 60 * minutes))
        assert not burn.observe((row,), clock + 60 * minutes)
    row = replace(quota, observed_at=at(clock + 300),
                  windows=(replace(window, remaining_percent=9),))
    result = burn.observe((row,), clock + 300)
    assert result[0].seconds_to_empty == 2700
