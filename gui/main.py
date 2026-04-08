"""MiniMax Agent GUI - Redesigned with ChatGPT-style interface."""

import sys
import json
import os
from pathlib import Path
from datetime import datetime

from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QTabWidget, QTextEdit, QPushButton, QLabel, QListWidget, QListWidgetItem,
    QFrame, QSplitter, QMessageBox, QInputDialog, QMenu, QDialog,
    QLineEdit, QVBoxLayout as QVBoxLayout2, QFormLayout, QDialogButtonBox,
    QGroupBox, QCheckBox, QSpinBox, QDoubleSpinBox, QScrollArea
)
from PyQt6.QtCore import Qt, QSize, QSettings
from PyQt6.QtGui import QFont, QAction, QIcon

from gui.panels.chat_panel import ChatPanel
from gui.panels.tts_panel import TTSPanel
from gui.panels.image_panel import ImagePanel


class ConversationHistory:
    """Manages conversation history persistence."""

    def __init__(self, storage_path: str = "workspace/conversations"):
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)
        self.conversations = self._load_all()

    def _load_all(self) -> dict:
        """Load all conversations from storage."""
        conversations = {}
        for f in self.storage_path.glob("*.json"):
            try:
                with open(f, 'r', encoding='utf-8') as fp:
                    data = json.load(fp)
                    conversations[data.get('id', f.stem)] = data
            except:
                pass
        return conversations

    def save(self, conv_id: str, title: str, messages: list):
        """Save a conversation."""
        self.conversations[conv_id] = {
            'id': conv_id,
            'title': title,
            'messages': messages,
            'updated_at': datetime.now().isoformat()
        }
        path = self.storage_path / f"{conv_id}.json"
        with open(path, 'w', encoding='utf-8') as fp:
            json.dump(self.conversations[conv_id], fp, ensure_ascii=False, indent=2)

    def delete(self, conv_id: str):
        """Delete a conversation."""
        if conv_id in self.conversations:
            del self.conversations[conv_id]
        path = self.storage_path / f"{conv_id}.json"
        if path.exists():
            path.unlink()

    def get_all(self) -> list:
        """Get all conversations sorted by date."""
        return sorted(self.conversations.values(),
                      key=lambda x: x.get('updated_at', ''),
                      reverse=True)


