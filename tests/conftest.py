"""Shared test configuration.

Sets MINIMAX_PROJECT_ROOT once, before any test module imports
``web.backend.main``. This prevents cross-module PROJECT_ROOT drift:
without it, whichever test module is collected first binds the env
var, and subsequent modules that set it to a different value have no
effect (main is already imported).

All test modules that need to write to the workspace should use
``_main.get_app_workspace_dir()`` to resolve paths — NOT their own
TMP_ROOT. This ensures writes and API-handled reads/deletes share the
same root.
"""
import os
import tempfile
from pathlib import Path

if not os.environ.get("MINIMAX_PROJECT_ROOT"):
    _TMP = Path(tempfile.mkdtemp(prefix="minimax_test_"))
    os.environ["MINIMAX_PROJECT_ROOT"] = str(_TMP)
