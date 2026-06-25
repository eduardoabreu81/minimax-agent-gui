"""MiniMax Agent Web — FastAPI backend."""

import os
import sys
import json
import uuid
import time
import asyncio
import logging
from pathlib import Path
from contextlib import asynccontextmanager
from datetime import datetime

# Add project root to path so we can import mini_agent and mini_max_mcp
PROJECT_ROOT = Path(__file__).parent.parent.parent
# Allow frozen / packaged executables (PyInstaller onedir, Tauri sidecar)
# to redirect data + import root via env var. When bundled, __file__ points
# inside _internal/ which is not a writable project root.
# MINIMAX_PROJECT_ROOT is set by the Tauri shell wrapper
# (desktop/src-tauri/src/lib.rs:82) and by ops who run the exe outside the
# source tree.
_env_root = os.environ.get("MINIMAX_PROJECT_ROOT")
if _env_root:
    PROJECT_ROOT = Path(_env_root)
sys.path.insert(0, str(PROJECT_ROOT))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, BackgroundTasks, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from pydantic import BaseModel, Field, model_validator
from typing import Optional, Literal
import httpx

# Import our existing Python modules
from mini_agent.config import Config as AgentConfig
from mini_agent import Agent, LLMClient
from mini_agent.tools import ReadTool, WriteTool, BashTool
from mini_agent.schema import Message
from mini_agent.tools.skill_loader import SkillLoader

# Agent context system (SOUL/IDENTITY/USER/MEMORY/daily).
# See web/backend/agent_context.py + web/backend/i18n.py.
from agent_context import (
    load_agent_context,
    render_memory_prompt,
    render_simple_prompt,
    AgentContext,
    CHAR_LIMITS,
    append_daily_turn,
    list_recent_dailies,
)

from i18n import (
    SUPPORTED as I18N_SUPPORTED,
    lang_or_default,
    preset_label,
    role_label,
    role_body,
    PRESETS as I18N_PRESETS,
    ROLES as I18N_ROLES,
)

from mini_max_mcp.client import MiniMaxSyncClient, MiniMaxClient
from mini_max_mcp.pricing import (
    calculate_image_cost,
    calculate_mcp_vlm_cost,
    calculate_music_cost,
    calculate_tts_cost,
    calculate_video_cost,
)
from mcp_runtime import test_mcp_server

logging.basicConfig(level=logging.INFO)
_logger = logging.getLogger(__name__)


def _log_compact_event(payload: dict) -> None:
    """Emit a structured compact-event log line (JSON, one line).

    Companion to ``Agent._log_compact_event`` for events that originate
    outside the agent (e.g. the WebSocket ``compact`` handler in
    ``chat_websocket``). The frontend and the backend can both trigger
    a summary; this helper unifies the log shape so dashboards ingest
    the same format regardless of which path fired. Payload is echoed
    verbatim — callers fill in ``event``, ``compact_id``, ``session_id``,
    ``triggered_by`` (and any other fields like ``before_tokens`` /
    ``pct_before`` / ``delta_tokens``).
    """
    _logger.info(json.dumps(payload))


def _build_mcp_section(mcp_tools) -> str:
    """Build the unified ``## MCP Servers`` block for the system prompt.

    The agent sees a single section that lists the MiniMax built-in
    servers (always present) and the user's own configured MCP
    servers (only when at least one is loaded). The shape matches
    the Settings panel: a "MiniMax (built-in)" sub-block and a
    "Custom (user-configured)" sub-block inside the same Card.

    Args:
        mcp_tools: List of ``ExternalMCPTool`` (or any object with
            ``.server_id`` and ``.server_config``) loaded by
            ``load_mcp_tools_for_agent``. May be empty or None.

    Returns:
        A markdown string starting with ``\\n\\n## MCP Servers`` and
        containing both sub-blocks. The Custom sub-block is only
        emitted when there's at least one user-configured server
        with tools.
    """
    section = "\n\n## MCP Servers\n"

    # Sub-block A: MiniMax built-in servers. Always present.
    #
    # The "How MCP tools reach you" paragraph below is load-bearing
    # for preventing the agent from hallucinating shell commands
    # like `claude mcp list` / `claude mcp add` (Claude Code CLI
    # patterns bleeding through from training data). MCP tools in
    # this app are exposed as native Anthropic `tool_use` functions
    # — they're in the `tools` array of every request, not behind a
    # shell command. The agent should never run bash to discover or
    # install MCP servers. If a tool the user asked about isn't in
    # the function list, it was toggled off in Settings (or the
    # server failed to start), not "needs to be installed".
    section += (
        "\n### MiniMax (built-in)\n"
        "Two MCP servers from MiniMax are always available:\n"
        "- **web_search**: searches the web for real-time information. "
        "Use this whenever the user asks about current events, recent "
        "news, or anything that might be outside your training cutoff.\n"
        "- **understand_image**: analyzes an image and returns a "
        "description. Use this whenever the user attaches an image "
        "(path or URL) and asks for analysis, OCR, or visual Q&A.\n\n"
        "How MCP tools reach you: MiniMax exposes MCP tools as native "
        "function-call definitions in the `tools` array of every "
        "request — you receive them the same way you receive the "
        "built-in tools (`read_file`, `write_file`, `bash`, etc.). "
        "You do NOT need to run shell commands to discover, install, "
        "or list MCP servers. Specifically:\n"
        "- NEVER run `claude mcp list`, `claude mcp add`, "
        "`npx @modelcontextprotocol/...`, `pip install mcp-...`, "
        "or any other shell command to discover or configure MCP "
        "servers. There is no `claude` CLI in this app — the name "
        "is a coincidence with the protocol, not a tool.\n"
        "- To see what's available, look at the `functions` in your "
        "current request. Anything listed there is callable right now.\n"
        "- If a tool the user mentioned isn't in the list, it was "
        "toggled OFF in Settings → MCP Servers, or its server failed "
        "to start at session boot. Tell the user plainly instead of "
        "trying to install it yourself.\n\n"
        "Both tools live on the MiniMax coding-plan endpoint and "
        "respect the same auth as the chat model."
    )

    if not mcp_tools:
        return section

    # Sub-block B: Custom (user-configured) servers. Group
    # tools by server_id so the agent gets a per-server count
    # + display name. Only emit when at least one server
    # produced tools (empty groups are noise).
    by_server = {}
    for tool in mcp_tools:
        sid = getattr(tool, "server_id", None)
        if not sid:
            continue
        by_server.setdefault(sid, []).append(tool)

    if not by_server:
        return section

    section += "\n### Custom (user-configured)\n"
    section += (
        "The following user-configured MCP servers are "
        "loaded into this session:\n"
    )
    for sid, tools in by_server.items():
        display_name = sid
        first = tools[0] if tools else None
        if first is not None and hasattr(first, "server_config") \
                and isinstance(first.server_config, dict):
            configured = first.server_config.get("name") or sid
            if configured:
                display_name = configured
        # When the user didn't supply a display name, just use
        # the id alone — "**filesystem** — 3 tool(s)" reads
        # better than "**filesystem** (filesystem) — 3 tool(s)".
        if display_name == sid:
            section += f"- **{sid}** — {len(tools)} tool(s)\n"
        else:
            section += f"- **{sid}** ({display_name}) — {len(tools)} tool(s)\n"
    section += (
        "Tool names are prefixed with `mcp_{server_id}_`. "
        "Use them when relevant to the task at hand. "
        "If a server is listed but no tools show up at "
        "call time, the server may have failed to start — "
        "report the failure rather than retrying blindly."
    )
    return section

# Load config
CONFIG_PATH = PROJECT_ROOT / "config" / "config.yaml"
try:
    config = AgentConfig.from_yaml(str(CONFIG_PATH)) if CONFIG_PATH.exists() else {}
except Exception:
    import yaml
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f) or {}
    else:
        config = {}


class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"


class GenerateRequest(BaseModel):
    prompt: str = ""
    model: str = ""
    settings: dict = {}

class ImageRequest(BaseModel):
    prompt: str
    aspect_ratio: str = "1:1"
    width: int = None
    height: int = None
    n: int = 1
    prompt_optimizer: bool = False
    watermark: bool = False
    seed: int = None
    # i2i: same endpoint as T2I but with subject_reference + model "image-01-live"
    model: str = "image-01"
    subject_reference: list = None
    reference_image: str = ""  # legacy I2I: local file path (image_variations)


# --- Music Generation ---------------------------------------------------------
#
# Phase 1 of the Music API migration: text-to-music only. Cover generation
# (music-cover / music-cover-free) and lyrics generation come in later
# phases; their request fields are present in the schema (so we can
# 400 cleanly if anyone tries to mix them up) but the endpoint logic
# only handles the music-2.6 / music-2.6-free flow.
#
# audio_setting values come from the Music 2.6 spec — only the four
# sample_rates / four bitrates / three formats MiniMax publishes are
# valid. Anything else is rejected with a clear 400 instead of the
# cryptic 2013 from the API.

AUDIO_SAMPLE_RATES = (16000, 24000, 32000, 44100)
AUDIO_BITRATES = (32000, 64000, 128000, 256000)
AUDIO_FORMATS = ("mp3", "wav", "pcm")

MUSIC_GENERATION_MODELS = ("music-2.6", "music-2.6-free")
MUSIC_COVER_MODELS = ("music-cover", "music-cover-free")
# Reference audio constraints for the music-cover flow. The Token Plan API
# itself enforces these but we surface clean errors before the round-trip.
COVER_AUDIO_MAX_BYTES = 50 * 1024 * 1024          # 50 MB
COVER_AUDIO_MIN_SECONDS = 6
COVER_AUDIO_MAX_SECONDS = 6 * 60                  # 6 minutes
COVER_AUDIO_FORMATS = ("mp3", "wav", "flac", "m4a", "ogg", "aac")
COVER_PROMPT_MIN_CHARS = 10
COVER_PROMPT_MAX_CHARS = 300
COVER_LYRICS_WITH_FEATURE_MIN = 10
COVER_LYRICS_WITH_FEATURE_MAX = 1000


class AudioSetting(BaseModel):
    """Audio output configuration — mirrors the music generation API."""
    sample_rate: Literal[16000, 24000, 32000, 44100] = 44100
    bitrate: Literal[32000, 64000, 128000, 256000] = 256000
    format: Literal["mp3", "wav", "pcm"] = "mp3"


class MusicRequest(BaseModel):
    """Music generation / cover request.

    Phase 1 (text-to-music) accepts ``music-2.6`` and ``music-2.6-free``
    with prompt + lyrics + is_instrumental + lyrics_optimizer.

    Phase 2 (music cover) accepts ``music-cover`` and ``music-cover-free``
    with one of three audio-source combinations:
      - ``audio_url`` (HTTP/HTTPS URL to reference audio)
      - ``audio_base64`` (inline base64-encoded audio, ≤50MB raw)
      - ``cover_feature_id`` (from a prior ``/api/minimax/music/preprocess``
        call, valid 24h, MD5-dedup)
    These three are mutually exclusive.
    """
    model: Literal[
        "music-2.6", "music-2.6-free",
        "music-cover", "music-cover-free",
    ]
    prompt: str = ""
    lyrics: str = ""
    is_instrumental: bool = False
    lyrics_optimizer: bool = False
    filename: str = ""
    audio_setting: Optional[AudioSetting] = None
    # Phase 2 cover fields — validated only when model ∈ MUSIC_COVER_MODELS.
    audio_url: str = ""
    audio_base64: str = ""
    cover_feature_id: str = ""

    @model_validator(mode="after")
    def _check_required_fields(self):
        # Phase 1: cover-related params are not allowed with generation models.
        if self.model in MUSIC_GENERATION_MODELS:
            if self.audio_url or self.audio_base64 or self.cover_feature_id:
                raise ValueError(
                    "audio_url / audio_base64 / cover_feature_id are only "
                    "valid with music-cover or music-cover-free (Phase 2). "
                    "Phase 1 (music-2.6 / music-2.6-free) accepts prompt + "
                    "lyrics + is_instrumental + lyrics_optimizer + "
                    "audio_setting only."
                )

        # Phase 1 prompt requirements per MiniMax spec.
        if self.model in MUSIC_GENERATION_MODELS:
            if self.is_instrumental:
                # prompt required, 1-2000 chars; lyrics optional.
                if not self.prompt or len(self.prompt) > 2000:
                    raise ValueError(
                        "When is_instrumental=True, prompt is required "
                        "(1-2000 chars) to describe the music style."
                    )
            else:
                # Non-instrumental: lyrics required unless lyrics_optimizer=True.
                if not self.lyrics_optimizer:
                    if not self.lyrics or len(self.lyrics) > 3500:
                        raise ValueError(
                            "lyrics is required (1-3500 chars) when "
                            "is_instrumental=False and lyrics_optimizer=False. "
                            "Set lyrics_optimizer=true to auto-generate "
                            "lyrics from the prompt instead."
                        )
                # prompt is optional for non-instrumental, max 2000 chars.
                if len(self.prompt) > 2000:
                    raise ValueError("prompt exceeds 2000 char limit.")

        # Phase 2 cover flow.
        if self.model in MUSIC_COVER_MODELS:
            # Instrumental + lyrics_optimizer are not valid for cover models.
            if self.is_instrumental:
                raise ValueError(
                    "is_instrumental is not supported with music-cover "
                    "models. Cover always uses vocals from the reference "
                    "audio (or your custom lyrics)."
                )
            if self.lyrics_optimizer:
                raise ValueError(
                    "lyrics_optimizer is not supported with music-cover "
                    "models. Pass lyrics directly or let the API extract "
                    "them via ASR when using audio_url/audio_base64."
                )
            # Exactly one audio source must be provided.
            sources = sum(bool(x) for x in (self.audio_url, self.audio_base64, self.cover_feature_id))
            if sources == 0:
                raise ValueError(
                    "music-cover requires exactly one of audio_url, "
                    "audio_base64, or cover_feature_id."
                )
            if sources > 1:
                raise ValueError(
                    "audio_url, audio_base64, and cover_feature_id are "
                    "mutually exclusive — pass exactly one for music-cover."
                )
            # Prompt is always required for cover models.
            if not self.prompt or len(self.prompt) < COVER_PROMPT_MIN_CHARS:
                raise ValueError(
                    f"prompt is required for music-cover "
                    f"({COVER_PROMPT_MIN_CHARS}-{COVER_PROMPT_MAX_CHARS} chars) "
                    f"to describe the target cover style."
                )
            if len(self.prompt) > COVER_PROMPT_MAX_CHARS:
                raise ValueError(
                    f"prompt exceeds {COVER_PROMPT_MAX_CHARS} char limit for "
                    f"music-cover."
                )
            # Lyrics rules depend on which source was used.
            if self.cover_feature_id:
                # Two-step path: lyrics required (10-1000).
                if not self.lyrics or len(self.lyrics) < COVER_LYRICS_WITH_FEATURE_MIN:
                    raise ValueError(
                        f"lyrics is required ({COVER_LYRICS_WITH_FEATURE_MIN}"
                        f"-{COVER_LYRICS_WITH_FEATURE_MAX} chars) when using "
                        f"cover_feature_id — extract them first via "
                        f"/api/minimax/music/preprocess."
                    )
                if len(self.lyrics) > COVER_LYRICS_WITH_FEATURE_MAX:
                    raise ValueError(
                        f"lyrics exceeds {COVER_LYRICS_WITH_FEATURE_MAX} char "
                        f"limit when using cover_feature_id."
                    )
            else:
                # One-step path (audio_url / audio_base64): lyrics optional,
                # auto-extracted via ASR if missing. If provided, must fit
                # within the same 10-1000 range per the API spec.
                if self.lyrics and len(self.lyrics) < COVER_LYRICS_WITH_FEATURE_MIN:
                    raise ValueError(
                        f"When provided, lyrics must be at least "
                        f"{COVER_LYRICS_WITH_FEATURE_MIN} chars for music-cover."
                    )
                if self.lyrics and len(self.lyrics) > COVER_LYRICS_WITH_FEATURE_MAX:
                    raise ValueError(
                        f"lyrics exceeds {COVER_LYRICS_WITH_FEATURE_MAX} char "
                        f"limit for music-cover."
                    )

        return self


class CLIRequest(BaseModel):
    command: str
    args: list = []
    env: dict = {}


class MCPServerCreate(BaseModel):
    name: str
    transport: str
    command: Optional[str] = None
    args: list[str] = []
    env: dict[str, str] = {}
    url: Optional[str] = None
    enabled: bool = True


class MCPServerUpdate(BaseModel):
    name: Optional[str] = None
    transport: Optional[str] = None
    command: Optional[str] = None
    args: Optional[list[str]] = None
    env: Optional[dict[str, str]] = None
    url: Optional[str] = None
    enabled: Optional[bool] = None


def _generate_server_id(name: str) -> str:
    import re
    safe = re.sub(r'[^a-zA-Z0-9_-]', '-', name.strip().lower())
    safe = re.sub(r'-+', '-', safe).strip('-')
    return safe or 'mcp-server'


def _load_config_dict() -> dict:
    global config
    cfg = config
    if hasattr(cfg, 'to_dict'):
        cfg = cfg.to_dict()
    elif not isinstance(cfg, dict):
        cfg = {}
    return cfg


