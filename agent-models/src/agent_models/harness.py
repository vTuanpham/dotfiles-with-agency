"""Backend-to-scaffold preference; unknown is never proof of a native run."""

TARGETS = {"claude": "Claude Code", "codex": "Codex CLI", "opencode": "OpenCode", "agy": "Antigravity"}


def native(value, backend):
    if not value:
        return None
    label = value.casefold()
    prefixes = {"claude": ("claude code", "claude"), "codex": ("codex cli", "codex"),
                "opencode": ("opencode",), "agy": ("antigravity", "agy")}.get(backend, ())
    return any(label == p or label.startswith(p + " (") or label.startswith(p + " /")
               or label.startswith(p + " ") for p in prefixes)


def note(value, backend, version=None):
    label = value or "Unverified"
    if version:
        if version.casefold().startswith(label.casefold() + " "):
            label = version
        elif version not in label:
            label += " " + version
    return ("harness: " if not backend or native(value, backend) is True else "other harness: "
            if value else "harness: ") + label
