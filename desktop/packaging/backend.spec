# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for the MiniMax Agent backend.
#
# Spike: prove the FastAPI backend in web/backend/main.py can be frozen
# into a standalone ONEDIR executable that runs without a Python install
# on the target machine. The output of this spec is consumed by
# desktop/scripts/dev.ps1 (or invoked directly via PyInstaller).
#
# Build:
#     cd "<PROJECT_ROOT>"
#     pyinstaller desktop/packaging/backend.spec --noconfirm
#
# Smoke test (with a stripped PATH so we know the exe does not depend
# on the system Python):
#     $env:MINIMAX_PROJECT_ROOT = "C:\\tmp\\spike-config"
#     $env:PATH = "C:\\Windows\\System32;C:\\Windows"
#     & "C:\\...\\dist\\backend\\backend.exe"

import os
import sys
from pathlib import Path

block_cipher = None

# Resolve project root (the directory that contains this .spec file's
# parent — `desktop/` — so we point at the repo root reliably).
PROJECT_ROOT = Path(SPECPATH).resolve().parent.parent

# --- Hidden imports ---
# Lazy modules that PyInstaller's static analysis cannot discover from
# the entry-point alone. These are imported inside try/except blocks
# and inside functions, so they never appear in the bytecode graph.
hiddenimports = [
    # uvicorn runtime — all submodules are dynamically selected
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",

    # HTTPX transports (the httpcore impls are loaded lazily)
    "httpx",
    "httpcore",
    "httpcore._sync",
    "httpcore._async",

    # Provider SDKs
    "anthropic",
    "anthropic._client",
    "openai",
    "openai._client",

    # MCP (used by web/backend/mcp_runtime.py and mcp_agent_tools.py)
    "mcp",
    "mcp.client",
    "mcp.client.stdio",
    "mcp.client.sse",

    # Local top-level packages
    "mini_agent",
    "mini_agent.tools",
    "mini_agent.tools.media_tools",
    "mini_max_mcp",
    "mini_max_mcp.mcp_tool_wrapper",
    "mini_max_mcp.mcp_tools",

    # Sibling .py modules that live next to main.py
    "mcp_runtime",
    "mcp_agent_tools",

    # tiktoken extension package — historically a separate install,
    # in newer versions it is vendored. Listing it is harmless if absent
    # at import time, so we keep it for forward/backward compatibility.
    "tiktoken_ext",
    "tiktoken_ext.openai_public",
]

# --- Data files bundled into the frozen exe ---
# Each entry is (source_path_relative_to_PROJECT_ROOT_or_absolute, dest_dir_in_bundle)
datas = [
    # certifi's CA bundle — required for any TLS connection the
    # backend makes (and httpx/anthropic/openai do).
    (str(Path(sys.executable).parent / "Lib" / "site-packages" / "certifi" / "cacert.pem"),
     "certifi"),

    # mini_agent/skills — the agent runtime discovers and loads skill
    # .py files at runtime; they must travel with the bundle.
    (str(PROJECT_ROOT / "mini_agent" / "skills"), "mini_agent/skills"),
]

# --- Heavyweight excludes ---
# The backend does not use these, and pulling them in bloats the
# onedir by ~1GB.
excludes = [
    "gradio",
    "gradio_client",
    "PyQt6",
    "PyQt6.QtCore",
    "PyQt6.QtGui",
    "PyQt6.QtWidgets",
    "playwright",
    "patchright",
    "pandas",
    "matplotlib",
    "altair",
    "reportlab",
    "PyMuPDF",
    "fitz",
    "pdfplumber",
    "pdf2image",
    "PIL.ImageQt",
    "tkinter",
    "scrapling",
    "browserforge",
    "apify_fingerprint_datapoints",
    "test",
    "tests",
    "pytest",
    "curl_cffi",
]


a = Analysis(
    [str(PROJECT_ROOT / "web" / "backend" / "main.py")],
    pathex=[str(PROJECT_ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,   # onedir: binários vão em _internal/
    name="backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,             # console app — uvicorn prints to stdout
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="backend",
)
