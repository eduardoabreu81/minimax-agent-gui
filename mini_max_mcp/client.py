"""MiniMax API Client for TTS, Image, Music, and Video Generation."""

import httpx
import asyncio
import base64
import json
import logging
import requests
from pathlib import Path
from typing import Optional, Tuple

_logger = logging.getLogger(__name__)


# MiniMax API Error Code definitions
MINIMAX_ERROR_CODES = {
    1000: ("unknown error", "Please retry your requests later."),
    1001: ("request timeout", "Please retry your requests later."),
    1002: ("rate limit", "Please retry your requests later."),
    1004: ("not authorized", "Please check your API key and make sure it is correct and active."),
    1008: ("insufficient balance", "Please check your account balance."),
    1024: ("internal error", "Please retry your requests later."),
    1026: ("input new_sensitive", "Please change your input content."),
    1027: ("output new_sensitive", "Please change your input content."),
    1033: ("system error", "Please retry your requests later."),
    1039: ("token limit", "Please retry your requests later."),
    1041: ("conn limit", "Please contact us if the issue persists."),
    1042: ("invisible character ratio limit", "Please check your input content for invisible or illegal characters."),
    1043: ("asr similarity check failed", "Please check file_id and text_validation."),
    1044: ("clone prompt similarity check failed", "Please check clone prompt audio and prompt words."),
    2013: ("invalid params", "Please check the request parameters."),
    20132: ("invalid samples or voice_id", "Please check your file_id (in Voice Cloning API), voice_id (in T2A v2 API) and contact us if the issue persists."),
    2037: ("voice duration too short/long", "Please adjust the duration of your file_id for voice clone."),
    2039: ("voice clone voice id duplicate", "Please check the voice_id to ensure no duplication with the existing ones."),
    2042: ("no access to voice_id", "Please check whether you are the creator of this voice_id and contact us if the issue persists."),
    2045: ("rate growth limit", "Please avoid sudden increases and decreases in requests."),
    2048: ("prompt audio too long", "Please adjust the duration of the prompt_audio file (< 8s)."),
    2049: ("invalid api key", "Please check your API key and make sure it is correct and active."),
    2056: ("usage limit exceeded", "Please wait for the resource release in the next 5-hour window."),
}

# MiniMax TTS Voice IDs (from API docs)
TTS_VOICE_IDS = [
    # English voices
    "English_Graceful_Lady", "English_Lyrical_Voice", "English_Classic_Man",
    "English_Magnetic_Voice", "English_Deep_Male", "English_Standard_Male",
    # Chinese (Mandarin) voices
    "Chinese (Mandarin)_Lyrical_Voice", "Chinese (Mandarin)_Warm_Female",
    "Chinese (Mandarin)_Magnetic_Voice", "Chinese (Mandarin)_Broadcast_Female",
    # More voices available...
    "male-qn-qingque", "female-nuo-yan", "male-qn-daxian",
    "female-yunxi", "male-qn-tiancai", "female-xiaotian"
]

# TTS Emotions
TTS_EMOTIONS = ["happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm", "fluent", "whisper"]

# Audio formats
AUDIO_FORMATS = ["mp3", "pcm", "flac", "wav"]
AUDIO_SAMPLE_RATES = [8000, 16000, 22050, 24000, 32000, 44100]


def get_error_details(status_code: int) -> Tuple[str, str]:
    """Get error message and solution for a MiniMax API error code."""
    if status_code in MINIMAX_ERROR_CODES:
        return MINIMAX_ERROR_CODES[status_code]
    return ("unknown error", "Please retry your requests later.")


def format_api_error(status_code: int, default_msg: str = "") -> str:
    """Format an API error with code, message, and solution."""
    error_msg, solution = get_error_details(status_code)
    return f"[Error {status_code}] {error_msg}. {solution}"


