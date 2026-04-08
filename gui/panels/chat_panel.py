"""Chat Panel - Agent conversation interface."""

import asyncio
import json
import os
from pathlib import Path
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QTextEdit, 
    QPushButton, QLabel, QScrollArea, QFrame, QMessageBox, QCheckBox
)
from PyQt6.QtCore import Qt, QThread, QTimer, pyqtSignal, pyqtSlot, QEvent
from PyQt6.QtGui import QFont

# Import real Mini-Agent
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "mini_agent"))

from mini_agent import Agent, LLMClient
from mini_agent.config import Config
from mini_agent.tools import ReadTool, WriteTool, BashTool


class AgentWorker(QThread):
    """Worker thread for running agent in background."""
    
    finished = pyqtSignal(str)
    error = pyqtSignal(str)
    progress = pyqtSignal(str)
    
    def __init__(self, agent: Agent, message: str, parent=None):
        super().__init__(parent)
        self.agent = agent
        self.message = message
    
    def run(self):
        """Run agent task with existing context."""
        try:
            self.progress.emit("Agent is thinking...")
            
            # Add new user message to existing agent (which has conversation history)
            self.agent.add_user_message(self.message)
            
            # Run agent synchronously in thread - it will use existing messages context
            result = asyncio.run(self.agent.run())
            
            self.finished.emit(result)
            
        except Exception as e:
            self.error.emit(str(e))


class ChatMessage(QFrame):
    """Single chat message widget."""

    def __init__(self, text: str, is_user: bool = True, parent=None):
        super().__init__(parent)
        self.is_user = is_user
        self._setup_ui(text)

    def _setup_ui(self, text: str):
        """Setup message UI."""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(10, 5, 10, 5)

        label = QLabel(text)
        label.setWordWrap(True)
        label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        label.setFont(QFont("Segoe UI", 13))

        if self.is_user:
            label.setStyleSheet("""
                background-color: #543088;
                color: white;
                border-radius: 12px;
                padding: 12px 16px;
            """)
        else:
            label.setStyleSheet("""
                background-color: #404040;
                color: #e0e0e0;
                border-radius: 12px;
                padding: 12px 16px;
            """)

        layout.addWidget(label)


