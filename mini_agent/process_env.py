"""Subprocess environment sanitization for packaged (frozen) builds.

Why this exists
---------------
On Linux the app ships as a Tauri AppImage that carries a PyInstaller-frozen
FastAPI backend. Two layers inject a *library search path* into the process
environment before our code ever runs:

1. The AppImage runtime (``AppRun``) points ``LD_LIBRARY_PATH`` at the
   squashfs/FUSE mount under ``/tmp/.mount_<AppName>xxxx``.
2. The PyInstaller bootloader points it at the onedir ``_internal``
   directory (``sys._MEIPASS``).

Both are correct for the *app's own* binaries, but we never scrub them
before spawning children. Every agent command therefore inherits an
``LD_LIBRARY_PATH`` that resolves system libraries against the bundle's
copies. When the bundle ships a different version of a shared library than
the host, the dynamic linker fails before the child ever runs its command.

Observed on Arch/Niri (issue #2)::

    /bin/sh: symbol lookup error: /bin/sh: undefined symbol: rl_print_keybinding

``/bin/sh`` is bash, which links ``libreadline.so.8`` and calls
``rl_print_keybinding`` (a readline >= 8.1 symbol). The bundle's readline
was older, so *every* ``bash()`` call died instantly — while the user's own
terminal kept working, because it has none of these variables.

What we do
----------
For subprocesses we spawn (shell commands, git, MCP stdio servers), drop
only the ``LD_LIBRARY_PATH`` / ``LD_PRELOAD`` entries that point *inside the
app bundle*. Anything the user set deliberately is preserved — this is not a
blanket scrub of the dynamic-linker environment.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

#: Dynamic-linker variables that can carry the app's own library path into
#: child processes. Windows/macOS use different mechanisms (PATH, DYLD_*),
#: and this module is a no-op there — see :func:`sanitized_subprocess_env`.
LINKER_ENV_VARS: tuple[str, ...] = ("LD_LIBRARY_PATH", "LD_PRELOAD")

#: AppImage extracts to a FUSE mount named ``/tmp/.mount_<Name><random>``.
#: Any path containing such a component came from the AppImage runtime.
_APPIMAGE_MOUNT_PREFIX = ".mount_"


def _bundle_roots() -> list[str]:
    """Directories that identify "inside our own bundle".

    Returns the PyInstaller ``_internal`` dir and the frozen exe's own
    directory. Empty when running from source (dev / `python -m`), which
    is the common case during development.
    """
    roots: list[str] = []

    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        roots.append(str(Path(meipass).resolve()))

    executable = getattr(sys, "executable", None)
    if executable:
        try:
            roots.append(str(Path(executable).resolve().parent))
        except OSError:
            # Unresolvable (deleted temp dir, restricted perms) — skip it.
            pass

    return roots


def _is_bundle_path(entry: str, roots: list[str]) -> bool:
    """True when ``entry`` lives inside the app bundle.

    Covers both detection strategies we need:

    * an AppImage runtime mount (``.mount_*`` path component), and
    * PyInstaller's ``_internal`` / frozen exe directory tree.
    """
    if not entry:
        return False

    # AppImage FUSE mount — the LD_LIBRARY_PATH entry usually points at
    # the mount root or a parent of the exe dir, so a containment check
    # against sys.executable's directory alone would miss it.
    if any(part.startswith(_APPIMAGE_MOUNT_PREFIX) for part in Path(entry).parts):
        return True

    if not roots:
        return False

    try:
        resolved = Path(entry).resolve()
    except (OSError, ValueError):
        return False

    for root in roots:
        try:
            resolved.relative_to(root)
            return True
        except ValueError:
            continue
    return False


def sanitized_subprocess_env(base: dict[str, str] | None = None) -> dict[str, str]:
    """Return a copy of ``base`` (default: ``os.environ``) safe to spawn with.

    Args:
        base: Environment to sanitize. Defaults to the current process
            environment. Pass an explicit dict when the caller is merging
            its own variables.

    Returns:
        The environment dict. On non-Linux platforms (and when running
        from source with no bundle paths set) this is an unchanged copy.
    """
    env = dict(os.environ if base is None else base)

    if not sys.platform.startswith("linux"):
        return env

    roots = _bundle_roots()
    if not roots:
        # Running from source: nothing of ours can be on the search path.
        return env

    for var in LINKER_ENV_VARS:
        raw = env.get(var)
        if not raw:
            continue
        kept = [
            entry for entry in raw.split(":")
            if entry and not _is_bundle_path(entry, roots)
        ]
        if kept:
            env[var] = ":".join(kept)
        else:
            # Every entry was ours — drop the variable entirely so the
            # child falls back to the system default search path.
            env.pop(var, None)

    return env


__all__ = ["LINKER_ENV_VARS", "sanitized_subprocess_env"]