def _save_config_dict(cfg: dict):
    global config
    import yaml
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        yaml.dump(cfg, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    config = cfg


def get_minimax_config():
    """Get MiniMax config with region-based api_base."""
    global config
    # Ensure config is a dict (AgentConfig may return an object)
    cfg = config
    if hasattr(cfg, 'to_dict'):
        cfg = cfg.to_dict()
    elif not isinstance(cfg, dict):
        cfg = {}
    
    minimax_config = cfg.get("minimax", {}) if isinstance(cfg, dict) else {}
    if not isinstance(minimax_config, dict):
        minimax_config = {}
    
    api_key = minimax_config.get("api_key", "")
    region = minimax_config.get("region", "global")
    # Map region to base URL
    if region == "cn":
        api_base = "https://api.minimaxi.com"
    else:
        api_base = minimax_config.get("api_base", "https://api.minimax.io")
    
    _logger.debug(f"get_minimax_config: region={region}, api_base={api_base}, key_set={bool(api_key)}")
    return {
        "api_key": api_key,
        "api_base": api_base,
        "region": region,
        "plan": minimax_config.get("plan", ""),
    }


# --- Conversation persistence ---
CONVERSATIONS_DIR = PROJECT_ROOT / "workspace" / "conversations"
CONVERSATIONS_DIR.mkdir(parents=True, exist_ok=True)


def _conv_path(conv_id: str) -> Path:
    return CONVERSATIONS_DIR / f"{conv_id}.json"


# --- Conversation persistence layer ---
#
# All conversation storage goes through ``conversation_store``
# (Protocol + JSONConversationStore in conv_store.py). When scale
# demands (>500 conversations, >1k messages each, or full-text search /
# multi-user / cloud sync in the roadmap), swap the factory below to a
# SQLiteConversationStore implementing the same Protocol — no caller
# changes needed.
from conv_store import JSONConversationStore, ConversationStore
conversation_store: ConversationStore = JSONConversationStore(CONVERSATIONS_DIR)

from context_refs import (  # noqa: E402  (import after conv_store by convention)
    parse_refs,
    expand_refs,
)

from subdirectory_hints import (  # noqa: E402  (PR D — progressive subdir discovery)
    SubdirectoryHintTracker,
    format_hints_for_model,
)


# --- App workspace + coding workspace management (v0.5 redesign) ---
#
# Two distinct concepts now:
#
# 1) APP WORKSPACE — fixed, owned by the MiniMax Studio app.
#    Located at ``PROJECT_ROOT / "workspace"`` (= ``%APPDATA%/com.minimax.agent.desktop/workspace``
#    when launched via the Tauri shell). Holds user data that is NOT
#    tied to a coding project: chat/coding conversations, task board,
#    uploads, media generations, profile, settings snapshot. Lives there
#    regardless of which coding project the user is working on.
#
# 2) CODING WORKSPACE — picked per session from the CodingPanel header
#    (a real folder the user wants the agent to read/write into). Tools
#    like Read/Write/Edit/Bash resolve paths relative to this folder.
#    Locked after the first message of the session. Media generated
#    inside a coding session lands in ``<coding-workspace>/outputs/``
#    instead of polluting the user's project or the app workspace.
#
# Both ``PROJECT_ROOT`` (set by Tauri via ``MINIMAX_PROJECT_ROOT``) and
# the per-session ``coding_workspace_dir`` are persisted in
# config.yaml under ``recent_coding_workspaces`` so the next session can
# pre-fill the picker with the last few projects (VSCode-style).


def _media_output_dir(session_id: str, media_kind: str) -> Path:
    """Where generated media of ``media_kind`` (one of "images",
    "videos", "music", "tts") should land for this session.

    Coding sessions with a workspace attached → ``<coding-workspace>/outputs/<kind>``.
    Everything else → ``<app-workspace>/generations/<kind>`` (the
    pre-v0.5 location, preserved for backwards-compat reads).
    """
    if session_id and session_id.startswith("coding-"):
        ws = _load_coding_workspace_for_session(session_id)
        if ws:
            d = Path(ws) / "outputs" / media_kind
            d.mkdir(parents=True, exist_ok=True)
            return d
    d = get_app_workspace_dir() / "generations" / media_kind
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_app_workspace_dir() -> Path:
    """The fixed app workspace — `PROJECT_ROOT/workspace`.

    Always returns an absolute Path, creating the directory if missing.
    This is where app-wide artifacts (conversations, tasks, uploads,
    media generations) live. It does NOT change between coding projects.
    """
    p = PROJECT_ROOT / "workspace"
    p.mkdir(parents=True, exist_ok=True)
    return p


def get_session_workspace_dir(session_id: str) -> Path:
    """Resolve the effective workspace dir for a given session.

    - Coding sessions (id starts with ``coding-``) use the
      ``coding_workspace_dir`` they were started with, falling back to
      the app workspace when none has been set yet (so the first call
      to ``/api/files?path=...`` before the user picks a folder does
      not 500 — it lists the app workspace instead).
    - All other sessions use the app workspace.

    Returns an absolute Path. Does NOT create the directory — the
    caller decides whether to mkdir (CodingPanel wants the user to pick
    a real folder; files endpoints create it on demand).
    """
    if session_id.startswith("coding-"):
        cw = _load_coding_workspace_for_session(session_id)
        if cw:
            return Path(cw)
    return get_app_workspace_dir()


# Top-N cap for the recent-workspaces list (VSCode uses 10).
RECENT_WORKSPACES_LIMIT = 10


def _load_config_dict() -> dict:
    """Read the current config as a plain dict (the in-memory ``config``
    might be a Pydantic object after AgentConfig.from_yaml)."""
    try:
        if hasattr(config, "to_dict"):
            return config.to_dict()
    except Exception:
        pass
    if isinstance(config, dict):
        return config
    return {}


def _save_config_dict(cfg: dict) -> None:
    """Persist a dict-form config to ``CONFIG_PATH`` and update the
    in-memory ``config`` global."""
    global config
    import yaml
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        yaml.dump(cfg, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    config = cfg


def _load_recent_coding_workspaces() -> list[dict]:
    """Return the recent-coding-workspaces list (newest first).

    Each entry is ``{"path": str, "last_used": iso8601, "label": str}``.
    Missing/corrupt config → ``[]``.
    """
    cfg = _load_config_dict()
    raw = cfg.get("recent_coding_workspaces") or []
    if not isinstance(raw, list):
        return []
    out = []
    for entry in raw:
        if isinstance(entry, dict) and isinstance(entry.get("path"), str):
            out.append({
                "path": entry["path"],
                "last_used": entry.get("last_used", ""),
                "label": entry.get("label") or Path(entry["path"]).name or entry["path"],
            })
    return out


def _add_recent_coding_workspace(path: str) -> list[dict]:
    """Push a workspace path onto the recent list (MRU + dedupe + cap).

    Returns the updated list. Persists to config.yaml.
    """
    cfg = _load_config_dict()
    path = str(Path(path).resolve()) if path else ""
    if not path:
        return _load_recent_coding_workspaces()

    existing = cfg.get("recent_coding_workspaces")
    if not isinstance(existing, list):
        existing = []

    now_iso = datetime.now().isoformat(timespec="seconds")
    label = Path(path).name or path

    # Remove any earlier entry with the same resolved path (dedupe).
    existing = [
        e for e in existing
        if not (isinstance(e, dict) and Path(str(e.get("path", ""))).resolve() == Path(path))
    ]
    existing.insert(0, {"path": path, "last_used": now_iso, "label": label})
    existing = existing[:RECENT_WORKSPACES_LIMIT]

    cfg["recent_coding_workspaces"] = existing
    _save_config_dict(cfg)
    return _load_recent_coding_workspaces()


# Map of session_id -> {workspace_dir: str|None, locked: bool}.
# Held in-process only (sessions are not persisted across restarts by
# design — the per-session workspace is re-attached when the frontend
# opens an existing conversation).
_coding_sessions: dict[str, dict] = {}


def _load_coding_workspace_for_session(session_id: str) -> str | None:
    """Return the workspace_dir attached to this session, if any.

    First checks the in-process map, then falls back to the conversation
    metadata (saved on disk when the user picks a folder), so the
    workspace survives a backend restart within the same conversation.
    """
    sess = _coding_sessions.get(session_id)
    if sess and sess.get("workspace_dir"):
        return sess["workspace_dir"]
    conv = load_conversation(session_id)
    ws = conv.get("workspace_dir") if isinstance(conv, dict) else None
    return ws if isinstance(ws, str) and ws else None


def _attach_coding_workspace(session_id: str, workspace_dir: str) -> None:
    """Persist the coding workspace for a session in both the in-process
    map AND the on-disk conversation metadata."""
    sess = _coding_sessions.setdefault(session_id, {"locked": False, "workspace_dir": None})
    if sess.get("locked"):
        raise HTTPException(
            status_code=409,
            detail="This coding session is locked — workspace cannot be changed after the first message.",
        )
    sess["workspace_dir"] = str(Path(workspace_dir).resolve())
    # Mirror onto the conversation JSON so it survives a backend restart.
    conv = load_conversation(session_id)
    if isinstance(conv, dict):
        conv["workspace_dir"] = sess["workspace_dir"]
        save_conversation_raw(conv)


def _lock_coding_session(session_id: str) -> None:
    """Lock a coding session — no more workspace changes allowed.

    Called by the WebSocket handler right before the agent processes
    the first user message of the session. Idempotent.
    """
    sess = _coding_sessions.setdefault(session_id, {"locked": False, "workspace_dir": None})
    sess["locked"] = True


def save_conversation_raw(conv: dict) -> None:
    """Save a fully-built conversation dict (no timestamp juggling).

    Used by helpers that already loaded the conversation and just want
    to persist mutated metadata (e.g. ``workspace_dir``) without
    touching the title/updated_at bookkeeping. Bypasses the store's
    timestamp logic on purpose.
    """
    conv_id = conv.get("id")
    if not conv_id:
        return
    path = conversation_store.dir / f"{conv_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(conv, f, ensure_ascii=False, indent=2)


# --- Task board persistence ---
# Single JSON file holds all tasks. Pattern matches conversation storage:
# one file = one atomic write per mutation, easy to inspect with cat/jq,
# no DB lock contention for an MVP-scale task board.
TASKS_FILE = PROJECT_ROOT / "workspace" / "tasks.json"

VALID_TASK_STATUSES = {"pending", "in-progress", "review", "done"}
VALID_TASK_PRIORITIES = {"high", "medium", "low"}


# --- WebSocket registry for cross-session broadcasts (PR C: Live Todo) ---
# Maps session_id -> set of currently-connected WebSockets. Used by
# the Live Todo Progress feature in CodingPanel: when a task is
# created/updated (via the UI endpoint OR the agent's tasks tool),
# we broadcast a ``task_updated`` event to every connected WebSocket
# whose session_id matches the task's ``source_session_id`` (or
# ALL sessions if the task has no source_session_id, which is the
# case for tasks created from the standalone TaskBoard panel).
#
# The registry is module-level because chat_websocket is a
# per-session handler — without a shared registry we couldn't
# broadcast to other sessions.
_ws_registry: dict[str, set] = {}


def register_ws(session_id: str, ws) -> None:
    """Add a WebSocket to the per-session registry."""
    _ws_registry.setdefault(session_id, set()).add(ws)


def unregister_ws(session_id: str, ws) -> None:
    """Remove a WebSocket from the per-session registry. Safe
    even if the session_id is unknown (e.g. disconnect race)."""
    bucket = _ws_registry.get(session_id)
    if bucket is None:
        return
    bucket.discard(ws)
    if not bucket:
        _ws_registry.pop(session_id, None)


async def broadcast_task_event(task: dict, action: str) -> None:
    """Send a ``task_updated`` event to every WebSocket subscribed
    to the task's source_session_id. Tasks without a
    source_session_id (created from the TaskBoard panel) go to
    ALL connected sessions.

    Errors are swallowed (best-effort broadcast). A dead
    WebSocket just means we fail to deliver to it; the task
    itself is already persisted to disk.

    Async because the underlying ``ws.send_json()`` is async. The
    HTTP ``/api/tasks`` endpoints await this directly; the
    agent's task tool wraps it via ``asyncio.create_task`` in
    the on_change callback (see the registration block).
    """
    source = task.get("source_session_id")
    payload = {
        "type": "task_updated",
        "action": action,  # "create" | "update"
        "task": task,
    }
    if source is None:
        # No source_session_id — broadcast to ALL open sessions
        # (so a task created from the TaskBoard panel shows up in
        # every open CodingPanel side panel).
        targets = [
            ws for bucket in _ws_registry.values() for ws in bucket
        ]
    else:
        targets = list(_ws_registry.get(source, set()))

    for ws in targets:
        try:
            await ws.send_json(payload)
        except Exception as e:
            # Don't let one bad WS kill the broadcast loop. The
            # WS will be unregistered on disconnect anyway.
            _logger.debug(f"broadcast_task_event: WS send failed: {e}")


def _load_tasks() -> list:
    """Load all tasks from disk. Returns [] if file missing/corrupt."""
    if not TASKS_FILE.exists():
        return []
    try:
        with open(TASKS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_tasks(tasks: list):
    """Atomic write — tmp file + rename so concurrent reads never see partial JSON."""
    TASKS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = TASKS_FILE.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(tasks, f, ensure_ascii=False, indent=2)
    tmp.replace(TASKS_FILE)


def _next_task_order(tasks: list) -> int:
    """Next order value for drag&drop placement (appended to end)."""
    if not tasks:
        return 0
    return max((t.get("order", 0) for t in tasks), default=-1) + 1


def _generate_task_id() -> str:
    return f"task-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}"


def _serialize_task(task: dict) -> dict:
    """Return a stable shape for API responses. Adds server-derived fields
    that the frontend can render directly (created_by badge, is_done flag)."""
    return {
        "id": task["id"],
        "title": task.get("title", ""),
        "description": task.get("description", ""),
        "status": task.get("status", "pending"),
        "priority": task.get("priority", "medium"),
        "subtasks": task.get("subtasks", []),
        "order": task.get("order", 0),
        "created_at": task.get("created_at"),
        "updated_at": task.get("updated_at"),
        "created_by": task.get("created_by", "user"),
        "source_session_id": task.get("source_session_id"),
    }


def list_conversations() -> list:
    """List all saved conversations, newest first.

    Thin wrapper around ``conversation_store.list_all`` to keep
    existing callers working. See ``conv_store.ConversationStore``.
    """
    return conversation_store.list_all("")


def load_conversation(conv_id: str) -> dict:
    """Load a conversation by ID. Thin wrapper around the store."""
    return conversation_store.load(conv_id)


def _hydrate_agent_messages(agent, session_id: str) -> int:
    """Populate ``agent.messages`` from the persisted conversation JSON.

    Called when a fresh Agent is created (e.g. after server restart, or
    for a session we haven't seen yet) so the API has full context of
    what was previously discussed. Without this, a reloaded chat shows
    the old messages visually (frontend receives them via the
    ``history`` WebSocket event) but the agent loop starts with an
    empty conversation and answers without remembering anything.

    Tool/system messages are skipped — only user + assistant turns are
    loaded, plus the assistant's stored thinking block so the agent
    can recall its own prior reasoning.

    Returns:
        Number of messages hydrated (for logging).
    """
    conv = load_conversation(session_id)
    if not conv or not conv.get("messages"):
        return 0

    hydrated = 0
    for msg in conv["messages"]:
        msg_type = msg.get("type", "user")
        content = msg.get("content", msg.get("text", ""))
        if msg_type == "user":
            agent.messages.append(Message(role="user", content=content))
            hydrated += 1
        elif msg_type == "assistant":
            assistant_msg = Message(role="assistant", content=content)
            if msg.get("thinking"):
                assistant_msg.thinking = msg["thinking"]
            agent.messages.append(assistant_msg)
            hydrated += 1
        # Skip system (handled by system_prompt) and tool turns (would
        # need tool_call_id re-association to be useful; safe to drop
        # because the assistant text already conveys the outcome).

    if hydrated:
        _logger.info(
            f"Hydrated session '{session_id}' with {hydrated} message(s) "
            f"from persisted conversation (agent.messages now {len(agent.messages)} total)."
        )
    return hydrated


def save_conversation(conv_id: str, title: str, messages: list):
    """Save a conversation to disk.

    Thin wrapper around ``conversation_store.save``. Existing callers
    don't pass ``workspace_dir`` (chat sessions only); coding sessions
    use ``save_conversation_raw`` to update metadata without touching
    the title/messages bookkeeping.
    """
    conversation_store.save(conv_id, title, messages)


def delete_conversation(conv_id: str) -> bool:
    """Delete a conversation by ID. Thin wrapper around the store."""
    return conversation_store.delete(conv_id)


def get_conversation_title(messages: list) -> str:
    """Generate a title from the first user message."""
    for msg in messages:
        if msg.get("type") == "user" or msg.get("is_user"):
            text = msg.get("content", msg.get("text", "")).strip()
            if text:
                return text[:40] + ("..." if len(text) > 40 else "")
    return "New Chat"


def search_conversations(query: str, type_filter: str = "") -> list:
    """Search conversations by title, message content, or attachment.

    Thin wrapper around ``conversation_store.search``.
    """
    return conversation_store.search(query, type_filter=type_filter)


class SessionManager:
    """Manages agent sessions in memory.

    Per the v0.5 workspace redesign, the effective workspace for a
    session is resolved via ``get_session_workspace_dir(session_id)``:

      - Coding sessions (``coding-...``) use the workspace the user
        picked in the CodingPanel header (falling back to the app
        workspace until they pick one).
      - Everything else uses the fixed app workspace.

    Tools (Read/Write/Edit/Bash + media) are constructed against that
    resolved path, so the agent reads/writes in the right place without
    needing to know which kind of session it is.

    Per Agent Context spec §2.2: when the user edits an .agent/*.md file
    via PUT /api/agent-context/{file}, the in-memory agent cache must
    be invalidated so the next session reloads from disk. Use
    ``invalidate(session_id)`` for one or ``invalidate_all()`` after
    a global edit (e.g. onboarding wizard writing 4 files).
    """

    def __init__(self):
        self.sessions = {}
        self.config = config

    def evict(self, session_id: str) -> None:
        """Drop a cached agent — used when:

        - the coding workspace changes before the session is locked
          (the agent was built against the old workspace and would
          point at the wrong files); or
        - the user edits an ``.agent/*.md`` file via
          ``PUT /api/agent-context/{file}`` (the agent was built
          against the old snapshot and would carry the stale system
          prompt — per Agent Context spec §2.2 the next session must
          reload from disk).
        """
        self.sessions.pop(session_id, None)

    def invalidate_all(self) -> int:
        """Drop all cached agents — used after a global edit (e.g. the
        onboarding wizard writes all 4 ``.agent/*.md`` files in one
        batch). Returns the number of sessions dropped, mainly for
        observability / debug logging.
        """
        count = len(self.sessions)
        self.sessions.clear()
        return count

    async def get_or_create_agent(self, session_id: str) -> Agent:
        if session_id in self.sessions:
            return self.sessions[session_id]

        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]

        model = self.config.get("agent", {}).get("model", "MiniMax-M3")

        llm_client = LLMClient(
            api_key=api_key,
            api_base=api_base,
            model=model,
        )

        # Per-session workspace: coding sessions use the user-picked
        # folder; everything else uses the fixed app workspace. The
        # app workspace is created on demand; the coding workspace must
        # already exist (the picker validates that).
        workspace_path = get_session_workspace_dir(session_id)
        try:
            workspace_path.mkdir(parents=True, exist_ok=True)
        except Exception:
            # Coding workspace may not exist yet (the user hasn't picked
            # one). The tools still need *some* absolute path so they
            # can resolve relative ones — fall back to the app workspace
            # so the WebSocket connect succeeds. The picker will refuse
            # to send the first message until a real folder is set.
            workspace_path = get_app_workspace_dir()
        from mini_agent.tools.file_tools import EditTool
        tools = [
            ReadTool(workspace_dir=str(workspace_path)),
            WriteTool(workspace_dir=str(workspace_path)),
            EditTool(workspace_dir=str(workspace_path)),
            BashTool(workspace_dir=str(workspace_path)),
        ]

        try:
            from mini_max_mcp.mcp_tool_wrapper import WebSearchTool, UnderstandImageTool
            from mini_max_mcp.client import MiniMaxClient
            from mini_agent.tools.media_tools import ImageGenerateTool, MusicGenerateTool, TTSTool, VideoGenerateTool
            tools_config = self.config.get("tools", {})
            if tools_config.get("web_search", True):
                tools.append(WebSearchTool(api_key, api_base))
            if tools_config.get("understand_image", True):
                tools.append(UnderstandImageTool(api_key, api_base))
            # Media generation tools
            media_client = MiniMaxClient(api_key=api_key, api_base=api_base)
            tools.extend([
                ImageGenerateTool(media_client, workspace_dir=str(workspace_path)),
                MusicGenerateTool(media_client, workspace_dir=str(workspace_path)),
                TTSTool(media_client, workspace_dir=str(workspace_path)),
                VideoGenerateTool(media_client, workspace_dir=str(workspace_path)),
            ])
        except ImportError:
            pass

        # Task board tools — shared with the Tasks panel. The agent can
        # create / list / update tasks on the user's board; deletion is
        # intentionally not exposed (see tasks_tool.py docstring).
        #
        # The task board is a GLOBAL feature (one board per user, not
        # one per coding project), so tasks.json always lives in the
        # app workspace — never in a coding session's workspace.
        try:
            from mini_agent.tools import (
                TasksCreateTool,
                TasksListTool,
                TasksUpdateTool,
            )
            tasks_file = str(get_app_workspace_dir() / "tasks.json")

            # on_change callback for the agent's task tools: when the
            # agent creates/updates a task, broadcast a
            # ``task_updated`` event via the WebSocket so the
            # CodingPanel's Live Todo Progress component can update
            # in real-time. Tasks created from the agent carry
            # source_session_id so we can filter to the right
            # session.
            def _agent_task_changed(task: dict, action: str) -> None:
                # Stamp the source_session_id so the broadcast
                # knows which session's panel to update. The
                # agent doesn't pass this — the backend owns the
                # session context.
                if not task.get("source_session_id"):
                    task = {**task, "source_session_id": session_id}
                # broadcast_task_event is async; we're called
                # synchronously from the tool. Schedule the send
                # on the running event loop so the tool returns
                # immediately and the broadcast runs in the
                # background.
                import asyncio
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        asyncio.ensure_future(
                            broadcast_task_event(task, action),
                            loop=loop,
                        )
                except Exception as e:
                    # Broadcast failures are non-fatal — the task
                    # is already on disk. Just log.
                    _logger.debug(
                        f"_agent_task_changed: could not schedule broadcast: {e}"
                    )

            tools.extend([
                TasksCreateTool(tasks_file=tasks_file, on_change=_agent_task_changed),
                TasksListTool(tasks_file=tasks_file),
                TasksUpdateTool(tasks_file=tasks_file, on_change=_agent_task_changed),
            ])
        except ImportError as exc:
            _logger.warning(f"Task board tools not registered: {exc}")

        # Memory tool — Hermes spec. Lets the agent manage MEMORY.md
        # (2,200 chars) and USER.md (1,375 chars) with add/replace/
        # remove actions + substring matching + capacity check +
        # security scan. The files live in <app_workspace>/.agent/ —
        # the same dir used by the context-files loader. The tool
        # reads from and writes to disk directly (no HTTP round-trip)
        # since the agent runs in-process with the FastAPI backend.
        #
        # write_approval defaults to False. The hermes-spec'd gate
        # (which would stage writes for user approval) is not yet
        # plumbed through to the UI — that's a future batch. Until
        # then, the agent writes freely (mirrors Hermes default).
        try:
            from mini_agent.tools import MemoryTool
            # NOTE: we deliberately import as ``get_minimax_config_from_module``
            # instead of ``get_minimax_config``. The local ``get_minimax_config``
            # function in this file (defined earlier) would be SHADOWED by
            # the same-named import — and the local name becomes a local
            # variable once any import statement targets it. That's the
            # classic "local variable 'get_minimax_config' referenced
            # before assignment" UnboundLocalError that crashes the
            # WebSocket handler. Renaming the import alias is the
            # minimal-blast-radius fix.
            from mini_agent.config import get_minimax_config as get_minimax_config_from_module
            cfg = get_minimax_config_from_module()
            write_approval = bool(
                cfg.get("minimax", {}).get("memory", {}).get("write_approval", False)
            )
            agent_dir = str(get_app_workspace_dir() / ".agent")
            tools.append(
                MemoryTool(agent_dir=agent_dir, write_approval=write_approval)
            )
            _logger.info(
                f"Memory tool registered (agent_dir={agent_dir}, "
                f"write_approval={write_approval})"
            )
        except ImportError as exc:
            _logger.warning(f"Memory tool not registered: {exc}")

        # Load external MCP tools from user-configured servers
        mcp_tools: list = []
        try:
            cfg = _load_config_dict()
            from mcp_agent_tools import load_mcp_tools_for_agent
            mcp_tools = await load_mcp_tools_for_agent(cfg)
            if mcp_tools:
                tools.extend(mcp_tools)
                _logger.info(f"Session '{session_id}': loaded {len(mcp_tools)} external MCP tool(s)")
        except Exception as exc:
            _logger.warning(f"Session '{session_id}': failed to load MCP tools: {exc}")

        # Coding agent gets a specialized system prompt
        if session_id.startswith("coding"):
            system_prompt = f"""You are MiniMax Coding Agent, an expert software engineer powered by {model}.
You help users write, debug, refactor, and understand code.
You have access to file system tools (read_file, write_file, edit_file), bash commands, web search, and image understanding.

CRITICAL: When the user asks you to create, write, or generate code, files, or projects, you MUST use the `write_file` tool to actually write files to disk. Do NOT just return code in markdown blocks — the user needs actual files in the workspace.

When asked to write code or create files:
1. Use `write_file` to create the actual files in the workspace
2. Then explain what you created
3. Suggest how to run or test the code

When asked to debug:
1. Use `read_file` to inspect the relevant files
2. Use `edit_file` or `write_file` to apply fixes
3. Explain the root cause and the fix

When asked to refactor:
1. Use `read_file` to understand the current code
2. Use `edit_file` for surgical changes or `write_file` for full rewrites
3. Explain what changed and why

When asked to create a landing page, website, or any project:
1. Create ALL necessary files using `write_file` (HTML, CSS, JS, etc.)
2. Create a proper directory structure if needed
3. Do NOT just describe the files — CREATE them

CRITICAL: When the user message includes file content inline (between triple backticks), that is the FULL content of the file they want you to analyze. Analyze THAT content directly. Do NOT call read_file for files mentioned in earlier conversation turns unless the user explicitly asks about them again.

You are working in: `{workspace_path}`
This is the project folder the user picked in the MiniMax Studio header — all relative paths are resolved from this directory, and any file you write ends up here.

Always be concise but thorough."""
        else:
            system_prompt = f"""You are a helpful AI assistant powered by {model}.
You help users with daily tasks, questions, brainstorming, writing, analysis, and general problem-solving.
You have access to file system tools, web search, and image understanding.

You are working in: `{workspace_path}`
This is the workspace the MiniMax Studio backend resolved for this session. When the user refers to "the project", "this folder", "where we are", they mean this directory.

CRITICAL LANGUAGE RULE: You MUST respond ONLY in the same language the user is using (Portuguese, English, Spanish, etc.). NEVER use Chinese, Japanese, Korean, or any other language not matching the user's message. NEVER mix Chinese characters in your responses.

Be concise, friendly, and helpful."""

        # ---- Agent context system (SOUL / IDENTITY / USER / MEMORY / daily) ----
        # Load all four .agent/*.md + today's daily as a frozen snapshot.
        # Per spec §2.1: the snapshot is captured once at session start and
        # never changes mid-session (preserves LLM prefix cache).
        ctx: AgentContext = load_agent_context(workspace_path / ".agent")
        sections = ctx.to_prompt_sections()

        # SOUL.md is slot #1 — identity (per spec §0). Empty falls back to
        # the built-in identity above (graceful degradation, never blocks).
        if sections["soul"]:
            system_prompt = f"{sections['soul']}\n\n---\n\n{system_prompt}"
        # IDENTITY.md — current role overlay (per spec §0).
        if sections["identity"]:
            system_prompt = system_prompt + f"\n\n## Current Role (IDENTITY.md)\n{sections['identity']}"
        # USER.md — profile, calibrates tone.
        if sections["user"]:
            system_prompt = system_prompt + f"\n\n## About the User (USER.md)\n{sections['user']}"
        # MEMORY.md — Hermes-style usage header + §-delimited entries.
        mem_rendered = render_memory_prompt(sections["memory"], used=ctx.memory.char_count)
        if mem_rendered:
            system_prompt = system_prompt + f"\n\n{mem_rendered}"
        # Today's daily — recent turns, append-only.
        if sections["daily"]:
            system_prompt = system_prompt + f"\n\n## Today's Session Log (daily/{ctx.daily.path.name})\n{sections['daily']}"

        # Single unified "## MCP Servers" section in the system
        # prompt — lists the MiniMax built-in servers (always
        # present) and the user's own configured MCP servers
        # (only when at least one is loaded). The same shape the
        # Settings panel uses, so the agent and the UI agree on
        # what's available. See build_mcp_section() for the
        # actual rendering.
        system_prompt += _build_mcp_section(mcp_tools or [])

        # Stash the context on the SessionManager so /api/config can expose
        # the missing/corrupt flags → banner + wizard triggers on frontend.
        self.last_context = ctx

        # Load user profile if exists
        user_profile = ""
        profile_path = PROJECT_ROOT / "workspace" / ".user_profile.json"
        if profile_path.exists():
            try:
                profile_data = json.loads(profile_path.read_text(encoding="utf-8"))
                user_profile = profile_data.get("bio", "")
            except Exception:
                pass

        if user_profile:
            profile_section = f"\n\n## About the User\n{user_profile}\nAlways keep this information in mind when responding."
            system_prompt = system_prompt + profile_section

        agent = Agent(
            llm_client=llm_client,
            system_prompt=system_prompt,
            tools=tools,
            max_steps=self.config.get("agent", {}).get("max_steps", 50),
            workspace_dir=str(workspace_path),
            # Auto-compact thresholds — passed through from config.yaml
            # `agent:` block. Defaults match the spec (warn 50 / auto 80 /
            # force 90) so callers that don't set them still get sensible
            # behavior. 90% safety net is never overridable by the toggle.
            auto_compact=self.config.get("agent", {}).get("auto_compact", True),
            compact_at_pct=float(self.config.get("agent", {}).get("compact_at_pct", 0.8)),
            force_compact_at_pct=float(self.config.get("agent", {}).get("force_compact_at_pct", 0.9)),
        )

        # Restore prior conversation context from the persisted JSON so
        # the agent loop has memory across server restarts. The
        # ``history`` WebSocket event already gives the frontend the
        # visual timeline; this gives the *API* the same memory.
        _hydrate_agent_messages(agent, session_id)

        # Bind the session_id onto the agent so structured compact logs
        # (started / completed / failed) emitted from inside the agent
        # carry the WS session id for correlation.
        agent.session_id = session_id

        # PR D — progressive subdirectory discovery (Hermes spec).
        # Tracker watches the agent's tool calls and appends relevant
        # project context files (AGENTS.md / CLAUDE.md / .cursorrules)
        # to the tool result so the model sees conventions as it
        # navigates into subdirectories. Cached per directory for the
        # lifetime of the agent (session), so the walk-up is at most
        # once per dir. The tracker is read by the WS handler via
        # agent._subdir_tracker; a closure built there invokes
        # hint_for_tool_call() and appends the formatted hint to the
        # ToolResult before it becomes part of the message history.
        agent._subdir_tracker = SubdirectoryHintTracker(
            workspace_dir=str(workspace_path)
        )

        self.sessions[session_id] = agent
        return agent


session_manager = SessionManager()


# --- Lifespan (defined before ``app`` so the FastAPI() call below can
# capture the reference). Wraps the lifespan for the v0.5 redesign:
# startup ensures the generations directories exist under the app
# workspace; shutdown just logs.
@asynccontextmanager
async def lifespan(app: FastAPI):
    _logger.info("MiniMax Agent Web starting up...")
    for subdir in ("images", "videos", "music", "tts"):
        (get_app_workspace_dir() / "generations" / subdir).mkdir(
            parents=True, exist_ok=True
        )
    yield
    _logger.info("Shutting down...")


# --- FastAPI app instance ---
# Declared BEFORE any ``@app.*`` decorator below (the new coding
# workspace endpoints and the older REST/WebSocket handlers all hang
# off this single ``app``).
app = FastAPI(
    title="MiniMax Agent Web",
    description="All-in-one platform for MiniMax Token Plan",
    version="0.3.0",
    lifespan=lifespan,
)


# CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Coding workspace endpoints (v0.5 redesign) ---
#
# The CodingPanel header lets the user pick a real folder for the
# current session. The lifecycle is:
#
#   1) GET    /api/coding/workspace?session_id=...       → returns the
#                                                         workspace + lock
#                                                         state for the
#                                                         session (or 404
#                                                         if none set).
#   2) PUT    /api/coding/workspace                      → attach a folder
#                                                         to a session
#                                                         (404/409 if
#                                                         locked). Also
#                                                         pushes the path
#                                                         onto the recent
#                                                         list.
#   3) GET    /api/coding/recent-workspaces              → VSCode-style
#                                                         recent list
#                                                         (newest first,
#                                                         capped at 10).
#   4) DELETE /api/coding/recent-workspaces/{path}       → remove a path
#                                                         from the recent
#                                                         list (pinned
#                                                         folders keep
#                                                         sticking around
#                                                         otherwise).
#   5) POST   /api/coding/session/{id}/lock              → server-side
#                                                         lock (also fired
#                                                         automatically by
#                                                         the WebSocket
#                                                         handler on the
#                                                         first message).
#
# All of these are REST + JSON; no streaming. Errors follow the existing
# HTTPException pattern (400 invalid path, 404 not found, 409 locked).


def _validate_workspace_path(path: str) -> Path:
    """Sanity-check a user-supplied workspace path.

    Returns the resolved absolute Path. Raises 400 if the path is
    empty or doesn't exist / isn't a directory. We don't try to gate
    on whether the agent is *allowed* to write there — that's the
    user's call (they picked the folder).
    """
    if not isinstance(path, str) or not path.strip():
        raise HTTPException(status_code=400, detail="workspace path must be a non-empty string.")
    try:
        resolved = Path(path).expanduser().resolve()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid path: {e}")
    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"Path does not exist: {resolved}")
    if not resolved.is_dir():
        raise HTTPException(status_code=400, detail=f"Path is not a directory: {resolved}")
    return resolved


@app.get("/api/coding/workspace")
async def get_coding_workspace(session_id: str = ""):
    """Return the workspace attached to a coding session (if any)."""
    if not session_id or not session_id.startswith("coding-"):
        raise HTTPException(status_code=400, detail="session_id must start with 'coding-'.")
    sess = _coding_sessions.get(session_id, {})
    workspace_dir = _load_coding_workspace_for_session(session_id)
    return {
        "success": True,
        "session_id": session_id,
        "workspace_dir": workspace_dir,
        "locked": bool(sess.get("locked")),
        "effective_dir": str(get_session_workspace_dir(session_id)),
    }


class CodingWorkspaceUpdate(BaseModel):
    session_id: str
    workspace_dir: str


@app.put("/api/coding/workspace")
async def set_coding_workspace(req: CodingWorkspaceUpdate):
    """Attach a folder to a coding session.

    Validates the path, stores it in the in-process session map AND
    the conversation JSON (so it survives a backend restart), pushes
    the path onto the recent-workspaces MRU list, and evicts any
    cached agent for the session so the next WebSocket message builds
    a fresh one against the new workspace.
    """
    if not req.session_id.startswith("coding-"):
        raise HTTPException(status_code=400, detail="session_id must start with 'coding-'.")
    resolved = _validate_workspace_path(req.workspace_dir)
    try:
        _attach_coding_workspace(req.session_id, str(resolved))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to attach workspace: {e}")
    session_manager.evict(req.session_id)
    _add_recent_coding_workspace(str(resolved))
    return {
        "success": True,
        "session_id": req.session_id,
        "workspace_dir": str(resolved),
        "label": resolved.name or str(resolved),
        "locked": False,
    }


@app.get("/api/coding/recent-workspaces")
async def list_recent_workspaces():
    """VSCode-style recent-workspaces list (newest first)."""
    return {"success": True, "workspaces": _load_recent_coding_workspaces()}


@app.delete("/api/coding/recent-workspaces")
async def remove_recent_workspace(path: str):
    """Drop a path from the recent list (e.g. user removed a project folder)."""
    target = str(Path(path).expanduser().resolve()) if path else ""
    if not target:
        raise HTTPException(status_code=400, detail="path is required.")
    cfg = _load_config_dict()
    existing = cfg.get("recent_coding_workspaces") or []
    if not isinstance(existing, list):
        existing = []
    kept = [
        e for e in existing
        if not (
            isinstance(e, dict)
            and str(Path(str(e.get("path", ""))).expanduser().resolve()) == target
        )
    ]
    cfg["recent_coding_workspaces"] = kept
    _save_config_dict(cfg)
    return {"success": True, "workspaces": _load_recent_coding_workspaces()}


@app.post("/api/coding/session/{session_id}/lock")
async def lock_coding_session(session_id: str):
    """Lock a coding session's workspace — no more changes allowed.

    Fired either by the frontend (defensive — usually right after the
    first message is sent) or by the WebSocket handler (canonical —
    see ``chat_websocket``). Idempotent.
    """
    if not session_id.startswith("coding-"):
        raise HTTPException(status_code=400, detail="session_id must start with 'coding-'.")
    _lock_coding_session(session_id)
    return {
        "success": True,
        "session_id": session_id,
        "locked": True,
        "workspace_dir": _load_coding_workspace_for_session(session_id),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Context references — @file:, @folder:, @diff, @staged, @git:N, @url:
# See web/backend/context_refs.py for the expansion logic. This
# endpoint is the frontend's entry point: composer sends the raw
# message text + the current session_id, backend parses, expands,
# and returns the report (results + total_bytes + soft/hard flags).
# ─────────────────────────────────────────────────────────────────────────────


class ContextRefsExpandRequest(BaseModel):
    """Request body for ``POST /api/context-refs/expand``."""

    session_id: str = Field(..., description="Session ID — determines the workspace_dir")
    message: str = Field(..., description="Raw message text with @-refs to expand")


class ContextRefsExpandResponse(BaseModel):
    """Response body — the parsed refs + their expansion results."""

    success: bool
    results: list[dict]
    total_bytes: int
    soft_warning: str = ""
    refused: bool = False
    refusal_reason: str = ""
    # Echoed back so the frontend can render chips without re-parsing
    parsed_refs: list[dict]


@app.post("/api/context-refs/expand")
async def context_refs_expand(req: ContextRefsExpandRequest):
    """Expand all @-references in a message.

    The endpoint:
    1. Parses refs out of the message text (cheap, no I/O)
    2. Resolves the workspace_dir from the session_id
    3. Looks up the model's context limit (for the soft/hard gates)
    4. Calls ``expand_refs()`` which fans out per-ref expansion
    5. Returns the report — frontend renders warning/error chips

    If the workspace is a coding session, ``coding_workspace_dir`` is
    used; otherwise the app workspace. This matches the file/git/shell
    endpoint convention.
    """
    # Parse refs (cheap, no I/O)
    refs = parse_refs(req.message)

    # Resolve workspace — coding sessions get their locked workspace,
    # non-coding sessions get the app workspace (matches the file
    # endpoint convention).
    if req.session_id.startswith("coding-"):
        workspace = get_session_workspace_dir(req.session_id)
    else:
        workspace = get_app_workspace_dir()

    # Model limit — used for the soft/hard size gates. Default to
    # a conservative 200K if we can't read the configured model
    # (the same fallback used by the context-window estimator).
    model_limit = 200_000
    try:
        from model_limits import MODEL_CONTEXT_LIMITS  # type: ignore
        selected = (config.get("minimax", {}) or {}).get("model", "MiniMax-M3")
        model_limit = MODEL_CONTEXT_LIMITS.get(selected, 200_000)
    except Exception:
        pass  # fall back to default

    # Expand
    report = expand_refs(refs, workspace, model_limit=model_limit)

    # Build response
    return {
        "success": True,
        "results": [r.to_dict() for r in report.results],
        "total_bytes": report.total_bytes,
        "soft_warning": report.soft_warning,
        "refused": report.refused,
        "refusal_reason": report.refusal_reason,
        "parsed_refs": [
            {
                "raw": r.raw,
                "type": r.type,
                "value": r.value,
                "start": r.start,
                "end": r.end,
            }
            for r in refs
        ],
    }


class ContextRefsListRequest(BaseModel):
    """Request body for ``POST /api/context-refs/list`` (path autocomplete)."""

    session_id: str = Field(..., description="Session ID — determines the workspace_dir")
    prefix: str = Field("", description="Optional path prefix to filter by (relative to workspace)")
    max_entries: int = Field(200, description="Cap on returned entries")


@app.post("/api/context-refs/list")
async def context_refs_list(req: ContextRefsListRequest):
    """List files + folders under the workspace for path autocomplete.

    Frontend calls this when the user types ``@file:`` or ``@folder:``
    in the composer and the autocomplete popover opens. Returns up to
    200 entries (paths relative to the workspace) plus a flag
    indicating whether the listing was truncated.
    """
    if req.session_id.startswith("coding-"):
        workspace = get_session_workspace_dir(req.session_id)
    else:
        workspace = get_app_workspace_dir()

    prefix = (req.prefix or "").strip().lstrip("/")
    # Build the candidate root — if prefix is empty, list the workspace
    # root; otherwise resolve it under the workspace and verify it
    # stays inside.
    if not prefix:
        scan_root = workspace
    else:
        from context_refs import resolve_workspace_path  # type: ignore
        try:
            scan_root = resolve_workspace_path(workspace, prefix)
        except (PermissionError, ValueError):
            return {"success": True, "entries": [], "truncated": False, "error": "invalid prefix"}

    if not scan_root.exists() or not scan_root.is_dir():
        return {"success": True, "entries": [], "truncated": False}

    entries: list[dict] = []
    truncated = False
    cap = max(1, min(req.max_entries, 500))

    def _walk(directory):
        nonlocal truncated
        if len(entries) >= cap:
            truncated = True
            return
        try:
            children = sorted(
                directory.iterdir(),
                key=lambda p: (not p.is_dir(), p.name.lower()),
            )
        except (PermissionError, OSError):
            return
        for child in children:
            if len(entries) >= cap:
                truncated = True
                return
            try:
                rel = child.relative_to(workspace)
            except ValueError:
                continue
            try:
                size = child.stat().st_size if child.is_file() else 0
            except OSError:
                size = 0
            entries.append({
                "path": str(rel).replace("\\", "/"),
                "is_dir": child.is_dir(),
                "size": size,
            })
            if child.is_dir():
                _walk(child)

    _walk(scan_root)
    return {
        "success": True,
        "entries": entries,
        "truncated": truncated,
    }


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "0.3.0"}


@app.get("/api/config")
async def get_config():
    """Return safe config (without API keys)."""
    minimax = config.get("minimax", {}) if isinstance(config, dict) else {}
    if hasattr(config, 'to_dict'):
        minimax = config.to_dict().get("minimax", {})
    elif hasattr(config, 'minimax'):
        minimax = config.minimax if isinstance(config.minimax, dict) else {}
    
    mcp_servers = config.get("mcp_servers", {}) if isinstance(config, dict) else {}
    if not isinstance(mcp_servers, dict):
        mcp_servers = {}
    mcp_list = []
    for sid, sdata in mcp_servers.items():
        if isinstance(sdata, dict):
            mcp_list.append({
                "id": sid,
                "name": sdata.get("name", sid),
                "transport": sdata.get("transport", "stdio"),
                "command": sdata.get("command"),
                "args": sdata.get("args", []),
                "env": sdata.get("env", {}),
                "url": sdata.get("url"),
                "enabled": sdata.get("enabled", True),
            })

    safe_config = {
        # The config schema keeps model / max_steps at the top level
        # (not under an `agent` key), but the Settings UI reads them
        # from `data.agent.*`. Project them under `agent` so the form
        # is populated from the real config rather than always showing
        # the JS-side fallbacks.
        #
        # Note (v0.5 redesign): the pre-v0.5 ``workspace_dir`` field
        # is now ignored — each coding session has its own workspace
        # chosen from the CodingPanel header, and non-coding sessions
        # use the fixed app workspace. The field is kept here as
        # ``legacy_workspace_dir`` (raw read) so we can warn users
        # with stale configs without breaking the response shape.
        "agent": {
            "model": config.get("model", "MiniMax-M3") if isinstance(config, dict) else "MiniMax-M3",
            "max_steps": config.get("max_steps", 50) if isinstance(config, dict) else 50,
            "workspace_dir": config.get("workspace_dir", "") if isinstance(config, dict) else "",
            # Context-window auto-compact thresholds — exposed to
            # frontend so the warning banner can show the right tier
            # (50/80/90) and reflect the toggle state. Defaults match
            # the spec; Advanced Settings modal will let users override
            # auto_compact + compact_at_pct but force_compact_at_pct is
            # server-enforced safety net and not user-editable.
            "auto_compact": config.get("auto_compact", True) if isinstance(config, dict) else True,
            "compact_at_pct": float(config.get("compact_at_pct", 0.8)) if isinstance(config, dict) else 0.8,
            "force_compact_at_pct": float(config.get("force_compact_at_pct", 0.9)) if isinstance(config, dict) else 0.9,
        },
        "app_workspace_dir": str(get_app_workspace_dir()),
        "tts": config.get("tts", {}) if isinstance(config, dict) else {},
        "image": config.get("image", {}) if isinstance(config, dict) else {},
        "music": config.get("music", {}) if isinstance(config, dict) else {},
        "video": config.get("video", {}) if isinstance(config, dict) else {},
        "tools": config.get("tools", {}) if isinstance(config, dict) else {},
        "mcp_servers": mcp_list,
        "region": minimax.get("region", "global") if isinstance(minimax, dict) else "global",
        "api_base": minimax.get("api_base", "https://api.minimax.io") if isinstance(minimax, dict) else "https://api.minimax.io",
        "api_key_configured": bool(minimax.get("api_key", "")) if isinstance(minimax, dict) else False,
        # App-level settings (i18n, etc.) — top-level under `app`.
        # Default is English (en-US); the install/setup flow writes
        # the user's chosen language to `app.language` in config.yaml.
        "app": {
            "language": config.get("app", {}).get("language", "en-US")
                if isinstance(config, dict) else "en-US",
        },
        # Agent context system — drives the IncompleteContextBanner + wizard.
        # Freshly loaded each request so it reflects edits on disk; the
        # *system prompt* still uses a frozen snapshot per session.
        "agent_context": _agent_context_status(),
    }
    return safe_config


def _agent_context_status() -> dict:
    """Load the four .agent files and return the incomplete-context flag.

    Used by /api/config to drive the frontend banner + wizard triggers.
    Cheap to compute (4 file reads, no LLM call).
    """
    try:
        from agent_context import load_agent_context
        agent_dir = get_app_workspace_dir() / ".agent"
        ctx = load_agent_context(agent_dir)
        flag = ctx.to_incomplete_flag()
        # Also expose char usage so the Settings cards can render counters.
        flag["char_usage"] = {
            "soul":    {"used": ctx.soul.char_count,    "limit": ctx.soul.limit},
            "identity": {"used": ctx.identity.char_count, "limit": ctx.identity.limit},
            "user":    {"used": ctx.user.char_count,    "limit": ctx.user.limit},
            "memory":  {"used": ctx.memory.char_count,  "limit": ctx.memory.limit},
        }
        return flag
    except Exception as exc:
        _logger.warning(f"Failed to compute agent_context status: {exc}")
        return {"missing": [], "corrupt": [], "banner_visible": False, "char_usage": {}}


@app.get("/api/profile")
async def get_profile():
    """Load user profile."""
    profile_path = PROJECT_ROOT / "workspace" / ".user_profile.json"
    if profile_path.exists():
        try:
            return json.loads(profile_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"bio": ""}


@app.post("/api/profile")
async def save_profile(req: dict):
    """Save user profile."""
    profile_path = PROJECT_ROOT / "workspace" / ".user_profile.json"
    profile_path.parent.mkdir(parents=True, exist_ok=True)
    profile_path.write_text(json.dumps(req, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"success": True}


# ─── Skills (multi-source: User > Extra > External > Built-in) ────────────
#
# Discovery priority matches Kimi / agentskills.io: more-specific sources win.
# The loader is built from config (`skills.*` block) on first call and cached;
# mutation endpoints (PUT/POST/DELETE) and the explicit `/discover` endpoint
# invalidate the cache. The cache is also keyed by source list so adding a
# new ``extra_skill_dirs`` entry in Settings auto-rebuilds.

_skills_loader_cache: dict | None = None
_skills_sources_signature: tuple | None = None


def _skills_config_block() -> dict:
    """Return the ``skills:`` sub-dict from config.yaml (defaults applied)."""
    cfg = _load_config_dict()
    block = cfg.get("skills") if isinstance(cfg, dict) else None
    if not isinstance(block, dict):
        block = {}
    return {
        "merge_all_available_skills": bool(
            block.get("merge_all_available_skills", True)
        ),
        "user_dir": block.get("user_dir"),  # None → default
        "extra_skill_dirs": list(block.get("extra_skill_dirs") or []),
    }


def _skills_signature() -> tuple:
    """A hashable key that changes when any source config changes."""
    block = _skills_config_block()
    return (
        block["merge_all_available_skills"],
        block["user_dir"] or "",
        tuple(block["extra_skill_dirs"]),
    )


def _build_skills_loader():
    """Construct a SkillLoader from config + env. Does not cache."""
    from mini_agent.tools.skill_loader import (
        SkillLoader,
        SkillSource,
        get_default_external_paths,
        get_default_user_dir,
    )

    block = _skills_config_block()
    user_dir_raw = block["user_dir"] or str(get_default_user_dir())
    user_dir = Path(SkillLoader.expand_path(user_dir_raw, project_root=PROJECT_ROOT))
    user_dir.mkdir(parents=True, exist_ok=True)

    sources: list[tuple[Path, SkillSource]] = [
        (user_dir, SkillSource.USER),
    ]

    # Extra: configurable paths (relative → project root; ~/ → home; absolute).
    for raw in block["extra_skill_dirs"]:
        path = SkillLoader.expand_path(str(raw), project_root=PROJECT_ROOT)
        sources.append((path, SkillSource.EXTRA))

    # External brand dirs (Claude / Codex / Gemini / Generic). Missing
    # paths are silently skipped by the loader — we still register them.
    for source, path in get_default_external_paths().items():
        sources.append((path, source))

    # Built-in (last / lowest priority).
    sources.append((PROJECT_ROOT / "mini_agent" / "skills", SkillSource.BUILTIN))

    return SkillLoader(sources=sources), user_dir


def _get_skills_loader():
    """Return the cached loader, rebuilding if config changed."""
    global _skills_loader_cache, _skills_sources_signature
    sig = _skills_signature()
    if _skills_loader_cache is None or sig != _skills_sources_signature:
        _skills_loader_cache, _ = _build_skills_loader()
        _skills_sources_signature = sig
    _skills_loader_cache.discover_skills()
    return _skills_loader_cache


def _invalidate_skills_loader() -> None:
    global _skills_loader_cache, _skills_sources_signature
    _skills_loader_cache = None
    _skills_sources_signature = None


def _skills_user_dir() -> Path:
    """The user-writable skills dir (created on first call)."""
    _, user_dir = _build_skills_loader()
    return user_dir


def _serialize_skill(skill, include_raw: bool = False) -> dict:
    """Skill → API dict. ``include_raw`` adds the full markdown source."""
    out = skill.to_dict()
    if include_raw:
        try:
            out["raw_markdown"] = (
                skill.skill_path.read_text(encoding="utf-8") if skill.skill_path else ""
            )
        except OSError:
            out["raw_markdown"] = ""
    return out


@app.get("/api/skills")
async def list_skills():
    """List all available skills (merged across sources)."""
    try:
        loader = _get_skills_loader()
        skills = [_serialize_skill(s) for s in loader.loaded_skills.values()]
        grouped = loader.get_skills_grouped_by_source()
        grouped_dict = {
            src: [_serialize_skill(s) for s in items]
            for src, items in grouped.items()
        }
        return {
            "success": True,
            "skills": skills,
            "grouped": grouped_dict,
            "scan_errors": loader.last_scan_errors,
            "count": len(skills),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/skills/sources")
async def list_skill_sources():
    """List all source paths with counts and reachability."""
    try:
        loader = _get_skills_loader()
        out: list[dict] = []
        seen: set = set()
        for path, source in loader.sources:
            key = (str(path), source.value)
            if key in seen:
                continue
            seen.add(key)
            count = sum(
                1 for s in loader.loaded_skills.values()
                if s.source == source
            )
            out.append({
                "path": str(path),
                "source": source.value,
                "source_label": source.label,
                "exists": path.exists() and path.is_dir(),
                "read_only": source.read_only,
                "count": count,
            })
        return {"success": True, "sources": out}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/skills/discover")
async def rediscover_skills():
    """Force a rescan of all configured sources (cache invalidation)."""
    try:
        _invalidate_skills_loader()
        loader = _get_skills_loader()
        return {
            "success": True,
            "count": len(loader.loaded_skills),
            "scan_errors": loader.last_scan_errors,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/skills/{name}")
async def get_skill(name: str):
    """Get full content + raw markdown for one skill."""
    try:
        loader = _get_skills_loader()
        skill = loader.get_skill(name)
        if skill is None:
            raise HTTPException(status_code=404, detail=f"Skill '{name}' not found.")
        return {"success": True, "skill": _serialize_skill(skill, include_raw=True)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SkillCreate(BaseModel):
    name: str
    description: str
    body: str = ""
    license: Optional[str] = None
    compatibility: Optional[str] = None
    allowed_tools: Optional[list] = None
    metadata: Optional[dict] = None
    skill_type: Optional[str] = None


@app.post("/api/skills")
async def create_skill(req: SkillCreate):
    """Create a new skill in the user data dir."""
    from mini_agent.tools.skill_loader import (
        write_skill,
        SkillValidationError,
    )
    try:
        user_dir = _skills_user_dir()
        skill = write_skill(
            user_dir,
            name=req.name,
            description=req.description,
            body=req.body,
            license=req.license,
            compatibility=req.compatibility,
            allowed_tools=req.allowed_tools,
            metadata=req.metadata,
            skill_type=req.skill_type,
        )
        _invalidate_skills_loader()
        return {"success": True, "skill": _serialize_skill(skill, include_raw=True)}
    except SkillValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SkillUpdate(BaseModel):
    description: Optional[str] = None
    body: Optional[str] = None
    license: Optional[str] = None
    compatibility: Optional[str] = None
    allowed_tools: Optional[list] = None
    metadata: Optional[dict] = None


@app.put("/api/skills/{name}")
async def update_skill(name: str, req: SkillUpdate):
    """Update an existing user-dir skill. Refuses non-user sources."""
    from mini_agent.tools.skill_loader import (
        update_skill as _update_skill,
        SkillValidationError,
    )
    try:
        loader = _get_skills_loader()
        existing = loader.get_skill(name)
        if existing is None:
            raise HTTPException(status_code=404, detail=f"Skill '{name}' not found.")
        if existing.source.read_only:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Skill '{name}' is read-only "
                    f"(source={existing.source.value}). Use 'Import to user' "
                    f"to create an editable copy."
                ),
            )
        user_dir = _skills_user_dir()
        skill = _update_skill(
            user_dir,
            name=name,
            description=req.description,
            body=req.body,
            license=req.license,
            compatibility=req.compatibility,
            allowed_tools=req.allowed_tools,
            metadata=req.metadata,
        )
        _invalidate_skills_loader()
        return {"success": True, "skill": _serialize_skill(skill, include_raw=True)}
    except HTTPException:
        raise
    except SkillValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/skills/{name}")
async def delete_skill(name: str):
    """Delete a user-dir skill. Refuses non-user sources."""
    from mini_agent.tools.skill_loader import (
        delete_skill as _delete_skill,
        SkillValidationError,
    )
    try:
        loader = _get_skills_loader()
        existing = loader.get_skill(name)
        if existing is None:
            raise HTTPException(status_code=404, detail=f"Skill '{name}' not found.")
        if existing.source.read_only:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Skill '{name}' is read-only "
                    f"(source={existing.source.value}). Cannot delete."
                ),
            )
        user_dir = _skills_user_dir()
        ok = _delete_skill(user_dir, name)
        if not ok:
            raise HTTPException(status_code=404, detail=f"Skill '{name}' not found on disk.")
        _invalidate_skills_loader()
        return {"success": True, "deleted": name}
    except HTTPException:
        raise
    except SkillValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SkillImportRequest(BaseModel):
    url: str


@app.post("/api/skills/import")
async def import_skill_preview(req: SkillImportRequest):
    """Fetch a SKILL.md from GitHub (raw or blob URL) and return a preview.

    The frontend shows the preview; the user confirms by calling
    POST /api/skills with the returned fields. No side effects on disk.
    """
    try:
        url = (req.url or "").strip()
        if not url:
            raise HTTPException(status_code=400, detail="url is required.")

        # Normalise GitHub URLs:
        #   https://github.com/<owner>/<repo>/blob/<branch>/<path>/SKILL.md
        #   https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>/SKILL.md
        if "github.com/" in url and "/blob/" in url:
            url = url.replace("github.com/", "raw.githubusercontent.com/", 1)
            url = url.replace("/blob/", "/", 1)

        if not url.startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="Only http(s) URLs are supported.")

        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=f"Upstream returned HTTP {resp.status_code}.",
                )
            raw_markdown = resp.text

        if "---" not in raw_markdown:
            raise HTTPException(
                status_code=422,
                detail="Remote file does not look like a SKILL.md (no frontmatter).",
            )

        # Parse via the loader's frontmatter parser (shared logic).
        from mini_agent.tools.skill_loader import SkillLoader
        fm, body = SkillLoader._parse_frontmatter(raw_markdown)
        fm = fm or {}
        body = (body or "").strip()

        return {
            "success": True,
            "preview": {
                "source_url": url,
                "raw_markdown": raw_markdown,
                "frontmatter": fm,
                "body": body,
                "suggested_name": fm.get("name") or "",
                "suggested_description": fm.get("description") or "",
                "suggested_license": fm.get("license"),
                "suggested_compatibility": fm.get("compatibility"),
                "suggested_allowed_tools": fm.get("allowed-tools"),
                "suggested_metadata": fm.get("metadata"),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SkillsConfigUpdate(BaseModel):
    merge_all_available_skills: Optional[bool] = None
    extra_skill_dirs: Optional[list[str]] = None
    user_dir: Optional[str] = None


@app.put("/api/config/skills")
async def update_skills_config(req: SkillsConfigUpdate):
    """Persist the ``skills:`` block and invalidate the loader cache."""
    try:
        cfg = _load_config_dict()
        block = cfg.get("skills") if isinstance(cfg.get("skills"), dict) else {}
        if req.merge_all_available_skills is not None:
            block["merge_all_available_skills"] = bool(req.merge_all_available_skills)
        if req.extra_skill_dirs is not None:
            block["extra_skill_dirs"] = list(req.extra_skill_dirs)
        if req.user_dir is not None:
            block["user_dir"] = req.user_dir or None
        cfg["skills"] = block
        _save_config_dict(cfg)
        _invalidate_skills_loader()
        return {"success": True, "skills": block}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ToolsConfigRequest(BaseModel):
    web_search: bool = True
    understand_image: bool = True


# ---------------------------------------------------------------------------
# Agent Context — Daily log listing + read
# ---------------------------------------------------------------------------
#
# The daily log is append-only (one block per turn) — there is no
# PUT/DELETE on individual days. The frontend reads the most recent N
# days for the daily-log viewer, and a specific day for the doc viewer.
#
# IMPORTANT: these routes are registered BEFORE the catch-all
# /api/agent-context/{file_id} route below — otherwise FastAPI matches
# "dailies" against {file_id} and rejects it as an unknown file id.
# ---------------------------------------------------------------------------

@app.get("/api/agent-context/presets")
async def list_presets(lang: str | None = None):
    """Return the 5 SOUL presets (id + i18n name/desc/body).

    The `lang` query param resolves labels in pt-BR or en-US. If
    omitted or invalid, falls back to the user's `app.language` from
    config (default en-US). The frontend uses the bodies to seed
    SOUL.md when the user picks a preset in the wizard.
    """
    resolved = _resolve_lang(lang)
    try:
        return {
            "lang": resolved,
            "presets": [
                {
                    "id": pid,
                    "name": preset_label(pid, resolved),
                    "desc": preset_label(pid, resolved, field="desc"),
                    "body": preset_label(pid, resolved, field="body"),
                }
                for pid in I18N_PRESETS
            ],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/agent-context/roles")
async def list_roles(lang: str | None = None):
    """Return the 4 role templates (id + i18n name/desc/body).

    The 3 non-custom roles (eng, reviewer, pm) carry a canonical body
    that the wizard writes to IDENTITY.md. The 'custom' role has no
    body — the user types it inline in the wizard's text field.
    """
    resolved = _resolve_lang(lang)
    try:
        out = []
        for rid in I18N_ROLES:
            entry = {
                "id": rid,
                "name": role_label(rid, resolved),
                "desc": role_label(rid, resolved, field="desc"),
            }
            body = role_body(rid, resolved)
            if body is not None:
                entry["body"] = body
            out.append(entry)
        return {"lang": resolved, "roles": out}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _resolve_lang(lang: str | None) -> str:
    """Resolve a `lang` query param to a supported language code.

    Priority:
      1. The `lang` query param if valid (case-insensitive, supports
         both `pt-BR` and `pt_br` forms).
      2. The user's `app.language` in config.yaml.
      3. The backend default (en-US).
    """
    if lang and lang.strip():
        try:
            return lang_or_default(lang)
        except Exception:
            pass
    try:
        cfg_lang = config.get("app", {}).get("language") if isinstance(config, dict) else None
        if cfg_lang:
            return lang_or_default(cfg_lang)
    except Exception:
        pass
    from i18n import DEFAULT_LANG
    return DEFAULT_LANG


@app.get("/api/agent-context/dailies")
async def list_dailies(n: int = 7):
    """Return the N most recent daily log files (newest first).

    Each entry carries just the date + size; the frontend opens the
    file via ``/api/agent-context/daily/{date}`` on click. Limit is
    capped at 30 to avoid scanning a long history.
    """
    n = max(1, min(int(n or 7), 30))
    try:
        agent_dir = get_app_workspace_dir() / ".agent"
        files = list_recent_dailies(agent_dir, n=n)
        return {
            "dailies": [
                {
                    "date": f.stem,            # "2026-06-23"
                    "size": f.stat().st_size, # bytes — for the UI
                    "path": str(f),
                }
                for f in files
            ],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/agent-context/daily/{date_str}")
async def read_daily(date_str: str):
    """Read a single daily log by ISO date (``YYYY-MM-DD``).

    Returns 404 if no log exists for that date — the frontend should
    show "No activity on this day" rather than render an empty card.
    Path is hard-confined to the daily/ directory to avoid traversal.
    """
    # Strict ISO date guard — reject anything that isn't 10 chars
    # shaped like YYYY-MM-DD. Prevents path traversal via ../foo.
    import re as _re
    if not _re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_str):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid date '{date_str}'. Expected YYYY-MM-DD.",
        )
    try:
        agent_dir = get_app_workspace_dir() / ".agent"
        target = (agent_dir / "daily" / f"{date_str}.md").resolve()
        # Defence-in-depth: ensure the resolved path is still under
        # ``agent_dir / "daily"``. resolve() should make symlinks safe,
        # but on Windows the network share case is a known edge.
        if not str(target).startswith(str((agent_dir / "daily").resolve())):
            raise HTTPException(status_code=400, detail="Path escape detected.")
        if not target.exists():
            raise HTTPException(status_code=404, detail=f"No log for {date_str}.")
        return {
            "date": date_str,
            "content": target.read_text(encoding="utf-8"),
            "size": target.stat().st_size,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Agent Context — CRUD on workspace/.agent/*.md (SOUL, IDENTITY, USER, MEMORY)
# ---------------------------------------------------------------------------
#
# Per Agent Context spec §2.2: editing one of these files must invalidate
# any in-memory agent so the next session reloads the new system prompt.
# The wizard uses `invalidate_all()`; the tab uses `evict(session_id)` for
# the active session (sufficient because the user is editing on the
# frontend, not in the chat where a session is mid-flight).
# ---------------------------------------------------------------------------

class AgentContextFileUpdate(BaseModel):
    content: str


_VALID_AGENT_FILES = {"soul", "identity", "user", "memory"}

# Maps the URL-safe ``file_id`` (lowercase, no extension) to the actual
# filename on disk. Mirrors the constant list in ``agent_context.py``.
_AGENT_FILE_NAMES = {
    "soul":     "SOUL.md",
    "identity": "IDENTITY.md",
    "user":     "USER.md",
    "memory":   "MEMORY.md",
}


@app.get("/api/agent-context/{file_id}")
async def get_agent_context_file(file_id: str):
    """Return the raw content + char usage for a single .agent/*.md file.

    Reads from disk on every call (no cache) so the frontend always sees
    the current state after the user saves a change. This is cheap —
    the files are < 2.2 KB each.
    """
    if file_id not in _VALID_AGENT_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file id '{file_id}'. Expected one of: "
                   f"{sorted(_VALID_AGENT_FILES)}",
        )
    try:
        agent_dir = get_app_workspace_dir() / ".agent"
        ctx = load_agent_context(agent_dir)
        status = {
            "soul": ctx.soul,
            "identity": ctx.identity,
            "user": ctx.user,
            "memory": ctx.memory,
        }[file_id]
        limit = CHAR_LIMITS[file_id]
        return {
            "id": file_id,
            "content": status.content or "",
            "exists": status.exists,
            "readable": status.readable,
            "char_count": status.char_count,
            "char_limit": limit,
            "corrupt_reason": status.corrupt_reason,
            "over_limit": status.over_limit,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/agent-context/{file_id}")
async def put_agent_context_file(file_id: str, req: AgentContextFileUpdate):
    """Write a single .agent/*.md file and invalidate session cache.

    Per Agent Context spec §2.2 — security: the body is rejected if it
    would inject a `<<` closing block delimiter (Hermes uses `<<` to
    close tool-result tags) or if it exceeds the file's char limit.
    The first guard prevents a single message from breaking the agent
    loop. The second is a hard limit on prompt budget.

    On success, returns the new char count + the up-to-date status
    payload (same shape as ``_agent_context_status()``) so the frontend
    can refresh its banner/wizard state in one round-trip.
    """
    if file_id not in _VALID_AGENT_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file id '{file_id}'. Expected one of: "
                   f"{sorted(_VALID_AGENT_FILES)}",
        )

    body = req.content or ""

    # Char limit enforcement — reject 413 so the frontend can show the
    # "X / Y chars" hint and trim.
    limit = CHAR_LIMITS[file_id]
    if len(body) > limit:
        raise HTTPException(
            status_code=413,
            detail=f"Content too long: {len(body)} chars exceeds "
                   f"limit of {limit} for '{file_id}'",
        )

    # Hermes `<<` guard — close-block delimiter injection protection.
    if "<<" in body:
        raise HTTPException(
            status_code=400,
            detail="Content contains '<<' (reserved Hermes close-block "
                   "delimiter). Remove it before saving.",
        )

    agent_dir = get_app_workspace_dir() / ".agent"
    target = agent_dir / _AGENT_FILE_NAMES[file_id]
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        # Write atomically via temp file + replace so a crash mid-write
        # never leaves a half-written .md on disk.
        tmp = target.with_suffix(target.suffix + ".tmp")
        tmp.write_text(body, encoding="utf-8")
        tmp.replace(target)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Invalidate session cache so the next chat reloads from disk.
    # The frontend only calls PUT from the AgentContextTab or the
    # onboarding wizard, never while a chat is in flight, so dropping
    # the cached agent is safe.
    dropped = session_manager.invalidate_all()

    return {
        "id": file_id,
        "char_count": len(body),
        "char_limit": limit,
        "sessions_invalidated": dropped,
        "status": _agent_context_status(),
    }


@app.post("/api/config/tools")
async def update_tools_config(req: ToolsConfigRequest):
    """Update tools configuration in config.yaml."""
    global config
    try:
        cfg = config
        if hasattr(cfg, 'to_dict'):
            cfg = cfg.to_dict()
        elif not isinstance(cfg, dict):
            cfg = {}

        cfg["tools"] = {
            "web_search": req.web_search,
            "understand_image": req.understand_image,
        }

        import yaml
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            yaml.dump(cfg, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

        config = cfg

        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ApiKeyUpdate(BaseModel):
    api_key: str


@app.put("/api/config/api-key")
async def set_api_key(req: ApiKeyUpdate):
    """Persist the MiniMax API key to config/config.yaml.

    The key is validated against MiniMax's known prefixes and written
    to disk. The key is never echoed back in the response — only a
    boolean `api_key_configured` flag.

    Note: WebSocket sessions that are already open keep the key they
    read on connect. New sessions (or a refresh of the panel) pick up
    the updated key automatically.
    """
    global config
    try:
        key = (req.api_key or "").strip()
        if not key:
            raise HTTPException(status_code=400, detail="API key cannot be empty.")
        # MiniMax API keys: 'sk-cp-...' (Token Plan) or 'sk-...' (general).
        if not (key.startswith("sk-") and len(key) >= 16):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Invalid API key format. MiniMax keys start with "
                    "'sk-' or 'sk-cp-' and are at least 16 characters."
                ),
            )

        cfg = config
        if hasattr(cfg, 'to_dict'):
            cfg = cfg.to_dict()
        elif not isinstance(cfg, dict):
            cfg = {}
        if not isinstance(cfg.get("minimax"), dict):
            cfg["minimax"] = {}

        cfg["minimax"]["api_key"] = key

        import yaml
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            yaml.dump(cfg, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

        config = cfg

        return {"success": True, "api_key_configured": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class AgentConfigUpdate(BaseModel):
    model: Optional[str] = None
    max_steps: Optional[int] = None
    # ``workspace_dir`` was removed in v0.5 (per-session coding workspace
    # is set via ``PUT /api/coding/workspace`` instead). Accepted for
    # backward-compat with older frontends but ignored server-side.
    workspace_dir: Optional[str] = None
    region: Optional[str] = None  # "global" or "cn"
    api_base: Optional[str] = None  # full URL, e.g. https://api.minimax.io/anthropic or a proxy
    auto_compact: Optional[bool] = None  # whether to auto-compact at the 80% threshold; 90% safety net is NEVER overridable


@app.put("/api/config/agent")
async def update_agent_config(req: AgentConfigUpdate):
    """Persist the agent's runtime settings to config/config.yaml.

    Only the fields provided in the body are written; missing fields
    are left untouched. ``region`` is stored under the ``minimax``
    section (``minimax.region``) so the existing ``get_minimax_config``
    helper can pick it up without any further changes. ``model``,
    ``max_steps``, ``workspace_dir`` and ``api_base`` are stored at the
    top level (matching the rest of the config schema).
    """
    global config
    try:
        cfg = config
        if hasattr(cfg, 'to_dict'):
            cfg = cfg.to_dict()
        elif not isinstance(cfg, dict):
            cfg = {}

        if req.model is not None:
            if not isinstance(req.model, str) or not req.model.strip():
                raise HTTPException(status_code=400, detail="model must be a non-empty string.")
            cfg["model"] = req.model.strip()

        if req.max_steps is not None:
            if not isinstance(req.max_steps, int) or req.max_steps < 1 or req.max_steps > 1000:
                raise HTTPException(
                    status_code=400,
                    detail="max_steps must be an integer between 1 and 1000.",
                )
            cfg["max_steps"] = req.max_steps

        if req.workspace_dir is not None:
            # v0.5 removed the global workspace_dir setting — the
            # frontend used to write it here; we accept it (so the
            # PUT doesn't 400) but log a one-time warning and drop it
            # instead of persisting, so the on-disk config stays clean.
            _logger.warning(
                "agent.workspace_dir is deprecated as of v0.5 — ignored. "
                "Use PUT /api/coding/workspace to set a coding session's workspace."
            )

        if req.region is not None:
            if req.region not in ("global", "cn"):
                raise HTTPException(
                    status_code=400,
                    detail="region must be 'global' or 'cn'.",
                )
            if not isinstance(cfg.get("minimax"), dict):
                cfg["minimax"] = {}
            cfg["minimax"]["region"] = req.region

        if req.api_base is not None:
            base = req.api_base.strip()
            if not base:
                raise HTTPException(status_code=400, detail="api_base must be a non-empty URL.")
            if not (base.startswith("http://") or base.startswith("https://")):
                raise HTTPException(
                    status_code=400,
                    detail="api_base must start with http:// or https://",
                )
            if not isinstance(cfg.get("minimax"), dict):
                cfg["minimax"] = {}
            cfg["minimax"]["api_base"] = base.rstrip("/")

        if req.auto_compact is not None:
            # The 80% auto-compact threshold respects this toggle.
            # The 90% safety net is NEVER overridable (see
            # AgentConfig docstring + AGENTS.local.md invariant #14).
            cfg["auto_compact"] = bool(req.auto_compact)

        import yaml
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            yaml.dump(cfg, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

        config = cfg

        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- MCP Servers endpoints ---

@app.get("/api/mcp/servers")
async def get_mcp_servers():
    """Return list of configured MCP servers."""
    cfg = _load_config_dict()
    servers = cfg.get("mcp_servers", {})
    if not isinstance(servers, dict):
        servers = {}
    result = []
    for sid, sdata in servers.items():
        if isinstance(sdata, dict):
            result.append({
                "id": sid,
                "name": sdata.get("name", sid),
                "transport": sdata.get("transport", "stdio"),
                "command": sdata.get("command"),
                "args": sdata.get("args", []),
                "env": sdata.get("env", {}),
                "url": sdata.get("url"),
                "enabled": sdata.get("enabled", True),
            })
    return {"success": True, "servers": result}


@app.post("/api/mcp/servers")
async def create_mcp_server(req: MCPServerCreate):
    """Create a new MCP server configuration."""
    cfg = _load_config_dict()
    if "mcp_servers" not in cfg or not isinstance(cfg.get("mcp_servers"), dict):
        cfg["mcp_servers"] = {}

    server_id = _generate_server_id(req.name)
    # Ensure unique id
    base_id = server_id
    counter = 1
    while server_id in cfg["mcp_servers"]:
        server_id = f"{base_id}-{counter}"
        counter += 1

    if req.transport not in ("stdio", "sse", "http"):
        raise HTTPException(status_code=400, detail="Invalid transport. Must be stdio, sse, or http.")

    if req.transport == "stdio" and not req.command:
        raise HTTPException(status_code=400, detail="stdio transport requires a command.")
    if req.transport in ("sse", "http") and not req.url:
        raise HTTPException(status_code=400, detail="sse/http transport requires a url.")

    cfg["mcp_servers"][server_id] = {
        "name": req.name,
        "transport": req.transport,
        "command": req.command,
        "args": req.args,
        "env": req.env,
        "url": req.url,
        "enabled": req.enabled,
    }
    _save_config_dict(cfg)
    return {"success": True, "server": {**cfg["mcp_servers"][server_id], "id": server_id}}


@app.put("/api/mcp/servers/{server_id}")
async def update_mcp_server(server_id: str, req: MCPServerUpdate):
    """Update an existing MCP server configuration."""
    cfg = _load_config_dict()
    servers = cfg.get("mcp_servers", {})
    if not isinstance(servers, dict) or server_id not in servers:
        raise HTTPException(status_code=404, detail="Server not found")

    sdata = servers[server_id]
    transport = req.transport or sdata.get("transport", "stdio")

    if transport not in ("stdio", "sse", "http"):
        raise HTTPException(status_code=400, detail="Invalid transport. Must be stdio, sse, or http.")

    new_command = req.command if req.command is not None else sdata.get("command")
    new_url = req.url if req.url is not None else sdata.get("url")

    if transport == "stdio" and not new_command:
        raise HTTPException(status_code=400, detail="stdio transport requires a command.")
    if transport in ("sse", "http") and not new_url:
        raise HTTPException(status_code=400, detail="sse/http transport requires a url.")

    sdata["name"] = req.name if req.name is not None else sdata.get("name", server_id)
    sdata["transport"] = transport
    if req.command is not None:
        sdata["command"] = req.command
    if req.args is not None:
        sdata["args"] = req.args
    if req.env is not None:
        sdata["env"] = req.env
    if req.url is not None:
        sdata["url"] = req.url
    if req.enabled is not None:
        sdata["enabled"] = req.enabled

    _save_config_dict(cfg)
    return {"success": True, "server": {**sdata, "id": server_id}}


@app.delete("/api/mcp/servers/{server_id}")
async def delete_mcp_server(server_id: str):
    """Delete an MCP server configuration."""
    cfg = _load_config_dict()
    servers = cfg.get("mcp_servers", {})
    if not isinstance(servers, dict) or server_id not in servers:
        raise HTTPException(status_code=404, detail="Server not found")
    del servers[server_id]
    _save_config_dict(cfg)
    return {"success": True}


@app.post("/api/mcp/servers/{server_id}/toggle")
async def toggle_mcp_server(server_id: str):
    """Toggle enabled state of an MCP server."""
    cfg = _load_config_dict()
    servers = cfg.get("mcp_servers", {})
    if not isinstance(servers, dict) or server_id not in servers:
        raise HTTPException(status_code=404, detail="Server not found")
    sdata = servers[server_id]
    sdata["enabled"] = not sdata.get("enabled", True)
    _save_config_dict(cfg)
    return {"success": True, "enabled": sdata["enabled"]}


@app.post("/api/mcp/servers/{server_id}/test")
async def test_mcp_server_endpoint(server_id: str):
    """Test connectivity to an MCP server and return discovered tools."""
    cfg = _load_config_dict()
    servers = cfg.get("mcp_servers", {})
    if not isinstance(servers, dict) or server_id not in servers:
        raise HTTPException(status_code=404, detail="Server not found")
    sdata = servers[server_id]
    server = {"id": server_id, **sdata}
    result = await test_mcp_server(server, timeout_seconds=10)
    if not sdata.get("enabled", True):
        result["warning"] = "Server is disabled, but connection test was run."
    return result


# --- Conversation REST endpoints ---

@app.get("/api/conversations")
async def get_conversations(type: str = ""):
    """List all saved conversations. Optional type filter: 'chat' or 'coding'."""
    all_convos = list_conversations()
    if type == "coding":
        all_convos = [c for c in all_convos if c["id"].startswith("coding-")]
    elif type == "chat":
        all_convos = [c for c in all_convos if not c["id"].startswith("coding-")]
    return {"success": True, "conversations": all_convos}


@app.get("/api/conversations/search")
async def search_conversations_endpoint(q: str = "", type: str = ""):
    """Search conversations by title, message content, or attachment.

    Query params:
      - q: search term (required, min 1 char)
      - type: optional filter — 'chat', 'coding', or empty for all
    """
    if not q or not q.strip():
        raise HTTPException(status_code=400, detail="Query parameter 'q' is required")
    results = search_conversations(q, type_filter=type)
    return {"success": True, "query": q.strip(), "results": results}


@app.get("/api/conversations/{conv_id}")
async def get_conversation(conv_id: str):
    """Load a specific conversation."""
    return {"success": True, "data": load_conversation(conv_id)}


@app.delete("/api/conversations/{conv_id}")
async def delete_conversation_endpoint(conv_id: str):
    """Delete a conversation."""
    deleted = delete_conversation(conv_id)
    return {"success": deleted}


@app.post("/api/conversations/{conv_id}/rename")
async def rename_conversation(conv_id: str, req: dict):
    """Rename a conversation."""
    conv = load_conversation(conv_id)
    conv["title"] = req.get("title", conv.get("title", "Untitled"))
    save_conversation(conv_id, conv["title"], conv.get("messages", []))
    return {"success": True}


# --- Task board REST endpoints ---

class TaskCreate(BaseModel):
    title: str
    description: str = ""
    status: str = "pending"
    priority: str = "medium"
    subtasks: list = []
    created_by: str = "user"
    source_session_id: str | None = None


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    priority: str | None = None
    subtasks: list | None = None


class TaskReorder(BaseModel):
    """Batch update of `order` for drag&drop reordering within a column.

    The frontend sends the full ordered list of task IDs in their new
    visual order — the server applies it as `order = index` so future
    sorts can rebuild deterministically.
    """
    ids: list[str]


def _validate_status(status: str):
    if status not in VALID_TASK_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status '{status}'. Must be one of {sorted(VALID_TASK_STATUSES)}.",
        )


def _validate_priority(priority: str):
    if priority not in VALID_TASK_PRIORITIES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid priority '{priority}'. Must be one of {sorted(VALID_TASK_PRIORITIES)}.",
        )


@app.get("/api/tasks")
async def get_tasks():
    """List all tasks, ordered by `order` ascending (then updated_at desc)."""
    tasks = _load_tasks()
    tasks.sort(key=lambda t: (t.get("order", 0), t.get("updated_at", "")), reverse=False)
    # Re-sort by updated_at desc as tiebreaker when order is identical
    # (this happens when all tasks have order=0 on first migration).
    tasks.sort(key=lambda t: t.get("updated_at", ""), reverse=True)
    return {"success": True, "tasks": [_serialize_task(t) for t in tasks]}


@app.post("/api/tasks")
async def create_task(req: TaskCreate):
    """Create a new task.

    `created_by` may be 'user' (default, from the UI) or 'agent' (when the
    LLM-driven agent creates tasks via the tasks_create tool).
    """
    title = req.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Task title is required.")
    _validate_status(req.status)
    _validate_priority(req.priority)

    tasks = _load_tasks()
    now = datetime.now().isoformat()
    new_task = {
        "id": _generate_task_id(),
        "title": title,
        "description": req.description.strip() if req.description else "",
        "status": req.status,
        "priority": req.priority,
        "subtasks": req.subtasks or [],
        "order": _next_task_order(tasks),
        "created_at": now,
        "updated_at": now,
        "created_by": req.created_by if req.created_by in {"user", "agent"} else "user",
        "source_session_id": req.source_session_id,
    }
    tasks.append(new_task)
    _save_tasks(tasks)
    _logger.info(
        f"Task created: id={new_task['id']} by={new_task['created_by']} title={new_task['title'][:40]!r}"
    )
    return {"success": True, "task": _serialize_task(new_task)}


# IMPORTANT: reorder MUST be declared BEFORE the {task_id} handlers below.
# FastAPI matches routes in declaration order, so PATCH /api/tasks/reorder
# would otherwise be swallowed by /api/tasks/{task_id} (with task_id="reorder")
# and return 404 "Task 'reorder' not found".
@app.patch("/api/tasks/reorder")
async def reorder_tasks(req: TaskReorder):
    """Batch update — assigns order = index for each task ID in `ids`.

    Tasks NOT in `ids` are untouched (they belong to other columns / are
    filtered out). This is intentional: the frontend only sends the IDs
    it actually reordered.
    """
    tasks = _load_tasks()
    id_to_new_order = {tid: idx for idx, tid in enumerate(req.ids)}
    unknown = [tid for tid in req.ids if not any(t["id"] == tid for t in tasks)]
    if unknown:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown task IDs: {unknown}",
        )
    for t in tasks:
        if t["id"] in id_to_new_order:
            t["order"] = id_to_new_order[t["id"]]
            t["updated_at"] = datetime.now().isoformat()
    _save_tasks(tasks)
    return {"success": True}


@app.patch("/api/tasks/{task_id}")
async def update_task(task_id: str, req: TaskUpdate):
    """Partial update — only the fields you send are touched."""
    tasks = _load_tasks()
    target = next((t for t in tasks if t["id"] == task_id), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found.")

    if req.title is not None:
        new_title = req.title.strip()
        if not new_title:
            raise HTTPException(status_code=400, detail="Task title cannot be empty.")
        target["title"] = new_title
    if req.description is not None:
        target["description"] = req.description.strip()
    if req.status is not None:
        _validate_status(req.status)
        target["status"] = req.status
    if req.priority is not None:
        _validate_priority(req.priority)
        target["priority"] = req.priority
    if req.subtasks is not None:
        target["subtasks"] = req.subtasks

    target["updated_at"] = datetime.now().isoformat()
    _save_tasks(tasks)
    return {"success": True, "task": _serialize_task(target)}


@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: str):
    """Delete a task by ID. Returns success=false if not found."""
    tasks = _load_tasks()
    before = len(tasks)
    tasks = [t for t in tasks if t["id"] != task_id]
    if len(tasks) == before:
        return {"success": False, "error": "not_found"}
    _save_tasks(tasks)
    _logger.info(f"Task deleted: id={task_id}")
    return {"success": True}


def _build_subdir_post_processor(agent):
    """Build a tool_result_post_processor that appends progressive
    subdirectory hints to each tool result.

    PR D (Hermes spec): as the agent navigates into subdirectories
    during a session, the relevant project context file
    (AGENTS.md / CLAUDE.md / .cursorrules) is discovered and appended
    to the tool result so the model sees the project conventions
    naturally.

    The closure captures ``agent._subdir_tracker`` (set up in
    ``SessionManager.get_or_create_agent``). On each tool call it
    invokes ``hint_for_tool_call`` to discover any new directories
    the tool touched, formats the resulting hints, and appends them
    to the ToolResult's content. The ``Agent.run`` loop's
    ``tool_result_post_processor`` hook guarantees the modified
    result is what the LLM sees.

    Returns a fresh ToolResult if any hint was found, or the
    original result untouched (best-effort, no-op for empty hits).
    """
    from mini_agent.tools.base import ToolResult
    tracker = getattr(agent, "_subdir_tracker", None)
    if tracker is None:
        return None  # legacy agent without a tracker — no-op

    def _post_process(tool_name, arguments, result):
        hints = tracker.hint_for_tool_call(tool_name, arguments or {})
        if not hints:
            return result  # no new directories hit; leave the result alone
        hint_text = format_hints_for_model(hints)
        # Append (don't replace) — the tool's actual output stays
        # intact; the hint is additional context for the model.
        new_content = (result.content or "") + hint_text
        return ToolResult(
            success=result.success,
            content=new_content,
            error=result.error,
        )

    return _post_process


@app.websocket("/ws/chat/{session_id}")
async def chat_websocket(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for streaming chat."""
    await websocket.accept()
    # Register in the cross-session WS registry so the Live Todo
    # Progress component (PR C) can receive task_updated events
    # for this session. Unregistered on disconnect.
    register_ws(session_id, websocket)
    _logger.info(f"WebSocket connected: {session_id}")

    try:
        agent = await session_manager.get_or_create_agent(session_id)

        # Load existing conversation and send history to client
        conv = load_conversation(session_id)
        if conv and conv.get("messages"):
            await websocket.send_json({
                "type": "history",
                "messages": [
                    {
                        "type": msg.get("type", "user" if msg.get("is_user") else "assistant"),
                        "content": msg.get("content", msg.get("text", "")),
                        "attachment": msg.get("attachment"),
                        # Replay the model's reasoning so the chat UI can
                        # render the thinking block alongside the answer.
                        "thinking": msg.get("thinking"),
                        "model": msg.get("model"),
                    }
                    for msg in conv["messages"]
                ]
            })

        # Coding sessions: tell the frontend which workspace this
        # conversation belongs to so the header picker can light up
        # with the right path. Locked sessions get the lock icon.
        if session_id.startswith("coding-"):
            ws = _load_coding_workspace_for_session(session_id)
            await websocket.send_json({
                "type": "session_workspace",
                "workspace_dir": ws,
                "locked": bool(_coding_sessions.get(session_id, {}).get("locked")),
            })

        while True:
            data = await websocket.receive_json()

            # Handle manual context-compact request from the frontend
            # (triggered by the [Compact] button in the warning banner).
            # Runs _summarize_messages synchronously, then re-emits a
            # `usage` event with the post-compact totals so the StatusBar
            # updates without waiting for the next LLM call. Emits
            # structured `started` / `completed` / `failed` log events
            # (JSON, one line per state) for dashboards to ingest.
            if data.get("type") == "compact":
                compact_id = uuid.uuid4().hex[:12]
                before = agent.api_total_tokens or 0
                limit = agent.model_context_limit or 1
                pct_before = before / limit if limit > 0 else 0
                last_usage = getattr(agent, "last_usage", None)
                effective_model = (
                    data.get("model")
                    or getattr(agent.llm, "model", None)
                )
                _log_compact_event({
                    "event": "started",
                    "compact_id": compact_id,
                    "session_id": session_id,
                    "triggered_by": "frontend",
                    "model": effective_model,
                    "before_tokens": before,
                    "pct_before": round(pct_before, 4),
                    "model_context_limit": limit,
                })
                try:
                    await agent._summarize_messages()
                    after = agent.api_total_tokens or 0
                    pct_after = after / limit if limit > 0 else 0
                    await websocket.send_json({
                        "type": "compact_done",
                        "compact_id": compact_id,
                        "before_tokens": before,
                        "after_tokens": after,
                        "model": effective_model,
                    })
                    # Re-emit usage so the StatusBar reflects the drop
                    if last_usage:
                        # Refresh by_source — the system prompt may
                        # have shrunk thanks to the summary, so the
                        # breakdown changed.
                        compact_by_source = None
                        try:
                            compact_by_source = agent.estimate_by_source()
                        except Exception as est_err:
                            _logger.debug(f"estimate_by_source after compact failed: {est_err}")
                        payload = {
                            "type": "usage",
                            "usage": last_usage,
                            "model": effective_model,
                        }
                        if compact_by_source is not None:
                            payload["by_source"] = compact_by_source
                        await websocket.send_json(payload)
                    _log_compact_event({
                        "event": "completed",
                        "compact_id": compact_id,
                        "session_id": session_id,
                        "triggered_by": "frontend",
                        "model": effective_model,
                        "before_tokens": before,
                        "after_tokens": after,
                        "pct_before": round(pct_before, 4),
                        "pct_after": round(pct_after, 4),
                        "delta_tokens": before - after,
                        "delta_pct": round(pct_before - pct_after, 4),
                    })
                except Exception as compact_err:
                    _log_compact_event({
                        "event": "failed",
                        "compact_id": compact_id,
                        "session_id": session_id,
                        "triggered_by": "frontend",
                        "model": effective_model,
                        "before_tokens": before,
                        "pct_before": round(pct_before, 4),
                        "error": str(compact_err),
                        "error_type": type(compact_err).__name__,
                    })
                    await websocket.send_json({
                        "type": "compact_failed",
                        "compact_id": compact_id,
                        "detail": str(compact_err),
                    })
                continue

            # Handle skill activation
            if data.get("type") == "activate_skill":
                skill_name = data.get("skill")
                # Use the cached multi-source loader (User > Extra > External > Built-in).
                # If we don't have the helper available yet (very early startup),
                # fall back to a single-dir scan to keep the handler robust.
                try:
                    loader = _get_skills_loader()
                except Exception:
                    from mini_agent.tools.skill_loader import SkillLoader
                    loader = SkillLoader(str(PROJECT_ROOT / "mini_agent" / "skills"))
                    loader.discover_skills()
                skill = loader.get_skill(skill_name)
                if skill:
                    # Inject skill content into messages as a system context update
                    skill_prompt = skill.to_prompt()
                    agent.messages.append(Message(role="user", content=f"[Skill Activated: {skill_name}]\n\n{skill_prompt}"))
                    await websocket.send_json({
                        "type": "skill_activated",
                        "skill": skill_name,
                        "source": skill.source.value,
                    })
                else:
                    await websocket.send_json({
                        "type": "skill_activate_failed",
                        "skill": skill_name,
                        "detail": f"Skill '{skill_name}' not found.",
                    })
                continue

            message = data.get("message", "").strip()
            attachment = data.get("attachment")
            permission_mode = data.get("permission_mode", "agent")
            # Per-turn model + thinking overrides. The user can pick a
            # different chat model and toggle the thinking param (only
            # M3 supports thinking) from the composer; these fields are
            # optional and fall back to the session's defaults.
            model_override = data.get("model")
            thinking_override = data.get("thinking")  # True/False/None

            if not message and not attachment:
                continue

            # Build full message with attachment analysis
            full_message = message
            
            if attachment:
                attachment_path = PROJECT_ROOT / attachment
                if attachment_path.exists():
                    # Check if it's an image
                    ext = attachment_path.suffix.lower()
                    if ext in ('.png', '.jpg', '.jpeg', '.webp', '.gif'):
                        try:
                            minimax_config = get_minimax_config()
                            from mini_max_mcp.mcp_tools import MiniMaxMCPClient
                            client = MiniMaxMCPClient(minimax_config["api_key"], minimax_config["api_base"])
                            success, description = client.understand_image(
                                image_path=str(attachment_path),
                                prompt="Describe this image in detail."
                            )
                            client.close()
                            if success:
                                # Frame the description as the IMAGE the user
                                # is asking about — otherwise the model
                                # treats the bracketed text as a stray note
                                # and replies "I don't see the image". The
                                # two cases (user question + image-only)
                                # both produce a clean message that the
                                # agent can answer from.
                                if message and message.strip():
                                    user_msg = message.strip()
                                else:
                                    user_msg = "What is in this image?"
                                img_context = (
                                    f"\n\n[User uploaded an image to the chat. "
                                    f"Use the description below AS your view "
                                    f"of the image when answering.]\n"
                                    f"Image description: {description}"
                                )
                                full_message = f"{user_msg}{img_context}"
                        except Exception as e:
                            _logger.warning(f"Image understanding failed: {e}")
                    else:
                        # Try to read text files
                        try:
                            with open(attachment_path, 'r', encoding='utf-8') as f:
                                file_content = f.read()[:10000]
                            file_context = f"\n\n[Attached file `{attachment_path.name}`:\n```\n{file_content}\n```]"
                            full_message = (message or "Please analyze this file.") + file_context
                        except Exception as e:
                            _logger.warning(f"File read failed: {e}")
                            full_message = (message or "") + f"\n\n[Attached file: {attachment_path.name}]"

            if not full_message.strip():
                continue

            # Coding sessions: lock the workspace on the first real
            # message so the user can't silently swap folders mid-run.
            # Skill activations / system events don't count — only
            # user messages with text or an attachment. The frontend
            # also fires POST /api/coding/session/{id}/lock defensively
            # right after sending; either path is idempotent.
            if session_id.startswith("coding-"):
                sess = _coding_sessions.setdefault(session_id, {"locked": False, "workspace_dir": None})
                if not sess.get("locked"):
                    if sess.get("workspace_dir"):
                        sess["locked"] = True
                        await websocket.send_json({
                            "type": "session_workspace",
                            "workspace_dir": sess["workspace_dir"],
                            "locked": True,
                        })
                    else:
                        # No workspace picked yet — refuse the message
                        # so the frontend can show the picker.
                        await websocket.send_json({
                            "type": "error",
                            "content": "Pick a workspace folder in the Coding header before sending your first message.",
                        })
                        continue

            # Send user message back as confirmation
            display_content = message or "📎 Attachment sent"
            await websocket.send_json({
                "type": "user",
                "content": display_content,
                "attachment": attachment,
            })

            # Add user message to agent
            agent.add_user_message(full_message)

            # Daily log append — user block (per spec §5.2). The
            # matching assistant block is written after the agent
            # returns. Best-effort: a daily write failure should never
            # break the chat.
            try:
                agent_dir_daily = get_app_workspace_dir() / ".agent"
                if display_content and display_content.strip():
                    daily_path = append_daily_turn(
                        agent_dir_daily,
                        "user",
                        display_content,
                    )
                    # Tell the frontend the daily log changed so any open
                    # ContextModal / DocViewer / status widget can refresh
                    # without the user re-opening it. date comes from the
                    # filename (YYYY-MM-DD.md) so the client can match the
                    # exact doc it's displaying.
                    if daily_path and daily_path.name:
                        await websocket.send_json({
                            "type": "daily_updated",
                            "date": daily_path.stem,
                            "path": str(daily_path),
                        })
            except Exception as e:
                _logger.warning(f"Daily append (user) failed: {e}")

            # Auto-save: append user message
            conv = load_conversation(session_id)
            conv["messages"].append({"type": "user", "content": display_content, "attachment": attachment})
            save_conversation(session_id, conv.get("title", get_conversation_title(conv["messages"])), conv["messages"])

            # Run agent and stream response
            await websocket.send_json({"type": "status", "content": "thinking..."})

            # Accumulate the model's reasoning across all agent-loop steps so
            # we can include the full thinking block in the final assistant
            # message (and persist it in the conversation).
            accumulated_thinking: list[str] = []
            effective_model: str | None = None
            # Set to True once we've streamed a thinking_delta or
            # text_delta — the tool-level __thinking__ event from the
            # agent would re-send the same accumulated content as one
            # big payload, duplicating what the user already saw
            # arrive live. Use this flag to skip the tool-level event
            # whenever streaming has already covered the ground.
            streamed_deltas = False

            try:
                async def tool_callback(tool_name, arguments, result):
                    if tool_name == "__thinking__":
                        # If the per-delta stream already delivered the
                        # reasoning to the client, skip the redundant
                        # bulk event (which would re-send the same
                        # accumulated text as one big payload).
                        if streamed_deltas:
                            return
                        # Stream-level thinking is the whole accumulated
                        # block from the LLM (not delta-by-delta). The
                        # delta stream from the LLM client arrives via
                        # ``stream_callback`` (thinking_delta events).
                        thinking_text = arguments.get("thinking", "")
                        if thinking_text:
                            accumulated_thinking.append(thinking_text)
                        await websocket.send_json({
                            "type": "thinking",
                            "content": thinking_text,
                        })
                    elif tool_name == "__tool_calls__":
                        await websocket.send_json({
                            "type": "tool_calls",
                            "tools": arguments.get("tool_calls", []),
                        })
                    elif tool_name == "__step_start__":
                        await websocket.send_json({
                            "type": "step_start",
                            "step": arguments.get("step"),
                            "max_steps": arguments.get("max_steps"),
                        })
                    elif result:
                        await websocket.send_json({
                            "type": "tool_result",
                            "tool": tool_name,
                            "arguments": arguments,
                            "success": result.success,
                            "content": result.content if result.success else None,
                            "error": result.error if not result.success else None,
                        })

                async def permission_callback(request):
                    req_id = str(uuid.uuid4())
                    await websocket.send_json({
                        "type": "permission_request",
                        "request_id": req_id,
                        "tool_name": request["tool_name"],
                        "arguments": request["arguments"],
                        "classification": request["classification"],
                    })
                    # Wait for response with timeout
                    try:
                        while True:
                            resp = await asyncio.wait_for(
                                websocket.receive_json(), timeout=120
                            )
                            if resp.get("type") == "permission_response" and resp.get("request_id") == req_id:
                                return "approved" if resp.get("approved") else "rejected"
                            # Ignore unrelated messages
                    except asyncio.TimeoutError:
                        _logger.warning(f"Permission request {req_id} timed out")
                        return "rejected"
                    except Exception as e:
                        _logger.warning(f"Permission request {req_id} error: {e}")
                        return "rejected"

                async def stream_callback(kind: str, content: str) -> None:
                    """Forward per-token deltas from the LLM to the WebSocket.

                    ``kind`` is "thinking" (extended-thinking block) or
                    "text" (visible response). The frontend appends each
                    delta to the in-flight message so the user sees
                    the reasoning and response stream word-by-word.
                    """
                    nonlocal streamed_deltas
                    streamed_deltas = True
                    try:
                        await websocket.send_json({
                            "type": f"{kind}_delta",
                            "content": content,
                        })
                    except Exception:
                        # Client disconnected mid-stream — let the
                        # agent.run loop fail naturally on the next
                        # send. Don't raise from the callback.
                        pass

                result = await agent.run(
                    tool_callback=tool_callback,
                    permission_mode=permission_mode,
                    permission_callback=permission_callback,
                    model_override=model_override,
                    thinking_override=thinking_override,
                    stream_callback=stream_callback,
                    tool_result_post_processor=_build_subdir_post_processor(agent),
                )

                # Resolve which model actually ran (override or default)
                effective_model = model_override or getattr(agent.llm, "model", None)
                full_thinking = "\n\n".join(s for s in accumulated_thinking if s) or None
                last_usage = getattr(agent, "last_usage", None)

                # Per-source token breakdown — best-effort approximation
                # (see Agent.estimate_by_source). Forwarded alongside
                # `usage` so the StatusBar popover can render a
                # "Token breakdown by source" section. The frontend is
                # defensive: missing `by_source` falls back to no breakdown.
                by_source = None
                try:
                    by_source = agent.estimate_by_source()
                except Exception as est_err:
                    _logger.debug(f"estimate_by_source failed: {est_err}")

                # Forward per-turn token usage to the StatusBar BEFORE the
                # assistant event, so the context chip can update immediately
                # when the agent finishes a turn. The frontend also accepts
                # `usage` inside the assistant event as a fallback for older
                # proxies that drop the standalone event.
                if last_usage:
                    payload = {
                        "type": "usage",
                        "usage": last_usage,
                        "model": effective_model,
                    }
                    if by_source is not None:
                        payload["by_source"] = by_source
                    await websocket.send_json(payload)

                await websocket.send_json({
                    "type": "assistant",
                    "content": result,
                    "thinking": full_thinking,
                    "model": effective_model,
                    "usage": last_usage,
                    "by_source": by_source,
                })

                # Auto-save: append assistant message (with thinking + model)
                conv = load_conversation(session_id)
                conv["messages"].append({
                    "type": "assistant",
                    "content": result,
                    "thinking": full_thinking,
                    "model": effective_model,
                })
                save_conversation(session_id, conv.get("title", get_conversation_title(conv["messages"])), conv["messages"])

                # Daily log append (per Agent Context spec §5.2). Records
                # this turn as a pair of blocks (user + assistant + `---`)
                # in workspace/.agent/daily/{YYYY-MM-DD}.md. Best-effort —
                # if the daily write fails, the chat still completes; we
                # only log the error and move on. The daily file is
                # separate from the conversation JSON so it can grow
                # append-only without bloating reload speed.
                try:
                    agent_dir_daily = get_app_workspace_dir() / ".agent"
                    # One block for the assistant turn. The matching
                    # user-turn block is written below (right after
                    # `display_content` is known), so each user/agent
                    # pair becomes two blocks separated by `---`.
                    if result and result.strip():
                        daily_path = append_daily_turn(
                            agent_dir_daily,
                            "assistant",
                            result,
                            thinking=full_thinking,
                        )
                        # Companion event to the user-block emit above.
                        # Frontend coalesces the two into a single refresh.
                        if daily_path and daily_path.name:
                            await websocket.send_json({
                                "type": "daily_updated",
                                "date": daily_path.stem,
                                "path": str(daily_path),
                            })
                except Exception as e:
                    _logger.warning(f"Daily append (assistant) failed: {e}")
            except Exception as e:
                _logger.error(f"Agent error: {e}")
                await websocket.send_json({
                    "type": "error",
                    "content": str(e),
                })

    except WebSocketDisconnect:
        _logger.info(f"WebSocket disconnected: {session_id}")
    except Exception as e:
        _logger.error(f"WebSocket error: {e}")
    finally:
        # Always unregister, even on exception. Prevents the
        # registry from accumulating dead WebSocket refs.
        unregister_ws(session_id, websocket)


@app.post("/api/tts")
async def tts_generate(req: GenerateRequest, background_tasks: BackgroundTasks, session_id: str = ""):
    """Generate TTS audio (legacy /api/tts endpoint).

    Output goes to ``<session_workspace>/tts/`` if a coding session is
    attached, otherwise to ``<app-workspace>/tts/``.
    """
    try:
        from mini_max_mcp.client import tts_sync
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]

        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        out_dir = _media_output_dir(session_id, "tts")
        output_path = out_dir / f"tts_web_{asyncio.get_event_loop().time()}.mp3"

        tts_model = req.settings.get("model", "speech-2.8-turbo")

        success, result = tts_sync(
            api_key, api_base, req.prompt,
            req.settings.get("voice", "male-qn-qingque"),
            req.settings.get("speed", 1.0),
            str(output_path)
        )

        if success:
            cost = calculate_tts_cost(len(req.prompt or ""), tts_model)
            return {
                "success": True,
                "file_path": str(result),
                "model": tts_model,
                "characters": len(req.prompt or ""),
                **cost,
            }
        else:
            return {"success": False, "error": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...), session_id: str = ""):
    """Upload a file. Coding sessions drop it in their workspace
    (``<coding-workspace>/uploads/``); everything else uses the fixed
    app workspace (``<app-workspace>/uploads/``)."""
    try:
        root = _resolve_session_root(session_id or None)
        upload_dir = root / "uploads"
        upload_dir.mkdir(parents=True, exist_ok=True)

        # Sanitize filename
        safe_name = Path(file.filename).name.replace(" ", "_")
        file_path = upload_dir / safe_name

        # If file exists, append timestamp
        if file_path.exists():
            stem = file_path.stem
            suffix = file_path.suffix
            file_path = upload_dir / f"{stem}_{asyncio.get_event_loop().time():.0f}{suffix}"

        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)

        relative_path = str(file_path.relative_to(root))
        return {
            "success": True,
            "path": relative_path,
            "filename": file_path.name,
            "workspace_dir": str(root),
            "session_id": session_id or None,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/image")
async def image_generate(req: ImageRequest, session_id: str = ""):
    """Generate image (T2I or i2i).

    Both modes hit ``/v1/image_generation``:
    - T2I:   ``model="image-01"``, no ``subject_reference``.
    - i2i:   ``model="image-01-live"``, ``subject_reference`` populated
             with ``[{"type": "character", "image_file": <url|base64>}]``.

    Output goes to the session's workspace when a coding session is
    attached (``<coding-workspace>/outputs/images/``), otherwise to
    the app workspace.
    """
    try:
        from mini_max_mcp.client import image_sync
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]

        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        n = max(int(req.n or 1), 1)

        # i2i requires the subject_reference list to be non-empty AND
        # switches the model to image-01-live. If the frontend sent an
        # empty subject_reference list, fall back to T2I rather than 400
        # — the frontend decides which mode via the segmented control.
        subject_reference = req.subject_reference if req.subject_reference else None
        model = req.model or "image-01"
        if subject_reference and model == "image-01":
            model = "image-01-live"

        suffix = "image_i2i" if subject_reference else "image_web"
        out_dir = _media_output_dir(session_id, "images")
        output_path = out_dir / f"{suffix}_{asyncio.get_event_loop().time():.0f}.png"

        success, result = image_sync(
            api_key, api_base, req.prompt,
            str(output_path),
            aspect_ratio=req.aspect_ratio,
            width=req.width,
            height=req.height,
            n=n,
            prompt_optimizer=req.prompt_optimizer,
            watermark=req.watermark,
            seed=req.seed,
            model=model,
            subject_reference=subject_reference,
        )

        if success:
            # Return path relative to the session's workspace root (coding
            # workspace if attached, else app workspace) so the frontend
            # can fetch it back via /api/files/raw?session_id=...&path=...
            out_root = _resolve_session_root(session_id or None)
            rel_path = str(Path(result).relative_to(out_root)).replace('\\', '/')
            cost = calculate_image_cost(n)
            return {
                "success": True,
                "file_path": rel_path,
                "count": n,
                "model": model,
                "workspace_dir": str(out_root),
                **cost,
            }
        else:
            return {"success": False, "error": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/image/i2i")
async def image_i2i_generate(req: ImageRequest, session_id: str = ""):
    """Generate image-to-image variation."""
    try:
        from mini_max_mcp.client import image_variations_sync
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]

        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        image_path = req.reference_image
        if not image_path:
            raise HTTPException(status_code=400, detail="Reference image required")

        full_image_path = PROJECT_ROOT / image_path
        if not full_image_path.exists():
            raise HTTPException(status_code=404, detail="Reference image not found")

        output_path = PROJECT_ROOT / "workspace" / f"image_i2i_{asyncio.get_event_loop().time()}.png"
        output_path.parent.mkdir(exist_ok=True)

        n = max(int(req.n or 1), 1)

        success, result = image_variations_sync(
            api_key, api_base,
            str(full_image_path),
            prompt=req.prompt,
            output_path=str(output_path),
            aspect_ratio=req.aspect_ratio,
            width=req.width,
            height=req.height,
            n=n,
            prompt_optimizer=req.prompt_optimizer,
            watermark=req.watermark,
            seed=req.seed
        )

        if success:
            rel_path = str(Path(result).relative_to(PROJECT_ROOT)).replace('\\', '/')
            cost = calculate_image_cost(n)
            return {
                "success": True,
                "file_path": rel_path,
                "count": n,
                **cost,
            }
        else:
            return {"success": False, "error": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class MusicCoverPreprocessRequest(BaseModel):
    """Body for the cover preprocess endpoint.

    Accepts one of:
      - ``audio_url`` — typically the workspace URL returned by
        ``/api/upload`` after the frontend uploads the file.
      - ``audio_base64`` — inline base64-encoded audio (≤50MB raw; only
        practical for short samples — prefer ``audio_url`` in normal use).

    The two are mutually exclusive.
    """
    audio_url: str = ""
    audio_base64: str = ""


def _resolve_local_audio_url(url: str) -> Optional[Path]:
    """Map a workspace-relative ``/api/files/download?path=...`` URL back
    to its on-disk path under PROJECT_ROOT, for pre-flight validation.

    Returns ``None`` for external URLs (the API will validate those).
    Returns ``None`` if the resolved path escapes PROJECT_ROOT or doesn't
    exist on disk.
    """
    if not url or "/api/files/download" not in url:
        return None
    try:
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(url).query)
        raw_path = (q.get("path") or [""])[0]
        if not raw_path:
            return None
        candidate = (PROJECT_ROOT / raw_path).resolve()
        proj_root = PROJECT_ROOT.resolve()
        if proj_root not in candidate.parents and candidate != proj_root:
            return None
        if not candidate.exists() or not candidate.is_file():
            return None
        return candidate
    except Exception:
        return None


@app.post("/api/minimax/music/preprocess")
async def music_cover_preprocess(req: MusicCoverPreprocessRequest):
    """Two-step cover flow — step 1: extract features + lyrics.

    Reference audio must be 6s-6min and ≤50MB. Provide either an
    ``audio_url`` (typically the URL returned by ``/api/upload`` after
    the frontend uploads the file) or ``audio_base64`` for inline data.

    Response shape:
        ``{"success": True, "cover_feature_id": str,
           "formatted_lyrics": str, "structure_result": str,
           "audio_duration": float, "trace_id": str,
           "feature_expires_at": str (ISO 8601, +24h)}``

    The returned ``cover_feature_id`` is valid for 24 hours and is
    MD5-deduped by the API — same audio content yields the same id.
    Pass it to ``/api/music`` (model=music-cover|music-cover-free,
    cover_feature_id=...) to generate the cover in step 2.
    """
    try:
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]

        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        sources = sum(bool(x) for x in (req.audio_url, req.audio_base64))
        if sources == 0:
            raise HTTPException(
                status_code=400,
                detail="audio_url or audio_base64 is required.",
            )
        if sources > 1:
            raise HTTPException(
                status_code=400,
                detail="audio_url and audio_base64 are mutually exclusive.",
            )

        # Pre-flight: if the URL points to a local upload, validate size
        # and format on disk before sending — the API rejects 50MB+ with
        # a less actionable error.
        local_path = _resolve_local_audio_url(req.audio_url) if req.audio_url else None
        if local_path is not None:
            size = local_path.stat().st_size
            if size > COVER_AUDIO_MAX_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Reference audio is {size / 1024 / 1024:.1f} MB; "
                        f"max is {COVER_AUDIO_MAX_BYTES // 1024 // 1024} MB."
                    ),
                )
            ext = local_path.suffix.lower().lstrip(".")
            if ext and ext not in COVER_AUDIO_FORMATS:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Unsupported audio format: .{ext}. "
                        f"Supported: {COVER_AUDIO_FORMATS}."
                    ),
                )

        client = MiniMaxSyncClient(api_key, api_base)
        try:
            success, result = client.music_cover_preprocess(
                audio_url=req.audio_url,
                audio_base64=req.audio_base64,
            )
        finally:
            client.close()

        if not success:
            err_msg = (
                result.get("error", "Preprocess failed")
                if isinstance(result, dict)
                else str(result)
            )
            sc = result.get("status_code") if isinstance(result, dict) else None
            if sc in (2013, 1004, 2049):
                raise HTTPException(status_code=400, detail=err_msg)
            if sc == 1008:
                raise HTTPException(status_code=402, detail=err_msg)
            if sc == 1002:
                raise HTTPException(status_code=429, detail=err_msg)
            if sc == 1026:
                raise HTTPException(status_code=422, detail=err_msg)
            raise HTTPException(status_code=502, detail=err_msg)

        from datetime import datetime, timedelta, timezone
        feature_expires_at = (
            datetime.now(timezone.utc) + timedelta(hours=24)
        ).isoformat()
        return {
            "success": True,
            "cover_feature_id": result.get("cover_feature_id", ""),
            "formatted_lyrics": result.get("formatted_lyrics", ""),
            "structure_result": result.get("structure_result", ""),
            "audio_duration": result.get("audio_duration", 0.0),
            "trace_id": result.get("trace_id", ""),
            "feature_expires_at": feature_expires_at,
        }
    except HTTPException:
        raise
    except Exception as e:
        _logger.exception("Music cover preprocess failed")
        raise HTTPException(status_code=500, detail=str(e))


class LyricsRequest(BaseModel):
    """Body for the lyrics generation endpoint.

    ``mode`` selects between generating lyrics from a theme
    (``write_full_song``) and refining existing lyrics (``edit``).
    In ``edit`` mode, ``lyrics`` must be present and is the source
    material; in ``write_full_song`` mode it's ignored.
    """
    mode: Literal["write_full_song", "edit"] = "write_full_song"
    prompt: str = ""
    lyrics: str = ""
    title: str = ""


@app.post("/api/minimax/music/lyrics")
async def music_lyrics_generate(req: LyricsRequest):
    """Generate or refine song lyrics.

    Body: ``LyricsRequest`` — see the Pydantic model for validation.

    Response shape mirrors the MiniMax API:
        ``{"success": True, "song_title": str, "style_tags": str,
           "lyrics": str, "trace_id": str}``

    In ``write_full_song`` mode, ``prompt`` describes the theme/genre/mood
    (≤2000 chars) and ``lyrics`` (if present) is ignored.
    In ``edit`` mode, ``prompt`` is the editing instructions and ``lyrics``
    is the source material (≤3500 chars).
    """
    try:
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]

        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        # Per-mode validation in addition to Pydantic Literal.
        if len(req.prompt) > 2000:
            raise HTTPException(
                status_code=400,
                detail="prompt exceeds 2000 char limit.",
            )
        if req.mode == "edit":
            if not req.lyrics.strip():
                raise HTTPException(
                    status_code=400,
                    detail="lyrics is required in edit mode.",
                )
            if len(req.lyrics) > 3500:
                raise HTTPException(
                    status_code=400,
                    detail="lyrics exceeds 3500 char limit in edit mode.",
                )
        else:
            # write_full_song: prompt is required per the spec.
            if not req.prompt.strip():
                raise HTTPException(
                    status_code=400,
                    detail="prompt is required in write_full_song mode.",
                )

        client = MiniMaxSyncClient(api_key, api_base)
        try:
            success, result = client.lyrics_generate(
                mode=req.mode,
                prompt=req.prompt,
                lyrics=req.lyrics,
                title=req.title,
            )
        finally:
            client.close()

        if not success:
            err_msg = (
                result.get("error", "Lyrics generation failed")
                if isinstance(result, dict)
                else str(result)
            )
            sc = result.get("status_code") if isinstance(result, dict) else None
            if sc in (2013, 1004, 2049):
                raise HTTPException(status_code=400, detail=err_msg)
            if sc == 1008:
                raise HTTPException(status_code=402, detail=err_msg)
            if sc == 1002:
                raise HTTPException(status_code=429, detail=err_msg)
            if sc == 1026:
                raise HTTPException(status_code=422, detail=err_msg)
            raise HTTPException(status_code=502, detail=err_msg)

        # The API returns song_title, style_tags (csv string), lyrics,
        # trace_id, base_resp.
        return {
            "success": True,
            "song_title": result.get("song_title", ""),
            "style_tags": result.get("style_tags", ""),
            "lyrics": result.get("lyrics", ""),
            "trace_id": result.get("trace_id", ""),
        }
    except HTTPException:
        raise
    except Exception as e:
        _logger.exception("Lyrics generation failed")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Speech endpoints — replaces the legacy /api/tts (mmx-based) and adds the
# four MiniMax speech APIs from TAURI_SPEC.md §6b:
#   Synthesize (sync + async) / Clone / Design / Voices (list + delete).
# ============================================================================

class SpeechSynthesizeRequest(BaseModel):
    """Body for /api/minimax/speech/synthesize — single-shot T2A."""
    text: str = Field(..., min_length=1, max_length=10000)
    model: str = "speech-2.8-hd"
    voice_id: str = "English_Graceful_Lady"
    speed: float = 1.0
    vol: float = 1.0
    pitch: int = 0
    emotion: str = ""  # happy|sad|angry|fearful|disgusted|surprised|calm|fluent|whisper
    language_boost: str = "auto"
    voice_modify_pitch: int = 0
    voice_modify_intensity: int = 0
    voice_modify_timbre: int = 0
    voice_modify_sound_effects: str = ""
    audio_setting: Optional[AudioSetting] = None
    filename: str = ""


class SpeechAsyncCreateRequest(BaseModel):
    """Body for /api/minimax/speech/synthesize-async — kick off long-text T2A."""
    text: str
    model: str = "speech-2.8-hd"
    voice_id: str = "English_Graceful_Lady"
    speed: float = 1.0
    vol: float = 1.0
    pitch: int = 0
    language_boost: str = "auto"
    voice_modify_pitch: int = 0
    voice_modify_intensity: int = 0
    voice_modify_timbre: int = 0
    voice_modify_sound_effects: str = ""
    audio_setting: Optional[AudioSetting] = None


class SpeechVoiceCloneRequest(BaseModel):
    """Body for /api/minimax/speech/clone — file_id from /clone/upload."""
    file_id: int
    voice_id: str
    clone_prompt_file_id: int = 0
    clone_prompt_text: str = ""
    text: str = ""           # optional preview text
    model: str = ""          # required if text is set
    language_boost: str = ""
    need_noise_reduction: bool = False
    need_volume_normalization: bool = False
    text_validation: str = ""
    accuracy: float = 0.0


class SpeechVoiceDesignRequest(BaseModel):
    """Body for /api/minimax/speech/design — voice from text description."""
    prompt: str = Field(..., min_length=1)
    preview_text: str = Field(..., min_length=1, max_length=500)
    voice_id: str = ""


# Resolve the audio_setting the user wants for a Speech call. Order:
#   1) Request body
#   2) config.yaml defaults.audio (single source of truth, TAURI_SPEC §7)
#   3) Hardcoded fallback (legacy Phase 1 default)
def _resolve_speech_audio_setting(cfg: dict) -> dict:
    default = cfg.get("audio") if isinstance(cfg.get("audio"), dict) else {}
    if not default:
        default = {"sample_rate": 32000, "bitrate": 128000, "format": "mp3", "channel": 1}
    return {
        "sample_rate": int(default.get("sample_rate", 32000)),
        "bitrate": int(default.get("bitrate", 128000)),
        "format": str(default.get("format", "mp3")),
        "channel": int(default.get("channel", 1)),
    }


def _save_audio_hex(hex_str: str, audio_setting: dict, filename: str = "", session_id: str = "") -> str:
    """Decode a hex-encoded audio payload and save it.

    Output path is relative to the session's workspace root (coding
    workspace if attached, else app workspace) so the frontend can
    fetch it back via ``/api/files/raw?session_id=...&path=...``.

    Returns the relative path string.
    """
    import re
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", (filename or "").strip()).strip("-")
    if safe and "." in safe:
        stem = safe.rsplit(".", 1)[0]
    elif safe:
        stem = safe
    else:
        stem = f"tts_{int(asyncio.get_event_loop().time())}"
    ext = audio_setting.get("format", "mp3")
    out_dir = _media_output_dir(session_id, "tts")
    out_path = out_dir / f"{stem}.{ext}"
    if out_path.exists():
        counter = 2
        while (out_dir / f"{stem}_{counter}.{ext}").exists():
            counter += 1
        out_path = out_dir / f"{stem}_{counter}.{ext}"
    out_path.write_bytes(bytes.fromhex(hex_str))
    # Relative path is to the root the caller will use to fetch it back
    # (the app workspace by default; a coding workspace when attached).
    return str(out_path.relative_to(out_dir.parent.parent)).replace("\\", "/")


@app.post("/api/minimax/speech/synthesize")
async def speech_synthesize(req: SpeechSynthesizeRequest, session_id: str = ""):
    """Single-shot T2A via /v1/t2a_v2. Saves audio to the session's
    ``tts/`` folder (coding workspace if attached, else app workspace)."""
    try:
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]
        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        cfg = _load_config_dict()
        # Prefer the explicit request body; fall back to the shared
        # "defaults.audio" block (TAURI_SPEC §7).
        if req.audio_setting is not None:
            audio_setting = {
                "sample_rate": req.audio_setting.sample_rate,
                "bitrate": req.audio_setting.bitrate,
                "format": req.audio_setting.format,
                "channel": 1,
            }
        else:
            audio_setting = _resolve_speech_audio_setting(cfg)

        voice_modify = None
        if any([req.voice_modify_pitch, req.voice_modify_intensity,
                req.voice_modify_timbre, req.voice_modify_sound_effects]):
            voice_modify = {
                "pitch": req.voice_modify_pitch,
                "intensity": req.voice_modify_intensity,
                "timbre": req.voice_modify_timbre,
            }
            if req.voice_modify_sound_effects:
                voice_modify["sound_effects"] = req.voice_modify_sound_effects

        client = MiniMaxSyncClient(api_key, api_base)
        try:
            success, result = client.speech_synthesize_v2(
                text=req.text,
                model=req.model,
                voice_id=req.voice_id,
                speed=req.speed,
                vol=req.vol,
                pitch=req.pitch,
                emotion=req.emotion,
                audio_setting=audio_setting,
                voice_modify=voice_modify,
                language_boost=req.language_boost,
                output_format="hex",
            )
        finally:
            client.close()

        if not success:
            _raise_speech_http_error(result, "T2A failed")

        data = (result.get("data") or {})
        hex_audio = data.get("audio") or ""
        if not hex_audio:
            raise HTTPException(status_code=502, detail="T2A response missing audio data")
        rel_path = _save_audio_hex(hex_audio, audio_setting, req.filename, session_id=session_id)
        return {
            "success": True,
            "file_path": rel_path,
            "filename": Path(rel_path).name,
            "extra_info": result.get("extra_info") or {},
            "trace_id": result.get("trace_id", ""),
            "model": req.model,
            "voice_id": req.voice_id,
            "audio_setting": audio_setting,
        }
    except HTTPException:
        raise
    except Exception as e:
        _logger.exception("T2A synthesize failed")
        raise HTTPException(status_code=500, detail=str(e))


def _raise_speech_http_error(result: dict, default_msg: str):
    """Map MiniMax status_code → HTTP status, matching the music endpoints."""
    sc = result.get("status_code") if isinstance(result, dict) else None
    err = (result.get("error") or default_msg) if isinstance(result, dict) else str(result)
    if sc in (2013, 1004, 2049, 1043):
        raise HTTPException(status_code=400, detail=err)
    if sc == 1008:
        raise HTTPException(status_code=402, detail=err)
    if sc == 1002:
        raise HTTPException(status_code=429, detail=err)
    if sc == 1042:
        raise HTTPException(status_code=422, detail=err)
    if sc == 2038:
        raise HTTPException(status_code=403, detail=err)
    if sc == 1026:
        raise HTTPException(status_code=422, detail=err)
    raise HTTPException(status_code=502, detail=err)


@app.post("/api/minimax/speech/synthesize-async")
async def speech_synthesize_async_create(req: SpeechAsyncCreateRequest):
    """Kick off a long-text async T2A task. Poll the query endpoint
    to know when it's done (file_id is returned on success)."""
    try:
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]
        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        cfg = _load_config_dict()
        if req.audio_setting is not None:
            audio_setting = {
                "sample_rate": req.audio_setting.sample_rate,
                "bitrate": req.audio_setting.bitrate,
                "format": req.audio_setting.format,
                "channel": 1,
            }
        else:
            audio_setting = _resolve_speech_audio_setting(cfg)

        voice_modify = None
        if any([req.voice_modify_pitch, req.voice_modify_intensity,
                req.voice_modify_timbre, req.voice_modify_sound_effects]):
            voice_modify = {
                "pitch": req.voice_modify_pitch,
                "intensity": req.voice_modify_intensity,
                "timbre": req.voice_modify_timbre,
            }
            if req.voice_modify_sound_effects:
                voice_modify["sound_effects"] = req.voice_modify_sound_effects

        client = MiniMaxSyncClient(api_key, api_base)
        try:
            success, result = client.speech_synthesize_async_create(
                text=req.text,
                model=req.model,
                voice_id=req.voice_id,
                speed=req.speed,
                vol=req.vol,
                pitch=req.pitch,
                audio_setting=audio_setting,
                voice_modify=voice_modify,
                language_boost=req.language_boost,
            )
        finally:
            client.close()

        if not success:
            _raise_speech_http_error(result, "Async T2A failed")
        return {
            "success": True,
            "task_id": result.get("task_id", ""),
            "file_id": result.get("file_id"),
            "usage_characters": result.get("usage_characters"),
            "task_token": result.get("task_token", ""),
            "trace_id": result.get("trace_id", ""),
        }
    except HTTPException:
        raise
    except Exception as e:
        _logger.exception("Async T2A create failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/minimax/speech/synthesize-async/{task_id}")
async def speech_synthesize_async_query(task_id: int):
    """Poll an async T2A task. Returns status (processing|success|failed|expired)
    and file_id when complete."""
    try:
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]
        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")
        client = MiniMaxSyncClient(api_key, api_base)
        try:
            success, result = client.speech_synthesize_async_query(task_id)
        finally:
            client.close()
        if not success:
            _raise_speech_http_error(result, "Async T2A query failed")
        return {
            "success": True,
            "task_id": result.get("task_id"),
            "status": (result.get("status") or "").lower(),
            "file_id": result.get("file_id"),
        }
    except HTTPException:
        raise
    except Exception as e:
        _logger.exception("Async T2A query failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/minimax/speech/voices")
async def speech_voices(voice_type: str = "all"):
    """List available voices (system + cloned + generated)."""
    try:
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]
        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")
        client = MiniMaxSyncClient(api_key, api_base)
        try:
            success, result = client.speech_voices_list(voice_type)
        finally:
            client.close()
        if not success:
            _raise_speech_http_error(result, "List voices failed")
        return {
            "success": True,
            "system_voice": result.get("system_voice", []),
            "voice_cloning": result.get("voice_cloning", []),
            "voice_generation": result.get("voice_generation", []),
        }
    except HTTPException:
        raise
    except Exception as e:
        _logger.exception("List voices failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/minimax/speech/clone/upload")
async def speech_clone_upload(file: UploadFile = File(...)):
    """Upload a voice-clone sample (10s-5min, mp3/m4a/wav, ≤20MB).
    Returns a ``file_id`` consumed by /api/minimax/speech/clone."""
    try:
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]
        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        # Save to a temp path so the multipart upload helper can stream it.
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename or "").suffix) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        try:
            client = MiniMaxSyncClient(api_key, api_base)
            try:
                success, result = client.speech_file_upload(tmp_path, purpose="voice_clone")
            finally:
                client.close()
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

        if not success:
            _raise_speech_http_error(result, "Sample upload failed")

        file_obj = result.get("file") or {}
        return {
            "success": True,
            "file_id": file_obj.get("file_id"),
            "bytes": file_obj.get("bytes"),
            "filename": file_obj.get("filename", file.filename),
        }
    except HTTPException:
        raise
    except Exception as e:
        _logger.exception("Voice clone upload failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/minimax/speech/clone")
async def speech_clone(req: SpeechVoiceCloneRequest):
    """Register a cloned voice. Returns ``demo_audio`` URL when ``text`` is set."""
    try:
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]
        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        # Voice ID validation (8-256 chars, starts with letter, no trailing -/_).
        v = (req.voice_id or "").strip()
        if not (8 <= len(v) <= 256):
            raise HTTPException(status_code=400, detail="voice_id must be 8–256 characters.")
        if not v[0].isalpha():
            raise HTTPException(status_code=400, detail="voice_id must start with a letter.")
        if not all(c.isalnum() or c in "-_" for c in v):
            raise HTTPException(status_code=400, detail="voice_id may only contain letters, digits, '-' and '_'.")
        if v.endswith("-") or v.endswith("_"):
            raise HTTPException(status_code=400, detail="voice_id must not end with '-' or '_'.")

        clone_prompt = None
        if req.clone_prompt_file_id and req.clone_prompt_text:
            clone_prompt = {
                "prompt_audio": req.clone_prompt_file_id,
                "prompt_text": req.clone_prompt_text,
            }

        client = MiniMaxSyncClient(api_key, api_base)
        try:
            success, result = client.speech_voice_clone(
                file_id=req.file_id,
                voice_id=v,
                clone_prompt=clone_prompt,
                text=req.text,
                model=req.model,
                language_boost=req.language_boost,
                need_noise_reduction=req.need_noise_reduction,
                need_volume_normalization=req.need_volume_normalization,
                text_validation=req.text_validation,
                accuracy=req.accuracy,
            )
        finally:
            client.close()

        if not success:
            _raise_speech_http_error(result, "Voice clone failed")
        return {
            "success": True,
            "demo_audio": result.get("demo_audio", ""),
            "extra_info": result.get("extra_info") or {},
            "trace_id": result.get("trace_id", ""),
        }
    except HTTPException:
        raise
    except Exception as e:
        _logger.exception("Voice clone failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/minimax/speech/design")
async def speech_design(req: SpeechVoiceDesignRequest, session_id: str = ""):
    """Design a custom voice from a text description. Returns ``voice_id`` +
    trial audio saved as hex-decoded mp3."""
    try:
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]
        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        client = MiniMaxSyncClient(api_key, api_base)
        try:
            success, result = client.speech_voice_design(
                prompt=req.prompt,
                preview_text=req.preview_text,
                voice_id=req.voice_id,
            )
        finally:
            client.close()

        if not success:
            _raise_speech_http_error(result, "Voice design failed")

        # Decode trial audio (hex) and save to disk for immediate playback.
        trial = result.get("trial_audio", "")
        trial_path = ""
        if trial:
            cfg = _load_config_dict()
            audio_setting = _resolve_speech_audio_setting(cfg)
            trial_path = _save_audio_hex(trial, audio_setting, f"design_{result.get('voice_id','voice')}", session_id=session_id)
        return {
            "success": True,
            "voice_id": result.get("voice_id", ""),
            "trial_audio_path": trial_path,
            "trace_id": result.get("trace_id", ""),
        }
    except HTTPException:
        raise
    except Exception as e:
        _logger.exception("Voice design failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/minimax/speech/voices/{voice_type}/{voice_id}")
async def speech_voice_delete(voice_type: str, voice_id: str):
    """Delete a cloned or generated voice. System voices are rejected by the API."""
    if voice_type not in ("voice_cloning", "voice_generation"):
        raise HTTPException(
            status_code=400,
            detail="voice_type must be 'voice_cloning' or 'voice_generation' (system voices are not deletable).",
        )
    try:
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]
        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")
        client = MiniMaxSyncClient(api_key, api_base)
        try:
            success, result = client.speech_voice_delete(voice_type, voice_id)
        finally:
            client.close()
        if not success:
            _raise_speech_http_error(result, "Voice delete failed")
        return {
            "success": True,
            "voice_id": result.get("voice_id", voice_id),
            "created_time": result.get("created_time", ""),
        }
    except HTTPException:
        raise
    except Exception as e:
        _logger.exception("Voice delete failed")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Generation defaults (audio_setting shared by Music + Speech)
# TAURI_SPEC.md §7 — read/write the ``defaults.audio`` block in config.yaml.
# ============================================================================

class GenerationDefaultsAudio(BaseModel):
    """Single source of truth for Music + Speech audio output."""
    sample_rate: int = 32000
    bitrate: int = 128000
    format: str = "mp3"  # mp3 | pcm | flac | wav
    channel: int = 1


@app.get("/api/config/defaults/audio")
async def get_generation_defaults_audio():
    cfg = _load_config_dict()
    block = cfg.get("defaults", {}).get("audio") if isinstance(cfg.get("defaults"), dict) else None
    if not isinstance(block, dict):
        return {"sample_rate": 32000, "bitrate": 128000, "format": "mp3", "channel": 1}
    return {
        "sample_rate": int(block.get("sample_rate", 32000)),
        "bitrate": int(block.get("bitrate", 128000)),
        "format": str(block.get("format", "mp3")),
        "channel": int(block.get("channel", 1)),
    }


@app.put("/api/config/defaults/audio")
async def put_generation_defaults_audio(req: GenerationDefaultsAudio):
    """Persist the audio defaults. Validates against the same enums the
    MiniMax API accepts."""
    allowed_formats = {"mp3", "pcm", "flac", "wav"}
    allowed_rates = {8000, 16000, 22050, 24000, 32000, 44100}
    allowed_bitrates = {32000, 64000, 128000, 256000}
    if req.format not in allowed_formats:
        raise HTTPException(
            status_code=400,
            detail=f"format must be one of {sorted(allowed_formats)}.",
        )
    if req.sample_rate not in allowed_rates:
        raise HTTPException(
            status_code=400,
            detail=f"sample_rate must be one of {sorted(allowed_rates)}.",
        )
    if req.bitrate not in allowed_bitrates:
        raise HTTPException(
            status_code=400,
            detail=f"bitrate must be one of {sorted(allowed_bitrates)}.",
        )
    if req.channel not in (1, 2):
        raise HTTPException(status_code=400, detail="channel must be 1 or 2.")
    try:
        cfg = _load_config_dict()
        defaults = cfg.get("defaults") if isinstance(cfg.get("defaults"), dict) else {}
        defaults["audio"] = {
            "sample_rate": req.sample_rate,
            "bitrate": req.bitrate,
            "format": req.format,
            "channel": req.channel,
        }
        cfg["defaults"] = defaults

        import yaml
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            yaml.dump(cfg, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

        global config
        config = cfg
        return {"success": True, "defaults": {"audio": defaults["audio"]}}
    except HTTPException:
        raise
    except Exception as e:
        _logger.exception("Failed to persist audio defaults")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/music")
async def music_generate(req: MusicRequest):
    """Generate music (Phase 1: text-to-music only).

    Body: ``MusicRequest`` — see the Pydantic model for validation.
    Pydantic enforces model / prompt / lyrics / cover-param rules; any
    422 from the framework already maps to a clear client-side error.

    Output: ``output_format="hex"`` so we get the audio bytes directly
    (no 24h-expiring CDN URL). The file is saved to
    ``workspace/music/`` under either the user-provided ``filename`` or
    a timestamp fallback, with the extension taken from
    ``audio_setting.format``.

    Response shape:
        ``{"success": True, "file_path": str, "filename": str,
           "model": str, "include_lyrics": bool, "extra_info": {...},
           "trace_id": str, cost_credits, cost_usd}``
    """
    try:
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]

        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        # Resolve audio_setting: request > config.yaml > hardcoded defaults.
        # The frontend normally sends audio_setting (read from Settings),
        # but we keep a config.yaml fallback so manual curl / scripted
        # callers don't need to.
        cfg = _load_config_dict()
        music_cfg = cfg.get("music") if isinstance(cfg.get("music"), dict) else {}
        audio_cfg = music_cfg.get("audio_setting") if isinstance(music_cfg.get("audio_setting"), dict) else {}

        if req.audio_setting is not None:
            audio_setting = {
                "sample_rate": req.audio_setting.sample_rate,
                "bitrate": req.audio_setting.bitrate,
                "format": req.audio_setting.format,
            }
        else:
            audio_setting = {
                "sample_rate": int(audio_cfg.get("sample_rate", 44100)),
                "bitrate": int(audio_cfg.get("bitrate", 256000)),
                "format": str(audio_cfg.get("format", "mp3")),
            }
        # Defensive validation (in case config.yaml got a stray value).
        if audio_setting["sample_rate"] not in AUDIO_SAMPLE_RATES:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid audio_setting.sample_rate={audio_setting['sample_rate']}. "
                    f"Must be one of {AUDIO_SAMPLE_RATES}."
                ),
            )
        if audio_setting["bitrate"] not in AUDIO_BITRATES:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid audio_setting.bitrate={audio_setting['bitrate']}. "
                    f"Must be one of {AUDIO_BITRATES}."
                ),
            )
        if audio_setting["format"] not in AUDIO_FORMATS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid audio_setting.format={audio_setting['format']}. "
                    f"Must be one of {AUDIO_FORMATS}."
                ),
            )

        # Build the output path. Filename is sanitised; extension is taken
        # from the audio_setting (which the API honours) so the file on
        # disk matches what the API actually returned.
        import re
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", (req.filename or "").strip()).strip("-")
        if safe_name and "." in safe_name:
            stem = safe_name.rsplit(".", 1)[0]
        elif safe_name:
            stem = safe_name
        else:
            stem = f"music_{int(asyncio.get_event_loop().time())}"

        ext = audio_setting["format"]
        music_dir = PROJECT_ROOT / "workspace" / "music"
        music_dir.mkdir(parents=True, exist_ok=True)
        # Avoid clobbering existing files — append a counter on collision.
        output_path = music_dir / f"{stem}.{ext}"
        if output_path.exists():
            counter = 2
            while (music_dir / f"{stem}_{counter}.{ext}").exists():
                counter += 1
            output_path = music_dir / f"{stem}_{counter}.{ext}"

        client = MiniMaxSyncClient(api_key, api_base)
        try:
            success, result = client.music_generate(
                prompt=req.prompt,
                lyrics=req.lyrics,
                model=req.model,
                output_path=str(output_path),
                audio_setting=audio_setting,
                lyrics_optimizer=req.lyrics_optimizer,
                is_instrumental=req.is_instrumental,
                audio_url=req.audio_url,
                audio_base64=req.audio_base64,
                cover_feature_id=req.cover_feature_id,
                output_format="hex",
            )
        finally:
            client.close()

        if not success:
            # The client returns a dict with ``error`` / ``status_code``.
            err_msg = result.get("error", "Music generation failed") if isinstance(result, dict) else str(result)
            # Surface as 400 for validation-style failures, 502 for upstream
            # API errors so the frontend can distinguish "fix your request"
            # from "MiniMax API is having a bad day".
            sc = result.get("status_code") if isinstance(result, dict) else None
            if sc in (2013, 1004, 2049):
                raise HTTPException(status_code=400, detail=err_msg)
            if sc == 1008:
                raise HTTPException(status_code=402, detail=err_msg)
            if sc == 1002:
                raise HTTPException(status_code=429, detail=err_msg)
            if sc == 1026:
                raise HTTPException(status_code=422, detail=err_msg)
            raise HTTPException(status_code=502, detail=err_msg)

        # success → dict with output_path / extra_info / trace_id
        actual_path = result.get("output_path", str(output_path)) if isinstance(result, dict) else result
        extra_info = (result.get("extra_info") or {}) if isinstance(result, dict) else {}
        trace_id = (result.get("trace_id") or "") if isinstance(result, dict) else ""

        rel_path = str(Path(actual_path).relative_to(PROJECT_ROOT)).replace("\\", "/")
        cost = calculate_music_cost(include_lyrics=bool(req.lyrics.strip()))
        return {
            "success": True,
            "file_path": rel_path,
            "filename": Path(actual_path).name,
            "model": req.model,
            "include_lyrics": bool(req.lyrics.strip()),
            "audio_setting": audio_setting,
            "extra_info": extra_info,
            "trace_id": trace_id,
            **cost,
        }
    except HTTPException:
        raise
    except Exception as e:
        _logger.exception("Music generation failed")
        raise HTTPException(status_code=500, detail=str(e))


class MusicConfigUpdate(BaseModel):
    """Update the ``music`` section of config.yaml.

    Phase 1 only persists ``audio_setting``; cover-related fields will
    be added in Phase 2. We keep the Pydantic model focused to avoid
    storing unknown keys.
    """
    audio_setting: Optional[AudioSetting] = None


@app.put("/api/config/music")
async def update_music_config(req: MusicConfigUpdate):
    """Persist music generation defaults (currently ``audio_setting``).

    The frontend SettingsModal writes here when the user changes the
    Audio tab. The /api/music handler reads from the same key as a
    fallback when the request body omits ``audio_setting``.
    """
    global config
    try:
        cfg = _load_config_dict()
        music_block = cfg.get("music")
        if not isinstance(music_block, dict):
            music_block = {}

        if req.audio_setting is not None:
            music_block["audio_setting"] = {
                "sample_rate": req.audio_setting.sample_rate,
                "bitrate": req.audio_setting.bitrate,
                "format": req.audio_setting.format,
            }

        cfg["music"] = music_block

        import yaml
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            yaml.dump(cfg, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

        config = cfg
        return {"success": True, "music": music_block}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/video")
async def video_generate(req: GenerateRequest):
    """Generate video (async task).

    Settings (all optional, defaults shown):
      - model             MiniMax-Hailuo-2.3 | MiniMax-Hailuo-2.3-Fast
      - duration          6 | 10  (seconds)
      - resolution        768P | 1080P
      - prompt_optimizer  bool  (auto-enhance the prompt before rendering)
      - first_frame_image str   (URL or data URL — for image2video / sef)
      - last_frame_image  str   (URL or data URL — for sef)
      - subject_reference list  (list of URLs/data URLs — for s2v)

    Mode is implicit from which frames are provided:
      - text2video: prompt only
      - image2video: prompt + first_frame_image
      - sef:         prompt + first_frame_image + last_frame_image
      - s2v:         prompt + subject_reference
    """
    try:
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]

        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        video_model = req.settings.get("model", "MiniMax-Hailuo-2.3")
        resolution = req.settings.get("resolution", "768P")
        duration = int(req.settings.get("duration", 6) or 6)
        prompt_optimizer = bool(req.settings.get("prompt_optimizer", False))
        first_frame_image = req.settings.get("first_frame_image", "") or ""
        last_frame_image = req.settings.get("last_frame_image", "") or ""
        subject_reference = req.settings.get("subject_reference")  # list | None

        client = MiniMaxSyncClient(api_key, api_base)
        success, task_id = client.video_generate(
            prompt=req.prompt,
            model=video_model,
            duration=duration,
            resolution=resolution,
            prompt_optimizer=prompt_optimizer,
            first_frame_image=first_frame_image,
            last_frame_image=last_frame_image,
            subject_reference=subject_reference,
        )
        client.close()

        if success:
            cost = calculate_video_cost(video_model, resolution, duration)
            return {
                "success": True,
                "task_id": task_id,
                "model": video_model,
                "resolution": resolution,
                "duration": duration,
                **cost,
            }
        else:
            return {"success": False, "error": task_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/video/{task_id}")
async def video_status(task_id: str):
    """Check video generation status.

    Returns the raw `/v1/query/video_generation` response, which includes
    `status` (Processing | Success | Failed) and `file_id` when done.
    """
    try:
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]

        client = MiniMaxSyncClient(api_key, api_base)
        success, result = client.video_query(task_id)
        client.close()

        return {"success": success, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/video/download")
async def video_download(req: dict):
    """Download a generated video by file_id into workspace/.

    Request body: { "file_id": str, "output_path"?: str }

    Returns: { success, path, error? }
    """
    try:
        file_id = req.get("file_id")
        if not file_id:
            raise HTTPException(status_code=400, detail="file_id is required")

        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]

        # Default to workspace/video_<ts>.mp4 so each download is unique
        default_path = f"workspace/video_{int(time.time())}.mp4"
        output_path = req.get("output_path") or default_path

        # Make sure it's inside PROJECT_ROOT
        target = PROJECT_ROOT / output_path
        if not str(target).startswith(str(PROJECT_ROOT)):
            raise HTTPException(status_code=403, detail="output_path outside project root")

        client = MiniMaxSyncClient(api_key, api_base)
        success, result = client.video_download(file_id, str(target))
        client.close()

        if success:
            return {"success": True, "path": output_path}
        else:
            return {"success": False, "error": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Files / Shell / Git endpoints (v0.5 workspace redesign) ---
#
# These endpoints all take an optional ``session_id`` query param. When
# present and it identifies a coding session, paths resolve against the
# coding workspace the user picked in the CodingPanel header. When
# absent (or for non-coding sessions), paths resolve against the fixed
# app workspace — which is also where media outputs / uploads live, so
# the legacy callers (image preview, file attach, etc.) keep working
# without changes.
#
# All path-traversal protection is unchanged: we still verify the
# resolved target lives inside the chosen workspace root before
# reading/writing/executing.

def _resolve_session_root(session_id: str | None) -> Path:
    """Return the absolute root the file endpoints should resolve paths
    against. ``session_id`` is optional — empty string means "use the
    app workspace" (legacy behavior)."""
    if session_id:
        return get_session_workspace_dir(session_id)
    return get_app_workspace_dir()


def _safe_join(root: Path, rel_path: str) -> Path:
    """Join ``rel_path`` under ``root`` and reject anything that
    escapes via ``..`` / absolute paths. Returns the resolved target."""
    if not isinstance(rel_path, str) or not rel_path:
        rel_path = ""
    # Treat the literal string "." / "" / root's own basename as
    # "root itself" so the frontend's default `path=workspace` (and
    # equivalent) resolve to root instead of ``root/workspace`` — which
    # would 404. The basename match is scoped to the resolved root, so
    # a coding-session subfolder named the same as its own root is also
    # covered; users can't accidentally escape because the resulting
    # rel_path is empty and resolves to root exactly.
    if rel_path == "." or rel_path == root.name:
        rel_path = ""
    target = (root / rel_path).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied (path escapes workspace root)")
    return target


@app.get("/api/files")
async def list_files(path: str = "workspace", session_id: str = ""):
    """List files in a directory.

    Without ``session_id`` (or for non-coding sessions) lists the app
    workspace. With a coding ``session_id`` lists that session's
    coding workspace. The returned ``path`` is relative to that root
    so the frontend can echo it back in subsequent calls.
    """
    try:
        root = _resolve_session_root(session_id)
        target = _safe_join(root, path)
        if not target.exists() or not target.is_dir():
            raise HTTPException(status_code=404, detail=f"Directory not found: {path}")

        entries = []
        for entry in sorted(target.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
            if entry.name.startswith("."):
                continue
            entries.append({
                "name": entry.name,
                "path": str(entry.relative_to(root)).replace("\\", "/"),
                "is_dir": entry.is_dir(),
            })
        return {
            "entries": entries,
            "root": str(root),
            "workspace_dir": str(root),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/files/content")
async def get_file_content(path: str, session_id: str = ""):
    """Read a UTF-8 text file. Resolves against the session workspace
    when ``session_id`` is provided, otherwise the app workspace."""
    try:
        root = _resolve_session_root(session_id)
        target = _safe_join(root, path)
        if not target.is_file():
            raise HTTPException(status_code=404, detail="File not found")
        with open(target, 'r', encoding='utf-8') as f:
            content = f.read()
        return {"content": content, "path": path}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/files/download")
async def download_file(path: str, session_id: str = ""):
    """Serve a file as an attachment (download)."""
    try:
        root = _resolve_session_root(session_id)
        target = _safe_join(root, path)
        if not target.is_file():
            raise HTTPException(status_code=404, detail="File not found")
        import mimetypes
        media_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        return FileResponse(str(target), media_type=media_type, filename=target.name)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/files/raw")
async def get_file_raw(path: str, session_id: str = ""):
    """Serve a file inline (image/audio/video previews)."""
    try:
        root = _resolve_session_root(session_id)
        target = _safe_join(root, path)
        if not target.is_file():
            raise HTTPException(status_code=404, detail="File not found")
        import mimetypes
        media_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        return FileResponse(str(target), media_type=media_type)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/generations")
async def list_generations():
    """List all generated media files grouped by type."""
    from datetime import datetime
    generations_dir = PROJECT_ROOT / "workspace" / "generations"
    result = {"images": [], "videos": [], "music": [], "tts": []}

    for subdir in ("images", "videos", "music", "tts"):
        folder = generations_dir / subdir
        if not folder.exists():
            continue
        for f in folder.iterdir():
            if not f.is_file():
                continue
            stat = f.stat()
            result[subdir].append({
                "name": f.name,
                "path": str(f.relative_to(PROJECT_ROOT)).replace("\\", "/"),
                "type": subdir,
                "size": stat.st_size,
                "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "extension": f.suffix.lower(),
            })
        result[subdir].sort(key=lambda x: x["modified_at"], reverse=True)

    return {"success": True, "data": result}


@app.post("/api/files/save")
async def save_file(data: dict):
    """Save file content into the workspace that owns this session."""
    try:
        path = data.get("path", "")
        content = data.get("content", "")
        session_id = data.get("session_id", "") or ""
        root = _resolve_session_root(session_id)
        target = _safe_join(root, path)
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, 'w', encoding='utf-8') as f:
            f.write(content)
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/shell")
async def shell_command(data: dict):
    """Execute a shell command in the session's workspace (cwd)."""
    import subprocess
    try:
        cmd = data.get("command", "")
        if not cmd:
            return {"output": "", "error": "No command provided"}
        session_id = data.get("session_id", "") or ""
        cwd = str(_resolve_session_root(session_id))
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            cwd=cwd,
            timeout=30,
        )
        return {
            "output": result.stdout,
            "error": result.stderr if result.returncode != 0 else None,
            "returncode": result.returncode,
            "cwd": cwd,
        }
    except subprocess.TimeoutExpired:
        return {"output": "", "error": "Command timed out"}
    except Exception as e:
        return {"output": "", "error": str(e)}


@app.get("/api/git/status")
async def git_status(session_id: str = ""):
    """Git status of the session's workspace (defaults to app workspace)."""
    import subprocess
    try:
        cwd = str(_resolve_session_root(session_id))
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, cwd=cwd,
        )
        status = subprocess.run(
            ["git", "status", "--short"],
            capture_output=True, text=True, cwd=cwd,
        )
        log = subprocess.run(
            ["git", "log", "--oneline", "-10"],
            capture_output=True, text=True, cwd=cwd,
        )
        return {
            "branch": branch.stdout.strip() if branch.returncode == 0 else None,
            "status": status.stdout.strip() if status.returncode == 0 else None,
            "log": log.stdout.strip().split("\n") if log.returncode == 0 else [],
            "cwd": cwd,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/git/branches")
async def git_branches(session_id: str = ""):
    """List git branches in the session's workspace."""
    import subprocess
    try:
        cwd = str(_resolve_session_root(session_id))
        result = subprocess.run(
            ["git", "branch", "-a"],
            capture_output=True, text=True, cwd=cwd,
        )
        branches = []
        if result.returncode == 0:
            for line in result.stdout.strip().split("\n"):
                line = line.strip()
                if line.startswith("* "):
                    branches.append(line[2:])
                elif line.startswith("remotes/"):
                    branches.append(line)
                else:
                    branches.append(line)
        return {"branches": branches, "cwd": cwd}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Shell WebSocket for persistent terminal
import threading
import subprocess
import platform

shell_sessions = {}


def get_shell_command():
    """Get the appropriate shell command for the current OS."""
    if platform.system() == "Windows":
        return ["cmd.exe", "/Q"]
    return ["/bin/bash", "-l"]


def read_stream(proc, stream, session_id, websocket):
    """Read from a stream and send to websocket."""
    try:
        while True:
            line = stream.read(1)
            if not line:
                break
            if session_id in shell_sessions and shell_sessions[session_id].get("active"):
                try:
                    asyncio.run_coroutine_threadsafe(
                        websocket.send_json({"type": "output", "data": line}),
                        shell_sessions[session_id]["loop"]
                    )
                except Exception:
                    pass
    except Exception:
        pass


@app.websocket("/ws/shell")
async def shell_websocket(websocket: WebSocket):
    """WebSocket endpoint for persistent shell."""
    await websocket.accept()
    session_id = id(websocket)
    
    try:
        # Spawn shell process
        cmd = get_shell_command()
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=str(PROJECT_ROOT),
            text=False,
            bufsize=0,
        )
        
        loop = asyncio.get_event_loop()
        shell_sessions[session_id] = {
            "proc": proc,
            "websocket": websocket,
            "active": True,
            "loop": loop,
        }
        
        # Start reader thread
        reader_thread = threading.Thread(
            target=read_stream,
            args=(proc, proc.stdout, session_id, websocket),
            daemon=True,
        )
        reader_thread.start()
        
        _logger.info(f"Shell session started: {session_id}")
        
        # Send initial prompt
        await websocket.send_json({"type": "connected", "shell": cmd[0]})
        
        # Handle input
        while True:
            msg = await websocket.receive_json()
            msg_type = msg.get("type", "")
            data = msg.get("data", "")
            
            if msg_type == "input" and proc.stdin:
                proc.stdin.write(data.encode())
                proc.stdin.flush()
            elif msg_type == "resize":
                # Terminal resize - not supported in basic subprocess
                pass
            
    except WebSocketDisconnect:
        _logger.info(f"Shell disconnected: {session_id}")
    except Exception as e:
        _logger.error(f"Shell error: {e}")
    finally:
        if session_id in shell_sessions:
            shell_sessions[session_id]["active"] = False
            proc = shell_sessions[session_id].get("proc")
            if proc:
                try:
                    proc.terminate()
                    proc.wait(timeout=2)
                except Exception:
                    proc.kill()
            del shell_sessions[session_id]


# ============ MiniMax Token Plan (quota + plan tier detection) ============

# Canonical plan identifiers for the current MiniMax Token Plan.
# There is no "starter" tier — Token Plan starts at Plus. All three paid
# tiers (Plus/Max/Ultra) include chat + image + speech + music; only
# video generation is tier-gated.
# Order matters: longest alias first so ``plus-hs`` wins over ``plus``.
_PLAN_ALIASES: list = [
    ("plus-hs", "plus-hs"),
    ("plus_hs", "plus-hs"),
    ("plushs", "plus-hs"),
    ("plus hs", "plus-hs"),
    ("ultra", "ultra"),
    ("plus", "plus"),
    ("max", "max"),
]
_PLAN_LOOKUP: dict = {alias: canonical for alias, canonical in _PLAN_ALIASES}


def _normalise_plan(raw: object) -> str:
    """Map a free-form plan name to a canonical identifier.

    Accepts strings coming from config.yaml (``minimax.plan``) or older
    API responses. Returns ``"unknown"`` for empty / unrecognised values
    so the frontend can always render a stable enum-like value.
    """
    if not raw:
        return "unknown"
    key = str(raw).strip().lower().replace(" ", "-")
    # 1) Exact match.
    if key in _PLAN_LOOKUP:
        return _PLAN_LOOKUP[key]
    # 2) Prefix match: alias is the start of the key, the next char is
    #    non-alphanumeric (or end of string). This handles "max-plan" and
    #    "ultra_v2" but rejects "max-hs" (no canonical for that).
    for alias, canonical in _PLAN_ALIASES:
        if key.startswith(alias):
            tail = key[len(alias):]
            if tail == "" or not tail[0].isalnum():
                return canonical
    return "unknown"


def _get_user_configured_plan() -> str:
    """Fallback plan source: read ``minimax.plan`` from config.yaml.

    This is a **fallback** — the primary plan source is auto-detection
    from the Token Plan API ``model_remains[]`` access flags (see
    ``_detect_plan_from_api``). We keep this for two reasons:
      1) Users whose API response is empty (fresh key, transient network
         blip) still see the right tier in the UI.
      2) Future API versions might add Ultra-specific signals that we
         can't auto-detect yet — config.yaml gives the user a manual
         override.
    The cost of a wrong value is bounded — a user lying about their tier
    only unlocks UI affordances; actual API calls still fail with
    401/403/429 if the plan doesn't match.
    """
    try:
        cfg = get_minimax_config()
        plan_raw = cfg.get("plan") if isinstance(cfg, dict) else None
        if plan_raw:
            return _normalise_plan(plan_raw)
    except Exception:
        pass
    return "unknown"


def _detect_plan_from_api(model_remains: list) -> str:
    """Auto-detect the user's plan from the Token Plan API ``model_remains[]``
    access flags.

    The Token Plan API returns each model entry with a
    ``current_interval_status`` field (1 = active for this plan, 3 =
    inactive). The set of models the user has access to uniquely
    identifies the plan:

        + video gen active          → max (or ultra; ultra is a superset)
        + image/speech/music active  → plus
        + only text (general) active → plus (lowest paid tier; no
                                         "starter" tier in current
                                         Token Plan)
        + nothing                   → unknown (API error / fresh key)

    This is the **primary** plan source — every user with a working
    Token Plan API endpoint gets the right tier automatically, with no
    need to hand-edit ``config.yaml``. Config.yaml is only consulted as
    a fallback when the API returns nothing usable.
    """
    if not model_remains:
        return "unknown"
    by_name = {(m.get("model_name") or "").lower(): m for m in model_remains}

    def active(name: str) -> bool:
        m = by_name.get(name)
        if not m:
            return False
        # 1 = active, 3 = inactive. Some API versions report 0 for
        # "no access for this plan" — treat anything other than 1 as
        # inactive. Prefer the 5h interval status, fall back to weekly.
        status = _coerce_number(m.get("current_interval_status"))
        if status is None:
            status = _coerce_number(m.get("current_weekly_status"))
        return status == 1

    # Video gen is the only capability that distinguishes Max+ from Plus.
    if active("video"):
        return "max"  # covers Max and Ultra (Ultra is a strict superset of Max)
    # Media gen: image/speech/music — Plus+ only. (All paid tiers have
    # these; there's no "starter" tier anymore.)
    if active("image") or active("speech") or active("music"):
        return "plus"
    # Text-only (general) access is unusual on the current Token Plan —
    # treat as Plus (the lowest paid tier) rather than inventing a
    # legacy "starter" value the UI no longer recognises.
    if active("general"):
        return "plus"
    return "unknown"


def _coerce_number(value: object) -> Optional[float]:
    """Coerce a numeric-looking value into ``float`` (or ``None``).

    Used to read fields that the API may return as strings or numbers
    depending on the version (credit balances, percentages, etc.).
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def _enrich_quota(data: object) -> dict:
    """Build the enriched quota payload from the raw Token Plan API response.

    The API returns the plan and credit fields under a few different keys
    depending on the version; we probe them all and fall back to safe
    defaults so the frontend always receives a stable shape.
    """
    payload: dict = data if isinstance(data, dict) else {}
    # `data` may itself be wrapped — the Token Plan API often returns
    # {"data": {...}}.
    inner = payload.get("data") if isinstance(payload.get("data"), dict) else payload

    # Plan resolution order:
    #   1) Auto-detect from API model_remains[] access flags (works for
    #      any user, no config required)
    #   2) Explicit plan field in the API response (older versions)
    #   3) User-declared ``minimax.plan`` in config.yaml (manual override)
    #   4) Default to ``plus`` (lowest paid tier) as a safe last resort
    model_remains = inner.get("model_remains") if isinstance(inner.get("model_remains"), list) else []
    plan = _detect_plan_from_api(model_remains)
    if plan == "unknown":
        plan_raw = (
            inner.get("plan")
            or inner.get("tier")
            or inner.get("package")
            or inner.get("plan_name")
            or payload.get("plan")
            or payload.get("tier")
        )
        plan = _normalise_plan(plan_raw)
    if plan == "unknown":
        plan = _get_user_configured_plan()
    if plan == "unknown":
        # No starter tier in the current Token Plan — default to Plus
        # (the lowest paid tier) so the UI doesn't accidentally show
        # the user as a legacy free user.
        plan = "plus"

    # The Token Plan API returns remaining *percentages* per model via
    # ``model_remains[]``. We surface the chat ("general") quota as
    # credit_balance so the existing CreditBalanceWidget has something
    # numeric to render. credit_total is fixed at 100 since the format
    # is percentage-based.
    # ``model_remains`` was already loaded above for plan auto-detection.
    general_model = next(
        (m for m in model_remains if (m.get("model_name") or "").lower() == "general"),
        None,
    )
    video_model = next(
        (m for m in model_remains if (m.get("model_name") or "").lower() == "video"),
        None,
    )

    if general_model is not None:
        # Use the 5h rolling quota as the "balance" — it matches the
        # "credits remaining" semantic that CreditBalanceWidget already
        # displays, even though the unit is now a percentage (0-100).
        credit_balance = _coerce_number(general_model.get("current_interval_remaining_percent"))
    else:
        credit_balance = _coerce_number(
            inner.get("credit_balance")
            or inner.get("balance")
            or inner.get("remaining_credits")
            or inner.get("credits_remaining")
        )
    credit_total: Optional[float] = 100.0 if general_model is not None else _coerce_number(
        inner.get("credit_total")
        or inner.get("total_credits")
        or inner.get("credits_total")
        or inner.get("plan_credits")
    )

    # window_reset_at: prefer explicit fields, fall back to end_time of
    # the "general" model's current interval (Unix ms → ISO 8601 UTC).
    window_reset_at = (
        inner.get("window_reset_at")
        or inner.get("reset_at")
        or inner.get("next_reset")
        or inner.get("next_reset_at")
    )
    if window_reset_at is None and general_model is not None:
        end_ms = _coerce_number(general_model.get("end_time"))
        if end_ms:
            try:
                from datetime import datetime, timezone
                window_reset_at = datetime.fromtimestamp(end_ms / 1000, tz=timezone.utc).isoformat()
            except Exception:
                window_reset_at = None

    # video_daily_limit: explicit field > plan-based default.
    # Max users get 3 generations/day, Ultra users get 5. Auto-detection
    # only returns "max" (it can't tell Max from Ultra — they have the
    # same model access). Ultra users should set ``minimax.plan: ultra``
    # in config.yaml to get the correct 5/day cap; otherwise they see
    # the safer 3/day default.
    video_daily_limit_raw = (
        inner.get("video_daily_limit")
        or inner.get("daily_video_limit")
        or payload.get("video_daily_limit")
    )
    video_daily_limit: Optional[int] = None
    if video_daily_limit_raw is not None:
        try:
            video_daily_limit = int(video_daily_limit_raw)
        except (TypeError, ValueError):
            video_daily_limit = None
    elif plan == "ultra":
        video_daily_limit = 5
    elif plan == "max" or (
        video_model is not None
        and _coerce_number(video_model.get("current_interval_status")) == 1
    ):
        # Auto-detected "max" or any user with active video access
        # defaults to the Max tier cap (3/day).
        video_daily_limit = 3

    video_daily_used = _coerce_number(
        inner.get("video_daily_used")
        or inner.get("daily_video_used")
        or payload.get("video_daily_used")
    )
    if video_daily_used is None and video_model is not None:
        # Derive used from remaining percentage when the cap is known.
        if video_daily_limit:
            remaining_pct = _coerce_number(video_model.get("current_interval_remaining_percent")) or 0
            video_daily_used = int(round(video_daily_limit * (100 - remaining_pct) / 100))
        else:
            video_daily_used = 0
    elif video_daily_used is None:
        video_daily_used = 0
    else:
        video_daily_used = int(video_daily_used)

    return {
        "plan": plan,
        "credit_balance": credit_balance,
        "credit_total": credit_total,
        "window_reset_at": window_reset_at,
        "video_daily_limit": video_daily_limit,
        "video_daily_used": video_daily_used,
    }


@app.get("/api/minimax/quota")
async def get_quota():
    """Get Token Plan quota and auto-detect the user's plan tier.

    Direct HTTP call to the Token Plan ``remains`` endpoint — no
    external CLI dependency.

    The response is enriched at the root level with canonical fields
    (plan, credit_balance, credit_total, window_reset_at, video_daily_*)
    while preserving the raw ``data`` payload for backwards compatibility.
    """
    try:
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        region = minimax_config["region"]

        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        data = await _fetch_quota_via_api(api_key, region)

        if data is None:
            return {
                "success": False,
                "error": (
                    "Could not fetch quota from the Token Plan API. "
                    "Verify network connectivity and API key, or set "
                    "minimax.plan: plus|max|ultra in config/config.yaml "
                    "as a fallback."
                ),
            }

        enriched = _enrich_quota(data)
        return {"success": True, "data": data, **enriched}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def _fetch_quota_via_api(api_key: str, region: str) -> Optional[dict]:
    """Direct HTTP call to the Token Plan ``remains`` endpoint.

    Returns the parsed JSON payload, or ``None`` on any failure
    (network error, non-2xx response, malformed JSON, API-level error).

    Endpoint:
        GET https://api.minimax.io/v1/api/openplatform/coding_plan/remains
        GET https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains  (CN)
        Authorization: Bearer <api_key>
    """
    host = "https://api.minimaxi.com" if region == "cn" else "https://api.minimax.io"
    url = f"{host}/v1/api/openplatform/coding_plan/remains"
    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, headers=headers)
            if r.status_code != 200:
                _logger.debug(
                    "Direct quota fetch returned %s: %s",
                    r.status_code,
                    r.text[:200],
                )
                return None
            data = r.json()
            # The Token Plan API returns HTTP 200 even for credential
            # errors; the real status lives in `base_resp.status_code`
            # (0 = success, anything else = API-level error). Treat
            # non-zero as failure.
            base_resp = data.get("base_resp") or {}
            if base_resp.get("status_code", 0) != 0:
                _logger.debug(
                    "Direct quota fetch API error: %s",
                    base_resp.get("status_msg", "unknown"),
                )
                return None
            return data
    except Exception as e:
        _logger.debug(f"Direct quota fetch failed: {e}")
        return None


@app.post("/api/minimax/cli")
async def run_cli_command(req: CLIRequest):
    """Run a MiniMax CLI command securely."""
    try:
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        region = minimax_config["region"]

        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        import subprocess
        # Build command: mmx <command> [args] --api-key <key> --region <region>
        # ``speech`` was removed when we migrated T2A to direct HTTP (the
        # /api/minimax/speech/* endpoints replace it). ``video`` and ``music``
        # are still allowed because their direct-HTTP migrations are pending
        # (covered in the mmx → API migration roadmap).
        allowed_commands = {
            "text", "image", "video", "music",
            "vision", "search", "quota", "config"
        }

        cmd_parts = req.command.strip().split()
        if not cmd_parts or cmd_parts[0] not in allowed_commands:
            raise HTTPException(status_code=400, detail=f"Command '{cmd_parts[0] if cmd_parts else ''}' not allowed")

        import shutil
        mmx_cmd = shutil.which("mmx") or "mmx"
        cmd_list = [f'"{mmx_cmd}"'] + cmd_parts + ["--api-key", api_key, "--region", region, "--output", "json"]
        if req.args:
            cmd_list.extend(req.args)
        cmd_str = " ".join(cmd_list)

        env = os.environ.copy()
        env.update(req.env)

        result = subprocess.run(
            cmd_str,
            capture_output=True,
            text=True,
            cwd=str(PROJECT_ROOT),
            timeout=300,
            env=env,
            shell=True
        )

        return {
            "success": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Command timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# NOTE: ``/api/minimax/voices`` (mmx-based, deleted 2026-06-21) was replaced by
# ``/api/minimax/speech/voices`` (direct HTTP, see speech section above).

# Serve frontend static files (for production)
FRONTEND_BUILD = PROJECT_ROOT / "web" / "frontend" / "dist"
if FRONTEND_BUILD.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_BUILD / "assets")), name="static")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        index_file = FRONTEND_BUILD / "index.html"
        if index_file.exists():
            return FileResponse(str(index_file))
        raise HTTPException(status_code=404)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    # ``reload=True`` requires the Python interpreter on PATH to spawn
    # the reloader child. That is incompatible with a frozen exe in
    # production (and with stripped PATHs in the smoke test). Default
    # to off; dev can opt back in with MINIMAX_RELOAD=1.
    reload = os.environ.get("MINIMAX_RELOAD", "0") == "1"
    if reload:
        # Dev only: hot-reload via StatReload. The "main:app" string
        # form is fine here because dev runs the raw .py from source.
        uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
    else:
        # Production / frozen exe: pass the app object directly so we
        # don't need importlib to find a "main" module (which is
        # renamed/embedded under _internal/ inside a PyInstaller bundle).
        uvicorn.run(app, host="0.0.0.0", port=port)
