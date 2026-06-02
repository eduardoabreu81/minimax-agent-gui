"""Unit tests for ``mini_max_mcp.pricing``.

These tests cover the canonical pricing table from
https://platform.minimax.io/docs/guides/pricing-paygo.md plus a few
defensive cases (case-insensitive lookup, unknown models, zero-cost
combinations).
"""

from __future__ import annotations

import math
import unittest

from mini_max_mcp.pricing import (
    CREDIT_USD_RATE,
    calculate_image_cost,
    calculate_llm_cost,
    calculate_mcp_vlm_cost,
    calculate_music_cost,
    calculate_tts_cost,
    calculate_video_cost,
)


class TestCreditConversion(unittest.TestCase):
    """1 credit = $0.001 USD invariant."""

    def test_credit_usd_rate(self):
        self.assertEqual(CREDIT_USD_RATE, 0.001)

    def test_image_cost_round_trip(self):
        cost = calculate_image_cost(1)
        self.assertEqual(cost["cost_credits"], 4)
        self.assertAlmostEqual(cost["cost_usd"], 0.0035, places=4)
        # cost_credits == round(cost_usd * 1000)
        self.assertEqual(cost["cost_credits"], round(cost["cost_usd"] * 1000))


class TestImageCost(unittest.TestCase):
    def test_one_image(self):
        self.assertEqual(
            calculate_image_cost(1),
            {"cost_credits": 4, "cost_usd": 0.0035},
        )

    def test_four_images(self):
        # 4 * $0.0035 = $0.014 → 14 credits
        self.assertEqual(
            calculate_image_cost(4),
            {"cost_credits": 14, "cost_usd": 0.014},
        )

    def test_zero_images(self):
        self.assertEqual(
            calculate_image_cost(0),
            {"cost_credits": 0, "cost_usd": 0.0},
        )


class TestTTSCost(unittest.TestCase):
    def test_turbo_1000_chars(self):
        # 1000 chars * $60/1M = $0.06
        self.assertEqual(
            calculate_tts_cost(1000, "speech-2.8-turbo"),
            {"cost_credits": 60, "cost_usd": 0.06},
        )

    def test_hd_1000_chars(self):
        # 1000 chars * $100/1M = $0.10
        self.assertEqual(
            calculate_tts_cost(1000, "speech-2.8-hd"),
            {"cost_credits": 100, "cost_usd": 0.1},
        )

    def test_default_is_turbo(self):
        # Default model = speech-2.8-turbo
        self.assertEqual(
            calculate_tts_cost(1000),
            {"cost_credits": 60, "cost_usd": 0.06},
        )

    def test_unknown_model_falls_back_to_turbo(self):
        # Defensive: unknown model uses turbo rate (doesn't crash).
        self.assertEqual(
            calculate_tts_cost(1000, "speech-99.9-unknown"),
            {"cost_credits": 60, "cost_usd": 0.06},
        )

    def test_zero_chars(self):
        self.assertEqual(
            calculate_tts_cost(0, "speech-2.8-hd"),
            {"cost_credits": 0, "cost_usd": 0.0},
        )


class TestMusicCost(unittest.TestCase):
    def test_no_lyrics(self):
        self.assertEqual(
            calculate_music_cost(False),
            {"cost_credits": 150, "cost_usd": 0.15},
        )

    def test_with_lyrics(self):
        self.assertEqual(
            calculate_music_cost(True),
            {"cost_credits": 160, "cost_usd": 0.16},
        )


class TestMCPVLMCost(unittest.TestCase):
    def test_one_request(self):
        self.assertEqual(
            calculate_mcp_vlm_cost(1),
            {"cost_credits": 60, "cost_usd": 0.06},
        )

    def test_three_requests(self):
        self.assertEqual(
            calculate_mcp_vlm_cost(3),
            {"cost_credits": 180, "cost_usd": 0.18},
        )


