"""
Activity panel widget for MiniMax Agent TUI - shows tool calls, thinking, results
"""
from textual.widgets import RichLog, Static
from textual.containers import Vertical, Container
from textual.app import ComposeResult
from datetime import datetime


class ActivityPanel(Container):
    """Activity/log panel showing agent actions"""
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.collapsed = False
    
    def compose(self) -> ComposeResult:
        with Vertical(id="activity-panel"):
            yield Static("📋 Activity Log", id="activity-title")
            yield RichLog(id="activity-log", highlight=True, markup=True, wrap=True)
    
    def log_tool_call(self, tool_name: str, args: dict) -> None:
        """Log a tool call"""
        log = self.query_one("#activity-log", RichLog)
        time_str = datetime.now().strftime("%H:%M:%S")
        log.write(f"[dim]{time_str}[/dim] [bold cyan]▶ Tool:[/bold cyan] {tool_name}")
        if args:
            log.write(f"  [dim]Args:[/dim] {args}")
    
    def log_thinking(self, thinking: str) -> None:
        """Log thinking content"""
        log = self.query_one("#activity-log", RichLog)
        time_str = datetime.now().strftime("%H:%M:%S")
        log.write(f"[dim]{time_str}[/dim] [bold yellow]💭 Thinking:[/bold yellow] {thinking[:200]}...")
    
    def log_result(self, tool_name: str, result: str, success: bool = True) -> None:
        """Log a tool result"""
        log = self.query_one("#activity-log", RichLog)
        time_str = datetime.now().strftime("%H:%M:%S")
        status = "✓" if success else "✗"
        color = "green" if success else "red"
        log.write(f"[dim]{time_str}[/dim] [bold {color}]{status} Result:[/bold {color}] {tool_name}")
        if result:
            preview = result[:300] + ("..." if len(result) > 300 else "")
            log.write(f"  [dim]{preview}[/dim]")
    
    def log_error(self, error: str) -> None:
        """Log an error"""
        log = self.query_one("#activity-log", RichLog)
        time_str = datetime.now().strftime("%H:%M:%S")
        log.write(f"[dim]{time_str}[/dim] [bold red]✗ Error:[/bold red] {error}")
    
    def log_info(self, info: str) -> None:
        """Log general info"""
        log = self.query_one("#activity-log", RichLog)
        time_str = datetime.now().strftime("%H:%M:%S")
        log.write(f"[dim]{time_str}[/dim] [blue]ℹ[/blue] {info}")
    
    def clear(self) -> None:
        """Clear the activity log"""
        log = self.query_one("#activity-log", RichLog)
        log.clear()
    
    def toggle_collapse(self) -> None:
        """Toggle collapse state"""
        self.collapsed = not self.collapsed
        panel = self.query_one("#activity-panel", Vertical)
        panel.toggle_class("collapsed")