"""Tests for non-retryable error handling in mini_agent/retry.py.

Context: a 402 ``insufficient_balance_error`` from the Anthropic-compatible
endpoint used to burn 4 attempts and ~7s of backoff before surfacing an
error that only the user can fix (top up the pay-as-you-go balance).
Permanent 4xx now fail fast.
"""

import pytest

from mini_agent.retry import (
    NonRetryableError,
    RetryConfig,
    RetryExhaustedError,
    async_retry,
    is_retryable_exception,
)


class _StatusError(Exception):
    """Stand-in for the Anthropic SDK's APIStatusError."""

    def __init__(self, status_code, message="boom"):
        super().__init__(f"Error code: {status_code} - {message}")
        self.status_code = status_code


class TestIsRetryableException:
    @pytest.mark.parametrize("status", [400, 401, 402, 403, 404, 422])
    def test_permanent_client_errors_are_not_retryable(self, status):
        assert is_retryable_exception(_StatusError(status)) is False

    @pytest.mark.parametrize("status", [408, 409, 429])
    def test_transient_client_errors_are_retryable(self, status):
        assert is_retryable_exception(_StatusError(status)) is True

    @pytest.mark.parametrize("status", [500, 502, 503, 529])
    def test_server_errors_are_retryable(self, status):
        assert is_retryable_exception(_StatusError(status)) is True

    def test_connection_errors_without_status_are_retryable(self):
        assert is_retryable_exception(ConnectionResetError("reset")) is True
        assert is_retryable_exception(TimeoutError("timed out")) is True

    def test_402_insufficient_balance_is_not_retryable(self):
        """The exact error from the M3.1 pay-as-you-go billing failure."""
        exc = _StatusError(402, "{'error': {'type': 'insufficient_balance_error'}}")
        assert is_retryable_exception(exc) is False


class TestAsyncRetryBehavior:
    @pytest.mark.asyncio
    async def test_permanent_error_fails_on_first_attempt(self):
        """No retries, no backoff sleep — surface it immediately."""
        calls = []

        @async_retry(RetryConfig(max_retries=3, initial_delay=10.0))
        async def always_402():
            calls.append(1)
            raise _StatusError(402, "insufficient balance (1008)")

        with pytest.raises(NonRetryableError) as excinfo:
            await always_402()

        assert len(calls) == 1, "permanent error was retried"
        assert excinfo.value.status_code == 402
        assert "insufficient balance" in str(excinfo.value.original)

    @pytest.mark.asyncio
    async def test_transient_error_still_retries_and_exhausts(self):
        calls = []

        @async_retry(RetryConfig(max_retries=2, initial_delay=0.001))
        async def always_500():
            calls.append(1)
            raise _StatusError(500)

        with pytest.raises(RetryExhaustedError) as excinfo:
            await always_500()

        assert len(calls) == 3, "500 should use the full retry budget"
        assert excinfo.value.attempts == 3

    @pytest.mark.asyncio
    async def test_transient_error_then_success(self):
        calls = []

        @async_retry(RetryConfig(max_retries=3, initial_delay=0.001))
        async def flaky():
            calls.append(1)
            if len(calls) < 2:
                raise _StatusError(503)
            return "ok"

        assert await flaky() == "ok"
        assert len(calls) == 2

    @pytest.mark.asyncio
    async def test_non_retryable_wraps_original_cause(self):
        @async_retry(RetryConfig(max_retries=3, initial_delay=0.001))
        async def bad_key():
            raise _StatusError(401, "invalid api key")

        with pytest.raises(NonRetryableError) as excinfo:
            await bad_key()

        assert excinfo.value.status_code == 401
        assert isinstance(excinfo.value.original, _StatusError)


class TestAgentErrorMessage:
    """The message the user actually sees must be actionable, not raw JSON."""

    def test_402_message_explains_pay_as_you_go(self):
        from mini_agent.agent import _describe_llm_error

        original = _StatusError(402, "{'error': {'type': 'insufficient_balance_error'}}")
        msg = _describe_llm_error(NonRetryableError(original))

        assert "balance" in msg.lower()
        assert "pay-as-you-go" in msg.lower()
        assert "M3.1" in msg
        # Must not leak the raw provider payload at the user.
        assert "insufficient_balance_error" not in msg

    def test_401_message_points_at_settings(self):
        from mini_agent.agent import _describe_llm_error

        msg = _describe_llm_error(NonRetryableError(_StatusError(401)))
        assert "API key" in msg

    def test_retry_exhausted_still_reports_attempts(self):
        from mini_agent.agent import _describe_llm_error

        exc = RetryExhaustedError(_StatusError(500), 4)
        assert "4 retries" in _describe_llm_error(exc)

    def test_plain_exception_passes_through(self):
        from mini_agent.agent import _describe_llm_error

        assert "weird" in _describe_llm_error(ValueError("weird failure"))
