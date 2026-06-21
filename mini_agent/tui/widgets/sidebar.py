"""
Sidebar widget for MiniMax Agent TUI
"""
from textual.widgets import Static, Button, ListView, ListItem, Label
from textual.containers import Vertical, Container
from textual.app import ComposeResult
from textual.binding import Binding
from textual.message import Message


class NavItem(Button):
    """Navigation item in sidebar"""
    
    def __init__(self, nav_id: str, label: str, icon: str, **kwargs):
        super().__init__(**kwargs)
        self.nav_id = nav_id
        self.icon = icon
        self.label_text = label
    
    def compose(self) -> ComposeResult:
        yield Label(self.icon, classes="nav-icon")
        yield Label(self.label_text, classes="nav-label")


class Sidebar(Container):
    """Sidebar with navigation and plan badge"""
    
    BINDINGS = [
        Binding("ctrl+b", "toggle_collapse", "Toggle Sidebar"),
    ]
    
    class NavSelected(Message):
        def __init__(self, nav_id: str) -> None:
            self.nav_id = nav_id
            super().__init__()
    
    def __init__(self, user_plan: str = "plus", **kwargs):
        super().__init__(**kwargs)
        self.user_plan = user_plan
        self.collapsed = False
        self.nav_items = [
            ("chat", "Chat", "💬"),
            ("code", "Code", "💻"),
            ("tools", "Tools", "🔧"),
            ("settings", "Settings", "⚙️"),
        ]
        self.plan_labels = {"plus": "Plus", "max": "Max", "ultra": "Ultra"}
    
    def compose(self) -> ComposeResult:
        with Vertical(id="sidebar-content"):
            # Header
            with Container(id="sidebar-header"):
                yield Label("🤖", id="sidebar-logo")
                yield Label("MiniMax Agent", id="sidebar-title")
                yield Label("All-in-One Platform", id="sidebar-subtitle")
                yield Label(f"◆ {self.plan_labels.get(self.user_plan, 'Plus')}", id="plan-badge", classes="plan-badge")
            
            # Navigation - using a container with buttons instead of ListView
            with Vertical(id="nav-list"):
                for nav_id, label, icon in self.nav_items:
                    yield NavItem(nav_id, label, icon)
            
            # Footer
            with Container(id="sidebar-footer"):
                yield Button("◀ Collapse", id="collapse-btn", variant="default")
    
    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle navigation button press"""
        if event.button.id == "collapse-btn":
            self.action_toggle_collapse()
        elif isinstance(event.button, NavItem):
            self.post_message(self.NavSelected(event.button.nav_id))
            # Update active state
            for item in self.query("#nav-list NavItem"):
                item.remove_class("-active")
            event.button.add_class("-active")
    
    def action_toggle_collapse(self) -> None:
        self.collapsed = not self.collapsed
        self.toggle_class("collapsed")
        btn = self.query_one("#collapse-btn", Button)
        if self.collapsed:
            btn.label = "▶ Expand"
            self.query_one("#sidebar-header").display = False
            self.query_one("#nav-list").display = False
            self.query_one("#sidebar-footer").display = False
        else:
            btn.label = "◀ Collapse"
            self.query_one("#sidebar-header").display = True
            self.query_one("#nav-list").display = True
            self.query_one("#sidebar-footer").display = True
    
    def set_plan(self, plan: str) -> None:
        self.user_plan = plan
        badge = self.query_one("#plan-badge", Label)
        self.plan_labels = {"plus": "Plus", "max": "Max", "ultra": "Ultra"}
        badge.update(f"◆ {self.plan_labels.get(plan, 'Plus')}")