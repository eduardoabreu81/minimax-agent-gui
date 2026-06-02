"""MiniMax pricing utilities.

Single source of truth for cost calculations across the backend.

Pricing source: https://platform.minimax.io/docs/guides/pricing-paygo.md
(MiniMax Token Plan — pay-as-you-go rates used as the conversion factor).

Convention:
  - 1 credit = $0.001 USD
  - cost_credits = round(cost_usd * 1000)
  - All amounts returned as ``{"cost_credits": int, "cost_usd": float}`` with
    ``cost_usd`` rounded to 4 decimals.

Functions are pure and side-effect free so they can be reused from the FastAPI
endpoints, the agent tools, and tests without touching the network.
"""

from __future__ import annotations

import logging
from typing import Optional

_logger = logging.getLogger(__name__)


# --- Conversion constants ----------------------------------------------------

CREDIT_USD_RATE: float = 0.001  # 1 credit == $0.001
USD_DECIMALS: int = 4


# --- LLM pricing (USD per 1M tokens) ----------------------------------------

LLM_PRICING: dict = {
    # model_name -> {"input": price_input_per_1m, "output": price_output_per_1m}
    "MiniMax-M3": {
        "input": 0.30,
        "output": 1.20,
        "long_context_threshold": 512_000,
        "long_context_input": 1.20,
        "long_context_output": 4.80,
    },
    "MiniMax-M2.7": {
        "input": 0.30,
        "output": 1.20,
    },
    "MiniMax-M2.7-highspeed": {
        "input": 0.60,
        "output": 2.40,
    },
}


# --- TTS pricing (USD per 1M characters) -----------------------------------

TTS_PRICING: dict = {
    "speech-2.8-turbo": 60.0,
    "speech-2.8-hd": 100.0,
}


# --- Image pricing (USD per image) -----------------------------------------

IMAGE_PRICING_PER_UNIT: float = 0.0035


# --- Music pricing (USD per song) ------------------------------------------

MUSIC_BASE_USD: float = 0.15
MUSIC_LYRICS_USD: float = 0.01


# --- Video pricing table ----------------------------------------------------
# USD per video, keyed by (model, resolution, duration).

VIDEO_PRICING: dict = {
    "MiniMax-Hailuo-2.3": {
        "768P": {6: 0.28, 10: 0.56},
        "1080P": {6: 0.49, 10: None},  # 10s @ 1080P not offered in source
    },
    "MiniMax-Hailuo-2.3-Fast": {
        "768P": {6: 0.19, 10: 0.32},
        "1080P": {6: 0.33, 10: None},
    },
}


# --- MCP / VLM pricing (USD per request) -----------------------------------

MCP_VLM_PER_REQUEST_USD: float = 0.06


# --- Helpers ----------------------------------------------------------------


def _to_cost_dict(cost_usd: float) -> dict:
    """Convert a raw USD float into the standard cost payload.

    Rounds ``cost_usd`` to 4 decimals and derives integer credits.
    """
    cost_usd_rounded = round(max(cost_usd, 0.0), USD_DECIMALS)
    cost_credits = int(round(cost_usd_rounded / CREDIT_USD_RATE))
    return {"cost_credits": cost_credits, "cost_usd": cost_usd_rounded}


def calculate_llm_cost(model: str, input_tokens: int, output_tokens: int) -> dict:
    """Calculate cost for an LLM call.

    Args:
        model: Model identifier (e.g. ``"MiniMax-M3"``).
        input_tokens: Number of input tokens (prompt + tools + system).
        output_tokens: Number of output tokens (completion).

    Returns:
        ``{"cost_credits": int, "cost_usd": float}``. Falls back to zero
        for unknown models so callers never break on a new release.
    """
    pricing = LLM_PRICING.get(model)
    if pricing is None:
        _logger.warning("Unknown LLM model for pricing: %s — returning zero cost", model)
        return _to_cost_dict(0.0)

    in_tokens = max(int(input_tokens or 0), 0)
    out_tokens = max(int(output_tokens or 0), 0)

    long_threshold = pricing.get("long_context_threshold")
    if long_threshold and in_tokens > long_threshold:
        in_price = pricing.get("long_context_input", pricing["input"])
        out_price = pricing.get("long_context_output", pricing["output"])
    else:
        in_price = pricing["input"]
        out_price = pricing["output"]

    cost_usd = (in_tokens / 1_000_000) * in_price + (out_tokens / 1_000_000) * out_price
    return _to_cost_dict(cost_usd)


def calculate_image_cost(count: int = 1) -> dict:
    """Calculate cost for image generation.

    Args:
        count: Number of images generated (e.g. ``n=2`` → count=2).

    Returns:
        ``{"cost_credits": int, "cost_usd": float}``.
    """
    n = max(int(count or 0), 0)
    return _to_cost_dict(n * IMAGE_PRICING_PER_UNIT)


