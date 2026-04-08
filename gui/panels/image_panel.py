"""Image Generation Panel - Using image-01 model."""

from pathlib import Path
from PyQt6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QTextEdit,
    QPushButton, QLabel, QComboBox, QProgressBar,
    QMessageBox, QFrame, QSizePolicy, QSpinBox, QCheckBox
)
from PyQt6.QtCore import Qt, QThread, pyqtSignal, pyqtSlot
from PyQt6.QtGui import QFont, QPixmap, QPalette, QColor

# Import MiniMax MCP client
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "mini_max_mcp"))
from mini_max_mcp.client import MiniMaxClient, image_sync


class ImageWorker(QThread):
    """Worker thread for image generation."""

    finished = pyqtSignal(str)  # Image file path
    error = pyqtSignal(str)
    progress = pyqtSignal(int)

    def __init__(self, config: dict, prompt: str, size: str, n: int, prompt_optimizer: bool, parent=None):
        super().__init__(parent)
        self.config = config
        self.prompt = prompt
        self.size = size
        self.n = n
        self.prompt_optimizer = prompt_optimizer

    def run(self):
        """Run image generation."""
        try:
            print(f"[DEBUG ImageWorker] Starting generation: prompt='{self.prompt[:50]}...', size={self.size}, n={self.n}, optimizer={self.prompt_optimizer}")
            self.progress.emit(10)

            minimax_config = self.config.get("minimax", {})
            api_key = minimax_config.get("api_key", "")
            api_base = minimax_config.get("api_base", "https://api.minimax.io")

            print(f"[DEBUG ImageWorker] API key configured: {bool(api_key and api_key != 'YOUR_API_KEY_HERE')}")

            if not api_key or api_key == "YOUR_API_KEY_HERE":
                self.error.emit("API key not configured. Please edit config/config.yaml")
                return

            self.progress.emit(20)

            # Generate unique output path
            import time
            output_path = Path("workspace") / f"image_{int(time.time())}.png"
            output_path.parent.mkdir(exist_ok=True)

            print(f"[DEBUG ImageWorker] Output path: {output_path}")
            self.progress.emit(30)

            print(f"[DEBUG ImageWorker] Calling image_sync()...")
            # Run sync image generation with n and prompt_optimizer
            success, result = image_sync(
                api_key, api_base, self.prompt, self.size, str(output_path),
                n=self.n, prompt_optimizer=self.prompt_optimizer
            )
            print(f"[DEBUG ImageWorker] image_sync returned: success={success}, result={result}")

            self.progress.emit(80)

            if success:
                self.progress.emit(100)
                self.finished.emit(result)
            else:
                self.error.emit(result)

        except Exception as e:
            self.error.emit(str(e))


