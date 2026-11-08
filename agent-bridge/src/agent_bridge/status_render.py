"""Human views of the status contract; no filesystem reads or state inference."""

from pathlib import PurePath

from agent_resources.resources import MIB

from .core import LARGE_CONTEXT, human


def pressure(host, queue):
    if host.error:
        return f"host: pressure unavailable ({host.error})"
    summary = (
        f"host: available={host.available_bytes / MIB:.0f}MiB load1={host.load1:.2f} "
        f"headroom={host.headroom_bytes / MIB:.0f}MiB "
        f"heavy_running={sum(r.state == 'running' for r in queue.requests)} "
        f"heavy_queued={sum(r.state == 'queued' for r in queue.requests)} "
        f"heavy_reserved={queue.reserved_bytes / MIB:.0f}MiB "
        f"heavy_budget={queue.budget_bytes / MIB:.0f}MiB"
    )
    if queue.paused:
        summary += f" heavy_paused=yes (paused by root: {queue.pause_reason})"
    for row in queue.requests:
        if row.state == "running":
            summary += f" | heavy={row.job or 'standalone'} need={row.need_bytes / MIB:g}MiB" + (
                " exclusive" if row.exclusive else ""
            )
    for group in host.groups:
        name = PurePath(group.id).name
        if name != "codex.slice" and group.memory_max_bytes is None and group.cpu_quota is None:
            continue
        memory = f"{group.memory_bytes / MIB:.0f}" if group.memory_bytes is not None else "unavailable"
        maximum = f"{group.memory_max_bytes / MIB:.0f}" if group.memory_max_bytes is not None else "max"
        cpu = f"{group.cpu_quota:g}" if group.cpu_quota is not None else "unavailable/unlimited"
        summary += (
            f" | {name}: memory={memory}/{maximum}MiB oom_kill={group.oom_kill} "
            f"cpu_quota={cpu} usage_usec={group.usage_usec} throttled_usec={group.throttled_usec}"
        )
    if not host.groups:
        summary += " cgroup_v2=unavailable"
    if queue.error:
        summary += f" | {queue.error}"
    return summary


def owners(snapshot):
    for owner in snapshot.owners:
        jobs = [j for j in snapshot.jobs if j.owner == owner.id and not j.retired_at]
        caps = ",".join(f"{j.name}[{job_marks(j)}]" for j in jobs)
        size = human(owner.size_bytes) if owner.size_bytes is not None else "unknown"
        yield (
            f"{owner.id}: jobs={owner.jobs} running={owner.running} "
            f"unanswered_urgent={owner.unanswered_urgent} size={size} "
            f"last_root_command={owner.last_root_command or 'unknown'} caps={caps}"
        )


def heavy_list(snapshot):
    if snapshot.heavy.paused:
        yield f"heavy: paused by root: {snapshot.heavy.pause_reason}"
    yield "ID JOB COMMAND NEED EXCLUSIVE STATE TIME ALIVE"
    for r in snapshot.heavy.requests:
        clock = "elapsed" if r.state == "running" else "wait"
        yield (
            f"{r.id} {r.job or 'standalone'} {r.command or 'unknown'} {r.need_bytes / MIB:g}MiB "
            f"{'yes' if r.exclusive else 'no'} {r.state} {clock}={r.age_seconds}s yes(kernel-lock)"
        )


def peer_message(message):
    source, target = message.source.split("/")[-1], message.target.split("/")[-1]
    return f"{source} → {target}: {message.preview or '[preview omitted]'}"


def peer_conversations(snapshot):
    for edge in snapshot.peers.edges:
        for message in snapshot.peers.recent_messages:
            if (message.source, message.target) == (edge.source, edge.target):
                yield peer_message(message)


def peers(snapshot):
    for job in snapshot.jobs:
        if not job.retired_at:
            yield (
                f"{job.name}\t{job.backend or 'unknown'}\t{job.model or ''}\t{job.title}\t"
                f"{'running' if job.running else 'idle'}"
            )
    yield from peer_conversations(snapshot)


def quota(snapshot, backend=None, account=None):
    for q in snapshot.quotas:
        if backend and q.backend != backend or account and q.account != account:
            continue
        for window in q.windows:
            remaining = "unknown" if window.remaining_percent is None else f"{window.remaining_percent}%"
            yield (
                f"{q.account}\t{window.group}\t{window.limit}\t"
                f"{remaining}\t{window.resets or ''}"
            )


def label(job):
    return f"{job.name} ({job.title})" if job.title else job.name


def context_mark(job):
    """'ctx=210k' for a job whose context is worth a thought before its login or model changes."""
    tokens = job.context_tokens
    return f"ctx={round(tokens / 1000)}k" if tokens is not None and tokens > LARGE_CONTEXT else ""


def job_marks(job):
    return ",".join(filter(None, (f"memory={job.memory_cap}", f"cpu={job.cpu_cap}", context_mark(job))))


def job_status(job):
    text, mark = status_line(job), context_mark(job)
    return f"{text} {mark}" if mark else text


def status_line(job):
    name = label(job)
    if not job.running:
        return f"status: {name} {job.state} memory={job.memory_cap} cpu={job.cpu_cap}"
    if job.waiting or job.in_flight:
        return f"status: {name} {job.stall.reason} memory={job.memory_cap} cpu={job.cpu_cap}"
    if job.state in {"waiting_for_heavy", "paused", "blocked_on_question"}:
        return f"status: {name} {job.reason}"
    if job.state == "waiting_for_root":
        text = f"status: {name} waiting for root"
    elif job.state == "retrying" and job.retry_attempt is not None:
        text = f"status: {name} retrying {job.retry_attempt}/{job.retry_maximum}; same model"
    else:
        text = (
            f"status: {name} running, last event {job.stall.quiet_seconds // 60}m ago, "
            f"{job.message_count} messages"
        )
    if job.native_observation:
        native = job.native_observation
        description = {"thread_started": "session initialized", "prompt_accepted": "prompt accepted",
                       "message": "message", "command_start": "command started",
                       "command_end": "command ended", "step_finished": "step finished"}[native["kind"]]
        text += f"; native {description} at {native['at']}"
    elif job.started_at:
        text += "; no native event observed since the latest request"
    return text + f" memory={job.memory_cap} cpu={job.cpu_cap}"


def notice(job):
    a, name = job.stall, label(job)
    if a.state == "slow":
        return f"{name}: slow, model steps take {a.recent_step_seconds}s (usually {a.usual_step_seconds}s)"
    why = "processes busy: a long command, or a spinning one?" if a.reason == "processes busy" else "stalled?"
    return f"{name}: silent for {a.quiet_seconds // 60}m while running ({why})"


def event(job, value):
    return (
        f"{label(job)}: {value.kind}"
        + (f" {value.status}" if value.status else "")
        + (f" error={value.error[:200]}" if value.error else "")
        + (f" | {value.text.replace(chr(10), ' ')[:600]}" if value.text else "")
    )


def group_notice(notice):
    return f"{notice.owner}/{notice.group or '@ungrouped'}: {notice.kind} | {notice.text}"
