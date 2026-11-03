"""Private native messaging connection bindings; never public configuration."""

import hashlib
import json
import os
import stat

from . import core
from .messages import address


def directory(target):
    address(target)
    root = core.HOME / "messages"
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    for path in (root, root / hashlib.sha256(target.encode()).hexdigest()):
        path.mkdir(mode=0o700, exist_ok=True)
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
            raise ValueError("Bridge message storage must be private and owned by this user")
    return path


def read(path, *, private=True):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd) as stream:
        info = os.fstat(stream.fileno())
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) & (0o077 if private else 0o022)
            or info.st_size > 65536
        ):
            raise ValueError("Unsafe native message connection file")
        data = json.load(stream)
    if not isinstance(data, dict):
        raise ValueError("Invalid native message connection file")
    return data