class SettingsDialog(QDialog):
    """Settings configuration dialog."""

    def __init__(self, parent=None, config: dict = None):
        super().__init__(parent)
        self.config = config or {}
        self.setWindowTitle("⚙️ Settings")
        self.setMinimumWidth(500)
        self._setup_ui()

    def _setup_ui(self):
        """Setup settings dialog UI."""
        layout = QVBoxLayout(self)
        layout.setSpacing(15)
        layout.setContentsMargins(20, 20, 20, 20)

        # Make dialog scrollable for smaller screens
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll_widget = QWidget()
        scroll_layout = QVBoxLayout(scroll_widget)
        scroll_layout.setSpacing(15)

        # API Configuration Group
        api_group = QGroupBox("🔑 API Configuration")
        api_group.setStyleSheet("""
            QGroupBox {
                font-weight: bold;
                padding: 15px;
                margin-top: 10px;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 10px;
                padding: 0 5px;
            }
        """)
        api_layout = QFormLayout()
        api_layout.setLabelAlignment(Qt.AlignmentFlag.AlignLeft)
        api_layout.setSpacing(10)
        api_layout.setRowWrapPolicy(QFormLayout.RowWrapPolicy.WrapLongRows)

        self.api_key_input = QLineEdit()
        self.api_key_input.setPlaceholderText("Enter your MiniMax API key")
        self.api_key_input.setText(self.config.get("minimax", {}).get("api_key", ""))
        self.api_key_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.api_key_input.setMinimumWidth(300)
        api_layout.addRow("API Key:", self.api_key_input)

        self.api_base_input = QLineEdit()
        self.api_base_input.setPlaceholderText("https://api.minimax.io")
        self.api_base_input.setText(self.config.get("minimax", {}).get("api_base", "https://api.minimax.io"))
        self.api_base_input.setMinimumWidth(300)
        api_layout.addRow("API Base URL:", self.api_base_input)

        api_group.setLayout(api_layout)
        scroll_layout.addWidget(api_group)

        # Agent Configuration Group
        agent_group = QGroupBox("🤖 Agent Settings")
        agent_group.setStyleSheet("""
            QGroupBox {
                font-weight: bold;
                padding: 15px;
                margin-top: 10px;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 10px;
                padding: 0 5px;
            }
        """)
        agent_layout = QFormLayout()
        agent_layout.setSpacing(10)
        agent_layout.setRowWrapPolicy(QFormLayout.RowWrapPolicy.WrapLongRows)

        self.model_input = QLineEdit()
        self.model_input.setText(self.config.get("agent", {}).get("model", "MiniMax-M2.7"))
        self.model_input.setMinimumWidth(200)
        agent_layout.addRow("Model:", self.model_input)

        self.max_steps_spin = QSpinBox()
        self.max_steps_spin.setRange(1, 200)
        self.max_steps_spin.setValue(self.config.get("agent", {}).get("max_steps", 50))
        agent_layout.addRow("Max Steps:", self.max_steps_spin)

        self.workspace_input = QLineEdit()
        self.workspace_input.setText(self.config.get("agent", {}).get("workspace_dir", "./workspace"))
        self.workspace_input.setMinimumWidth(300)
        agent_layout.addRow("Workspace Dir:", self.workspace_input)

        agent_group.setLayout(agent_layout)
        scroll_layout.addWidget(agent_group)

        # TTS Configuration Group
        tts_group = QGroupBox("🔊 TTS Settings")
        tts_group.setStyleSheet("""
            QGroupBox {
                font-weight: bold;
                padding: 15px;
                margin-top: 10px;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 10px;
                padding: 0 5px;
            }
        """)
        tts_layout = QFormLayout()
        tts_layout.setSpacing(10)
        tts_layout.setRowWrapPolicy(QFormLayout.RowWrapPolicy.WrapLongRows)

        self.tts_model_input = QLineEdit()
        self.tts_model_input.setText(self.config.get("tts", {}).get("model", "speech-2.8-turbo"))
        self.tts_model_input.setMinimumWidth(200)
        tts_layout.addRow("TTS Model:", self.tts_model_input)

        self.tts_voice_input = QLineEdit()
        self.tts_voice_input.setText(self.config.get("tts", {}).get("voice", "male-qn-qingque"))
        self.tts_voice_input.setMinimumWidth(200)
        tts_layout.addRow("Default Voice:", self.tts_voice_input)

        self.tts_speed_spin = QDoubleSpinBox()
        self.tts_speed_spin.setRange(0.5, 2.0)
        self.tts_speed_spin.setSingleStep(0.1)
        self.tts_speed_spin.setValue(self.config.get("tts", {}).get("speed", 1.0))
        tts_layout.addRow("Speed:", self.tts_speed_spin)

        tts_group.setLayout(tts_layout)
        scroll_layout.addWidget(tts_group)

        # Image Configuration Group
        image_group = QGroupBox("🎨 Image Settings")
        image_group.setStyleSheet("""
            QGroupBox {
                font-weight: bold;
                padding: 15px;
                margin-top: 10px;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 10px;
                padding: 0 5px;
            }
        """)
        image_layout = QFormLayout()
        image_layout.setSpacing(10)
        image_layout.setRowWrapPolicy(QFormLayout.RowWrapPolicy.WrapLongRows)

        self.image_model_input = QLineEdit()
        self.image_model_input.setText(self.config.get("image", {}).get("model", "image-01"))
        self.image_model_input.setMinimumWidth(200)
        image_layout.addRow("Image Model:", self.image_model_input)

        self.image_size_input = QLineEdit()
        self.image_size_input.setText(self.config.get("image", {}).get("size", "1:1"))
        self.image_size_input.setMinimumWidth(200)
        image_layout.addRow("Default Aspect Ratio:", self.image_size_input)

        image_group.setLayout(image_layout)
        scroll_layout.addWidget(image_group)

        # GUI Settings Group
        gui_group = QGroupBox("🖥️ GUI Settings")
        gui_group.setStyleSheet("""
            QGroupBox {
                font-weight: bold;
                padding: 15px;
                margin-top: 10px;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 10px;
                padding: 0 5px;
            }
        """)
        gui_layout = QFormLayout()
        gui_layout.setSpacing(10)

        self.auto_play_check = QCheckBox()
        self.auto_play_check.setChecked(self.config.get("gui", {}).get("auto_play_audio", True))
        gui_layout.addRow("Auto-play TTS:", self.auto_play_check)

        gui_group.setLayout(gui_layout)
        scroll_layout.addWidget(gui_group)

        scroll_layout.addStretch()
        scroll.setWidget(scroll_widget)
        layout.addWidget(scroll)

        # Buttons
        button_box = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        button_box.accepted.connect(self.accept)
        button_box.rejected.connect(self.reject)
        layout.addWidget(button_box)

    def get_config(self) -> dict:
        """Get configuration from dialog fields."""
        return {
            "minimax": {
                "api_key": self.api_key_input.text(),
                "api_base": self.api_base_input.text(),
            },
            "agent": {
                "model": self.model_input.text(),
                "max_steps": self.max_steps_spin.value(),
                "workspace_dir": self.workspace_input.text(),
            },
            "tts": {
                "model": self.tts_model_input.text(),
                "voice": self.tts_voice_input.text(),
                "speed": self.tts_speed_spin.value(),
            },
            "image": {
                "model": self.image_model_input.text(),
                "size": self.image_size_input.text(),
            },
            "gui": {
                "auto_play_audio": self.auto_play_check.isChecked(),
            }
        }