def calculate_tts_cost(text_chars: int, model: str = "speech-2.8-turbo") -> dict:
    """Calculate cost for TTS synthesis.

    Args:
        text_chars: Number of characters in the input text.
        model: TTS model id (``"speech-2.8-turbo"`` or ``"speech-2.8-hd"``).

    Returns:
        ``{"cost_credits": int, "cost_usd": float}``. Falls back to the
        turbo rate if the model is unknown.
    """
    chars = max(int(text_chars or 0), 0)
    price_per_million = TTS_PRICING.get(model, TTS_PRICING["speech-2.8-turbo"])
    if model not in TTS_PRICING:
        _logger.warning("Unknown TTS model for pricing: %s — using turbo rate", model)
    cost_usd = (chars / 1_000_000) * price_per_million
    return _to_cost_dict(cost_usd)


def calculate_music_cost(include_lyrics: bool = False) -> dict:
    """Calculate cost for music generation.

    Args:
        include_lyrics: Whether custom lyrics were provided (adds $0.01).

    Returns:
        ``{"cost_credits": int, "cost_usd": float}``.
    """
    cost_usd = MUSIC_BASE_USD + (MUSIC_LYRICS_USD if include_lyrics else 0.0)
    return _to_cost_dict(cost_usd)


def _ci_lookup(table: dict, key: str) -> object:
    """Case-insensitive dict lookup preserving the original key on miss.

    Used by pricing helpers so callers can pass ``"768p"`` or
    ``"minimax-hailuo-2.3"`` and still get a hit on the canonical
    ``"768P"`` / ``"MiniMax-Hailuo-2.3"`` entries.
    """
    if not key:
        return None
    if key in table:
        return table[key]
    upper = str(key).strip().upper()
    for canonical, value in table.items():
        if str(canonical).strip().upper() == upper:
            return value
    return None


def calculate_video_cost(
    model: str,
    resolution: str,
    duration: int,
) -> dict:
    """Calculate cost for video generation.

    Args:
        model: Video model id (e.g. ``"MiniMax-Hailuo-2.3"``). Matched
            case-insensitively — ``"minimax-hailuo-2.3"`` and
            ``"MINIMAX-HAILUO-2.3"`` resolve to the same entry.
        resolution: Resolution string (``"768P"`` or ``"1080P"``). Matched
            case-insensitively — ``"768p"`` and ``"1080p"`` are accepted.
        duration: Duration in seconds (6 or 10).

    Returns:
        ``{"cost_credits": int, "cost_usd": float}``. Returns zero cost
        with a warning for unknown combinations so the UI never crashes.
    """
    model_pricing = _ci_lookup(VIDEO_PRICING, model)
    if not model_pricing:
        _logger.warning("Unknown video model for pricing: %s", model)
        return _to_cost_dict(0.0)

    resolution_pricing = _ci_lookup(model_pricing, resolution)
    if not resolution_pricing:
        _logger.warning("Unknown video resolution for %s: %s", model, resolution)
        return _to_cost_dict(0.0)

    price = resolution_pricing.get(duration)
    if price is None:
        _logger.warning(
            "No published price for %s @ %s @ %ss — returning zero",
            model, resolution, duration,
        )
        return _to_cost_dict(0.0)

    return _to_cost_dict(price)


def calculate_mcp_vlm_cost(request_count: int = 1) -> dict:
    """Calculate cost for MCP VLM (image understanding) calls.

    Args:
        request_count: Number of VLM requests made.

    Returns:
        ``{"cost_credits": int, "cost_usd": float}``.
    """
    n = max(int(request_count or 0), 0)
    return _to_cost_dict(n * MCP_VLM_PER_REQUEST_USD)


def calculate_cost(kind: str, **kwargs) -> dict:
    """Dispatch helper that routes a generic ``kind`` string to the right function.

    Useful when cost calculation is driven by a config or event payload.
    """
    kind = (kind or "").lower()
    if kind == "llm":
        return calculate_llm_cost(**kwargs)
    if kind == "image":
        return calculate_image_cost(**kwargs)
    if kind == "tts":
        return calculate_tts_cost(**kwargs)
    if kind == "music":
        return calculate_music_cost(**kwargs)
    if kind == "video":
        return calculate_video_cost(**kwargs)
    if kind == "mcp_vlm":
        return calculate_mcp_vlm_cost(**kwargs)
    _logger.warning("Unknown cost kind: %s", kind)
    return {"cost_credits": 0, "cost_usd": 0.0}


__all__ = [
    "CREDIT_USD_RATE",
    "LLM_PRICING",
    "TTS_PRICING",
    "IMAGE_PRICING_PER_UNIT",
    "MUSIC_BASE_USD",
    "MUSIC_LYRICS_USD",
    "VIDEO_PRICING",
    "MCP_VLM_PER_REQUEST_USD",
    "calculate_llm_cost",
    "calculate_image_cost",
    "calculate_tts_cost",
    "calculate_music_cost",
    "calculate_video_cost",
    "calculate_mcp_vlm_cost",
    "calculate_cost",
]