class ImagePanel(QWidget):
    """Image generation interface using image-01."""
    
    def __init__(self, config: dict, parent=None):
        super().__init__(parent)
        self.config = config
        self.current_image = None
        self.worker = None
        self._setup_ui()
    
    def _setup_ui(self):
        """Setup image panel UI."""
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

        info_label = QLabel("🎨 Image Generation - image-01 - Token Plan Plus: 50 images/day")
        info_label.setFont(QFont("Segoe UI", 11, QFont.Weight.Bold))
        info_label.setStyleSheet("color: white;")
        info_layout.addWidget(info_label)

        self.images_count_label = QLabel("Images: 0 / 50")
        self.images_count_label.setStyleSheet("color: #aaa;")
        info_layout.addWidget(self.images_count_label)

        layout.addWidget(info_frame)

        # Prompt input
        prompt_label = QLabel("Image description:")
        prompt_label.setStyleSheet("color: #ccc; padding: 5px 0;")
        layout.addWidget(prompt_label)

        self.prompt_input = QTextEdit()
        self.prompt_input.setPlaceholderText(
            "Describe the image you want to generate...\n"
            "Example: A serene mountain landscape at sunset with a lake in the foreground"
        )
        self.prompt_input.setMaximumHeight(120)
        self.prompt_input.setStyleSheet("""
            QTextEdit {
                background-color: #404040;
                color: white;
                border: 1px solid #555;
                border-radius: 8px;
                padding: 10px;
            }
        """)
        layout.addWidget(self.prompt_input)

        # Size selection
        size_layout = QHBoxLayout()
        size_label = QLabel("Aspect Ratio:")
        size_label.setStyleSheet("color: #ccc;")
        size_layout.addWidget(size_label)

        self.size_combo = QComboBox()
        self.size_combo.addItems([
            "1:1 (1024x1024)",
            "16:9 (1792x1024)",
            "4:3 (1152x864)",
            "3:2 (1248x832)",
            "2:3 (832x1248)",
            "3:4 (864x1152)",
            "9:16 (1024x1792)",
            "21:9 (1344x576)",
        ])
        self.size_combo.setStyleSheet("""
            QComboBox {
                background-color: #404040;
                color: white;
                border: 1px solid #555;
                border-radius: 6px;
                padding: 8px;
            }
        """)
        size_layout.addWidget(self.size_combo, stretch=1)

        layout.addLayout(size_layout)

        # Number of images and prompt optimizer
        options_layout = QHBoxLayout()

        n_label = QLabel("Count:")
        n_label.setStyleSheet("color: #ccc;")
        options_layout.addWidget(n_label)

        self.n_spin = QSpinBox()
        self.n_spin.setRange(1, 9)
        self.n_spin.setValue(1)
        self.n_spin.setStyleSheet("""
            QSpinBox {
                background-color: #404040;
                color: white;
                border: 1px solid #555;
                border-radius: 6px;
                padding: 5px;
            }
        """)
        options_layout.addWidget(self.n_spin)

        self.optimizer_check = QCheckBox("Prompt Optimizer")
        self.optimizer_check.setStyleSheet("color: #ccc;")
        options_layout.addWidget(self.optimizer_check)
        options_layout.addStretch()

        layout.addLayout(options_layout)

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

        # Generate button
        self.generate_btn = QPushButton("🎨 Generate Image")
        self.generate_btn.setStyleSheet("""
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
        self.generate_btn.clicked.connect(self._generate)
        layout.addWidget(self.generate_btn)

        # Image preview
        preview_label = QLabel("Preview:")
        preview_label.setStyleSheet("color: #ccc; padding: 5px 0;")
        layout.addWidget(preview_label)

        self.image_label = QLabel()
        self.image_label.setMinimumHeight(300)
        self.image_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.image_label.setStyleSheet("""
            background-color: #2a2a2a;
            border: 2px dashed #555;
            border-radius: 8px;
        """)
        self.image_label.setText("No image generated yet")
        self.image_label.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        layout.addWidget(self.image_label, stretch=1)

        # Action buttons
        btn_layout = QHBoxLayout()

        self.save_btn = QPushButton("💾 Save")
        self.save_btn.setEnabled(False)
        self.save_btn.setStyleSheet("""
            QPushButton {
                background-color: #555;
                color: white;
                border: none;
                border-radius: 8px;
                padding: 10px 20px;
            }
            QPushButton:hover {
                background-color: #666;
            }
        """)
        self.save_btn.clicked.connect(self._save_image)
        btn_layout.addWidget(self.save_btn)

        self.open_btn = QPushButton("📂 Open Folder")
        self.open_btn.setEnabled(False)
        self.open_btn.setStyleSheet("""
            QPushButton {
                background-color: #555;
                color: white;
                border: none;
                border-radius: 8px;
                padding: 10px 20px;
            }
            QPushButton:hover {
                background-color: #666;
            }
        """)
        self.open_btn.clicked.connect(self._open_folder)
        btn_layout.addWidget(self.open_btn)

        layout.addLayout(btn_layout)

        # Status
        self.status_label = QLabel("")
        self.status_label.setStyleSheet("color: #888; padding: 5px;")
        layout.addWidget(self.status_label)
    
    def _generate(self):
        """Generate image from prompt."""
        prompt = self.prompt_input.toPlainText().strip()
        if not prompt:
            QMessageBox.warning(self, "No Prompt", "Please enter an image description.")
            return

        if self.worker and self.worker.isRunning():
            return

        self.generate_btn.setEnabled(False)
        self.progress_bar.setVisible(True)
        self.progress_bar.setValue(0)

        # Extract aspect_ratio from selection (e.g., "1:1 (1024x1024)" -> "1:1")
        size_text = self.size_combo.currentText()
        size = size_text.split(" ")[0]

        n = self.n_spin.value()
        prompt_optimizer = self.optimizer_check.isChecked()

        self.worker = ImageWorker(self.config, prompt, size, n, prompt_optimizer)
        self.worker.finished.connect(self._on_finished)
        self.worker.error.connect(self._on_error)
        self.worker.progress.connect(self._on_progress)
        self.worker.start()
    
    @pyqtSlot(str)
    def _on_finished(self, image_path: str):
        """Handle generation finished."""
        self.current_image = image_path
        
        # Update preview
        pixmap = QPixmap(image_path)
        if not pixmap.isNull():
            scaled = pixmap.scaled(
                self.image_label.width(), 
                self.image_label.height(),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation
            )
            self.image_label.setPixmap(scaled)
            self.image_label.setText("")
        
        self.progress_bar.setVisible(False)
        self.generate_btn.setEnabled(True)
        self.save_btn.setEnabled(True)
        self.open_btn.setEnabled(True)
        
        # Update count (placeholder)
        current = int(self.images_count_label.text().split(": ")[1].split("/")[0])
        self.images_count_label.setText(f"Images: {current + 1} / 50")
        
        self.status_label.setText(f"✅ Image saved: {image_path}")
    
    @pyqtSlot(str)
    def _on_error(self, error: str):
        """Handle generation error."""
        self.progress_bar.setVisible(False)
        self.generate_btn.setEnabled(True)
        QMessageBox.critical(self, "Generation Error", f"Image generation failed: {error}")
    
    @pyqtSlot(int)
    def _on_progress(self, value: int):
        """Handle progress update."""
        self.progress_bar.setValue(value)
    
    def _save_image(self):
        """Save image to custom location."""
        if not self.current_image:
            return
        
        from PyQt6.QtWidgets import QFileDialog
        path, _ = QFileDialog.getSaveFileName(
            self, "Save Image", "",
            "PNG Files (*.png);;JPEG Files (*.jpg);;All Files (*.*)"
        )
        if path:
            pixmap = QPixmap(self.current_image)
            pixmap.save(path)
            self.status_label.setText(f"✅ Saved to: {path}")
    
    def _open_folder(self):
        """Open workspace folder."""
        if not self.current_image:
            return
        
        folder = str(Path(self.current_image).parent)
        import os
        os.startfile(folder)