# Synchronous client for use in Qt threads (uses requests, not httpx)
class MiniMaxSyncClient:
    """Synchronous client for MiniMax API using requests (thread-safe)."""

    def __init__(self, api_key: str, api_base: str = "https://api.minimax.io"):
        self.api_key = api_key
        self.api_base = api_base
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        })

    def close(self):
        """Close HTTP session."""
        self.session.close()

    def _post_json(self, endpoint: str, data: dict, timeout: float = 120.0) -> Tuple[bool, dict]:
        """POST JSON and return (success, result_dict or error_dict)."""
        url = f"{self.api_base}{endpoint}"
        _logger.debug(f"[_post_json] POST {url} (timeout={timeout}s)")
        try:
            resp = self.session.post(url, json=data, timeout=timeout)
            _logger.debug(f"[_post_json] Response status={resp.status_code}, headers={dict(resp.headers)}, len={len(resp.content)}")
            resp.raise_for_status()
            try:
                json_data = resp.json()
                _logger.debug(f"[_post_json] JSON parsed OK, keys={list(json_data.keys())[:10]}")
                return True, json_data
            except Exception as json_err:
                _logger.error(f"[_post_json] JSON parse failed: {json_err}. Raw text (first 500 chars): {resp.text[:500]}")
                # Save raw response for inspection
                debug_path = Path("workspace/logs/last_error_response.txt")
                debug_path.parent.mkdir(parents=True, exist_ok=True)
                debug_path.write_text(resp.text, encoding="utf-8")
                return False, {"status_msg": f"Invalid JSON response: {json_err}"}
        except requests.HTTPError as e:
            _logger.error(f"[_post_json] HTTP error: {e}")
            try:
                err_body = e.response.json()
            except Exception:
                err_body = {"status_msg": e.response.text}
            return False, err_body
        except Exception as e:
            _logger.exception(f"[_post_json] Exception: {e}")
            return False, {"status_msg": str(e)}

    def _get_binary(self, url: str, timeout: float = 120.0) -> Tuple[bool, bytes | str]:
        """GET binary data from URL."""
        try:
            resp = self.session.get(url, timeout=timeout)
            resp.raise_for_status()
            return True, resp.content
        except Exception as e:
            return False, str(e)

    def image_generate(
        self,
        prompt: str,
        model: str = "image-01",
        aspect_ratio: str = "1:1",
        width: int = None,
        height: int = None,
        output_path: str = "workspace/image.png",
        n: int = 1,
        prompt_optimizer: bool = False,
        watermark: bool = False,
        seed: int = None,
        subject_reference: Optional[list] = None,
    ) -> Tuple[bool, str]:
        """Generate image from text prompt (sync).

        Both T2I and i2i hit the same ``/v1/image_generation`` endpoint —
        i2i is enabled by passing ``subject_reference`` (typically
        ``[{"type": "character", "image_file": "<url or base64>"}]``) and
        using ``model="image-01-live"``. T2I uses ``model="image-01"``.
        """
        data = {
            "model": model,
            "prompt": prompt,
            "response_format": "base64",
            "n": n,
            "prompt_optimizer": prompt_optimizer
        }
        # Use width/height if provided, otherwise aspect_ratio
        if width and height:
            data["width"] = width
            data["height"] = height
        else:
            data["aspect_ratio"] = aspect_ratio
        if watermark:
            data["aigc_watermark"] = True
        if seed is not None:
            data["seed"] = seed
        if subject_reference:
            data["subject_reference"] = subject_reference

        success, result = self._post_json("/v1/image_generation", data)
        if not success:
            msg = result.get("status_msg", "Unknown error")
            code = result.get("status_code", 0)
            return False, format_api_error(code, msg) if code else msg

        if "base_resp" in result:
            status_code = result["base_resp"].get("status_code", 0)
            if status_code != 0:
                return False, format_api_error(status_code, result["base_resp"].get("status_msg", ""))

        if "data" in result:
            if "image_base64" in result["data"]:
                images = result["data"]["image_base64"]
            elif "image_urls" in result["data"]:
                image_urls = result["data"]["image_urls"]
                if image_urls:
                    ok, content = self._get_binary(image_urls[0])
                    if not ok:
                        return False, content
                    images = [base64.b64encode(content).decode()]
            else:
                return False, "No image data in response"

            if images:
                Path(output_path).parent.mkdir(parents=True, exist_ok=True)
                # Save all generated images
                saved_paths = []
                for i, img_b64 in enumerate(images):
                    image_bytes = base64.b64decode(img_b64)
                    if len(images) == 1:
                        path = output_path
                    else:
                        stem = Path(output_path).stem
                        suffix = Path(output_path).suffix
                        path = str(Path(output_path).with_name(f"{stem}_{i+1}{suffix}"))
                    with open(path, "wb") as f:
                        f.write(image_bytes)
                    saved_paths.append(path)
                return True, saved_paths[0] if len(saved_paths) == 1 else saved_paths

        return False, "Invalid response format"

    def image_variations(
        self,
        image_path: str,
        prompt: str = "",
        model: str = "image-01",
        aspect_ratio: str = "1:1",
        width: int = None,
        height: int = None,
        output_path: str = "workspace/image_variation.png",
        n: int = 1,
        prompt_optimizer: bool = False,
        watermark: bool = False,
        seed: int = None
    ) -> Tuple[bool, str]:
        """Generate image variations from reference image (Image-to-Image)."""
        with open(image_path, "rb") as f:
            image_base64 = base64.b64encode(f.read()).decode()

        ext = Path(image_path).suffix.lower()
        mime_types = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'}
        mime_type = mime_types.get(ext, 'image/png')
        image_data_url = f"data:{mime_type};base64,{image_base64}"

        data = {
            "model": model,
            "prompt": prompt or "Create a variation of this image",
            "response_format": "base64",
            "n": n,
            "prompt_optimizer": prompt_optimizer,
            "subject_reference": [
                {
                    "type": "character",
                    "image_file": image_data_url
                }
            ]
        }
        if width and height:
            data["width"] = width
            data["height"] = height
        else:
            data["aspect_ratio"] = aspect_ratio
        if watermark:
            data["aigc_watermark"] = True
        if seed is not None:
            data["seed"] = seed

        success, result = self._post_json("/v1/image_generation", data)
        if not success:
            msg = result.get("status_msg", "Unknown error")
            code = result.get("status_code", 0)
            return False, format_api_error(code, msg) if code else msg

        if "base_resp" in result:
            status_code = result["base_resp"].get("status_code", 0)
            if status_code != 0:
                return False, format_api_error(status_code, result["base_resp"].get("status_msg", ""))

        if "data" in result:
            if "image_base64" in result["data"]:
                images = result["data"]["image_base64"]
            elif "image_urls" in result["data"]:
                image_urls = result["data"]["image_urls"]
                if image_urls:
                    ok, content = self._get_binary(image_urls[0])
                    if not ok:
                        return False, content
                    images = [base64.b64encode(content).decode()]
            else:
                return False, "No image data in response"

            if images:
                Path(output_path).parent.mkdir(parents=True, exist_ok=True)
                saved_paths = []
                for i, img_b64 in enumerate(images):
                    image_bytes = base64.b64decode(img_b64)
                    if len(images) == 1:
                        path = output_path
                    else:
                        stem = Path(output_path).stem
                        suffix = Path(output_path).suffix
                        path = str(Path(output_path).with_name(f"{stem}_{i+1}{suffix}"))
                    with open(path, "wb") as f:
                        f.write(image_bytes)
                    saved_paths.append(path)
                return True, saved_paths[0] if len(saved_paths) == 1 else saved_paths

        return False, "Invalid response format"

    def tts_synthesize(
        self,
        text: str,
        voice: str = "male-qn-qingque",
        speed: float = 1.0,
        model: str = "speech-2.8-turbo",
        output_path: str = "workspace/tts_output.mp3"
    ) -> Tuple[bool, str]:
        """Synthesize speech from text (sync)."""
        data = {
            "model": model,
            "text": text,
            "voice_setting": {"voice_id": voice, "speed": speed},
            "output_format": {"container": "mp3", "sample_rate": 32000, "bitrate": 128000}
        }
        try:
            resp = self.session.post(f"{self.api_base}/v1/t2a_v2", json=data, timeout=120.0)
            resp.raise_for_status()
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, "wb") as f:
                f.write(resp.content)
            return True, output_path
        except requests.HTTPError as e:
            return False, f"HTTP Error {e.response.status_code}: {e.response.text}"
        except Exception as e:
            return False, str(e)

    # ============ Speech (full MiniMax APIs) ============
    # The legacy ``tts_synthesize`` above is kept for MCP tool compatibility.
    # New endpoints below mirror the four sub-modes in TAURI_SPEC.md §6b.

    def _get_json(self, endpoint: str, params: dict | None = None, timeout: float = 60.0) -> Tuple[bool, dict]:
        """GET JSON. Returns (success, payload). Same error envelope as _post_json."""
        url = f"{self.api_base}{endpoint}"
        try:
            resp = self.session.get(url, params=params, timeout=timeout)
            resp.raise_for_status()
            return True, resp.json()
        except requests.HTTPError as e:
            try:
                err_body = e.response.json()
            except Exception:
                err_body = {"status_msg": e.response.text}
            return False, err_body
        except Exception as e:
            return False, {"status_msg": str(e)}

    def speech_synthesize_v2(
        self,
        text: str,
        model: str = "speech-2.8-hd",
        voice_id: str = "English_Graceful_Lady",
        speed: float = 1.0,
        vol: float = 1.0,
        pitch: int = 0,
        emotion: str = "",
        audio_setting: Optional[dict] = None,
        voice_modify: Optional[dict] = None,
        language_boost: str = "auto",
        output_format: str = "hex",
    ) -> Tuple[bool, dict]:
        """POST /v1/t2a_v2 — full T2A sync with voice_setting, voice_modify,
        language_boost. Returns the parsed JSON envelope (hex-encoded audio
        in ``data.audio``). For files on disk, the FastAPI layer decodes
        the hex and writes the bytes.
        """
        voice_setting = {
            "voice_id": voice_id,
            "speed": speed,
            "vol": vol,
            "pitch": pitch,
        }
        if emotion:
            voice_setting["emotion"] = emotion

        data: dict = {
            "model": model,
            "text": text,
            "stream": False,
            "language_boost": language_boost,
            "output_format": output_format,
            "voice_setting": voice_setting,
        }
        if audio_setting is not None:
            data["audio_setting"] = audio_setting
        if voice_modify is not None:
            data["voice_modify"] = voice_modify

        success, result = self._post_json("/v1/t2a_v2", data, timeout=180.0)
        if not success:
            return False, result
        if "base_resp" in result and result["base_resp"].get("status_code", 0) != 0:
            return False, {
                "error": result["base_resp"].get("status_msg", "T2A failed"),
                "status_code": result["base_resp"].get("status_code"),
            }
        return True, result

    def speech_synthesize_async_create(
        self,
        text: str,
        model: str = "speech-2.8-hd",
        voice_id: str = "English_Graceful_Lady",
        speed: float = 1.0,
        vol: float = 1.0,
        pitch: int = 0,
        audio_setting: Optional[dict] = None,
        voice_modify: Optional[dict] = None,
        language_boost: str = "auto",
    ) -> Tuple[bool, dict]:
        """POST /v1/t2a_async_v2 — kick off an async long-text T2A task.
        Returns ``{task_id, file_id, usage_characters, task_token, base_resp}``.
        Poll ``speech_synthesize_async_query`` to know when it's done.
        """
        voice_setting = {
            "voice_id": voice_id,
            "speed": speed,
            "vol": vol,
            "pitch": pitch,
        }
        data: dict = {
            "model": model,
            "text": text,
            "voice_setting": voice_setting,
            "language_boost": language_boost,
        }
        if audio_setting is not None:
            data["audio_setting"] = audio_setting
        if voice_modify is not None:
            data["voice_modify"] = voice_modify

        success, result = self._post_json("/v1/t2a_async_v2", data, timeout=180.0)
        if not success:
            return False, result
        if "base_resp" in result and result["base_resp"].get("status_code", 0) != 0:
            return False, {
                "error": result["base_resp"].get("status_msg", "Async T2A failed"),
                "status_code": result["base_resp"].get("status_code"),
            }
        return True, result

    def speech_synthesize_async_query(self, task_id: int) -> Tuple[bool, dict]:
        """GET /v1/query/t2a_async_query_v2 — poll task status.
        Returns ``{task_id, status, file_id, base_resp}`` where status is one
        of ``processing | success | failed | expired``.
        """
        success, result = self._get_json(
            "/v1/query/t2a_async_query_v2", params={"task_id": task_id}, timeout=30.0
        )
        if not success:
            return False, result
        if "base_resp" in result and result["base_resp"].get("status_code", 0) != 0:
            return False, {
                "error": result["base_resp"].get("status_msg", "Async query failed"),
                "status_code": result["base_resp"].get("status_code"),
            }
        return True, result

    def speech_voices_list(self, voice_type: str = "all") -> Tuple[bool, dict]:
        """POST /v1/get_voice — list system + cloned + generated voices.

        Returns the envelope with three arrays (system_voice, voice_cloning,
        voice_generation). Note: cloned voices are inactive until used once.
        """
        data = {"voice_type": voice_type}
        success, result = self._post_json("/v1/get_voice", data, timeout=60.0)
        if not success:
            return False, result
        if "base_resp" in result and result["base_resp"].get("status_code", 0) != 0:
            return False, {
                "error": result["base_resp"].get("status_msg", "List voices failed"),
                "status_code": result["base_resp"].get("status_code"),
            }
        return True, result

    def speech_voice_clone(
        self,
        file_id: int,
        voice_id: str,
        clone_prompt: Optional[dict] = None,
        text: str = "",
        model: str = "",
        language_boost: str = "",
        need_noise_reduction: bool = False,
        need_volume_normalization: bool = False,
        text_validation: str = "",
        accuracy: float = 0.0,
    ) -> Tuple[bool, dict]:
        """POST /v1/voice_clone — register a cloned voice.

        file_id comes from ``speech_file_upload`` with purpose=voice_clone.
        voice_id: 8-256 chars, must start with a letter, [A-Za-z0-9_-], no
        trailing -/_.
        Sample rules: mp3/m4a/wav, 10s-5min, ≤20MB. Errors: 2038 = no cloning
        permission (account not verified).
        """
        data: dict = {
            "file_id": file_id,
            "voice_id": voice_id,
            "need_noise_reduction": need_noise_reduction,
            "need_volume_normalization": need_volume_normalization,
        }
        if clone_prompt:
            data["clone_prompt"] = clone_prompt
        if text:
            data["text"] = text
        if model:
            data["model"] = model
        if language_boost:
            data["language_boost"] = language_boost
        if text_validation:
            data["text_validation"] = text_validation
        if accuracy > 0:
            data["accuracy"] = accuracy

        success, result = self._post_json("/v1/voice_clone", data, timeout=120.0)
        if not success:
            return False, result
        if "base_resp" in result and result["base_resp"].get("status_code", 0) != 0:
            return False, {
                "error": result["base_resp"].get("status_msg", "Voice clone failed"),
                "status_code": result["base_resp"].get("status_code"),
            }
        return True, result

    def speech_voice_design(
        self,
        prompt: str,
        preview_text: str,
        voice_id: str = "",
    ) -> Tuple[bool, dict]:
        """POST /v1/voice_design — design a custom voice from text.

        Returns ``{voice_id, trial_audio (hex), base_resp}``. voice_id is
        auto-generated when not provided.
        """
        data: dict = {"prompt": prompt, "preview_text": preview_text}
        if voice_id:
            data["voice_id"] = voice_id
        success, result = self._post_json("/v1/voice_design", data, timeout=120.0)
        if not success:
            return False, result
        if "base_resp" in result and result["base_resp"].get("status_code", 0) != 0:
            return False, {
                "error": result["base_resp"].get("status_msg", "Voice design failed"),
                "status_code": result["base_resp"].get("status_code"),
            }
        return True, result

    def speech_voice_delete(self, voice_type: str, voice_id: str) -> Tuple[bool, dict]:
        """POST /v1/delete_voice — delete a cloned or generated voice.

        voice_type ∈ {"voice_cloning", "voice_generation"}. System voices
        cannot be deleted (the API rejects with 2013).
        """
        data = {"voice_type": voice_type, "voice_id": voice_id}
        success, result = self._post_json("/v1/delete_voice", data, timeout=60.0)
        if not success:
            return False, result
        if "base_resp" in result and result["base_resp"].get("status_code", 0) != 0:
            return False, {
                "error": result["base_resp"].get("status_msg", "Voice delete failed"),
                "status_code": result["base_resp"].get("status_code"),
            }
        return True, result

    def speech_file_upload(
        self,
        file_path: str,
        purpose: str = "voice_clone",
    ) -> Tuple[bool, dict]:
        """POST /v1/files/upload (multipart) — upload a file with a purpose.

        purpose ∈ {"voice_clone", "prompt_audio", "t2a_async_input",
        "video_understanding"}. Returns the file envelope including
        ``file_id`` (used by voice_clone and asr queries).
        """
        url = f"{self.api_base}/v1/files/upload"
        try:
            with open(file_path, "rb") as f:
                files = {"file": (Path(file_path).name, f)}
                data = {"purpose": purpose}
                resp = self.session.post(url, files=files, data=data, timeout=120.0)
                resp.raise_for_status()
                return True, resp.json()
        except requests.HTTPError as e:
            try:
                err_body = e.response.json()
            except Exception:
                err_body = {"status_msg": e.response.text}
            return False, err_body
        except Exception as e:
            return False, {"status_msg": str(e)}

    # ============ Music Generation ============

    def music_generate(
        self,
        prompt: str = "",
        lyrics: str = "",
        model: str = "music-2.6",
        output_path: str = "workspace/music_output.mp3",
        audio_setting: Optional[dict] = None,
        lyrics_optimizer: bool = False,
        is_instrumental: bool = False,
        audio_url: str = "",
        audio_base64: str = "",
        cover_feature_id: str = "",
        output_format: str = "hex",
        timeout: float = 300.0,
    ) -> Tuple[bool, dict]:
        """Generate music from prompt and lyrics (sync).

        Returns:
            ``(True, {"output_path": str, "extra_info": dict, "trace_id": str})``
            on success, or ``(False, {"error": str, "status_code": int | None})``
            on failure. The structured dict lets callers propagate
            ``extra_info`` (duration, sample_rate, channels, bitrate, size)
            and the ``trace_id`` back to the frontend without a second
            round-trip.
        """
        # Phase 1 client-side guard: cover-related params must not be sent
        # together with non-cover models. The backend enforces the same
        # rule (defense in depth) so the user sees a clean 400 instead
        # of a cryptic 2013 from the API.
        if cover_feature_id and audio_url:
            return False, {
                "error": (
                    "cover_feature_id and audio_url are mutually exclusive "
                    "in the music-cover flow."
                ),
                "status_code": None,
            }
        if cover_feature_id and audio_base64:
            return False, {
                "error": (
                    "cover_feature_id and audio_base64 are mutually exclusive "
                    "in the music-cover flow."
                ),
                "status_code": None,
            }
        if audio_url and audio_base64:
            return False, {
                "error": (
                    "audio_url and audio_base64 are mutually exclusive — "
                    "pass exactly one for music-cover."
                ),
                "status_code": None,
            }

        data: dict = {"model": model, "output_format": output_format}
        if prompt:
            data["prompt"] = prompt
        if lyrics:
            data["lyrics"] = lyrics
        if audio_setting:
            data["audio_setting"] = audio_setting
        if lyrics_optimizer:
            data["lyrics_optimizer"] = True
        if is_instrumental:
            data["is_instrumental"] = True
        if audio_url:
            data["audio_url"] = audio_url
        if audio_base64:
            data["audio_base64"] = audio_base64
        if cover_feature_id:
            data["cover_feature_id"] = cover_feature_id

        _logger.debug(f"music_generate] Request: {data}")
        success, result = self._post_json("/v1/music_generation", data, timeout=timeout)
        _logger.info(f"[Music] _post_json returned: success={success}")
        if not success:
            msg = result.get("status_msg", "Unknown error")
            code = result.get("status_code", 0)
            _logger.error(f"[Music] _post_json failed: {msg}")
            return False, {
                "error": format_api_error(code, msg) if code else msg,
                "status_code": code or None,
            }

        # Log response metadata only (avoid printing multi-MB hex strings)
        _logger.info(f"[Music] Response keys: {list(result.keys())}")
        if "data" in result and isinstance(result["data"], dict):
            data_info = {k: (f"<string:{len(v)} chars>" if isinstance(v, str) and len(v) > 500 else v) for k, v in result["data"].items()}
            _logger.info(f"[Music] Response data (truncated): {data_info}")

        # Save response for potential retry (debug aid; trimmed — hex
        # payloads can be 8MB+, so we don't write them to disk anymore
        # to keep workspace/ clean).
        # Commented out to avoid filling disk; uncomment if needed.
        # last_resp_path = script_dir / "workspace" / ".last_music_response.json"
        # last_resp_path.parent.mkdir(parents=True, exist_ok=True)
        # with open(last_resp_path, "w", encoding="utf-8") as f:
        #     json.dump(result, f, ensure_ascii=False, indent=2)

        if "base_resp" in result:
            status_code = result["base_resp"].get("status_code", 0)
            if status_code != 0:
                err_msg = result["base_resp"].get("status_msg", "")
                _logger.error(f"[Music] base_resp error: {status_code} - {err_msg}")
                return False, {
                    "error": format_api_error(status_code, err_msg),
                    "status_code": status_code,
                }

        extra_info = result.get("extra_info") or {}
        trace_id = result.get("trace_id", "")

        if "data" in result:
            _logger.info(f"[Music] Response has 'data' key: {list(result['data'].keys())}")
            audio_data = result["data"].get("audio", "")
            status = result["data"].get("status", 0)
            _logger.info(f"[Music] status={status}, audio_data_len={len(audio_data)}")
            if status == 1:
                _logger.warning("[Music] API returned status=1 (in progress)")
                return False, {
                    "error": "Music still generating (status=1). Please retry in a moment.",
                    "status_code": None,
                }
            if audio_data:
                _logger.info(f"[Music] Audio data received: {len(audio_data)} chars, format={output_format}")
                if output_format == "hex":
                    try:
                        _logger.info("[Music] Decoding hex...")
                        audio_bytes = bytes.fromhex(audio_data)
                        _logger.info(f"[Music] Hex decoded: {len(audio_bytes)} bytes")
                    except ValueError:
                        _logger.warning("[Music] Hex decode failed, trying base64...")
                        audio_bytes = base64.b64decode(audio_data)
                        _logger.info(f"[Music] Base64 decoded: {len(audio_bytes)} bytes")
                else:
                    _logger.info(f"[Music] Downloading from URL: {audio_data[:120]}...")
                    ok, content = self._get_binary(audio_data)
                    if not ok:
                        return False, {
                            "error": f"Download failed: {content}",
                            "status_code": None,
                        }
                    audio_bytes = content
                    _logger.info(f"[Music] Downloaded {len(audio_bytes)} bytes")

                _logger.info(f"[Music] Writing to {output_path}...")
                Path(output_path).parent.mkdir(parents=True, exist_ok=True)
                with open(output_path, "wb") as f:
                    f.write(audio_bytes)
                _logger.info(f"[Music] File written successfully: {output_path}")
                return True, {
                    "output_path": str(output_path),
                    "extra_info": extra_info,
                    "trace_id": trace_id,
                }
            else:
                _logger.warning("[Music] No audio_data in response data")
        else:
            _logger.warning(f"[Music] No 'data' key in response. Keys: {list(result.keys())}")

        return False, {
            "error": f"No audio data in response. Raw: {result}",
            "status_code": None,
        }

    def music_cover_preprocess(
        self,
        audio_url: str = "",
        audio_base64: str = ""
    ) -> Tuple[bool, dict]:
        """Preprocess reference audio for cover generation (sync)."""
        data: dict = {"model": "music-cover"}
        if audio_url:
            data["audio_url"] = audio_url
        if audio_base64:
            data["audio_base64"] = audio_base64

        success, result = self._post_json("/v1/music_cover_preprocess", data)
        if not success:
            return False, {"error": result.get("status_msg", "Preprocess failed")}

        if "base_resp" in result:
            status_code = result["base_resp"].get("status_code", 0)
            if status_code != 0:
                return False, {"error": format_api_error(status_code, result["base_resp"].get("status_msg", ""))}

        return True, result

    def lyrics_generate(
        self,
        mode: str = "write_full_song",
        prompt: str = "",
        lyrics: str = "",
        title: str = "",
    ) -> Tuple[bool, dict]:
        """Generate or refine song lyrics (sync).

        Two modes (per MiniMax spec):
          - ``write_full_song``: prompt = theme/brief, lyrics ignored.
          - ``edit``: prompt = editing instructions, lyrics = source lyrics
            to be refined.

        Returns the parsed API payload, which includes ``song_title``,
        ``style_tags`` (comma-separated string), ``lyrics`` (with 14
        structure tags), and ``trace_id``.
        """
        if mode not in ("write_full_song", "edit"):
            return False, {"error": f"Invalid mode: {mode!r}. Must be 'write_full_song' or 'edit'."}
        data: dict = {"mode": mode, "prompt": prompt}
        if lyrics:
            data["lyrics"] = lyrics
        if title:
            data["title"] = title

        success, result = self._post_json("/v1/lyrics_generation", data)
        if not success:
            return False, {"error": result.get("status_msg", "Lyrics generation failed")}

        if "base_resp" in result:
            status_code = result["base_resp"].get("status_code", 0)
            if status_code != 0:
                return False, {
                    "error": format_api_error(
                        status_code, result["base_resp"].get("status_msg", "")
                    ),
                    "status_code": status_code,
                }

        return True, result

    # ============ Video Generation ============

    def video_generate(
        self,
        prompt: str,
        model: str = "MiniMax-Hailuo-2.3",
        first_frame_image: str = "",
        last_frame_image: str = "",
        subject_reference: Optional[list] = None,
        duration: int = 6,
        resolution: str = "768P",
        prompt_optimizer: bool = True,
        fast_pretreatment: bool = False
    ) -> Tuple[bool, str]:
        """Create a video generation task (sync)."""
        data: dict = {
            "model": model,
            "prompt": prompt,
            "duration": duration,
            "resolution": resolution,
            "prompt_optimizer": prompt_optimizer,
            "fast_pretreatment": fast_pretreatment
        }
        if first_frame_image:
            data["first_frame_image"] = first_frame_image
        if last_frame_image:
            data["last_frame_image"] = last_frame_image
        if subject_reference:
            data["subject_reference"] = subject_reference

        success, result = self._post_json("/v1/video_generation", data)
        if not success:
            msg = result.get("status_msg", "Unknown error")
            code = result.get("status_code", 0)
            return False, format_api_error(code, msg) if code else msg

        if "base_resp" in result:
            status_code = result["base_resp"].get("status_code", 0)
            if status_code != 0:
                return False, format_api_error(status_code, result["base_resp"].get("status_msg", ""))

        if "task_id" in result:
            return True, str(result["task_id"])

        return False, "No task_id in response"

    def video_query(self, task_id: str) -> Tuple[bool, dict]:
        """Query video generation task status (sync)."""
        try:
            resp = self.session.get(
                f"{self.api_base}/v1/query/video_generation",
                params={"task_id": task_id},
                timeout=30.0
            )
            resp.raise_for_status()
            result = resp.json()

            if "base_resp" in result:
                status_code = result["base_resp"].get("status_code", 0)
                if status_code != 0:
                    return False, {"error": format_api_error(status_code, result["base_resp"].get("status_msg", ""))}

            return True, result
        except Exception as e:
            return False, {"error": str(e)}

    def video_download(self, file_id: str, output_path: str = "workspace/video_output.mp4") -> Tuple[bool, str]:
        """Download generated video by file_id (sync)."""
        try:
            resp = self.session.get(
                f"{self.api_base}/v1/files/retrieve",
                params={"file_id": file_id},
                timeout=30.0
            )
            resp.raise_for_status()
            result = resp.json()

            if "base_resp" in result:
                status_code = result["base_resp"].get("status_code", 0)
                if status_code != 0:
                    return False, format_api_error(status_code, result["base_resp"].get("status_msg", ""))

            download_url = result.get("file", {}).get("download_url", "")
            if not download_url:
                return False, "No download URL found"

            ok, content = self._get_binary(download_url)
            if not ok:
                return False, content

            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, "wb") as f:
                f.write(content)

            return True, output_path
        except Exception as e:
            return False, str(e)


