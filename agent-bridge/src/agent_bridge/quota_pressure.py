"""Turn observed account burn into conservative worker warnings."""

import hashlib
import json
from pathlib import Path

from agent_accounts.burn import Burn

from .acknowledgements import event_lines
from .core import load_state, log
from .status_inputs import quotas


class Pressure:
    def __init__(self):
        self.burn = Burn()
        self.next_sample = 0.0

    def sample(self, jobs, now, emit):
        if now < self.next_sample:
            return
        jobs = [job for job in jobs if job.running and job.backend in {"agy", "codex"} and job.account]
        if not jobs:
            return
        self.next_sample = now + 60
        observations = quotas(now, [])
        for estimate in self.burn.observe(observations, now):
            # A half-hour gives the coordinator a useful handoff window; this is
            # a notification lead time, not a model or subscription burn rule.
            if estimate.seconds_to_empty > 1800 or estimate.seconds_to_empty >= estimate.seconds_to_reset:
                continue
            candidates = [job for job in jobs if job.backend == estimate.backend
                          and job.account == estimate.account and
                          (estimate.model_ids is None or job.model in estimate.model_ids)]
            for job in candidates:
                try:
                    state = load_state(Path(job.directory))
                    if estimate.backend == "agy":
                        account_id = state.get("agyAuthId")
                        identity = (hashlib.sha256(account_id.encode()).hexdigest()
                                    if isinstance(account_id, str) else None)
                    else:
                        identity = state.get("accountKeyHash")
                    if identity != estimate.account_key_hash:
                        continue
                except (OSError, ValueError, TypeError):
                    continue
                binding = "account usage may include other sessions"
                identity = hashlib.sha256(json.dumps([
                    estimate.backend, estimate.account_key_hash, estimate.pool_id, estimate.source_window,
                    estimate.window, estimate.resets
                ]).encode()).hexdigest()
                path = Path(job.directory)

                def record():
                    if any(row.get("kind") == "quota_pressure" and row.get("noticeId") == identity
                           for _, row in event_lines(path, 0)):
                        return
                    minutes = max(1, round(estimate.seconds_to_empty / 60))
                    log(path, "quota_pressure", level="urgent", noticeId=identity,
                        message=(f"{estimate.backend} account {estimate.account}, {estimate.window}: "
                                 f"{estimate.remaining_percent:.1f}% remaining, approximately {minutes}m "
                                 f"at the recent shared burn rate; {binding}. Worker model: "
                                 f"{job.model or 'not reported'}. Consider account or model "
                                 "change, with or without compacting."))

                emit(path.parent, record)
