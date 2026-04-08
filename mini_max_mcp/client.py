"""MiniMax API Client for TTS and Image Generation."""

import httpx
import asyncio
import base64
import json
from pathlib import Path
from typing import Optional, Tuple


# Synchronous client for use in Qt threads (no asyncio.run() needed)
class MiniMaxSyncClient:
    """Synchronous client for MiniMax API (TTS, Image Gen)."""

    def __init__(self, api_key: str, api_base: str = "https://api.minimax.io"):
        self.api_key = api_key
        self.api_base = api_base
        self.http_client = httpx.Client(timeout=120.0)

    def close(self):
        """Close HTTP client."""
        self.http_client.close()

    def image_generate(
        self,
        prompt: str,
        model: str = "image-01",
        size: str = "1024x1024",
        output_path: str = "workspace/image.png",
        n: int = 1,
        prompt_optimizer: bool = False
    ) -> Tuple[bool, str]:
        """Generate image from text prompt (sync)."""
        url = f"{self.api_base}/v1/image_generation"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        # The size parameter IS the aspect_ratio directly (e.g., "1:1", "16:9", "2:3")
        aspect_ratio = size

        data = {
            "model": model,
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
            "response_format": "base64",
            "n": n,
            "prompt_optimizer": prompt_optimizer
        }

        print(f"[DEBUG image_sync] Size received: {size}")
        print(f"[DEBUG image_sync] Aspect ratio used: {aspect_ratio}")
        print(f"[DEBUG image_sync] Sending request to {url}")
        print(f"[DEBUG image_sync] Data: {data}")

        try:
            response = self.http_client.post(url, headers=headers, json=data)
            print(f"[DEBUG image_sync] Response status: {response.status_code}")
            response.raise_for_status()

            result = response.json()
            print(f"[DEBUG image_sync] Response JSON: {result}")

            # Check for API errors
            if "base_resp" in result:
                status_code = result["base_resp"].get("status_code", 0)
                if status_code != 0:
                    return False, f"API Error: {result['base_resp'].get('status_msg', 'Unknown error')}"

            if "data" in result:
                if "image_base64" in result["data"]:
                    images = result["data"]["image_base64"]
                elif "image_urls" in result["data"]:
                    image_urls = result["data"]["image_urls"]
                    if image_urls:
                        img_response = self.http_client.get(image_urls[0])
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
            print(f"[DEBUG image_sync] HTTP Error: {e.response.status_code} - {e.response.text}")
            return False, f"HTTP Error {e.response.status_code}: {e.response.text}"
        except Exception as e:
            print(f"[DEBUG image_sync] Exception: {type(e).__name__}: {e}")
            return False, str(e)

    def tts_synthesize(
        self,
        text: str,
        voice: str = "male-qn-qingque",
        speed: float = 1.0,
        model: str = "speech-2.8-turbo",
        output_path: str = "workspace/tts_output.mp3"
    ) -> Tuple[bool, str]:
        """Synthesize speech from text (sync)."""
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
            "response_format": "mp3"
        }

        try:
            response = self.http_client.post(url, headers=headers, json=data)
            response.raise_for_status()

            # Response is binary audio
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, "wb") as f:
                f.write(response.content)

            return True, output_path

        except httpx.HTTPStatusError as e:
            return False, f"HTTP Error {e.response.status_code}: {e.response.text}"
        except Exception as e:
            return False, str(e)


