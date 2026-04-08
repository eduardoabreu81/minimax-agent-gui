"""TTS Panel - Text to Speech with Speech 2.8."""

import os
import asyncio
from pathlib import Path
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QTextEdit,
    QPushButton, QLabel, QComboBox, QSlider, QProgressBar,
    QMessageBox, QFrame
)
from PyQt6.QtCore import Qt, QThread, pyqtSignal, pyqtSlot
from PyQt6.QtGui import QFont

# Import MiniMax MCP client
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "mini_max_mcp"))
from mini_max_mcp.client import MiniMaxClient, tts_sync


class TTSWorker(QThread):
    """Worker thread for TTS synthesis."""
    
    finished = pyqtSignal(str)  # Audio file path
    error = pyqtSignal(str)
    progress = pyqtSignal(int)
    
    def __init__(self, config: dict, text: str, voice: str, speed: float, parent=None):
        super().__init__(parent)
        self.config = config
        self.text = text
        self.voice = voice
        self.speed = speed

    def run(self):
        """Run TTS synthesis."""
        try:
            self.progress.emit(10)

            minimax_config = self.config.get("minimax", {})
            api_key = minimax_config.get("api_key", "")
            api_base = minimax_config.get("api_base", "https://api.minimax.io")

            if not api_key or api_key == "YOUR_API_KEY_HERE":
                self.error.emit("API key not configured. Please edit config/config.yaml")
                return

            self.progress.emit(30)

            # Generate unique output path
            output_path = Path("workspace") / f"tts_{Path().stat().st_mtime}.mp3"
            output_path.parent.mkdir(exist_ok=True)

            self.progress.emit(50)

            # Run sync TTS
            success, result = tts_sync(api_key, api_base, self.text, self.voice, self.speed, str(output_path))

            self.progress.emit(80)

            if success:
                self.progress.emit(100)
                self.finished.emit(result)
            else:
                self.error.emit(result)

        except Exception as e:
            self.error.emit(str(e))


