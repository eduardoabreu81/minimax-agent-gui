"""MiniMax MCP Module - web_search and understand_image tools."""

import base64
import httpx
import json
import logging
from pathlib import Path
from typing import Tuple, Any

_logger = logging.getLogger(__name__)


class MiniMaxMCPClient:
    """Client for MiniMax MCP tools (web_search, understand_image)."""

    def __init__(self, api_key: str, api_host: str = "https://api.minimax.io"):
        self.api_key = api_key
        self.api_host = api_host
        self.http_client = httpx.Client(timeout=120.0, headers={
            'MM-API-Source': 'Minimax-MCP'
        })

    def close(self):
        """Close HTTP client."""
        self.http_client.close()

    def web_search(self, query: str, recency_days: int = 30, max_results: int = 5) -> Tuple[bool, str]:
        """
        Search the web using MiniMax API.

        Args:
            query: Search query
            recency_days: Filter results from last N days (0 = any time).
                         Currently accepted but ignored — the API only
                         honours the ``q`` field for keyword search.
            max_results: Maximum number of results (1-10). Accepted
                         but ignored — the API returns its own default
                         result set.

        Returns:
            (success, results_text)
        """
        url = f"{self.api_host}/v1/coding_plan/search"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        # IMPORTANT: the Token Plan API expects the query under the
        # ``q`` key, NOT ``query`` (the older M2.7 coding-plan endpoint
        # used ``query``). Sending ``query`` + extra fields returns
        # ``HTTP 400 invalid params`` because the extra fields are
        # rejected as unknown. Match the working ``minimax-coding-plan-mcp``
        # server's exact request shape.
        data = {
            "q": query,
        }

        _logger.debug(f"web_search] Query: {query}")

        try:
            response = self.http_client.post(url, headers=headers, json=data)
            _logger.debug(f"web_search] Status: {response.status_code}")
            response.raise_for_status()

            result = response.json()
            _logger.debug(f"web_search] Response: {result}")

            # Check API-specific error codes
            base_resp = result.get("base_resp", {})
            if base_resp.get("status_code", 0) != 0:
                return False, f"API Error {base_resp.get('status_code')}: {base_resp.get('status_msg', 'Unknown error')}"

            # Parse results (official MCP format: organic array)
            organic = result.get("organic", [])
            if not organic:
                return True, "No results found."

            output = []
            for i, r in enumerate(organic, 1):
                title = r.get("title", "No title")
                url_link = r.get("link", "")
                snippet = r.get("snippet", "")
                date = r.get("date", "")
                date_str = f" ({date})" if date else ""
                output.append(f"{i}. {title}{date_str}\n   URL: {url_link}\n   {snippet}")

            # Add related searches if present
            related = result.get("related_searches", [])
            if related:
                output.append("\nRelated searches:")
                for r in related:
                    output.append(f"- {r.get('query', '')}")

            return True, "\n\n".join(output)

        except httpx.HTTPStatusError as e:
            return False, f"HTTP Error {e.response.status_code}: {e.response.text}"
        except Exception as e:
            return False, str(e)

    def understand_image(self, image_path: str = None, image_url: str = None, prompt: str = "Describe this image in detail.") -> Tuple[bool, str]:
        """
        Understand image content using MiniMax VLM API.

        Args:
            image_path: Local path to image file
            image_url: URL of image to analyze
            prompt: Question/prompt about the image

        Returns:
            (success, description_text)
        """
        url = f"{self.api_host}/v1/coding_plan/vlm"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        data = {
            "prompt": f"{prompt}\n\nIMPORTANT: Respond ONLY in English or Portuguese. Do not use Chinese or any other language."
        }

        if image_path:
            # Read and encode local image as data URL
            with open(image_path, "rb") as f:
                image_base64_data = base64.b64encode(f.read()).decode()
            # Determine MIME type from extension
            ext = Path(image_path).suffix.lower()
            mime_types = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif'}
            mime_type = mime_types.get(ext, 'image/png')
            data["image_url"] = f"data:{mime_type};base64,{image_base64_data}"
            _logger.debug(f"understand_image] Using local image: {image_path}")
        elif image_url:
            data["image_url"] = image_url
            _logger.debug(f"understand_image] Using URL: {image_url}")
        else:
            return False, "Either image_path or image_url must be provided"

        try:
            response = self.http_client.post(url, headers=headers, json=data)
            _logger.debug(f"understand_image] Status: {response.status_code}")
            response.raise_for_status()

            result = response.json()
            _logger.info(f"understand_image] Response: {result}")

            # Check API-specific error codes
            base_resp = result.get("base_resp", {})
            if base_resp.get("status_code", 0) != 0:
                return False, f"API Error {base_resp.get('status_code')}: {base_resp.get('status_msg', 'Unknown error')}"

            # Extract content from response (official MCP format)
            content = result.get("content", "")
            if content:
                return True, content

            _logger.warning(f"understand_image] No content in response: {result}")
            return False, "No content returned from VLM API"

        except httpx.HTTPStatusError as e:
            return False, f"HTTP Error {e.response.status_code}: {e.response.text}"
        except Exception as e:
            return False, str(e)


# Synchronous wrappers for use in Qt threads
def web_search_sync(api_key: str, api_base: str, query: str, recency_days: int = 30, max_results: int = 5) -> Tuple[bool, str]:
    """Synchronous web_search wrapper."""
    client = MiniMaxMCPClient(api_key, api_base)
    try:
        return client.web_search(query, recency_days, max_results)
    finally:
        client.close()


def understand_image_sync(api_key: str, api_base: str, image_path: str = None, image_url: str = None, prompt: str = "Describe this image in detail.") -> Tuple[bool, str]:
    """Synchronous understand_image wrapper."""
    client = MiniMaxMCPClient(api_key, api_base)
    try:
        return client.understand_image(image_path, image_url, prompt)
    finally:
        client.close()
