"""Tests for mini_agent.process_env — the issue #2 linker fix.

Issue #2 (Arch / Niri, Tauri AppImage + PyInstaller backend): every agent
``bash()`` call died with::

    /bin/sh: symbol lookup error: /bin/sh: undefined symbol: rl_print_keybinding

Cause: the AppImage runtime and the PyInstaller bootloader both push their
own library directory into ``LD_LIBRARY_PATH``. The backend inherited that
and passed it straight through to every child, so the dynamic linker
resolved the bundle's older ``libreadline.so.8`` instead of the host's and
bash failed to link.

These tests pin the sanitization rules. They force the Linux code path via
``sys.platform`` patching because CI (and the maintainer's machine) is
Windows, where this module is deliberately a no-op.
"""

import sys
from pathlib import Path

import pytest

from mini_agent import process_env
from mini_agent.process_env import (
    LINKER_ENV_VARS,
    _bundle_roots,
    _is_bundle_path,
    sanitized_subprocess_env,
)

# A realistic AppImage layout: the bundle lives on a FUSE mount named
# /tmp/.mount_MiniMaxStuXXXXXX, and LD_LIBRARY_PATH points at its usr/lib
# plus the PyInstaller _internal dir *inside* the frozen exe dir.
APPDIR = "/tmp/.mount_MiniMaxStu7Xk9a/usr"
APPIMAGE_LIB = f"{APPDIR}/lib"
MEIPASS = f"{APPDIR}/lib/backend/_internal"


@pytest.fixture
def linux_frozen(monkeypatch):
    """Pretend to be Linux, running frozen, with the AppImage env set."""
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(sys, "_MEIPASS", MEIPASS, raising=False)
    monkeypatch.setattr(sys, "executable", f"{APPDIR}/lib/backend/backend", raising=False)
    monkeypatch.setenv("LD_LIBRARY_PATH", f"{APPIMAGE_LIB}:{MEIPASS}:/usr/local/lib")
    monkeypatch.setenv("LD_PRELOAD", f"{APPIMAGE_LIB}/libwayland-client.so.0")
    return monkeypatch


# ─────────────────────────────────────────────────────────────────────────────
# _is_bundle_path — the detection rules
# ─────────────────────────────────────────────────────────────────────────────

class TestIsBundlePath:
    def test_detects_appimage_fuse_mount(self):
        # The mount root is a *parent* of the exe dir, so a containment
        # check against sys.executable alone would miss it.
        assert _is_bundle_path(APPIMAGE_LIB, []) is True
        assert _is_bundle_path(f"{APPDIR}/lib/backend/_internal", []) is True

    def test_keeps_system_paths(self):
        assert _is_bundle_path("/usr/lib", []) is False
        assert _is_bundle_path("/usr/local/lib", []) is False
        assert _is_bundle_path("/opt/cuda/lib64", []) is False

    def test_empty_entry_is_not_bundle(self):
        assert _is_bundle_path("", []) is False

    def test_respects_meipass_root_when_provided(self, tmp_path):
        roots = [str(tmp_path)]
        assert _is_bundle_path(str(tmp_path / "_internal"), roots) is True
        assert _is_bundle_path("/usr/lib", roots) is False


# ─────────────────────────────────────────────────────────────────────────────
# sanitized_subprocess_env — the behavior that actually fixes the bug
# ─────────────────────────────────────────────────────────────────────────────