class MiniMaxClient:
    """Async client for MiniMax API (TTS, Image Gen) — uses httpx."""

    def __init__(self, api_key: str, api_base: str = "https://api.minimax.io"):
        self.api_key = api_key
        self.api_base = api_base
        self.http_client = httpx.AsyncClient(timeout=120.0)

    async def close(self):
        """Close HTTP client."""
        await self.http_client.aclose()

    # ============ TTS (Text-to-Speech) ============

    async def tts_synthesize(
        self,
        text: str,
        voice: str = "male-qn-qingque",
        speed: float = 1.0,
        model: str = "speech-2.8-turbo",
        output_path: str = "workspace/tts_output.mp3"
    ) -> Tuple[bool, str]:
        """Synthesize speech from text."""
        url = f"{self.api_base}/v1/t2a_v2"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        data = {
            "model": model,
            "text": text,
            "voice_setting": {
                "voice_id": voice,
                "speed": speed
            },
            "output_format": {
                "container": "mp3",
                "sample_rate": 32000
            }
        }

        try:
            response = await self.http_client.post(url, headers=headers, json=data)
            response.raise_for_status()

            result = response.json()

            if "data" in result:
                audio_base64 = result["data"]
                audio_bytes = base64.b64decode(audio_base64)

                Path(output_path).parent.mkdir(parents=True, exist_ok=True)
                with open(output_path, "wb") as f:
                    f.write(audio_bytes)

                return True, output_path

            return False, "No audio data in response"

        except httpx.HTTPStatusError as e:
            return False, f"HTTP Error {e.response.status_code}: {e.response.text}"
        except Exception as e:
            return False, str(e)

    async def tts_async_create(
        self,
        text: str,
        voice: str = "male-qn-qingque",
        speed: float = 1.0,
        model: str = "speech-2.8-turbo"
    ) -> Tuple[bool, str]:
        """Create async TTS task for long text (up to 1M chars)."""
        url = f"{self.api_base}/v1/t2a_v2_async"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        data = {
            "model": model,
            "text": text,
            "voice_setting": {
                "voice_id": voice,
                "speed": speed
            }
        }

        try:
            response = await self.http_client.post(url, headers=headers, json=data)
            response.raise_for_status()

            result = response.json()
            if "task_id" in result:
                return True, result["task_id"]

            return False, "No task_id in response"

        except Exception as e:
            return False, str(e)

    async def tts_async_query(self, task_id: str) -> Tuple[bool, dict]:
        """Query async TTS task status."""
        url = f"{self.api_base}/v1/t2a_v2_async"

        headers = {"Authorization": f"Bearer {self.api_key}"}
        params = {"task_id": task_id}

        try:
            response = await self.http_client.get(url, headers=headers, params=params)
            response.raise_for_status()

            return True, response.json()

        except Exception as e:
            return False, {"error": str(e)}

    # ============ Image Generation ============

    async def image_generate(
        self,
        prompt: str,
        model: str = "image-01",
        size: str = "1024x1024",
        output_path: str = "workspace/image_output.png",
        n: int = 1,
        prompt_optimizer: bool = False
    ) -> Tuple[bool, str]:
        """Generate image from text prompt."""
        url = f"{self.api_base}/v1/image_generation"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        size_to_ratio = {
            "1024x1024": "1:1",
            "1024x1792": "9:16",
            "1792x1024": "16:9",
            "768x768": "1:1",
        }
        aspect_ratio = size_to_ratio.get(size, "1:1")

        data = {
            "model": model,
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
            "response_format": "base64",
            "n": n,
            "prompt_optimizer": prompt_optimizer
        }

        try:
            response = await self.http_client.post(url, headers=headers, json=data)
            response.raise_for_status()

            result = response.json()

            if "base_resp" in result:
                status_code = result["base_resp"].get("status_code", 0)
                if status_code != 0:
                    error_msg = result["base_resp"].get("status_msg", "Unknown error")
                    return False, format_api_error(status_code, error_msg)

            if "data" in result:
                if "image_base64" in result["data"]:
                    images = result["data"]["image_base64"]
                elif "image_urls" in result["data"]:
                    image_urls = result["data"]["image_urls"]
                    if image_urls:
                        img_response = await self.http_client.get(image_urls[0])
                        img_response.raise_for_status()
                        images = [base64.b64encode(img_response.content).decode()]
                else:
                    return False, "No image data in response"

                if images:
                    image_bytes = base64.b64decode(images[0])

                    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
                    with open(output_path, "wb") as f:
                        f.write(image_bytes)

                    return True, output_path

            return False, "Invalid response format"

        except httpx.HTTPStatusError as e:
            return False, f"HTTP Error {e.response.status_code}: {e.response.text}"
        except Exception as e:
            return False, str(e)

    async def image_variations(
        self,
        image_path: str,
        prompt: str = "",
        model: str = "image-01",
        size: str = "1024x1024",
        output_path: str = "workspace/image_variation.png",
        n: int = 1,
        prompt_optimizer: bool = False
    ) -> Tuple[bool, str]:
        """Generate image variations from reference image (Image-to-Image)."""
        url = f"{self.api_base}/v1/image_generation"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        with open(image_path, "rb") as f:
            image_base64 = base64.b64encode(f.read()).decode()

        size_to_ratio = {
            "1024x1024": "1:1",
            "1024x1792": "9:16",
            "1792x1024": "16:9",
            "768x768": "1:1",
        }
        aspect_ratio = size_to_ratio.get(size, "1:1")

        data = {
            "model": model,
            "prompt": prompt or "Create a variation of this image",
            "aspect_ratio": aspect_ratio,
            "response_format": "base64",
            "n": n,
            "prompt_optimizer": prompt_optimizer,
            "subject_reference": [
                {
                    "type": "character",
                    "image_base64": image_base64
                }
            ]
        }

        try:
            response = await self.http_client.post(url, headers=headers, json=data)
            response.raise_for_status()

            result = response.json()

            if "base_resp" in result:
                status_code = result["base_resp"].get("status_code", 0)
                if status_code != 0:
                    error_msg = result["base_resp"].get("status_msg", "Unknown error")
                    return False, format_api_error(status_code, error_msg)

            if "data" in result:
                if "image_base64" in result["data"]:
                    images = result["data"]["image_base64"]
                elif "image_urls" in result["data"]:
                    image_urls = result["data"]["image_urls"]
                    if image_urls:
                        img_response = await self.http_client.get(image_urls[0])
                        img_response.raise_for_status()
                        images = [base64.b64encode(img_response.content).decode()]
                else:
                    return False, "No image data in response"

                if images:
                    image_bytes = base64.b64decode(images[0])

                    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
                    with open(output_path, "wb") as f:
                        f.write(image_bytes)

                    return True, output_path

            return False, "Invalid response format"

        except Exception as e:
            return False, str(e)

    # ============ Music Generation (Async) ============

    async def music_generate(
        self,
        prompt: str = "",
        lyrics: str = "",
        model: str = "music-2.6",
        output_path: str = "workspace/music_output.mp3",
        audio_setting: Optional[dict] = None,
        lyrics_optimizer: bool = False,
        is_instrumental: bool = False,
        audio_url: str = "",
        audio_base64: str = "",
        cover_feature_id: str = "",
        output_format: str = "hex",
        timeout: float = 300.0,
    ) -> Tuple[bool, dict]:
        """Generate music from prompt and lyrics (async).

        Returns:
            ``(True, {"output_path": str, "extra_info": dict, "trace_id": str})``
            on success, or ``(False, {"error": str, "status_code": int | None})``
            on failure. Same shape as the sync version above.
        """
        # Same Phase 1 cover-param guard as the sync client.
        if cover_feature_id and audio_url:
            return False, {
                "error": (
                    "cover_feature_id and audio_url are mutually exclusive "
                    "in the music-cover flow."
                ),
                "status_code": None,
            }
        if cover_feature_id and audio_base64:
            return False, {
                "error": (
                    "cover_feature_id and audio_base64 are mutually exclusive "
                    "in the music-cover flow."
                ),
                "status_code": None,
            }
        if audio_url and audio_base64:
            return False, {
                "error": (
                    "audio_url and audio_base64 are mutually exclusive — "
                    "pass exactly one for music-cover."
                ),
                "status_code": None,
            }

        url = f"{self.api_base}/v1/music_generation"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        data: dict = {"model": model, "output_format": output_format}
        if prompt:
            data["prompt"] = prompt
        if lyrics:
            data["lyrics"] = lyrics
        if audio_setting:
            data["audio_setting"] = audio_setting
        if lyrics_optimizer:
            data["lyrics_optimizer"] = True
        if is_instrumental:
            data["is_instrumental"] = True
        if audio_url:
            data["audio_url"] = audio_url
        if audio_base64:
            data["audio_base64"] = audio_base64
        if cover_feature_id:
            data["cover_feature_id"] = cover_feature_id

        # The shared httpx client was created with a default timeout that
        # may be too short for music gen (60-180s typical). Override per
        # request via a one-off client so we don't change global state.
        timeout_client = None
        client_to_use = self.http_client
        if timeout and timeout != 120.0:
            timeout_client = httpx.AsyncClient(timeout=timeout)
            client_to_use = timeout_client

        try:
            response = await client_to_use.post(url, headers=headers, json=data)
            response.raise_for_status()

            result = response.json()

            if "base_resp" in result:
                status_code = result["base_resp"].get("status_code", 0)
                if status_code != 0:
                    error_msg = result["base_resp"].get("status_msg", "Unknown error")
                    return False, {
                        "error": format_api_error(status_code, error_msg),
                        "status_code": status_code,
                    }

            extra_info = result.get("extra_info") or {}
            trace_id = result.get("trace_id", "")

            if "data" in result:
                audio_data = result["data"].get("audio", "")
                if audio_data:
                    if output_format == "hex":
                        try:
                            audio_bytes = bytes.fromhex(audio_data)
                        except ValueError:
                            audio_bytes = base64.b64decode(audio_data)
                    else:
                        audio_resp = await client_to_use.get(audio_data)
                        audio_resp.raise_for_status()
                        audio_bytes = audio_resp.content

                    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
                    with open(output_path, "wb") as f:
                        f.write(audio_bytes)

                    return True, {
                        "output_path": str(output_path),
                        "extra_info": extra_info,
                        "trace_id": trace_id,
                    }

            return False, {
                "error": "No audio data in response",
                "status_code": None,
            }

        except httpx.HTTPStatusError as e:
            return False, {
                "error": f"HTTP Error {e.response.status_code}: {e.response.text}",
                "status_code": e.response.status_code,
            }
        except Exception as e:
            return False, {
                "error": str(e),
                "status_code": None,
            }
        finally:
            if timeout_client is not None:
                await timeout_client.aclose()

    async def music_cover_preprocess(
        self,
        audio_url: str = "",
        audio_base64: str = ""
    ) -> Tuple[bool, dict]:
        """Preprocess reference audio for cover generation (async)."""
        url = f"{self.api_base}/v1/music_cover_preprocess"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        data: dict = {"model": "music-cover"}
        if audio_url:
            data["audio_url"] = audio_url
        if audio_base64:
            data["audio_base64"] = audio_base64

        try:
            response = await self.http_client.post(url, headers=headers, json=data)
            response.raise_for_status()

            result = response.json()

            if "base_resp" in result:
                status_code = result["base_resp"].get("status_code", 0)
                if status_code != 0:
                    error_msg = result["base_resp"].get("status_msg", "Unknown error")
                    return False, {"error": format_api_error(status_code, error_msg)}

            return True, result

        except httpx.HTTPStatusError as e:
            return False, {"error": f"HTTP Error {e.response.status_code}: {e.response.text}"}
        except Exception as e:
            return False, {"error": str(e)}

    # ============ Video Generation (Async) ============

    async def video_generate(
        self,
        prompt: str,
        model: str = "MiniMax-Hailuo-2.3",
        first_frame_image: str = "",
        last_frame_image: str = "",
        subject_reference: Optional[list] = None,
        duration: int = 6,
        resolution: str = "768P",
        prompt_optimizer: bool = True,
        fast_pretreatment: bool = False
    ) -> Tuple[bool, str]:
        """Create a video generation task (async)."""
        url = f"{self.api_base}/v1/video_generation"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        data: dict = {
            "model": model,
            "prompt": prompt,
            "duration": duration,
            "resolution": resolution,
            "prompt_optimizer": prompt_optimizer,
            "fast_pretreatment": fast_pretreatment
        }
        if first_frame_image:
            data["first_frame_image"] = first_frame_image
        if last_frame_image:
            data["last_frame_image"] = last_frame_image
        if subject_reference:
            data["subject_reference"] = subject_reference

        try:
            response = await self.http_client.post(url, headers=headers, json=data)
            response.raise_for_status()

            result = response.json()

            if "base_resp" in result:
                status_code = result["base_resp"].get("status_code", 0)
                if status_code != 0:
                    error_msg = result["base_resp"].get("status_msg", "Unknown error")
                    return False, format_api_error(status_code, error_msg)

            if "task_id" in result:
                return True, str(result["task_id"])

            return False, "No task_id in response"

        except httpx.HTTPStatusError as e:
            return False, f"HTTP Error {e.response.status_code}: {e.response.text}"
        except Exception as e:
            return False, str(e)

    async def video_query(self, task_id: str) -> Tuple[bool, dict]:
        """Query video generation task status (async)."""
        url = f"{self.api_base}/v1/query/video_generation"

        headers = {"Authorization": f"Bearer {self.api_key}"}
        params = {"task_id": task_id}

        try:
            response = await self.http_client.get(url, headers=headers, params=params)
            response.raise_for_status()

            result = response.json()

            if "base_resp" in result:
                status_code = result["base_resp"].get("status_code", 0)
                if status_code != 0:
                    error_msg = result["base_resp"].get("status_msg", "Unknown error")
                    return False, {"error": format_api_error(status_code, error_msg)}

            return True, result

        except httpx.HTTPStatusError as e:
            return False, {"error": f"HTTP Error {e.response.status_code}: {e.response.text}"}
        except Exception as e:
            return False, {"error": str(e)}

    async def video_download(self, file_id: str, output_path: str = "workspace/video_output.mp4") -> Tuple[bool, str]:
        """Download generated video by file_id (async)."""
        url = f"{self.api_base}/v1/files/retrieve"

        headers = {"Authorization": f"Bearer {self.api_key}"}
        params = {"file_id": file_id}

        try:
            response = await self.http_client.get(url, headers=headers, params=params)
            response.raise_for_status()

            result = response.json()

            if "base_resp" in result:
                status_code = result["base_resp"].get("status_code", 0)
                if status_code != 0:
                    error_msg = result["base_resp"].get("status_msg", "Unknown error")
                    return False, format_api_error(status_code, error_msg)

            download_url = result.get("file", {}).get("download_url", "")
            if not download_url:
                return False, "No download URL found"

            video_resp = await self.http_client.get(download_url)
            video_resp.raise_for_status()

            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, "wb") as f:
                f.write(video_resp.content)

            return True, output_path

        except httpx.HTTPStatusError as e:
            return False, f"HTTP Error {e.response.status_code}: {e.response.text}"
        except Exception as e:
            return False, str(e)


