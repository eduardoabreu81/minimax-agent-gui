"""MiniMax Agent Web — FastAPI backend."""

import os
import sys
import json
import uuid
import asyncio
import logging
from pathlib import Path
from contextlib import asynccontextmanager

# Add project root to path so we can import mini_agent and mini_max_mcp
PROJECT_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, BackgroundTasks, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from pydantic import BaseModel
from typing import Optional

# Import our existing Python modules
from mini_agent.config import Config as AgentConfig
from mini_agent import Agent, LLMClient
from mini_agent.tools import ReadTool, WriteTool, BashTool
from mini_agent.schema import Message
from mini_agent.tools.skill_loader import SkillLoader

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
    reference_image: str = ""  # For I2I: path or URL


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


def list_conversations() -> list:
    """List all saved conversations, newest first."""
    conversations = []
    for p in CONVERSATIONS_DIR.glob("*.json"):
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            conversations.append({
                "id": data.get("id", p.stem),
                "title": data.get("title", "Untitled"),
                "created_at": data.get("created_at", ""),
                "updated_at": data.get("updated_at", ""),
                "message_count": len(data.get("messages", [])),
            })
        except Exception:
            pass
    conversations.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
    return conversations


def load_conversation(conv_id: str) -> dict:
    """Load a conversation by ID."""
    path = _conv_path(conv_id)
    if not path.exists():
        return {"id": conv_id, "title": "New Chat", "messages": []}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_conversation(conv_id: str, title: str, messages: list):
    """Save a conversation to disk."""
    now = asyncio.get_event_loop().time()
    # Use ISO format string
    from datetime import datetime
    iso_now = datetime.now().isoformat()
    
    path = _conv_path(conv_id)
    data = {"id": conv_id, "title": title, "messages": messages}
    
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                existing = json.load(f)
            data["created_at"] = existing.get("created_at", iso_now)
        except Exception:
            data["created_at"] = iso_now
    else:
        data["created_at"] = iso_now
    
    data["updated_at"] = iso_now
    
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def delete_conversation(conv_id: str) -> bool:
    """Delete a conversation by ID."""
    path = _conv_path(conv_id)
    if path.exists():
        path.unlink()
        return True
    return False


def get_conversation_title(messages: list) -> str:
    """Generate a title from the first user message."""
    for msg in messages:
        if msg.get("type") == "user" or msg.get("is_user"):
            text = msg.get("content", msg.get("text", "")).strip()
            if text:
                return text[:40] + ("..." if len(text) > 40 else "")
    return "New Chat"


def _make_snippet(text: str, query_lower: str, context: int = 60) -> str:
    """Extract a short snippet around the first match of query in text."""
    if not text:
        return ""
    idx = text.lower().find(query_lower)
    if idx == -1:
        return text[:100] + ("..." if len(text) > 100 else "")
    start = max(0, idx - context)
    end = min(len(text), idx + len(query_lower) + context)
    snippet = text[start:end]
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet = snippet + "..."
    return snippet


def search_conversations(query: str, type_filter: str = "") -> list:
    """Search conversations by title, message content, or attachment.

    Returns a list of result dicts ordered by updated_at desc.
    """
    if not query or not query.strip():
        return []

    q = query.strip().lower()
    results = []

    for p in CONVERSATIONS_DIR.glob("*.json"):
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue

        conv_id = data.get("id", p.stem)

        # Type filter
        is_coding = conv_id.startswith("coding-")
        if type_filter == "coding" and not is_coding:
            continue
        if type_filter == "chat" and is_coding:
            continue

        matches = []

        # Search title
        title = data.get("title", "")
        if q in title.lower():
            matches.append({
                "field": "title",
                "snippet": _make_snippet(title, q, 40),
            })

        # Search messages
        messages = data.get("messages", [])
        for i, msg in enumerate(messages):
            content = msg.get("content", msg.get("text", ""))
            if q in content.lower():
                matches.append({
                    "field": "message",
                    "snippet": _make_snippet(content, q, 60),
                    "message_index": i,
                })

            # Search attachment
            attachment = msg.get("attachment", "")
            if attachment and q in attachment.lower():
                matches.append({
                    "field": "attachment",
                    "snippet": _make_snippet(attachment, q, 40),
                    "message_index": i,
                })

        if matches:
            results.append({
                "id": conv_id,
                "title": title or "Untitled",
                "type": "coding" if is_coding else "chat",
                "updated_at": data.get("updated_at", ""),
                "message_count": len(messages),
                "matches": matches,
            })

    results.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
    return results


