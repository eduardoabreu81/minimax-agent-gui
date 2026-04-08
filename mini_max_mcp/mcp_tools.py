"""MiniMax MCP Module - web_search and understand_image tools."""

import base64
import httpx
import json
from pathlib import Path
from typing import Tuple, Any


class MiniMaxMCPClient:
    """Client for MiniMax MCP tools (web_search, understand_image)."""

    def __init__(self, api_key: str, api_host: str = "https://api.minimax.io"):
        self.api_key = api_key
        self.api_host = api_host
        self.http_client = httpx.Client(timeout=120.0)

    def close(self):
        """Close HTTP client."""
        self.http_client.close()

    def web_search(self, query: str, recency_days: int = 30, max_results: int = 5) -> Tuple[bool, str]:
        """
        Search the web using MiniMax API.

        Args:
            query: Search query
            recency_days: Filter results from last N days (0 = any time)
            max_results: Maximum number of results (1-10)

        Returns:
            (success, results_text)
        """
        url = f"{self.api_host}/v1/web_search"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        data = {
            "query": query,
            "recency_days": recency_days,
            "max_results": max_results
        }

        print(f"[DEBUG web_search] Query: {query}")

        try:
            response = self.http_client.post(url, headers=headers, json=data)
            print(f"[DEBUG web_search] Status: {response.status_code}")
            response.raise_for_status()

            result = response.json()
            print(f"[DEBUG web_search] Response: {result}")

            # Parse results
            if "data" in result:
                results = result["data"].get("results", [])
                if not results:
                    return True, "No results found."

                output = []
                for i, r in enumerate(results, 1):
                    title = r.get("title", "No title")
                    url_link = r.get("url", "")
                    snippet = r.get("snippet", "")
                    output.append(f"{i}. {title}\n   URL: {url_link}\n   {snippet}")

                return True, "\n\n".join(output)

            return False, "Invalid response format"

        except httpx.HTTPStatusError as e:
            return False, f"HTTP Error {e.response.status_code}: {e.response.text}"
        except Exception as e:
            return False, str(e)

    def understand_image(self, image_path: str = None, image_url: str = None, prompt: str = "Describe this image in detail.") -> Tuple[bool, str]:
        """
        Understand image content using MiniMax API.

        Args:
            image_path: Local path to image file
            image_url: URL of image to analyze
            prompt: Question/prompt about the image

        Returns:
            (success, description_text)
        """
        url = f"{self.api_host}/v1/understand_image"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        data = {
            "model": "image-01",
            "prompt": prompt
        }

        if image_path:
            # Read and encode local image
            with open(image_path, "rb") as f:
                image_base64_data = base64.b64encode(f.read()).decode()
            data["image_base64"] = image_base64_data
            print(f"[DEBUG understand_image] Using local image: {image_path}")
        elif image_url:
            data["image_url"] = image_url
            print(f"[DEBUG understand_image] Using URL: {image_url}")
        else:
            return False, "Either image_path or image_url must be provided"

        try:
            response = self.http_client.post(url, headers=headers, json=data)
            print(f"[DEBUG understand_image] Status: {response.status_code}")
            response.raise_for_status()

            result = response.json()
            print(f"[DEBUG understand_image] Response: {result}")

            # Parse response
            if "data" in result:
                description = result["data"].get("description", result["data"].get("text", ""))
                if description:
                    return True, description

            return False, "Invalid response format"

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