class TestVideoCost(unittest.TestCase):
    """Video pricing — strict table + case-insensitive lookup."""

    # --- Canonical (uppercase) lookups from the pricing page -------------

    def test_hailuo_2_3_768p_6s(self):
        self.assertEqual(
            calculate_video_cost("MiniMax-Hailuo-2.3", "768P", 6),
            {"cost_credits": 280, "cost_usd": 0.28},
        )

    def test_hailuo_2_3_768p_10s(self):
        self.assertEqual(
            calculate_video_cost("MiniMax-Hailuo-2.3", "768P", 10),
            {"cost_credits": 560, "cost_usd": 0.56},
        )

    def test_hailuo_2_3_1080p_6s(self):
        self.assertEqual(
            calculate_video_cost("MiniMax-Hailuo-2.3", "1080P", 6),
            {"cost_credits": 490, "cost_usd": 0.49},
        )

    def test_hailuo_2_3_fast_768p_6s(self):
        self.assertEqual(
            calculate_video_cost("MiniMax-Hailuo-2.3-Fast", "768P", 6),
            {"cost_credits": 190, "cost_usd": 0.19},
        )

    def test_hailuo_2_3_fast_768p_10s(self):
        self.assertEqual(
            calculate_video_cost("MiniMax-Hailuo-2.3-Fast", "768P", 10),
            {"cost_credits": 320, "cost_usd": 0.32},
        )

    def test_hailuo_2_3_fast_1080p_6s(self):
        self.assertEqual(
            calculate_video_cost("MiniMax-Hailuo-2.3-Fast", "1080P", 6),
            {"cost_credits": 330, "cost_usd": 0.33},
        )

    # --- The exact spec verification command ------------------------------

    def test_spec_command_768p_lowercase(self):
        """The verifier ran the spec command with '768p' (lowercase).
        This test pins that behaviour: lookup must be case-insensitive."""
        self.assertEqual(
            calculate_video_cost("MiniMax-Hailuo-2.3", "768p", 6),
            {"cost_credits": 280, "cost_usd": 0.28},
        )

    # --- Case insensitivity (regression guard) ---------------------------

    def test_resolution_lowercase(self):
        for res_in, res_canonical in [("768p", "768P"), ("1080p", "1080P")]:
            with self.subTest(res=res_in):
                cost = calculate_video_cost("MiniMax-Hailuo-2.3", res_in, 6)
                cost_canonical = calculate_video_cost("MiniMax-Hailuo-2.3", res_canonical, 6)
                self.assertEqual(cost, cost_canonical)

    def test_model_lowercase(self):
        cost = calculate_video_cost("minimax-hailuo-2.3", "768P", 6)
        self.assertEqual(cost, {"cost_credits": 280, "cost_usd": 0.28})

    def test_model_mixed_case(self):
        cost = calculate_video_cost("MINIMAX-HAILUO-2.3", "768P", 6)
        self.assertEqual(cost, {"cost_credits": 280, "cost_usd": 0.28})

    # --- Defensive: unknown / empty / not offered ------------------------

    def test_unknown_model(self):
        cost = calculate_video_cost("BogusModel", "768P", 6)
        self.assertEqual(cost, {"cost_credits": 0, "cost_usd": 0.0})

    def test_unknown_resolution(self):
        cost = calculate_video_cost("MiniMax-Hailuo-2.3", "4K", 6)
        self.assertEqual(cost, {"cost_credits": 0, "cost_usd": 0.0})

    def test_1080p_10s_not_offered(self):
        # 10s @ 1080P is not in the official table.
        cost = calculate_video_cost("MiniMax-Hailuo-2.3", "1080P", 10)
        self.assertEqual(cost, {"cost_credits": 0, "cost_usd": 0.0})

    def test_empty_model(self):
        cost = calculate_video_cost("", "768P", 6)
        self.assertEqual(cost, {"cost_credits": 0, "cost_usd": 0.0})

    def test_none_model(self):
        cost = calculate_video_cost(None, "768P", 6)
        self.assertEqual(cost, {"cost_credits": 0, "cost_usd": 0.0})


