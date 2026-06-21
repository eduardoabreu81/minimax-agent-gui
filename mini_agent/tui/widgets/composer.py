"""
Composer widget for MiniMax Agent TUI - input area with model selector and thinking toggle
"""
from textual.widgets import Input, Select, Button, Static, Label, TextArea
from textual.containers import Horizontal, Vertical, Container
from textual.app import ComposeResult
from textual.message import Message


class Composer(Container):
    """Message composer with model selector and thinking toggle"""
    
    class Submit(Message):
        def __init__(self, text: str, model: str, thinking: bool) -> None:
            self.text = text
            self.model = model
            self.thinking = thinking
            super().__init__()
    
    CHAT_MODELS = [
        ("MiniMax-M3", "MiniMax-M3 (1M context, agentic)"),
        ("MiniMax-M2.7", "MiniMax-M2.7 (faster)"),
        ("MiniMax-M2.7-highspeed", "MiniMax-M2.7-highspeed (highest throughput)"),
    ]
    
    def __init__(self, default_model: str = "MiniMax-M3", **kwargs):
        super().__init__(**kwargs)
        self.current_model = default_model
        self.thinking_enabled = True
    
    def compose(self) -> ComposeResult:
        with Vertical(id="composer"):
            # Header with model selector and thinking toggle
            with Horizontal(id="composer-header"):
                yield Label("Model:", classes="label")
                yield Select(
                    [(label, value) for value, label in self.CHAT_MODELS],
                    value=self.current_model,
                    id="model-selector",
                    allow_blank=False,
                )
                yield Label("Thinking:", classes="label")
                yield Button(
                    "🧠 ON" if self.thinking_enabled else "🧠 OFF",
                    id="thinking-toggle",
                    variant="primary" if self.thinking_enabled else "default",
                )
            
            # Input area
            yield TextArea(
                id="composer-input",
                placeholder="Type your message... (Ctrl+Enter to send, Enter for newline)",
                show_line_numbers=False,
            )
            
            # Send button
            with Horizontal(id="composer-footer"):
                yield Button("Send (Ctrl+Enter)", id="send-btn", variant="primary")
                yield Static("Esc to cancel • ↑/↓ for history", id="key-hints", classes="key-hint")
    
    def on_select_changed(self, event: Select.Changed) -> None:
        if event.select.id == "model-selector":
            self.current_model = event.value
            # Hide thinking toggle for non-M3 models
            thinking_btn = self.query_one("#thinking-toggle", Button)
            if self.current_model != "MiniMax-M3":
                thinking_btn.display = False
                self.thinking_enabled = False
            else:
                thinking_btn.display = True
    
    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "thinking-toggle":
            self.thinking_enabled = not self.thinking_enabled
            event.button.label = "🧠 ON" if self.thinking_enabled else "🧠 OFF"
            event.button.variant = "primary" if self.thinking_enabled else "default"
        elif event.button.id == "send-btn":
            self._submit()
    
    def on_text_area_submitted(self, event: Input.Submitted) -> None:
        # TextArea doesn't have submitted event by default, we'll handle via key binding
        pass
    
    def _submit(self) -> None:
        input_widget = self.query_one("#composer-input", TextArea)
        text = input_widget.text.strip()
        if text:
            self.post_message(self.Submit(text, self.current_model, self.thinking_enabled))
            input_widget.clear()
    
    def action_submit(self) -> None:
        """Action for Ctrl+Enter"""
        self._submit()
    
    def action_cancel(self) -> None:
        """Action for Esc"""
        input_widget = self.query_one("#composer-input", TextArea)
        input_widget.clear()