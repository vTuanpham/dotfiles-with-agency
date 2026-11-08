"""Estimate depletion from comparable native account observations."""

from dataclasses import dataclass

from .models import Quota, timestamp


@dataclass(frozen=True)
class Estimate:
    backend: str
    account: str
    window: str
    resets: str
    remaining_percent: float
    seconds_to_empty: float
    seconds_to_reset: float
    model_ids: tuple[str, ...] | None
    pool_id: str | None
    source_window: str | None
    account_key_hash: str | None


class Burn:
    def __init__(self):
        self.previous = {}

    def observe(self, quotas: tuple[Quota, ...], now: float) -> tuple[Estimate, ...]:
        estimates = []
        for quota in quotas:
            if quota.freshness != "fresh" or not quota.observed_at:
                continue
            observed = timestamp(quota.observed_at)
            if observed > now or now - observed > 600:
                continue
            # Display positions are not stable account identities.
            identity = (quota.account if quota.backend == "opencode"
                        and quota.account.startswith("workspace-") else quota.account_key_hash)
            if not identity:
                continue
            for window in quota.windows:
                if not window.resets or timestamp(window.resets) <= now:
                    continue
                remaining = (window.remaining_fraction * 100 if window.remaining_fraction is not None
                             else 100 - window.used_percent if window.used_percent is not None
                             else window.remaining_percent)
                if remaining is None or not 0 <= remaining <= 100:
                    continue
                key = (quota.backend, identity, window.pool_id, window.source_window,
                       window.label, window.resets)
                previous = self.previous.get(key)
                if (previous is None or remaining > previous[1]
                        or observed - previous[0] >= 60 and remaining < previous[1]):
                    self.previous[key] = (observed, remaining)
                if previous is None:
                    continue
                duration = observed - previous[0]
                consumed = previous[1] - remaining
                if duration < 60 or consumed <= 0:
                    continue
                empty = remaining * duration / consumed
                reset = timestamp(window.resets) - now
                estimates.append(Estimate(
                    quota.backend, quota.account, window.limit or window.label, window.resets, remaining,
                    empty, reset, window.model_ids, window.pool_id, window.source_window,
                    quota.account_key_hash,
                ))
        return tuple(estimates)