class ChatPanel(QWidget):
    """Chat interface for agent conversation."""

    # Signal emitted when conversation changes (for auto-save)
    conversation_changed = pyqtSignal()

    def __init__(self, config: dict, parent=None):
        super().__init__(parent)
        self.config = config
        self.messages = []
        self.worker = None
        self.agent = None  # Persistent agent with conversation context
        self._setup_ui()
        self._init_agent()

    def _init_agent(self):
        """Initialize or reinitialize the agent for a new conversation."""
        # Import here to avoid issues
        import sys
        from pathlib import Path
        sys.path.insert(0, str(Path(__file__).parent.parent.parent / "mini_agent"))
        from mini_agent import Agent, LLMClient
        from mini_agent.tools import ReadTool, WriteTool, BashTool

        # Get API credentials from config
        minimax_config = self.config.get("minimax", {})
        api_key = minimax_config.get("api_key", "")
        api_base = minimax_config.get("api_base", "https://api.minimax.io")

        if not api_key or api_key == "YOUR_API_KEY_HERE":
            print("[DEBUG ChatPanel] API key not configured, cannot initialize agent")
            return

        # Create LLM client
        llm_client = LLMClient(
            api_key=api_key,
            api_base=api_base,
            model=self.config.get("agent", {}).get("model", "MiniMax-M2.7")
        )

        # Setup tools
        workspace_dir = self.config.get("agent", {}).get("workspace_dir", "./workspace")
        tools = [
            ReadTool(workspace_dir=workspace_dir),
            WriteTool(workspace_dir=workspace_dir),
            BashTool(),
        ]

        # Add MiniMax MCP tools (web_search, understand_image)
        try:
            from mini_max_mcp.mcp_tool_wrapper import WebSearchTool, UnderstandImageTool
            tools.append(WebSearchTool(api_key, api_base))
            tools.append(UnderstandImageTool(api_key, api_base))
            print("[DEBUG ChatPanel] Added MiniMax MCP tools: web_search, understand_image")
        except ImportError as e:
            print(f"[DEBUG ChatPanel] Could not load MiniMax MCP tools: {e}")

        # Create agent with system prompt
        system_prompt = """You are a helpful AI assistant powered by MiniMax M2.7.
You have access to file system tools:
- Read, Write, Edit files
- Bash commands
- web_search: Search the web for current information
- understand_image: Analyze images to describe their content
Be concise and helpful in your responses."""

        self.agent = Agent(
            llm_client=llm_client,
            system_prompt=system_prompt,
            tools=tools,
            max_steps=self.config.get("agent", {}).get("max_steps", 50),
            workspace_dir=workspace_dir,
        )
        print(f"[DEBUG ChatPanel] Agent initialized with {len(self.agent.messages)} messages (system prompt), {len(tools)} tools")

    def reset_agent(self):
        """Reset agent for a new conversation (new context)."""
        self.agent = None
        self.messages = []
        self.clear_chat()
        self._init_agent()

    def _setup_ui(self):
        """Setup chat panel UI."""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        # Chat history area
        self.chat_area = QScrollArea()
        self.chat_area.setStyleSheet("""
            QScrollArea {
                background-color: #1e1e1e;
                border: none;
            }
        """)
        self.chat_area.setWidgetResizable(True)
        self.chat_content = QWidget()
        self.chat_content.setStyleSheet("background-color: #1e1e1e;")
        self.chat_layout = QVBoxLayout(self.chat_content)
        self.chat_layout.setContentsMargins(20, 20, 20, 20)
        self.chat_layout.addStretch()
        self.chat_area.setWidget(self.chat_content)
        layout.addWidget(self.chat_area, stretch=1)

        # Input area
        input_frame = QFrame()
        input_frame.setStyleSheet("""
            background-color: #404040;
            border-top: 1px solid #555;
        """)
        input_layout = QHBoxLayout(input_frame)
        input_layout.setContentsMargins(15, 10, 15, 10)

        # Left side: toggles
        toggles_layout = QVBoxLayout()
        toggles_layout.setSpacing(2)
        
        self.web_search_check = QCheckBox("🔍 Web Search")
        self.web_search_check.setChecked(True)
        self.web_search_check.setStyleSheet("""
            QCheckBox {
                color: #ccc;
                font-size: 11px;
            }
            QCheckBox::indicator {
                width: 14px;
                height: 14px;
            }
        """)
        
        self.img_understand_check = QCheckBox("🖼️ Understand Image")
        self.img_understand_check.setChecked(True)
        self.img_understand_check.setStyleSheet("""
            QCheckBox {
                color: #ccc;
                font-size: 11px;
            }
            QCheckBox::indicator {
                width: 14px;
                height: 14px;
            }
        """)
        
        toggles_layout.addWidget(self.web_search_check)
        toggles_layout.addWidget(self.img_understand_check)
        input_layout.addLayout(toggles_layout)

        # Center: text input
        self.input_text = QTextEdit()
        self.input_text.setPlaceholderText("Message MiniMax Agent... (Ctrl+Enter to send)")
        self.input_text.setMaximumHeight(80)
        self.input_text.setStyleSheet("""
            QTextEdit {
                background-color: #404040;
                color: white;
                border: none;
                border-radius: 8px;
                padding: 10px;
                font-size: 14px;
            }
        """)
        # Add Ctrl+Enter to send
        self.input_text.installEventFilter(self)
        input_layout.addWidget(self.input_text, stretch=1)

        # Right side: Send button
        self.send_btn = QPushButton("Send")
        self.send_btn.setMaximumWidth(80)
        self.send_btn.setMinimumHeight(36)
        self.send_btn.setStyleSheet("""
            QPushButton {
                background-color: #5a5a5a;
                color: white;
                border: none;
                border-radius: 8px;
                padding: 8px 16px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #6a6a6a;
            }
            QPushButton:disabled {
                background-color: #3a3a3a;
                color: #888;
            }
        """)
        self.send_btn.clicked.connect(self._send_message)
        input_layout.addWidget(self.send_btn, stretch=0)

        layout.addWidget(input_frame, stretch=0)

        # Status label
        self.status_label = QLabel("")
        self.status_label.setStyleSheet("color: #888; padding: 5px; background-color: #1e1e1e;")
        layout.addWidget(self.status_label)

    def eventFilter(self, obj, event):
        """Handle Ctrl+Enter to send message."""
        if obj == self.input_text and event.type() == event.Type.KeyPress:
            if event.key() == Qt.Key.Key_Return and (event.modifiers() & Qt.KeyboardModifier.ControlModifier):
                self._send_message()
                return True
        return super().eventFilter(obj, event)
    
    def _send_message(self):
        """Send message to agent."""
        message = self.input_text.toPlainText().strip()
        if not message:
            return
        
        if self.worker and self.worker.isRunning():
            QMessageBox.warning(self, "Busy", "Agent is still processing. Please wait.")
            return

        if not self.agent:
            QMessageBox.warning(self, "Agent Not Ready", "Agent is not initialized. Check your API key.")
            return
        
        # Add user message to chat
        self._add_message(message, is_user=True)
        self.input_text.clear()
        
        # Emit signal for auto-save
        self.conversation_changed.emit()
        
        # Start worker thread with existing agent (has conversation context)
        self.send_btn.setEnabled(False)
        self.status_label.setText("Agent is thinking...")
        
        self.worker = AgentWorker(self.agent, message)
        self.worker.finished.connect(self._on_response)
        self.worker.error.connect(self._on_error)
        self.worker.start()
    
    @pyqtSlot(str)
    def _on_response(self, response: str):
        """Handle agent response."""
        self._add_message(response, is_user=False)
        self.send_btn.setEnabled(True)
        self.status_label.setText("")
        # Emit signal for auto-save
        self.conversation_changed.emit()
    
    @pyqtSlot(str)
    def _on_error(self, error: str):
        """Handle agent error."""
        QMessageBox.critical(self, "Error", f"Agent error: {error}")
        self.send_btn.setEnabled(True)
        self.status_label.setText("")
    
    def _add_message(self, text: str, is_user: bool):
        """Add message to chat history."""
        # Remove stretch
        self.chat_layout.removeItem(self.chat_layout.itemAt(self.chat_layout.count() - 1))

        # Add message
        msg = ChatMessage(text, is_user)
        self.chat_layout.addWidget(msg)

        # Re-add stretch
        self.chat_layout.addStretch()

        self.messages.append({"text": text, "is_user": is_user})

        # Scroll to bottom
        QTimer.singleShot(10, lambda: self.chat_area.verticalScrollBar().setValue(
            self.chat_area.verticalScrollBar().maximum()
        ))

    def get_messages(self) -> list:
        """Get all messages for saving."""
        return self.messages

    def clear_chat(self):
        """Clear all messages from chat."""
        self.messages = []
        # Remove all widgets from layout
        while self.chat_layout.count() > 1:  # Keep the stretch
            item = self.chat_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

    def load_messages(self, messages: list):
        """Load messages into chat (for conversation history)."""
        self.clear_chat()
        for msg in messages:
            self._add_message(msg.get('text', ''), msg.get('is_user', True))

    def get_conversation_title(self) -> str:
        """Get a title for the current conversation (first user message)."""
        for msg in self.messages:
            if msg.get('is_user', True):
                text = msg.get('text', '')[:50]
                return text if text else ''
        return ''