class MainWindow(QMainWindow):
    """Main application window with ChatGPT-style layout."""

    def __init__(self):
        super().__init__()

        self.history = ConversationHistory()
        self.current_conv_id = None
        self.current_messages = []

        self.setWindowTitle("MiniMax Agent GUI")
        self.setGeometry(100, 100, 1400, 900)

        # Load config before UI setup
        self.config = self._get_config()

        self._setup_ui()
        self._setup_menu()

        # Start new conversation by default
        self._new_conversation()

    def _setup_ui(self):
        """Setup the main UI structure."""
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QHBoxLayout(central)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # ========== LEFT SIDEBAR ==========
        self.sidebar = QFrame()
        self.sidebar.setMaximumWidth(280)
        self.sidebar.setMinimumWidth(200)
        self.sidebar.setStyleSheet("""
            background-color: #202123;
            color: white;
        """)
        sidebar_layout = QVBoxLayout(self.sidebar)
        sidebar_layout.setContentsMargins(0, 0, 0, 0)

        # New chat button
        self.new_chat_btn = QPushButton("+ New Chat")
        self.new_chat_btn.setStyleSheet("""
            QPushButton {
                background-color: transparent;
                color: white;
                border: none;
                padding: 15px;
                text-align: left;
                font-size: 14px;
            }
            QPushButton:hover {
                background-color: #343541;
            }
        """)
        self.new_chat_btn.clicked.connect(self._new_conversation)
        sidebar_layout.addWidget(self.new_chat_btn)

        # Conversations list
        self.conv_list = QListWidget()
        self.conv_list.setStyleSheet("""
            QListWidget {
                background-color: transparent;
                border: none;
                color: white;
            }
            QListWidget::item {
                padding: 12px 15px;
                border-bottom: 1px solid #343541;
            }
            QListWidget::item:selected {
                background-color: #343541;
            }
            QListWidget::item:hover {
                background-color: #2a2a2e;
            }
        """)
        self.conv_list.itemClicked.connect(self._load_conversation)
        sidebar_layout.addWidget(self.conv_list, stretch=1)

        # Bottom section - TTS/Image shortcuts
        bottom_widget = QFrame()
        bottom_widget.setStyleSheet("border-top: 1px solid #343541;")
        bottom_layout = QVBoxLayout(bottom_widget)

        tts_btn = QPushButton("🔊 TTS")
        tts_btn.setStyleSheet("""
            QPushButton {
                background-color: transparent;
                color: white;
                border: none;
                padding: 10px;
                text-align: left;
            }
            QPushButton:hover {
                background-color: #343541;
            }
        """)
        tts_btn.clicked.connect(lambda: self.main_tabs.setCurrentIndex(1))
        bottom_layout.addWidget(tts_btn)

        image_btn = QPushButton("🎨 Image Gen")
        image_btn.setStyleSheet("""
            QPushButton {
                background-color: transparent;
                color: white;
                border: none;
                padding: 10px;
                text-align: left;
            }
            QPushButton:hover {
                background-color: #343541;
            }
        """)
        image_btn.clicked.connect(lambda: self.main_tabs.setCurrentIndex(2))
        bottom_layout.addWidget(image_btn)

        sidebar_layout.addWidget(bottom_widget)

        # ========== MAIN CONTENT AREA ==========
        self.main_content = QWidget()
        main_layout.addWidget(self.sidebar)
        main_layout.addWidget(self.main_content, stretch=1)

        # Use splitter for responsive resize
        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.addWidget(self.sidebar)
        splitter.addWidget(self.main_content)
        splitter.setStretchFactor(0, 0)  # Sidebar doesn't stretch
        splitter.setStretchFactor(1, 1)   # Main content stretches

        # Clear and re-add with splitter
        main_layout.removeWidget(self.sidebar)
        main_layout.removeWidget(self.main_content)
        main_layout.addWidget(splitter)

        content_layout = QVBoxLayout(self.main_content)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(0)

        # Top tab bar (replaces old bottom tabs)
        self.main_tabs = QTabWidget()
        self.main_tabs.setStyleSheet("""
            QTabWidget {
                background-color: #343541;
            }
            QTabBar {
                background-color: #343541;
            }
            QTabBar::tab {
                background-color: transparent;
                color: #aaa;
                padding: 12px 24px;
                font-size: 14px;
            }
            QTabBar::tab:selected {
                background-color: #444654;
                color: white;
            }
            QTabBar::tab:hover {
                background-color: #3a3a42;
            }
        """)

        self.chat_panel = ChatPanel(self._get_config())
        self.chat_panel.conversation_changed.connect(self._auto_save_conversation)
        self.tts_panel = TTSPanel(self._get_config())
        self.image_panel = ImagePanel(self._get_config())

        self.main_tabs.addTab(self.chat_panel, "🤖 Agent Chat")
        self.main_tabs.addTab(self.tts_panel, "🔊 Text-to-Speech")
        self.main_tabs.addTab(self.image_panel, "🎨 Image Generation")

        # Tab bar should stretch
        self.main_tabs.setMovable(True)
        self.main_tabs.setTabsClosable(False)

        content_layout.addWidget(self.main_tabs, stretch=1)

        self._refresh_conv_list()

    def _setup_menu(self):
        """Setup menu bar."""
        menubar = self.menuBar()
        menubar.setStyleSheet("background-color: #343541; color: white;")

        # File menu
        file_menu = menubar.addMenu("File")

        new_action = QAction("New Chat", self)
        new_action.setShortcut("Ctrl+N")
        new_action.triggered.connect(self._new_conversation)
        file_menu.addAction(new_action)

        save_action = QAction("Save Conversation", self)
        save_action.setShortcut("Ctrl+S")
        save_action.triggered.connect(self._save_current_conv)
        file_menu.addAction(save_action)

        file_menu.addSeparator()

        exit_action = QAction("Exit", self)
        exit_action.triggered.connect(self.close)
        file_menu.addAction(exit_action)

        # Edit menu
        edit_menu = menubar.addMenu("Edit")

        clear_action = QAction("Clear Current Chat", self)
        clear_action.triggered.connect(self._clear_current_chat)
        edit_menu.addAction(clear_action)

        # Help menu
        help_menu = menubar.addMenu("Help")

        settings_action = QAction("Settings", self)
        settings_action.setShortcut("Ctrl+,")
        settings_action.triggered.connect(self._show_settings)
        help_menu.addAction(settings_action)

        about_action = QAction("About", self)
        about_action.triggered.connect(self._show_about)
        help_menu.addAction(about_action)

    def _get_config(self) -> dict:
        """Load configuration from YAML."""
        import yaml
        config_path = Path("config/config.yaml")
        if config_path.exists():
            with open(config_path, 'r') as f:
                return yaml.safe_load(f)
        return {}

    def _new_conversation(self):
        """Start a new conversation with fresh context."""
        import uuid
        self.current_conv_id = str(uuid.uuid4())[:8]
        self.current_messages = []
        # Reset agent to get a fresh conversation context
        self.chat_panel.reset_agent()
        self.chat_panel.clear_chat()
        self._refresh_conv_list()

    def _refresh_conv_list(self):
        """Refresh the conversation list in sidebar."""
        self.conv_list.clear()
        for conv in self.history.get_all():
            title = conv.get('title', 'New Chat')[:30]
            item = QListWidgetItem(title)
            item.setData(Qt.ItemDataRole.UserRole, conv.get('id'))
            self.conv_list.addItem(item)

    def _load_conversation(self, item):
        """Load a conversation from sidebar."""
        conv_id = item.data(Qt.ItemDataRole.UserRole)
        conv = self.history.conversations.get(conv_id)
        if conv:
            self.current_conv_id = conv_id
            self.current_messages = conv.get('messages', [])
            self.chat_panel.load_messages(self.current_messages)

    def _save_current_conv(self):
        """Save current conversation."""
        if self.current_conv_id:
            # Get messages from chat panel
            messages = self.chat_panel.get_messages()
            if messages:
                title = self.chat_panel.get_conversation_title()
                if not title:
                    title = "Chat " + datetime.now().strftime("%Y-%m-%d %H:%M")
                self.history.save(self.current_conv_id, title, messages)
                self._refresh_conv_list()
                QMessageBox.information(self, "Saved", "Conversation saved.")

    def _auto_save_conversation(self):
        """Auto-save current conversation without showing message."""
        if self.current_conv_id:
            messages = self.chat_panel.get_messages()
            if messages:
                title = self.chat_panel.get_conversation_title()
                if not title:
                    title = "Chat " + datetime.now().strftime("%Y-%m-%d %H:%M")
                self.history.save(self.current_conv_id, title, messages)
                self._refresh_conv_list()

    def _clear_current_chat(self):
        """Clear current chat without deleting history."""
        self._new_conversation()

    def _show_about(self):
        """Show about dialog."""
        QMessageBox.about(self, "About",
            "MiniMax Agent GUI\n"
            "Version 0.1.0\n\n"
            "Your personal AI agent with:\n"
            "• M2.7 Chat\n"
            "• Speech 2.8 TTS\n"
            "• Image-01 Generation")

    def _show_settings(self):
        """Show settings dialog."""
        dialog = SettingsDialog(self, self.config)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            # Reload config
            self.config = dialog.get_config()
            # Save to file
            import yaml
            config_path = Path("config/config.yaml")
            with open(config_path, 'w') as f:
                yaml.dump(self.config, f)
            QMessageBox.information(self, "Settings", "Settings saved. Restart the app for all changes to take effect.")

    def closeEvent(self, event):
        """Save before closing."""
        if self.current_conv_id and self.current_messages:
            self._save_current_conv()
        event.accept()


def main():
    """Main entry point."""
    app = QApplication(sys.argv)
    app.setApplicationName("MiniMax Agent GUI")

    app.setStyleSheet("""
        QMainWindow {
            background-color: #1e1e1e;
        }
    """)

    window = MainWindow()
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()