# Synchronous wrappers for use in Qt threads

def tts_sync(api_key: str, api_base: str, text: str, voice: str, speed: float, output_path: str) -> Tuple[bool, str]:
    """Synchronous TTS wrapper."""
    client = MiniMaxSyncClient(api_key, api_base)
    try:
        return client.tts_synthesize(text, voice, speed, output_path=output_path)
    finally:
        client.close()


def image_sync(api_key: str, api_base: str, prompt: str, output_path: str, aspect_ratio: str = "1:1", width: int = None, height: int = None, n: int = 1, prompt_optimizer: bool = False, watermark: bool = False, seed: int = None, model: str = "image-01", subject_reference: Optional[list] = None) -> Tuple[bool, str]:
    """Synchronous image generation wrapper.

    Both T2I and i2i share this entry point — i2i is selected by passing
    ``subject_reference`` and ``model="image-01-live"`` (or any of the
    ``image-01-live*`` variants). See ``MiniMaxSyncClient.image_generate``.
    """
    client = MiniMaxSyncClient(api_key, api_base)
    try:
        return client.image_generate(
            prompt,
            model=model,
            aspect_ratio=aspect_ratio,
            width=width,
            height=height,
            output_path=output_path,
            n=n,
            prompt_optimizer=prompt_optimizer,
            watermark=watermark,
            seed=seed,
            subject_reference=subject_reference,
        )
    finally:
        client.close()


