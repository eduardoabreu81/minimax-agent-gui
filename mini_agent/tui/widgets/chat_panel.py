"""
Chat panel widget for MiniMax Agent TUI
"""
from datetime import datetime
from textual.widgets import Static, RichLog, MarkdownViewer
from textual.containers import Vertical, ScrollableContainer, Container
from textual.app import ComposeResult
from textual.message import Message


class ChatMessage(Static):
    """A single chat message"""
    
    def __init__(self, role: str, content: str, model: str = None, thinking: str = None, **kwargs):
        super().__init__(**kwargs)
        self.role = role
        self.content = content
        self.model = model
        self.thinking = thinking
    
    def compose(self) -> ComposeResult:
        role_labels = {
            "user": "👤 You",
            "assistant": "🤖 Assistant",
            "thinking": "🧠 Thinking",
            "system": "⚙️ System",
            "tool": "🔧 Tool",
        }
        
        css_class = f"message message-{self.role}"
        
        with Container(classes=css_class):
            # Header
            with Container(classes="message-header"):
                yield Label(role_labels.get(self.role, self.role), classes="message-role")
                if self.model:
                    yield Label(f"[{self.model}]", classes="message-model")
                yield Label(datetime.now().strftime("%H:%M:%S"), classes="message-time")
            
            # Thinking block (for assistant messages)
            if self.thinking and self.role == "assistant":
                yield Static(self.thinking, classes="message-thinking")
            
            # Content
            if self.role in ("assistant", "user") and self.content:
                yield MarkdownViewer(self.content, show_table_of_contents=False)
            elif self.content:
                yield Static(self.content)


class ChatPanel(Container):
    """Chat panel with message history"""
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.messages = []
    
    def compose(self) -> ComposeResult:
        yield ScrollableContainer(id="chat-messages")
    
    def add_message(self, role: str, content: str, model: str = None, thinking: str = None) -> None:
        """Add a message to the chat"""
        msg = ChatMessage(role, content, model=model, thinking=thinking)
        self.messages.append(msg)
        chat_messages = self.query_one("#chat-messages", ScrollableContainer)
        chat_messages.mount(msg)
        chat_messages.scroll_end()
    
    def clear(self) -> None:
        """Clear all messages"""
        self.messages.clear()
        chat_messages = self.query_one("#chat-messages", ScrollableContainer)
        chat_messages.remove_children()
    
    def update_last_message(self, content: str, thinking: str = None) -> None:
        """Update the last assistant message (for streaming)"""
        if self.messages and self.messages[-1].role == "assistant":
            self.messages[-1].content = content
            if thinking is not None:
                self.messages[-1].thinking = thinking
            # Re-render would need a refresh - simplified for now
            chat_messages = self.query_one("#chat-messages", ScrollableContainer)
            chat_messages.remove_children()
            for msg in self.messages:
                chat_messages.mount(ChatMessage(msg.role, msg.content, model=msg.model, thinking=msg.thinking))
            chat_messages.scroll_end()