class TestLLMCost(unittest.TestCase):
    """LLM pricing — three models + M3 long-context tier."""

    def test_m3_short_context(self):
        # 1000 in @ $0.30/M + 500 out @ $1.20/M = $0.0009
        self.assertEqual(
            calculate_llm_cost("MiniMax-M3", 1000, 500),
            {"cost_credits": 1, "cost_usd": 0.0009},
        )

    def test_m3_exactly_at_threshold_uses_short_rate(self):
        # 512k input is still the short-context rate (threshold is >512k).
        cost = calculate_llm_cost("MiniMax-M3", 512_000, 0)
        expected_usd = (512_000 / 1_000_000) * 0.30
        self.assertAlmostEqual(cost["cost_usd"], expected_usd, places=4)
        self.assertEqual(cost["cost_credits"], round(expected_usd * 1000))

    def test_m3_just_above_threshold_uses_long_rate(self):
        # 512_001 input (one token past the threshold) flips to the long-context
        # rate: condition in pricing.py is ``in_tokens > long_threshold`` (strict).
        # (512_001 / 1_000_000) * 1.20 = 0.6144012 → 0.6144 USD, 614 credits.
        cost = calculate_llm_cost("MiniMax-M3", 512_001, 0)
        expected_usd = (512_001 / 1_000_000) * 1.20
        self.assertAlmostEqual(cost["cost_usd"], expected_usd, places=4)
        self.assertEqual(cost["cost_credits"], round(expected_usd * 1000))

    def test_m3_long_context(self):
        # 600k in @ $1.20/M + 1000 out @ $4.80/M = 0.72 + 0.0048 = 0.7248
        self.assertEqual(
            calculate_llm_cost("MiniMax-M3", 600_000, 1000),
            {"cost_credits": 725, "cost_usd": 0.7248},
        )

    def test_m3_long_context_1m_1m(self):
        # 1M in @ $1.20/M + 1M out @ $4.80/M = 1.20 + 4.80 = 6.00
        # 1M input crosses the 512k threshold → long-context rate applies.
        self.assertEqual(
            calculate_llm_cost("MiniMax-M3", 1_000_000, 1_000_000),
            {"cost_credits": 6000, "cost_usd": 6.0},
        )

    def test_m3_short_context_500k_1m(self):
        # 500k in @ $0.30/M + 1M out @ $1.20/M = 0.15 + 1.20 = 1.35
        # 500k input is below the 512k threshold → short-context rate applies.
        self.assertEqual(
            calculate_llm_cost("MiniMax-M3", 500_000, 1_000_000),
            {"cost_credits": 1350, "cost_usd": 1.35},
        )

    def test_m2_7(self):
        # Same as M3 short rate.
        self.assertEqual(
            calculate_llm_cost("MiniMax-M2.7", 1000, 500),
            {"cost_credits": 1, "cost_usd": 0.0009},
        )

    def test_m2_7_highspeed(self):
        # 2x rate: 1000 in @ $0.60/M + 500 out @ $2.40/M = 0.0006 + 0.0012 = 0.0018
        self.assertEqual(
            calculate_llm_cost("MiniMax-M2.7-highspeed", 1000, 500),
            {"cost_credits": 2, "cost_usd": 0.0018},
        )

    def test_unknown_model_returns_zero(self):
        # Defensive: never crash on a new model.
        self.assertEqual(
            calculate_llm_cost("UnknownModel", 1000, 500),
            {"cost_credits": 0, "cost_usd": 0.0},
        )

    def test_zero_tokens(self):
        self.assertEqual(
            calculate_llm_cost("MiniMax-M3", 0, 0),
            {"cost_credits": 0, "cost_usd": 0.0},
        )

    def test_negative_input_clamped(self):
        # Negative input shouldn't happen, but clamp to 0.
        self.assertEqual(
            calculate_llm_cost("MiniMax-M3", -100, 500),
            {"cost_credits": 1, "cost_usd": 0.0006},
        )


class TestCreditRounding(unittest.TestCase):
    """Verify that ``cost_credits == round(cost_usd * 1000)`` always holds."""

    def test_relationship_holds_for_all_functions(self):
        cases = [
            calculate_image_cost(7),
            calculate_tts_cost(12345, "speech-2.8-turbo"),
            calculate_tts_cost(12345, "speech-2.8-hd"),
            calculate_music_cost(True),
            calculate_mcp_vlm_cost(11),
            calculate_video_cost("MiniMax-Hailuo-2.3", "768P", 6),
            calculate_video_cost("MiniMax-Hailuo-2.3", "1080P", 6),
            calculate_video_cost("MiniMax-Hailuo-2.3-Fast", "768P", 10),
            calculate_llm_cost("MiniMax-M3", 12345, 6789),
            calculate_llm_cost("MiniMax-M2.7", 100000, 50000),
        ]
        for cost in cases:
            with self.subTest(cost=cost):
                self.assertEqual(
                    cost["cost_credits"],
                    round(cost["cost_usd"] * 1000),
                )
                # 4-decimal invariant
                self.assertEqual(
                    cost["cost_usd"],
                    round(cost["cost_usd"], 4),
                )


if __name__ == "__main__":
    unittest.main()