def image_variations_sync(api_key: str, api_base: str, image_path: str, prompt: str = "", output_path: str = "workspace/image_variation.png", aspect_ratio: str = "1:1", width: int = None, height: int = None, n: int = 1, prompt_optimizer: bool = False, watermark: bool = False, seed: int = None) -> Tuple[bool, str]:
    """Synchronous image-to-image generation wrapper."""
    client = MiniMaxSyncClient(api_key, api_base)
    try:
        return client.image_variations(image_path, prompt=prompt, aspect_ratio=aspect_ratio, width=width, height=height, output_path=output_path, n=n, prompt_optimizer=prompt_optimizer, watermark=watermark, seed=seed)
    finally:
        client.close()


def music_sync(
    api_key: str,
    api_base: str,
    prompt: str = "",
    lyrics: str = "",
    model: str = "music-2.6",
    output_path: str = "workspace/music_output.mp3",
    audio_setting: Optional[dict] = None,
    lyrics_optimizer: bool = False,
    is_instrumental: bool = False,
    audio_url: str = "",
    audio_base64: str = "",
    cover_feature_id: str = "",
    output_format: str = "hex",
    timeout: float = 300.0,
) -> Tuple[bool, dict]:
    """Synchronous music generation wrapper.

    Returns the same dict shape as ``MiniMaxSyncClient.music_generate``:
    ``(True, {"output_path": str, "extra_info": dict, "trace_id": str})`` or
    ``(False, {"error": str, "status_code": int | None})``.
    """
    client = MiniMaxSyncClient(api_key, api_base)
    try:
        return client.music_generate(
            prompt=prompt, lyrics=lyrics, model=model, output_path=output_path,
            audio_setting=audio_setting, lyrics_optimizer=lyrics_optimizer,
            is_instrumental=is_instrumental, audio_url=audio_url,
            audio_base64=audio_base64, cover_feature_id=cover_feature_id,
            output_format=output_format, timeout=timeout,
        )
    finally:
        client.close()


