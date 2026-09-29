"""Tests for the MiniMax-M3.1-Flash-Preview always-on-thinking path.

M3.1 Flash reasons unconditionally: MiniMax turns thinking on by default and
exposes no `disabled` value. Depth is tuned with `output_config.effort`
instead of the on/off `thinking` param. These tests pin that contract so a
future refactor doesn't start sending `thinking: disabled` to a model that
rejects it.
"""

import pytest

from mini_agent.llm.anthropic_client import AnthropicClient

M31 = "MiniMax-M3.1-Flash-Preview"
M3 = "MiniMax-M3"
M27 = "MiniMax-M2.7"


@pytest.fixture
def client():
    """An AnthropicClient with a stubbed SDK so no network call is made."""
    c = AnthropicClient(api_key="test-key", model=M31)
    return c


class _Recorder:
    """Captures the params dict handed to `messages.stream()`."""

    def __init__(self) -> None:
        self.params = None

    async def __call__(self, **params):
        self.params = params
        raise _StopStream()


class _StopStream(Exception):
    """Raised from the fake stream context to unwind the request build."""


async def _capture_params(client, **kwargs) -> dict:
    """Build the request params without hitting the network."""
    recorder = _Recorder()

    class _FakeStream:
        def __init__(self, params):
            self.params = params

        async def __aenter__(self):
            recorder.params = self.params
            raise _StopStream()

        async def __aexit__(self, *exc):
            return False

    class _FakeMessages:
        def stream(self, **params):
            return _FakeStream(params)

    client.client.messages = _FakeMessages()
    with pytest.raises(_StopStream):
        await client._make_api_request(None, [{"role": "user", "content": "hi"}], **kwargs)
    return recorder.params


@pytest.mark.asyncio
async def test_m31_never_sends_thinking_param(client):
    """No `thinking` key at all — the model has no `disabled` value."""
    params = await _capture_params(client, model=M31, thinking=False)
    assert "thinking" not in params


@pytest.mark.asyncio
async def test_m31_sends_output_config_effort(client):
    params = await _capture_params(client, model=M31, effort="high")
    assert params["output_config"] == {"effort": "high"}


@pytest.mark.asyncio
async def test_m31_accepts_xhigh_despite_sdk_literal(client):
    """`xhigh` is MiniMax-documented but missing from the SDK's Literal.

    TypedDicts aren't enforced at runtime, so it must still be forwarded.
    """
    params = await _capture_params(client, model=M31, effort="xhigh")
    assert params["output_config"] == {"effort": "xhigh"}


@pytest.mark.asyncio
async def test_m31_omits_output_config_for_unknown_effort(client):
    """A bogus level is dropped rather than forwarded to the API."""
    params = await _capture_params(client, model=M31, effort="turbo")
    assert "output_config" not in params


@pytest.mark.asyncio
async def test_m31_max_tokens_uses_published_output_limit(client):
    params = await _capture_params(client, model=M31)
    assert params["max_tokens"] == 512_000


@pytest.mark.asyncio
async def test_m3_still_uses_adaptive_thinking_not_effort(client):
    """M3 keeps the on/off toggle; `effort` must not leak into its request."""
    params = await _capture_params(client, model=M3, thinking=True, effort="high")
    assert params["thinking"] == {"type": "adaptive"}
    assert "output_config" not in params


@pytest.mark.asyncio
async def test_m3_can_disable_thinking(client):
    params = await _capture_params(client, model=M3, thinking=False)
    assert params["thinking"] == {"type": "disabled"}


@pytest.mark.asyncio
async def test_m27_auto_never_sends_thinking(client):
    """Auto (thinking=None) leaves M2.7 alone — it's not in THINKING_SUPPORTED."""
    params = await _capture_params(client, model=M27)
    assert "thinking" not in params
    assert "output_config" not in params


@pytest.mark.asyncio
async def test_m27_ignores_effort(client):
    """`effort` is M3.1-only; M2.7 must never get `output_config`."""
    params = await _capture_params(client, model=M27, effort="high")
    assert "output_config" not in params


def test_m31_is_registered_in_model_tables():
    """M3.1 must be present in every lookup the summarizer + client use."""
    assert AnthropicClient.MODEL_CONTEXT_LIMITS[M31] == 1_000_000
    assert M31 in AnthropicClient.THINKING_SUPPORTED
    assert M31 in AnthropicClient.THINKING_ALWAYS_ON


def test_default_client_model_is_m3():
    """M3.1 stays out of the default slot on purpose.

    M3.1-Flash-Preview bills the pay-as-you-go balance instead of the
    Token Plan quota — a Token Plan-only account gets HTTP 402
    (insufficient_balance_error) on the very first message. Shipping it
    as the default would break every such user; it stays selectable in
    the picker only.
    """
    assert AnthropicClient(api_key="k").model == "MiniMax-M3"
