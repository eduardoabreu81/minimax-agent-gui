"""Media generation tools for the agent — image, music, TTS, video."""

import asyncio
from pathlib import Path
from typing import Any

from .base import Tool, ToolResult


class ImageGenerateTool(Tool):
    """Generate images from text prompts using MiniMax API."""

    def __init__(self, client, workspace_dir: str = "workspace"):
        self.client = client
        self.workspace_dir = Path(workspace_dir)

    @property
    def name(self) -> str:
        return "image_generate"

    @property
    def description(self) -> str:
        return (
            "Generate an image from a text prompt using MiniMax AI. "
            "Returns the path to the saved image file."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "prompt": {
                "type": "string",
                "description": "Text description of the image to generate. Be vivid and detailed.",
            },
            "aspect_ratio": {
                "type": "string",
                "description": "Aspect ratio. Options: 1:1, 16:9, 4:3, 3:2, 2:3, 3:4, 9:16",
                "default": "1:1",
            },
            "output_name": {
                "type": "string",
                "description": "Filename for the output image (e.g. 'hero.png'). Saved to workspace/",
                "default": "generated_image.png",
            },
        }

    async def execute(self, prompt: str, aspect_ratio: str = "1:1", output_name: str = "generations/images/generated_image.png") -> ToolResult:
        output_path = self.workspace_dir / output_name
        output_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            success, result = await asyncio.to_thread(
                self.client.image_generate,
                prompt=prompt,
                aspect_ratio=aspect_ratio,
                output_path=str(output_path),
            )
            if success:
                return ToolResult(success=True, content=f"Image saved to: {output_path}")
            return ToolResult(success=False, error=result)
        except Exception as e:
            return ToolResult(success=False, error=str(e))


class MusicGenerateTool(Tool):
    """Generate music from text prompts using MiniMax API."""

    def __init__(self, client, workspace_dir: str = "workspace"):
        self.client = client
        self.workspace_dir = Path(workspace_dir)

    @property
    def name(self) -> str:
        return "music_generate"

    @property
    def description(self) -> str:
        return (
            "Generate music from a text prompt or lyrics using MiniMax AI. "
            "Returns the path to the saved audio file."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "prompt": {
                "type": "string",
                "description": "Text description of the music style/mood. Optional if lyrics provided.",
                "default": "",
            },
            "lyrics": {
                "type": "string",
                "description": "Lyrics for the song. Optional if prompt provided.",
                "default": "",
            },
            "is_instrumental": {
                "type": "boolean",
                "description": "If true, generate instrumental music without vocals.",
                "default": False,
            },
            "output_name": {
                "type": "string",
                "description": "Filename for the output audio (e.g. 'soundtrack.mp3'). Saved to workspace/",
                "default": "generated_music.mp3",
            },
        }

    async def execute(self, prompt: str = "", lyrics: str = "", is_instrumental: bool = False, output_name: str = "generations/music/generated_music.mp3") -> ToolResult:
        output_path = self.workspace_dir / output_name
        output_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            success, result = await asyncio.to_thread(
                self.client.music_generate,
                prompt=prompt,
                lyrics=lyrics,
                is_instrumental=is_instrumental,
                output_path=str(output_path),
            )
            if success:
                return ToolResult(success=True, content=f"Music saved to: {output_path}")
            return ToolResult(success=False, error=result)
        except Exception as e:
            return ToolResult(success=False, error=str(e))


class TTSTool(Tool):
    """Text-to-speech synthesis using MiniMax API."""

    def __init__(self, client, workspace_dir: str = "workspace"):
        self.client = client
        self.workspace_dir = Path(workspace_dir)

    @property
    def name(self) -> str:
        return "tts_synthesize"

    @property
    def description(self) -> str:
        return (
            "Convert text to speech using MiniMax AI. "
            "Returns the path to the saved audio file."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "text": {
                "type": "string",
                "description": "Text to convert to speech.",
            },
            "voice": {
                "type": "string",
                "description": "Voice ID. Options: male-qn-qingque, female-shaonv, etc.",
                "default": "male-qn-qingque",
            },
            "speed": {
                "type": "number",
                "description": "Speech speed. Range 0.5 to 2.0",
                "default": 1.2,
            },
            "output_name": {
                "type": "string",
                "description": "Filename for the output audio (e.g. 'voice.mp3'). Saved to workspace/",
                "default": "tts_output.mp3",
            },
        }

    async def execute(self, text: str, voice: str = "male-qn-qingque", speed: float = 1.2, output_name: str = "generations/tts/tts_output.mp3") -> ToolResult:
        output_path = self.workspace_dir / output_name
        output_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            success, result = await asyncio.to_thread(
                self.client.tts_synthesize,
                text=text,
                voice=voice,
                speed=speed,
                output_path=str(output_path),
            )
            if success:
                return ToolResult(success=True, content=f"Audio saved to: {output_path}")
            return ToolResult(success=False, error=result)
        except Exception as e:
            return ToolResult(success=False, error=str(e))


class VideoGenerateTool(Tool):
    """Generate video from text prompts using MiniMax API."""

    def __init__(self, client, workspace_dir: str = "workspace"):
        self.client = client
        self.workspace_dir = Path(workspace_dir)

    @property
    def name(self) -> str:
        return "video_generate"

    @property
    def description(self) -> str:
        return (
            "Generate a video from a text prompt using MiniMax AI. "
            "Returns the path to the saved video file."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "prompt": {
                "type": "string",
                "description": "Text description of the video to generate. Be vivid and detailed.",
            },
            "model": {
                "type": "string",
                "description": "Model to use. Options: MiniMax-Hailuo-2.3",
                "default": "MiniMax-Hailuo-2.3",
            },
            "output_name": {
                "type": "string",
                "description": "Filename for the output video (e.g. 'scene.mp4'). Saved to workspace/",
                "default": "generated_video.mp4",
            },
        }

    async def execute(self, prompt: str, model: str = "MiniMax-Hailuo-2.3", output_name: str = "generations/videos/generated_video.mp4") -> ToolResult:
        output_path = self.workspace_dir / output_name
        output_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            success, result = await asyncio.to_thread(
                self.client.video_generate,
                prompt=prompt,
                model=model,
                output_path=str(output_path),
            )
            if success:
                return ToolResult(success=True, content=f"Video saved to: {output_path}")
            return ToolResult(success=False, error=result)
        except Exception as e:
            return ToolResult(success=False, error=str(e))
