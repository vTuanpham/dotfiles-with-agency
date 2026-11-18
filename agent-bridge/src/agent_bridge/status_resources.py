"""Observe worker scopes, using the resource module's strict Linux boundary readers."""

from agent_resources import resources


def scopes(pids):
    found = set()
    for pid in pids:
        try:
            paths = resources.cgroup_paths(pid, include_shared=False)
            if paths and paths[0].name.endswith(".scope") and any(
                p.name == resources.slice_name() for p in paths
            ):
                found.add(paths[0])
        except (OSError, ValueError):
            continue
    return found


def memory(pids):
    """RSS is only a fallback when a job has no readable scope; shared pages can count twice."""
    return resources.resident_memory(pids)


def scope_memory(path):
    return resources.number(path / "memory.current"), resources.counters(path / "memory.events")["oom_kill"]