class TestSanitizedEnv:
    def test_strips_appimage_entries_and_keeps_system_ones(self, linux_frozen):
        env = sanitized_subprocess_env()
        assert APPIMAGE_LIB not in env["LD_LIBRARY_PATH"]
        assert MEIPASS not in env["LD_LIBRARY_PATH"]
        # A user's own system path must survive untouched.
        assert env["LD_LIBRARY_PATH"] == "/usr/local/lib"

    def test_drops_preload_pointing_into_bundle(self, linux_frozen):
        env = sanitized_subprocess_env()
        # Every LD_PRELOAD entry was ours, so the var is removed entirely
        # and the child falls back to the system loader config.
        assert "LD_PRELOAD" not in env

    def test_variable_removed_when_all_entries_are_ours(self, linux_frozen):
        linux_frozen.setenv("LD_LIBRARY_PATH", f"{APPIMAGE_LIB}:{MEIPASS}")
        env = sanitized_subprocess_env()
        assert "LD_LIBRARY_PATH" not in env

    def test_preserves_deliberate_user_preload(self, linux_frozen):
        linux_frozen.setenv("LD_PRELOAD", "/opt/mylib/libfoo.so")
        env = sanitized_subprocess_env()
        assert env["LD_PRELOAD"] == "/opt/mylib/libfoo.so"

    def test_other_env_vars_are_untouched(self, linux_frozen):
        linux_frozen.setenv("MY_APP_SETTING", "keep-me")
        assert sanitized_subprocess_env()["MY_APP_SETTING"] == "keep-me"

    def test_does_not_mutate_os_environ(self, linux_frozen):
        before = dict(process_env.os.environ)
        sanitized_subprocess_env()
        assert dict(process_env.os.environ) == before


class TestNonLinux:
    def test_is_noop_on_windows(self, monkeypatch):
        """Windows uses PATH, not LD_*, so the module must not touch it."""
        monkeypatch.setattr(sys, "platform", "win32")
        monkeypatch.setenv("LD_LIBRARY_PATH", f"{APPIMAGE_LIB}:/usr/lib")
        assert sanitized_subprocess_env()["LD_LIBRARY_PATH"] == f"{APPIMAGE_LIB}:/usr/lib"

    def test_is_noop_on_macos(self, monkeypatch):
        monkeypatch.setattr(sys, "platform", "darwin")
        monkeypatch.setenv("LD_LIBRARY_PATH", APPIMAGE_LIB)
        assert sanitized_subprocess_env()["LD_LIBRARY_PATH"] == APPIMAGE_LIB

    def test_is_noop_when_running_from_source(self, monkeypatch):
        """No _MEIPASS and no .mount_ prefix -> nothing of ours to strip."""
        monkeypatch.setattr(sys, "platform", "linux")
        monkeypatch.delattr(sys, "_MEIPASS", raising=False)
        monkeypatch.setattr(sys, "executable", "/usr/bin/python3", raising=False)
        monkeypatch.setenv("LD_LIBRARY_PATH", "/usr/local/lib")
        assert sanitized_subprocess_env()["LD_LIBRARY_PATH"] == "/usr/local/lib"


class TestExplicitBase:
    def test_sanitizes_a_partial_env_dict(self, linux_frozen):
        env = sanitized_subprocess_env({"LD_LIBRARY_PATH": f"{MEIPASS}:/usr/lib", "API_KEY": "k"})
        assert env["LD_LIBRARY_PATH"] == "/usr/lib"
        assert env["API_KEY"] == "k"

    def test_does_not_pull_in_os_environ(self, linux_frozen):
        linux_frozen.setenv("LEAKY_PARENT_VAR", "should-not-appear")
        assert "LEAKY_PARENT_VAR" not in sanitized_subprocess_env({"API_KEY": "k"})


def test_linker_vars_cover_library_path_and_preload():
    assert "LD_LIBRARY_PATH" in LINKER_ENV_VARS
    assert "LD_PRELOAD" in LINKER_ENV_VARS


def test_bundle_roots_empty_when_not_frozen(monkeypatch):
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    monkeypatch.setattr(sys, "executable", "", raising=False)
    assert _bundle_roots() == []


def test_process_env_module_is_importable_from_frozen_paths():
    """The module must be a plain top-level import (PyInstaller-safe)."""
    assert Path(process_env.__file__).name == "process_env.py"