def video_sync(
    api_key: str,
    api_base: str,
    prompt: str,
    model: str = "MiniMax-Hailuo-2.3",
    first_frame_image: str = "",
    duration: int = 6,
    resolution: str = "768P",
    prompt_optimizer: bool = True,
    fast_pretreatment: bool = False,
    output_path: str = "workspace/video_output.mp4"
) -> Tuple[bool, str]:
    """Synchronous video generation wrapper with polling."""
    client = MiniMaxSyncClient(api_key, api_base)
    try:
        success, task_id = client.video_generate(
            prompt=prompt, model=model, first_frame_image=first_frame_image,
            duration=duration, resolution=resolution,
            prompt_optimizer=prompt_optimizer, fast_pretreatment=fast_pretreatment
        )
        if not success:
            return False, task_id

        # Poll for completion
        import time
        for _ in range(120):  # max 10 minutes (5s * 120)
            time.sleep(5)
            qsuccess, qresult = client.video_query(task_id)
            if not qsuccess:
                continue
            status = qresult.get("status", "").lower()
            if status == "success":
                file_id = qresult.get("file_id", "")
                if file_id:
                    return client.video_download(file_id, output_path)
                return False, "No file_id in success response"
            elif status == "fail":
                return False, qresult.get("error_message", "Video generation failed")

        return False, "Video generation timeout"
    finally:
        client.close()