class TTSPanel(QWidget):
    """TTS interface using Speech 2.8."""
    
    def __init__(self, config: dict, parent=None):
        super().__init__(parent)
        self.config = config
        self.current_audio = None
        self.worker = None
        self._setup_ui()
    
    def _setup_ui(self):
        """Setup TTS panel UI."""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)

        # Info section
        info_frame = QFrame()
        info_frame.setStyleSheet("""
            background-color: #404040;
            border-radius: 10px;
            padding: 15px;
        """)
        info_layout = QVBoxLayout(info_frame)

        info_label = QLabel("🔊 Speech 2.8 TTS - Token Plan Plus: 4,000 chars/day")
        info_label.setFont(QFont("Segoe UI", 11, QFont.Weight.Bold))
        info_label.setStyleSheet("color: white;")
        info_layout.addWidget(info_label)

        self.chars_count_label = QLabel("Characters: 0 / 4,000")
        self.chars_count_label.setStyleSheet("color: #aaa;")
        info_layout.addWidget(self.chars_count_label)

        layout.addWidget(info_frame)

        # Text input
        text_label = QLabel("Text to synthesize:")
        text_label.setStyleSheet("color: #ccc; padding: 5px 0;")
        layout.addWidget(text_label)

        self.text_input = QTextEdit()
        self.text_input.setPlaceholderText("Enter text here (max 4,000 characters)...")
        self.text_input.setMaximumHeight(150)
        self.text_input.setStyleSheet("""
            QTextEdit {
                background-color: #404040;
                color: white;
                border: 1px solid #555;
                border-radius: 8px;
                padding: 10px;
            }
        """)
        self.text_input.textChanged.connect(self._update_char_count)
        layout.addWidget(self.text_input)

        # Voice selection
        voice_layout = QHBoxLayout()
        voice_label = QLabel("Voice:")
        voice_label.setStyleSheet("color: #ccc;")
        voice_layout.addWidget(voice_label)

        self.voice_combo = QComboBox()
        self.voice_combo.addItems([
            "male-qn-qingque", "female-nuo-yan",
            "male-qn-daxian", "female-yunxi",
            "male-qn-tiancai", "female-xiaotian"
        ])
        self.voice_combo.setCurrentText(self.config.get("tts", {}).get("voice", "male-qn-qingque"))
        self.voice_combo.setStyleSheet("""
            QComboBox {
                background-color: #404040;
                color: white;
                border: 1px solid #555;
                border-radius: 6px;
                padding: 8px;
            }
        """)
        voice_layout.addWidget(self.voice_combo, stretch=1)

        layout.addLayout(voice_layout)

        # Speed control
        speed_layout = QHBoxLayout()
        speed_label = QLabel("Speed:")
        speed_label.setStyleSheet("color: #ccc;")
        speed_layout.addWidget(speed_label)

        self.speed_slider = QSlider(Qt.Orientation.Horizontal)
        self.speed_slider.setMinimum(50)
        self.speed_slider.setMaximum(200)
        self.speed_slider.setValue(int(self.config.get("tts", {}).get("speed", 1.0) * 100))
        self.speed_slider.setTickPosition(QSlider.TickPosition.TicksBelow)
        self.speed_slider.setStyleSheet("""
            QSlider::groove:horizontal {
                border: 1px solid #555;
                height: 6px;
                background: #333;
                border-radius: 3px;
            }
            QSlider::handle:horizontal {
                background: #888;
                width: 14px;
                margin: -5px 0;
                border-radius: 7px;
            }
        """)
        speed_layout.addWidget(self.speed_slider, stretch=1)

        self.speed_label = QLabel("1.0x")
        self.speed_label.setStyleSheet("color: #aaa;")
        speed_layout.addWidget(self.speed_label)

        layout.addLayout(speed_layout)

        # Progress bar
        self.progress_bar = QProgressBar()
        self.progress_bar.setVisible(False)
        self.progress_bar.setStyleSheet("""
            QProgressBar {
                background-color: #333;
                border: none;
                border-radius: 6px;
                height: 12px;
            }
            QProgressBar::chunk {
                background-color: #7654d4;
                border-radius: 6px;
            }
        """)
        layout.addWidget(self.progress_bar)

        # Buttons
        btn_layout = QHBoxLayout()

        self.synthesize_btn = QPushButton("🔊 Synthesize")
        self.synthesize_btn.setStyleSheet("""
            QPushButton {
                background-color: #7654d4;
                color: white;
                border: none;
                border-radius: 8px;
                padding: 12px 24px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #8a66e0;
            }
        """)
        self.synthesize_btn.clicked.connect(self._synthesize)
        btn_layout.addWidget(self.synthesize_btn)

        self.play_btn = QPushButton("▶ Play")
        self.play_btn.setEnabled(False)
        self.play_btn.setStyleSheet("""
            QPushButton {
                background-color: #555;
                color: white;
                border: none;
                border-radius: 8px;
                padding: 12px 24px;
            }
            QPushButton:hover {
                background-color: #666;
            }
            QPushButton:disabled {
                background-color: #333;
                color: #666;
            }
        """)
        self.play_btn.clicked.connect(self._play_audio)
        btn_layout.addWidget(self.play_btn)

        self.save_btn = QPushButton("💾 Save")
        self.save_btn.setEnabled(False)
        self.save_btn.setStyleSheet("""
            QPushButton {
                background-color: #555;
                color: white;
                border: none;
                border-radius: 8px;
                padding: 12px 24px;
            }
            QPushButton:hover {
                background-color: #666;
            }
        """)
        self.save_btn.clicked.connect(self._save_audio)
        btn_layout.addWidget(self.save_btn)

        layout.addLayout(btn_layout)

        # Status
        self.status_label = QLabel("")
        self.status_label.setStyleSheet("color: #888; padding: 5px;")
        layout.addWidget(self.status_label)

        layout.addStretch()
    
    def _update_char_count(self):
        """Update character count display."""
        text = self.text_input.toPlainText()
        count = len(text)
        self.chars_count_label.setText(f"Characters: {count} / 4,000")
        
        if count > 4000:
            self.chars_count_label.setStyleSheet("color: red;")
        else:
            self.chars_count_label.setStyleSheet("color: #333;")
    
    def _synthesize(self):
        """Synthesize text to speech."""
        text = self.text_input.toPlainText().strip()
        if not text:
            QMessageBox.warning(self, "No Text", "Please enter text to synthesize.")
            return
        
        if len(text) > 4000:
            QMessageBox.warning(self, "Text Too Long", "Text exceeds 4,000 character limit.")
            return
        
        if self.worker and self.worker.isRunning():
            return
        
        self.synthesize_btn.setEnabled(False)
        self.progress_bar.setVisible(True)
        self.progress_bar.setValue(0)
        
        voice = self.voice_combo.currentText()
        speed = self.speed_slider.value() / 100.0
        
        self.worker = TTSWorker(self.config, text, voice, speed)
        self.worker.finished.connect(self._on_finished)
        self.worker.error.connect(self._on_error)
        self.worker.progress.connect(self._on_progress)
        self.worker.start()
    
    @pyqtSlot(str)
    def _on_finished(self, audio_path: str):
        """Handle synthesis finished."""
        self.current_audio = audio_path
        self.progress_bar.setVisible(False)
        self.synthesize_btn.setEnabled(True)
        self.play_btn.setEnabled(True)
        self.save_btn.setEnabled(True)
        self.status_label.setText(f"✅ Audio saved: {audio_path}")
    
    @pyqtSlot(str)
    def _on_error(self, error: str):
        """Handle synthesis error."""
        self.progress_bar.setVisible(False)
        self.synthesize_btn.setEnabled(True)
        QMessageBox.critical(self, "TTS Error", f"Synthesis failed: {error}")
    
    @pyqtSlot(int)
    def _on_progress(self, value: int):
        """Handle progress update."""
        self.progress_bar.setValue(value)
    
    def _play_audio(self):
        """Play current audio file."""
        if not self.current_audio:
            return
        
        # Placeholder - will add audio playback with QMediaPlayer
        self.status_label.setText(f"▶ Playing: {self.current_audio}")
    
    def _save_audio(self):
        """Save audio to custom location."""
        if not self.current_audio:
            return
        
        from PyQt6.QtWidgets import QFileDialog
        path, _ = QFileDialog.getSaveFileName(
            self, "Save Audio", "", 
            "Audio Files (*.mp3 *.wav *.m4a)"
        )
        if path:
            import shutil
            shutil.copy(self.current_audio, path)
            self.status_label.setText(f"✅ Saved to: {path}")