class MiniMaxClient:
    """Client for MiniMax API (TTS, Image Gen)."""
    
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
        """
        Synthesize speech from text.
        
        Args:
            text: Text to synthesize (max 10,000 chars per request)
            voice: Voice ID
            speed: Speech speed (0.5 to 2.0)
            model: TTS model (speech-2.8-turbo or speech-2.8-hd)
            output_path: Path to save output audio
        
        Returns:
            (success, path_or_error)
        """
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
            
            # Save audio from base64 or URL
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
        """
        Create async TTS task for long text (up to 1M chars).
        
        Returns:
            (success, task_id or error)
        """
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
        """
        Query async TTS task status.
        
        Returns:
            (success, result_dict with status, file_id, etc.)
        """
        url = f"{self.api_base}/v1/t2a_v2_async"
        
        headers = {
            "Authorization": f"Bearer {self.api_key}"
        }
        
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
        """
        Generate image from text prompt.

        API: POST /v1/image_generation
        https://platform.minimax.io/docs/api-reference/image-generation-t2i

        Args:
            prompt: Image description (max 1500 chars)
            model: Image model (image-01)
            size: Image size in format "WxH" (e.g., "1024x1024", "1792x1024")
            output_path: Path to save output image
            n: Number of images to generate (1-9)
            prompt_optimizer: Enable automatic prompt optimization

        Returns:
            (success, path_or_error)
        """
        url = f"{self.api_base}/v1/image_generation"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        # Map size to aspect_ratio
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
            "response_format": "base64",  # base64 doesn't expire like URL
            "n": n,
            "prompt_optimizer": prompt_optimizer
        }

        try:
            print(f"[DEBUG image_generate] Sending request to {url}")
            print(f"[DEBUG image_generate] Data: {data}")
            response = await self.http_client.post(url, headers=headers, json=data)
            print(f"[DEBUG image_generate] Response status: {response.status_code}")
            response.raise_for_status()

            result = response.json()
            print(f"[DEBUG image_generate] Response JSON: {result}")

            # Check for API errors
            if "base_resp" in result:
                status_code = result["base_resp"].get("status_code", 0)
                if status_code != 0:
                    return False, f"API Error: {result['base_resp'].get('status_msg', 'Unknown error')}"

            if "data" in result:
                # Handle both base64 and url formats
                if "image_base64" in result["data"]:
                    images = result["data"]["image_base64"]
                elif "image_urls" in result["data"]:
                    # If URL format, download the image
                    image_urls = result["data"]["image_urls"]
                    if image_urls:
                        img_response = await self.http_client.get(image_urls[0])
                        img_response.raise_for_status()
                        images = [base64.b64encode(img_response.content).decode()]
                else:
                    return False, "No image data in response"

                if images:
                    # Save first image
                    image_bytes = base64.b64decode(images[0])

                    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
                    with open(output_path, "wb") as f:
                        f.write(image_bytes)

                    return True, output_path

            return False, "Invalid response format"

        except httpx.HTTPStatusError as e:
            print(f"[DEBUG image_generate] HTTP Error: {e.response.status_code} - {e.response.text}")
            return False, f"HTTP Error {e.response.status_code}: {e.response.text}"
        except Exception as e:
            print(f"[DEBUG image_generate] Exception: {type(e).__name__}: {e}")
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
        """
        Generate image variations from reference image (Image-to-Image).

        API: POST /v1/image_generation
        https://platform.minimax.io/docs/api-reference/image-generation-i2i

        Args:
            image_path: Path to reference image
            prompt: Optional modification prompt (max 1500 chars)
            model: Image model (image-01)
            size: Output size (mapped to aspect_ratio)
            output_path: Path to save output
            n: Number of images to generate (1-9)
            prompt_optimizer: Enable automatic prompt optimization

        Returns:
            (success, path_or_error)
        """
        url = f"{self.api_base}/v1/image_generation"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        # Read and encode reference image
        with open(image_path, "rb") as f:
            image_base64 = base64.b64encode(f.read()).decode()

        # Map size to aspect_ratio
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

            # Check for API errors
            if "base_resp" in result:
                status_code = result["base_resp"].get("status_code", 0)
                if status_code != 0:
                    return False, f"API Error: {result['base_resp'].get('status_msg', 'Unknown error')}"

            if "data" in result:
                # Handle both base64 and url formats
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


# Synchronous wrappers for use in Qt threads

def tts_sync(api_key: str, api_base: str, text: str, voice: str, speed: float, output_path: str) -> Tuple[bool, str]:
    """Synchronous TTS wrapper."""
    client = MiniMaxSyncClient(api_key, api_base)
    try:
        return client.tts_synthesize(text, voice, speed, output_path=output_path)
    finally:
        client.close()


def image_sync(api_key: str, api_base: str, prompt: str, size: str, output_path: str, n: int = 1, prompt_optimizer: bool = False) -> Tuple[bool, str]:
    """Synchronous image generation wrapper."""
    client = MiniMaxSyncClient(api_key, api_base)
    try:
        return client.image_generate(prompt, size=size, output_path=output_path, n=n, prompt_optimizer=prompt_optimizer)
    finally:
        client.close()