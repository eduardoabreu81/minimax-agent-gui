"""Anthropic LLM client implementation."""

import logging
from typing import Any

import anthropic

from ..retry import RetryConfig, async_retry
from ..schema import FunctionCall, LLMResponse, Message, TokenUsage, ToolCall
from .base import LLMClientBase

logger = logging.getLogger(__name__)


class AnthropicClient(LLMClientBase):
    """LLM client using Anthropic's protocol.

    This client uses the official Anthropic SDK and supports:
    - Extended thinking content
    - Tool calling
    - Retry logic
    """

    # Per-model max_tokens defaults (Anthropic-compatible MiniMax docs).
    # M3: 131K recommended (up to 512K). M2.x: 64K recommended (up to 200K).
    MODEL_MAX_TOKENS: dict = {
        "MiniMax-M3": 131_072,
        "MiniMax-M2.7": 65_536,
        "MiniMax-M2.7-highspeed": 65_536,
        "MiniMax-M2.5": 65_536,
        "MiniMax-M2.5-highspeed": 65_536,
        "MiniMax-M2.1": 65_536,
        "MiniMax-M2.1-highspeed": 65_536,
        "MiniMax-M2": 65_536,
    }
    # Per-model CONTEXT WINDOW (input limit, separate from max_tokens
    # which is the output limit). Used by Agent._summarize_messages()
    # to compute pct-based auto-compact triggers. M3 is the 1M-context
    # flagship; M2.x tops out at 200K. Keep in sync with
    # desktop/src/lib/modelLimits.js — both files are the source of
    # truth on the respective sides (frontend display, backend trigger).
    MODEL_CONTEXT_LIMITS: dict = {
        "MiniMax-M3":           1_000_000,
        "MiniMax-M2.7":           204_800,
        "MiniMax-M2.7-highspeed": 204_800,
    }
    # Models that support Anthropic-style extended thinking blocks.
    # Only M3 currently — M2.x does not accept the `thinking` param.
    THINKING_SUPPORTED: set = {"MiniMax-M3"}

    def __init__(
        self,
        api_key: str,
        api_base: str = "https://api.minimaxi.com/anthropic",
        model: str = "MiniMax-M3",
        retry_config: RetryConfig | None = None,
    ):
        """Initialize Anthropic client.

        Args:
            api_key: API key for authentication
            api_base: Base URL for the API (default: MiniMax Anthropic endpoint)
            model: Model name to use (default: MiniMax-M2.5)
            retry_config: Optional retry configuration
        """
        super().__init__(api_key, api_base, model, retry_config)

        # Initialize Anthropic async client
        self.client = anthropic.AsyncAnthropic(
            base_url=api_base,
            api_key=api_key,
            default_headers={"Authorization": f"Bearer {api_key}"},
        )

    async def _make_api_request(
        self,
        system_message: str | None,
        api_messages: list[dict[str, Any]],
        tools: list[Any] | None = None,
        model: str | None = None,
        thinking: bool | None = None,
        on_delta: Any = None,
    ) -> anthropic.types.Message:
        """Execute API request (core method that can be retried).

        Args:
            system_message: Optional system message
            api_messages: List of messages in Anthropic format
            tools: Optional list of tools
            model: Optional model override for this call (defaults to self.model)
            thinking: Optional thinking override for this call.
                       True = force thinking on, False = force off, None = auto
                       (auto = on for M3, off otherwise).
            on_delta: Optional async callback(kind, content) invoked for
                       every content_block_delta chunk. kind is "thinking"
                       or "text"; content is the incremental string.
                       When set, the request streams the response and the
                       callback fires as deltas arrive; the returned
                       Message is the same final object either way.

        Returns:
            Anthropic Message response

        Raises:
            Exception: API call failed
        """
        effective_model = model or self.model
        params = {
            "model": effective_model,
            "max_tokens": self.MODEL_MAX_TOKENS.get(effective_model, 16_384),
            "messages": api_messages,
        }

        if system_message:
            params["system"] = system_message

        if tools:
            params["tools"] = self._convert_tools(tools)

        # Thinking param: explicit override wins, otherwise auto for M3.
        # Use `enabled` with a budget (not `adaptive`) so the model ALWAYS
        # emits thinking blocks — `adaptive` lets the model skip thinking
        # on simple turns, which makes the ThinkingBlock UI inconsistent
        # (appears with M2.7, sometimes vanishes with M3). Forcing enabled
        # guarantees the reasoning shows up above every M3 response.
        if thinking is True or (thinking is None and effective_model in self.THINKING_SUPPORTED):
            params["thinking"] = {"type": "enabled", "budget_tokens": 4096}

        # Use Anthropic SDK's streaming API. The non-streaming
        # ``messages.create`` is hard-blocked by the SDK for any
        # operation that may take longer than 10 minutes — and M3
        # requests with thinking enabled (or even M2.7 when the
        # 5h quota window is nearly full and responses get
        # throttled) routinely exceed that. ``messages.stream()``
        # internally streams the response and gives us back the
        # same final ``Message`` object, so no downstream code
        # needs to change.
        if on_delta is None:
            # Plain streaming, no per-delta callback — just collect
            # the final message. Cheaper (no callback overhead) when
            # the caller doesn't need real-time updates.
            async with self.client.messages.stream(**params) as stream:
                await stream.until_done()
                response = await stream.get_final_message()
            return response

        # Streaming with per-delta callback. We iterate the events
        # ourselves so we can call on_delta for every thinking/text
        # chunk as it arrives (the user sees the reasoning and
        # response stream in real time, not as one big payload).
        import json as _json
        text_content = ""
        thinking_content = ""
        tool_calls: list[ToolCall] = []
        current_tool: dict | None = None

        async with self.client.messages.stream(**params) as stream:
            async for event in stream:
                if event.type == "content_block_start":
                    block = getattr(event, "content_block", None)
                    if block and getattr(block, "type", None) == "tool_use":
                        current_tool = {
                            "id": block.id,
                            "name": block.name,
                            "input_json": "",
                        }
                elif event.type == "content_block_delta":
                    delta = getattr(event, "delta", None)
                    if not delta:
                        continue
                    dtype = getattr(delta, "type", None)
                    if dtype == "thinking_delta":
                        chunk = getattr(delta, "thinking", "") or ""
                        if chunk:
                            thinking_content += chunk
                            await on_delta("thinking", chunk)
                    elif dtype == "text_delta":
                        chunk = getattr(delta, "text", "") or ""
                        if chunk:
                            text_content += chunk
                            await on_delta("text", chunk)
                    elif dtype == "input_json_delta":
                        if current_tool is not None:
                            current_tool["input_json"] += getattr(delta, "partial_json", "") or ""
                elif event.type == "content_block_stop":
                    if current_tool is not None:
                        try:
                            arguments = _json.loads(current_tool["input_json"]) if current_tool["input_json"] else {}
                        except _json.JSONDecodeError:
                            arguments = {}
                        tool_calls.append(ToolCall(
                            id=current_tool["id"],
                            type="function",
                            function=FunctionCall(
                                name=current_tool["name"],
                                arguments=arguments,
                            ),
                        ))
                        current_tool = None
            response = await stream.get_final_message()

        # The streaming path returns the same Message as the
        # non-streaming path, but the caller can reconstruct
        # content/thinking/tool_calls from the deltas if they want.
        # We attach them as attributes for convenience.
        response._streamed_text = text_content
        response._streamed_thinking = thinking_content or None
        response._streamed_tool_calls = tool_calls or None
        return response

    def _convert_tools(self, tools: list[Any]) -> list[dict[str, Any]]:
        """Convert tools to Anthropic format.

        Anthropic tool format:
        {
            "name": "tool_name",
            "description": "Tool description",
            "input_schema": {
                "type": "object",
                "properties": {...},
                "required": [...]
            }
        }

        Args:
            tools: List of Tool objects or dicts

        Returns:
            List of tools in Anthropic dict format
        """
        result = []
        for tool in tools:
            if isinstance(tool, dict):
                result.append(tool)
            elif hasattr(tool, "to_schema"):
                # Tool object with to_schema method
                result.append(tool.to_schema())
            else:
                raise TypeError(f"Unsupported tool type: {type(tool)}")
        return result

    def _convert_messages(self, messages: list[Message]) -> tuple[str | None, list[dict[str, Any]]]:
        """Convert internal messages to Anthropic format.

        Args:
            messages: List of internal Message objects

        Returns:
            Tuple of (system_message, api_messages)
        """
        system_message = None
        api_messages = []

        for msg in messages:
            if msg.role == "system":
                system_message = msg.content
                continue

            # For user and assistant messages
            if msg.role in ["user", "assistant"]:
                # Handle assistant messages with thinking or tool calls
                if msg.role == "assistant" and (msg.thinking or msg.tool_calls):
                    # Build content blocks for assistant with thinking and/or tool calls
                    content_blocks = []

                    # Add thinking block if present
                    if msg.thinking:
                        content_blocks.append({"type": "thinking", "thinking": msg.thinking})

                    # Add text content if present
                    if msg.content:
                        content_blocks.append({"type": "text", "text": msg.content})

                    # Add tool use blocks
                    if msg.tool_calls:
                        for tool_call in msg.tool_calls:
                            content_blocks.append(
                                {
                                    "type": "tool_use",
                                    "id": tool_call.id,
                                    "name": tool_call.function.name,
                                    "input": tool_call.function.arguments,
                                }
                            )

                    api_messages.append({"role": "assistant", "content": content_blocks})
                else:
                    api_messages.append({"role": msg.role, "content": msg.content})

            # For tool result messages
            elif msg.role == "tool":
                # Anthropic uses user role with tool_result content blocks
                api_messages.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": msg.tool_call_id,
                                "content": msg.content,
                            }
                        ],
                    }
                )

        return system_message, api_messages

    def _prepare_request(
        self,
        messages: list[Message],
        tools: list[Any] | None = None,
    ) -> dict[str, Any]:
        """Prepare the request for Anthropic API.

        Args:
            messages: List of conversation messages
            tools: Optional list of available tools

        Returns:
            Dictionary containing request parameters
        """
        system_message, api_messages = self._convert_messages(messages)

        return {
            "system_message": system_message,
            "api_messages": api_messages,
            "tools": tools,
        }

    def _extract_usage(self, response: anthropic.types.Message) -> TokenUsage | None:
        """Pull the token-usage block from an Anthropic response."""
        usage = getattr(response, "usage", None)
        if not usage:
            return None
        input_tokens = usage.input_tokens or 0
        output_tokens = usage.output_tokens or 0
        cache_read_tokens = getattr(usage, "cache_read_input_tokens", 0) or 0
        cache_creation_tokens = getattr(usage, "cache_creation_input_tokens", 0) or 0
        total_input_tokens = input_tokens + cache_read_tokens + cache_creation_tokens
        return TokenUsage(
            prompt_tokens=total_input_tokens,
            completion_tokens=output_tokens,
            total_tokens=total_input_tokens + output_tokens,
        )

    def _parse_response(self, response: anthropic.types.Message) -> LLMResponse:
        """Parse Anthropic response into LLMResponse.

        Args:
            response: Anthropic Message response

        Returns:
            LLMResponse object
        """
        # Extract text content, thinking, and tool calls
        text_content = ""
        thinking_content = ""
        tool_calls = []

        for block in response.content:
            if block.type == "text":
                text_content += block.text
            elif block.type == "thinking":
                thinking_content += block.thinking
            elif block.type == "tool_use":
                # Parse Anthropic tool_use block
                tool_calls.append(
                    ToolCall(
                        id=block.id,
                        type="function",
                        function=FunctionCall(
                            name=block.name,
                            arguments=block.input,
                        ),
                    )
                )

        # Extract token usage from response
        # Anthropic usage includes: input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens
        usage = None
        if hasattr(response, "usage") and response.usage:
            input_tokens = response.usage.input_tokens or 0
            output_tokens = response.usage.output_tokens or 0
            cache_read_tokens = getattr(response.usage, "cache_read_input_tokens", 0) or 0
            cache_creation_tokens = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
            total_input_tokens = input_tokens + cache_read_tokens + cache_creation_tokens
            usage = TokenUsage(
                prompt_tokens=total_input_tokens,
                completion_tokens=output_tokens,
                total_tokens=total_input_tokens + output_tokens,
            )

        return LLMResponse(
            content=text_content,
            thinking=thinking_content if thinking_content else None,
            tool_calls=tool_calls if tool_calls else None,
            finish_reason=response.stop_reason or "stop",
            usage=usage,
        )

    async def generate(
        self,
        messages: list[Message],
        tools: list[Any] | None = None,
        model: str | None = None,
        thinking: bool | None = None,
        on_delta: Any = None,
    ) -> LLMResponse:
        """Generate response from Anthropic LLM.

        Args:
            messages: List of conversation messages
            tools: Optional list of available tools
            model: Optional model override for this call (defaults to self.model)
            thinking: Optional thinking override for this call.
                       True = force thinking on, False = force off, None = auto
                       (auto = on for M3, off otherwise).
            on_delta: Optional async callback(kind, content) invoked for
                       every content_block_delta chunk during streaming.
                       When set, the request streams and the callback fires
                       as the model generates. The returned LLMResponse
                       still contains the full final content.

        Returns:
            LLMResponse containing the generated content
        """
        # Prepare request
        request_params = self._prepare_request(messages, tools)

        # Make API request with retry logic
        if self.retry_config.enabled:
            # Apply retry logic
            retry_decorator = async_retry(config=self.retry_config, on_retry=self.retry_callback)
            api_call = retry_decorator(self._make_api_request)
            response = await api_call(
                request_params["system_message"],
                request_params["api_messages"],
                request_params["tools"],
                model=model,
                thinking=thinking,
                on_delta=on_delta,
            )
        else:
            # Don't use retry
            response = await self._make_api_request(
                request_params["system_message"],
                request_params["api_messages"],
                request_params["tools"],
                model=model,
                thinking=thinking,
                on_delta=on_delta,
            )

        # Parse and return response. If on_delta was used, the
        # Message carries the accumulated streamed text/thinking as
        # ``_streamed_*`` attributes; prefer those so we don't
        # re-parse the raw blocks (which would be empty since we
        # consumed the chunks via the callback).
        if on_delta is not None and getattr(response, "_streamed_text", None) is not None:
            return LLMResponse(
                content=response._streamed_text,
                thinking=response._streamed_thinking,
                tool_calls=response._streamed_tool_calls,
                finish_reason=response.stop_reason or "stop",
                usage=self._extract_usage(response),
            )

        # Parse and return response
        return self._parse_response(response)
