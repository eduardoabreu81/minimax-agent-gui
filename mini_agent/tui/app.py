"""
MiniMax Agent TUI - Main Application
"""
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from textual.app import App, ComposeResult
from textual.containers import Container, Horizontal, Vertical
from textual.widgets import (
    Button, Input, Select, Static, Label, 
    ListView, ListItem, MarkdownViewer, 
    RichLog, Footer, Header, TextArea
)
from textual.binding import Binding
from textual.message import Message
from textual.events import Key

from mini_agent import Agent, LLMClient
from mini_agent.config import Config
from mini_agent.tools import ReadTool, WriteTool, EditTool, BashTool
from mini_agent.tools.mcp_loader import load_mcp_tools_async, cleanup_mcp_connections, set_mcp_timeout_config
from mini_agent.tools.skill_loader import SkillLoader
from mini_agent.schema import Message

from .widgets.sidebar import Sidebar
from .widgets.chat_panel import ChatPanel
from .widgets.composer import Composer
from .widgets.activity_panel import ActivityPanel


class MiniMaxAgentTUI(App):
    """Main TUI Application for MiniMax Agent"""
    
    CSS_PATH = "styles.css"
    
    BINDINGS = [
        Binding("ctrl+b", "toggle_sidebar", "Toggle Sidebar"),
        Binding("ctrl+q", "quit", "Quit"),
        Binding("ctrl+l", "clear_chat", "Clear Chat"),
        Binding("ctrl+a", "toggle_activity", "Toggle Activity"),
    ]
    
    def __init__(self, workspace_dir: Optional[Path] = None, **kwargs):
        super().__init__(**kwargs)
        self.workspace_dir = workspace_dir or Path.cwd()
        self.config = None
        self.agent = None
        self.llm_client = None
        self.current_model = "MiniMax-M3"
        self.thinking_enabled = True
        self.user_plan = "plus"
        self.session_start = datetime.now()
        self._cancel_event = asyncio.Event()
        self._agent_task = None
    
    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with Horizontal():
            # Sidebar
            yield Sidebar(user_plan=self.user_plan, id="sidebar")
            
            # Main area
            with Vertical(id="main-area"):
                # Chat panel
                yield ChatPanel(id="chat-panel")
                
                # Composer
                yield Composer(default_model=self.current_model, id="composer")
                
                # Activity panel
                yield ActivityPanel(id="activity-panel")
        
        yield Footer()

    async def on_mount(self) -> None:
        """Initialize app on mount"""
        await self._load_config()
        await self._initialize_agent()
        self._setup_bindings()
        self._focus_composer()
    
    def _setup_bindings(self) -> None:
        """Setup additional key bindings"""
        pass
    
    def _focus_composer(self) -> None:
        """Focus the composer input"""
        try:
            composer = self.query_one("#composer", Composer)
            input_widget = composer.query_one("#composer-input", TextArea)
            input_widget.focus()
        except Exception:
            pass
    
    async def _load_config(self) -> None:
        """Load configuration from config.yaml"""
        config_path = Config.get_default_config_path()
        if config_path.exists():
            self.config = Config.from_yaml(str(config_path))
        else:
            self.config = Config()
        
        # Update plan badge if available (default to plus)
        self.user_plan = "plus"
        sidebar = self.query_one("#sidebar", Sidebar)
        sidebar.set_plan(self.user_plan)
    
    async def _initialize_agent(self) -> None:
        """Initialize the agent with tools"""
        llm_config = self.config.llm if self.config else None
        if llm_config:
            api_key = getattr(llm_config, "api_key", "") or ""
            api_base = getattr(llm_config, "api_base", "https://api.minimax.io") or "https://api.minimax.io"
        else:
            api_key = ""
            api_base = "https://api.minimax.io"
        
        if not api_key:
            chat_panel = self.query_one("#chat-panel", ChatPanel)
            chat_panel.add_message("system", "⚠️ No API key configured. Please set MINIMAX_API_KEY or edit config/config.yaml")
            return
        
        # Initialize LLM client
        self.llm_client = LLMClient(
            api_key=api_key,
            api_base=api_base,
            model=self.current_model,
        )
        
        # Initialize tools
        tools = [
            ReadTool(workspace_dir=str(self.workspace_dir)),
            WriteTool(workspace_dir=str(self.workspace_dir)),
            EditTool(workspace_dir=str(self.workspace_dir)),
            BashTool(workspace_dir=str(self.workspace_dir)),
        ]
        
        # Load MCP tools if enabled
        try:
            tools_config = self.config.tools if self.config else None
            web_search = getattr(tools_config, "web_search", True) if tools_config else True
            understand_image = getattr(tools_config, "understand_image", True) if tools_config else True
            if web_search or understand_image:
                from mini_max_mcp.mcp_tool_wrapper import WebSearchTool, UnderstandImageTool
                if web_search:
                    tools.append(WebSearchTool(api_key, api_base))
                if understand_image:
                    tools.append(UnderstandImageTool(api_key, api_base))
        except ImportError:
            pass
        
        # Load external MCP tools
        try:
            tools_config = self.config.tools if self.config else None
            enable_mcp = getattr(tools_config, "enable_mcp", True) if tools_config else True
            if enable_mcp:
                mcp_config = getattr(tools_config, "mcp", None)
                set_mcp_timeout_config(
                    connect_timeout=getattr(mcp_config, "connect_timeout", 30) if mcp_config else 30,
                    execute_timeout=getattr(mcp_config, "execute_timeout", 120) if mcp_config else 120,
                    sse_read_timeout=getattr(mcp_config, "sse_read_timeout", 60) if mcp_config else 60,
                )
                mcp_config_path = getattr(tools_config, "mcp_config_path", "mcp.json") if tools_config else "mcp.json"
                mcp_tools = await load_mcp_tools_async(mcp_config_path)
                if mcp_tools:
                    tools.extend(mcp_tools)
                    activity = self.query_one("#activity-panel", ActivityPanel)
                    activity.log_info(f"Loaded {len(mcp_tools)} MCP tools")
        except Exception as e:
            activity = self.query_one("#activity-panel", ActivityPanel)
            activity.log_error(f"Failed to load MCP tools: {e}")
        
        # Load skills
        try:
            skill_loader = SkillLoader()
            skill_tools = skill_loader.get_tools()
            if skill_tools:
                tools.extend(skill_tools)
                activity = self.query_one("#activity-panel", ActivityPanel)
                activity.log_info(f"Loaded {len(skill_tools)} skill tools")
        except Exception:
            pass
        
        # Create agent
        system_prompt = f"""You are MiniMax Agent, powered by {self.current_model}.
You help users with coding, analysis, writing, and general tasks.
You have access to file tools, bash, web search, and image understanding.

Working directory: {self.workspace_dir}
All relative paths are resolved from this directory."""
        
        self.agent = Agent(
            llm_client=self.llm_client,
            system_prompt=system_prompt,
            tools=tools,
            max_steps=getattr(self.config.agent, "max_steps", 50) if self.config and self.config.agent else 50,
            workspace_dir=str(self.workspace_dir),
        )
        
        activity = self.query_one("#activity-panel", ActivityPanel)
        activity.log_info(f"Agent initialized with {len(tools)} tools")
        activity.log_info(f"Model: {self.current_model} | Thinking: {'ON' if self.thinking_enabled else 'OFF'}")

    # --- Event Handlers ---
    
    def on_sidebar_nav_selected(self, event: Sidebar.NavSelected) -> None:
        """Handle sidebar navigation"""
        activity = self.query_one("#activity-panel", ActivityPanel)
        activity.log_info(f"Switched to: {event.nav_id}")
        # TODO: Implement panel switching (chat, code, tools, settings)
    
    def on_composer_submit(self, event: Composer.Submit) -> None:
        """Handle message submission"""
        if not self.agent:
            chat_panel = self.query_one("#chat-panel", ChatPanel)
            chat_panel.add_message("system", "⚠️ Agent not initialized. Check API key.")
            return
        
        # Add user message to chat panel and agent history
        chat_panel = self.query_one("#chat-panel", ChatPanel)
        chat_panel.add_message("user", event.text)
        self.agent.add_user_message(event.text)
        
        # Update model/thinking if changed
        if event.model != self.current_model:
            self.current_model = event.model
        self.thinking_enabled = event.thinking
        
        # Run agent in background
        self._cancel_event.clear()
        self._agent_task = asyncio.create_task(self._run_agent_stream())
    
    async def _run_agent_stream(self) -> None:
        """Run agent with streaming callbacks"""
        if not self.agent:
            return
        
        chat_panel = self.query_one("#chat-panel", ChatPanel)
        activity = self.query_one("#activity-panel", ActivityPanel)
        
        # Add placeholder for assistant response
        chat_panel.add_message("assistant", "", model=self.current_model)
        thinking_buffer = ""
        text_buffer = ""
        
        async def on_stream_delta(kind: str, chunk: str) -> None:
            nonlocal thinking_buffer, text_buffer
            if kind == "thinking":
                thinking_buffer += chunk
                chat_panel.update_last_message(text_buffer, thinking=thinking_buffer)
            elif kind == "text":
                text_buffer += chunk
                chat_panel.update_last_message(text_buffer, thinking=thinking_buffer)
        
        async def on_tool_callback(tool_name: str, arguments: dict, result: str) -> None:
            if tool_name == "__step_start__":
                activity.log_info(f"Step {arguments.get('step', '?')}/{arguments.get('max_steps', '?')}")
            elif tool_name == "__thinking__":
                thinking_text = arguments.get("thinking", "")
                if thinking_text:
                    activity.log_thinking(thinking_text[:100])
            elif result is not None:
                success = not (isinstance(result, str) and result.startswith("Error"))
                activity.log_result(tool_name, result, success=success)
            else:
                activity.log_tool_call(tool_name, arguments)
        
        try:
            # Run agent — uses self.agent.messages (including the user message
            # added by add_user_message above). Returns the final text response.
            result = await self.agent.run(
                cancel_event=self._cancel_event,
                tool_callback=on_tool_callback,
                model_override=self.current_model,
                thinking_override=self.thinking_enabled,
                stream_callback=on_stream_delta,
            )
            
            # Final update — use the returned text, plus any thinking accumulated
            chat_panel.update_last_message(result, thinking=thinking_buffer)
            activity.log_info("Response complete")
            
        except asyncio.CancelledError:
            activity.log_info("Generation cancelled")
            chat_panel.update_last_message("[Cancelled]", thinking=thinking_buffer)
        except Exception as e:
            activity.log_error(f"Agent error: {e}")
            chat_panel.update_last_message(f"Error: {e}", thinking=thinking_buffer)
    
    # --- Actions ---
    
    def action_toggle_sidebar(self) -> None:
        """Toggle sidebar collapse"""
        sidebar = self.query_one("#sidebar", Sidebar)
        sidebar.action_toggle_collapse()
    
    def action_clear_chat(self) -> None:
        """Clear chat history"""
        chat_panel = self.query_one("#chat-panel", ChatPanel)
        chat_panel.clear()
        activity = self.query_one("#activity-panel", ActivityPanel)
        activity.log_info("Chat cleared")
    
    def action_toggle_activity(self) -> None:
        """Toggle activity panel"""
        activity = self.query_one("#activity-panel", ActivityPanel)
        activity.toggle_collapse()
    
    def action_quit(self) -> None:
        """Quit the application"""
        if self._agent_task and not self._agent_task.done():
            self._cancel_event.set()
            self._agent_task.cancel()
        self.exit()
    
    async def on_unmount(self) -> None:
        """Cleanup on exit"""
        if self._agent_task and not self._agent_task.done():
            self._cancel_event.set()
            self._agent_task.cancel()
        await cleanup_mcp_connections()


def main():
    """Entry point for the TUI application"""
    import sys
    from pathlib import Path
    
    workspace = Path.cwd()
    if len(sys.argv) > 1:
        workspace = Path(sys.argv[1]).resolve()
    
    app = MiniMaxAgentTUI(workspace_dir=workspace)
    app.run()


if __name__ == "__main__":
    main()