class SessionManager:
    """Manages agent sessions in memory."""

    def __init__(self):
        self.sessions = {}
        self.config = config

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

        workspace_dir = self.config.get("agent", {}).get("workspace_dir", "./workspace")
        workspace_path = PROJECT_ROOT / workspace_dir
        workspace_path.mkdir(parents=True, exist_ok=True)
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
All relative paths are resolved from this directory.

Always be concise but thorough."""
        else:
            system_prompt = f"""You are a helpful AI assistant powered by {model}.
You help users with daily tasks, questions, brainstorming, writing, analysis, and general problem-solving.
You have access to file system tools, web search, and image understanding.

CRITICAL LANGUAGE RULE: You MUST respond ONLY in the same language the user is using (Portuguese, English, Spanish, etc.). NEVER use Chinese, Japanese, Korean, or any other language not matching the user's message. NEVER mix Chinese characters in your responses.

Be concise, friendly, and helpful."""

        if mcp_tools:
            system_prompt += "\n\n## Custom MCP Tools\nAdditional MCP tools are available from user-configured servers. Use them when relevant. Tool names are prefixed with mcp_{server_id}_."

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
        )
        self.sessions[session_id] = agent
        return agent


session_manager = SessionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _logger.info("MiniMax Agent Web starting up...")
    # Ensure generations directories exist
    for subdir in ("images", "videos", "music", "tts"):
        (PROJECT_ROOT / "workspace" / "generations" / subdir).mkdir(parents=True, exist_ok=True)
    yield
    _logger.info("Shutting down...")


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
        "agent": config.get("agent", {}) if isinstance(config, dict) else {},
        "tts": config.get("tts", {}) if isinstance(config, dict) else {},
        "image": config.get("image", {}) if isinstance(config, dict) else {},
        "music": config.get("music", {}) if isinstance(config, dict) else {},
        "video": config.get("video", {}) if isinstance(config, dict) else {},
        "tools": config.get("tools", {}) if isinstance(config, dict) else {},
        "mcp_servers": mcp_list,
        "region": minimax.get("region", "global") if isinstance(minimax, dict) else "global",
        "api_base": minimax.get("api_base", "https://api.minimax.io") if isinstance(minimax, dict) else "https://api.minimax.io",
        "api_key_configured": bool(minimax.get("api_key", "")) if isinstance(minimax, dict) else False,
    }
    return safe_config


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


@app.get("/api/skills")
async def get_skills():
    """List all available skills."""
    try:
        from mini_agent.tools.skill_loader import SkillLoader
        skills_dir = PROJECT_ROOT / "mini_agent" / "skills"
        loader = SkillLoader(str(skills_dir))
        loader.discover_skills()
        skills = []
        for name, skill in loader.loaded_skills.items():
            skills.append({
                "name": skill.name,
                "description": skill.description,
                "license": skill.license,
            })
        return {"success": True, "skills": skills}
    except Exception as e:
        return {"success": False, "error": str(e)}


class ToolsConfigRequest(BaseModel):
    web_search: bool = True
    understand_image: bool = True

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


@app.websocket("/ws/chat/{session_id}")
async def chat_websocket(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for streaming chat."""
    await websocket.accept()
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

        while True:
            data = await websocket.receive_json()

            # Handle skill activation
            if data.get("type") == "activate_skill":
                skill_name = data.get("skill")
                # Load skill and inject into system prompt
                from mini_agent.tools.skill_loader import SkillLoader
                skills_dir = PROJECT_ROOT / "mini_agent" / "skills"
                loader = SkillLoader(str(skills_dir))
                loader.discover_skills()
                skill = loader.get_skill(skill_name)
                if skill:
                    # Inject skill content into messages as a system context update
                    skill_prompt = skill.to_prompt()
                    agent.messages.append(Message(role="user", content=f"[Skill Activated: {skill_name}]\n\n{skill_prompt}"))
                    await websocket.send_json({"type": "skill_activated", "skill": skill_name})
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

            # Send user message back as confirmation
            display_content = message or "📎 Attachment sent"
            await websocket.send_json({
                "type": "user",
                "content": display_content,
                "attachment": attachment,
            })

            # Add user message to agent
            agent.add_user_message(full_message)

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
                )

                # Resolve which model actually ran (override or default)
                effective_model = model_override or getattr(agent.llm, "model", None)
                full_thinking = "\n\n".join(s for s in accumulated_thinking if s) or None

                await websocket.send_json({
                    "type": "assistant",
                    "content": result,
                    "thinking": full_thinking,
                    "model": effective_model,
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


@app.post("/api/tts")
async def tts_generate(req: GenerateRequest, background_tasks: BackgroundTasks):
    """Generate TTS audio."""
    try:
        from mini_max_mcp.client import tts_sync
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]

        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        output_path = PROJECT_ROOT / "workspace" / f"tts_web_{asyncio.get_event_loop().time()}.mp3"
        output_path.parent.mkdir(exist_ok=True)

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
async def upload_file(file: UploadFile = File(...)):
    """Upload a file to workspace/uploads/."""
    try:
        upload_dir = PROJECT_ROOT / "workspace" / "uploads"
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
        
        relative_path = str(file_path.relative_to(PROJECT_ROOT))
        return {"success": True, "path": relative_path, "filename": file_path.name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/image")
async def image_generate(req: ImageRequest):
    """Generate image."""
    try:
        from mini_max_mcp.client import image_sync
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]

        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        output_path = PROJECT_ROOT / "workspace" / f"image_web_{asyncio.get_event_loop().time()}.png"
        output_path.parent.mkdir(exist_ok=True)

        n = max(int(req.n or 1), 1)

        success, result = image_sync(
            api_key, api_base, req.prompt,
            str(output_path),
            aspect_ratio=req.aspect_ratio,
            width=req.width,
            height=req.height,
            n=n,
            prompt_optimizer=req.prompt_optimizer,
            watermark=req.watermark,
            seed=req.seed
        )

        if success:
            # Return path relative to PROJECT_ROOT for frontend
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


@app.post("/api/image/i2i")
async def image_i2i_generate(req: ImageRequest):
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


@app.post("/api/music")
async def music_generate(req: GenerateRequest):
    """Generate music."""
    try:
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]

        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        client = MiniMaxSyncClient(api_key, api_base)
        output_path = PROJECT_ROOT / "workspace" / f"music_web_{asyncio.get_event_loop().time()}.mp3"
        output_path.parent.mkdir(exist_ok=True)

        lyrics = req.settings.get("lyrics", "") or ""
        music_model = req.settings.get("model", "music-2.6")

        success, result = client.music_generate(
            prompt=req.prompt,
            lyrics=lyrics,
            model=music_model,
            output_path=str(output_path),
            output_format="hex"
        )
        client.close()

        if success:
            cost = calculate_music_cost(include_lyrics=bool(lyrics.strip()))
            return {
                "success": True,
                "file_path": str(result),
                "model": music_model,
                "include_lyrics": bool(lyrics.strip()),
                **cost,
            }
        else:
            return {"success": False, "error": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/video")
async def video_generate(req: GenerateRequest):
    """Generate video (async task)."""
    try:
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        api_base = minimax_config["api_base"]

        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        video_model = req.settings.get("model", "MiniMax-Hailuo-2.3")
        resolution = req.settings.get("resolution", "768P")
        duration = int(req.settings.get("duration", 6) or 6)

        client = MiniMaxSyncClient(api_key, api_base)
        success, task_id = client.video_generate(
            prompt=req.prompt,
            model=video_model,
            duration=duration,
            resolution=resolution,
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
    """Check video generation status."""
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


@app.get("/api/files")
async def list_files(path: str = "workspace"):
    """List files in a directory."""
    try:
        target = PROJECT_ROOT / path
        if not str(target).startswith(str(PROJECT_ROOT)):
            raise HTTPException(status_code=403, detail="Access denied")

        entries = []
        for entry in sorted(target.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
            if entry.name.startswith("."):
                continue
            entries.append({
                "name": entry.name,
                "path": str(entry.relative_to(PROJECT_ROOT)),
                "is_dir": entry.is_dir(),
            })
        return {"entries": entries}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/files/content")
async def get_file_content(path: str):
    """Get file content."""
    try:
        target = PROJECT_ROOT / path
        if not str(target).startswith(str(PROJECT_ROOT)):
            raise HTTPException(status_code=403, detail="Access denied")
        if not target.is_file():
            raise HTTPException(status_code=404, detail="File not found")

        with open(target, 'r', encoding='utf-8') as f:
            content = f.read()
        return {"content": content, "path": path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/files/download")
async def download_file(path: str):
    """Download/serve a file (for images, etc.)."""
    try:
        target = PROJECT_ROOT / path
        if not str(target).startswith(str(PROJECT_ROOT)):
            raise HTTPException(status_code=403, detail="Access denied")
        if not target.is_file():
            raise HTTPException(status_code=404, detail="File not found")

        import mimetypes
        media_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        return FileResponse(str(target), media_type=media_type, filename=target.name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/files/raw")
async def get_file_raw(path: str):
    """Serve raw file content with proper MIME type for inline display."""
    try:
        root = PROJECT_ROOT.resolve()
        target = (PROJECT_ROOT / path).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            raise HTTPException(status_code=403, detail="Access denied")
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
    """Save file content."""
    try:
        path = data.get("path", "")
        content = data.get("content", "")
        target = PROJECT_ROOT / path
        if not str(target).startswith(str(PROJECT_ROOT)):
            raise HTTPException(status_code=403, detail="Access denied")

        with open(target, 'w', encoding='utf-8') as f:
            f.write(content)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/shell")
async def shell_command(data: dict):
    """Execute a shell command."""
    import subprocess
    try:
        cmd = data.get("command", "")
        if not cmd:
            return {"output": "", "error": "No command provided"}
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            cwd=str(PROJECT_ROOT),
            timeout=30
        )
        return {
            "output": result.stdout,
            "error": result.stderr if result.returncode != 0 else None,
            "returncode": result.returncode
        }
    except subprocess.TimeoutExpired:
        return {"output": "", "error": "Command timed out"}
    except Exception as e:
        return {"output": "", "error": str(e)}


@app.get("/api/git/status")
async def git_status():
    """Get git status."""
    import subprocess
    try:
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, cwd=str(PROJECT_ROOT)
        )
        status = subprocess.run(
            ["git", "status", "--short"],
            capture_output=True, text=True, cwd=str(PROJECT_ROOT)
        )
        log = subprocess.run(
            ["git", "log", "--oneline", "-10"],
            capture_output=True, text=True, cwd=str(PROJECT_ROOT)
        )
        return {
            "branch": branch.stdout.strip() if branch.returncode == 0 else None,
            "status": status.stdout.strip() if status.returncode == 0 else None,
            "log": log.stdout.strip().split("\n") if log.returncode == 0 else [],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/git/branches")
async def git_branches():
    """Get all git branches."""
    import subprocess
    try:
        result = subprocess.run(
            ["git", "branch", "-a"],
            capture_output=True, text=True, cwd=str(PROJECT_ROOT)
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
        return {"branches": branches}
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


# ============ MiniMax CLI Integration ============

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
    """Map a free-form plan name from the mmx CLI to a canonical identifier.

    Returns ``"unknown"`` for empty / unrecognised values so the frontend
    can always render a stable enum-like value.
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
    from mmx ``model_remains[]`` access flags (see ``_detect_plan_from_mmx``).
    We keep this for two reasons:
      1) Users whose mmx response is empty (fresh key, transient network
         blip) still see the right tier in the UI.
      2) Future mmx versions might add Ultra-specific signals that we
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


def _detect_plan_from_mmx(model_remains: list) -> str:
    """Auto-detect the user's plan from mmx ``model_remains[]`` access flags.

    mmx 1.0.16+ no longer returns the plan name directly, but every model
    entry carries ``current_interval_status`` (1 = active, 3 = inactive
    for this plan). The set of models the user has access to uniquely
    identifies the plan:

        + video gen active          → max (or ultra; ultra is a superset)
        + image/speech/music active  → plus
        + only text (general) active → plus (lowest paid tier; no
                                         "starter" tier in current
                                         Token Plan)
        + nothing                   → unknown (mmx error / fresh key)

    This is the **primary** plan source — every other user with a working
    mmx quota endpoint gets the right tier automatically, with no need
    to hand-edit ``config.yaml``. Config.yaml is only consulted as a
    fallback when mmx returns nothing usable.
    """
    if not model_remains:
        return "unknown"
    by_name = {(m.get("model_name") or "").lower(): m for m in model_remains}

    def active(name: str) -> bool:
        m = by_name.get(name)
        if not m:
            return False
        # 1 = active, 3 = inactive. Some mmx versions report 0 for
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
    """Coerce a value coming from the mmx CLI into ``float`` (or ``None``)."""
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
    """Build the enriched quota payload from raw mmx output.

    The mmx CLI returns the plan and credit fields under a few different
    keys depending on the version; we probe them all and fall back to
    safe defaults so the frontend always receives a stable shape.
    """
    payload: dict = data if isinstance(data, dict) else {}
    # `data` may itself be wrapped — mmx often returns {"data": {...}}.
    inner = payload.get("data") if isinstance(payload.get("data"), dict) else payload

    # Plan resolution order:
    #   1) Auto-detect from mmx model_remains[] access flags (works for
    #      any user, no config required)
    #   2) Explicit plan field in the mmx response (older versions)
    #   3) User-declared ``minimax.plan`` in config.yaml (manual override)
    #   4) Default to ``starter`` (lowest tier) as a safe last resort
    model_remains = inner.get("model_remains") if isinstance(inner.get("model_remains"), list) else []
    plan = _detect_plan_from_mmx(model_remains)
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

    # mmx 1.0.16+ removed credit_balance/total fields. Instead, the response
    # carries ``model_remains[]`` with per-model remaining *percentages*.
    # We surface the chat ("general") quota as credit_balance so the existing
    # CreditBalanceWidget has something numeric to render. credit_total is
    # fixed at 100 since the new format is percentage-based.
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
    """Get Token Plan quota using mmx CLI.

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

        import subprocess
        import shutil
        mmx_cmd = shutil.which("mmx") or "mmx"
        cmd_str = f'"{mmx_cmd}" quota --api-key {api_key} --region {region} --output json'
        result = subprocess.run(cmd_str, capture_output=True, text=True, timeout=30, shell=True)

        if result.returncode != 0:
            return {"success": False, "error": result.stderr or "CLI error"}

        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError:
            return {"success": True, "raw": result.stdout}

        enriched = _enrich_quota(data)
        return {"success": True, "data": data, **enriched}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
        allowed_commands = {
            "text", "speech", "image", "video", "music",
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


@app.get("/api/minimax/voices")
async def get_voices(language: str = ""):
    """Get available TTS voices using mmx CLI."""
    try:
        minimax_config = get_minimax_config()
        api_key = minimax_config["api_key"]
        region = minimax_config["region"]

        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        import subprocess
        import shutil
        mmx_cmd = shutil.which("mmx") or "mmx"
        cmd_str = f'"{mmx_cmd}" speech voices --api-key {api_key} --region {region} --output json'
        if language:
            cmd_str += f' --language {language}'
        result = subprocess.run(cmd_str, capture_output=True, text=True, timeout=30, shell=True)

        if result.returncode != 0:
            return {"success": False, "error": result.stderr or "CLI error"}

        try:
            data = json.loads(result.stdout)
            # CLI returns a flat list of strings; enrich into objects
            if isinstance(data, list):
                voices = []
                for v in data:
                    if isinstance(v, str):
                        voice_id = v
                        # Detect language from prefix
                        if voice_id.startswith("Chinese (Mandarin)_"):
                            lang = "Chinese"
                        elif voice_id.startswith("Cantonese_"):
                            lang = "Cantonese"
                        elif "_" in voice_id:
                            # Extract language from prefix before first underscore
                            # e.g. "English_expressive" -> "English", "German_Calm" -> "German"
                            lang = voice_id.split("_")[0]
                        else:
                            lang = "Unknown"
                        # Build friendly name
                        name_part = voice_id.split("_", 1)[1] if "_" in voice_id else voice_id
                        friendly = name_part.replace("_", " ").replace("-", " ")
                        # Guess gender
                        gender = "General"
                        lowered = voice_id.lower()
                        if any(x in lowered for x in ["man", "male", "boy", "gentleman", "guy", "dude", "bloke", "knight", "butler", "commander"]):
                            gender = "Male"
                        elif any(x in lowered for x in ["woman", "female", "girl", "lady", "maiden", "queen", "princess", "auntie", "bestie"]):
                            gender = "Female"
                        voices.append({
                            "id": voice_id,
                            "name": friendly,
                            "language": lang,
                            "gender": gender,
                        })
                    elif isinstance(v, dict):
                        voices.append(v)
                return {"success": True, "data": {"voices": voices}}
            return {"success": True, "data": data}
        except json.JSONDecodeError:
            return {"success": True, "raw": result.stdout}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
