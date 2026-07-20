"""Regression tests for the ``/v1/video_generation`` request body.

The MiniMax API rejects unknown request keys with
``[Error 2013] invalid params``. The previous client forwarded
``fast_pretreatment`` (a legacy field for ``abab-video-1``) on every call,
which made every Hailuo 2.3 video generation fail at the API. These
tests pin the wire-level contract so the regression cannot return.
"""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from mini_max_mcp.client import (
    MiniMaxSyncClient,
    format_api_error,
)


class _CapturingSession:
    """Stand-in for ``requests.Session`` that records the last JSON body."""

    def __init__(self):
        self.last_json = None

    def post(self, url, json=None, timeout=None, **_):  # pragma: no cover - trivial
        self.last_json = json
        return _StubResponse(
            json_data={"task_id": "stub-123"},
        )

    def get(self, url, params=None, timeout=None, **_):  # pragma: no cover - unused
        return _StubResponse(json_data={"status": "Success", "file_id": "fid"})


class _StubResponse:
    status_code = 200
    headers = {}
    ok = True

    def __init__(self, json_data):
        self._json = json_data
        self.text = json.dumps(json_data)
        self.content = self.text.encode()

    def raise_for_status(self):
        return None

    def json(self):
        return self._json

@pytest.fixture
def client(monkeypatch):
    cli = MiniMaxSyncClient(api_key="sk-test", api_base="https://api.example.test")
    sess = _CapturingSession()
    monkeypatch.setattr(cli, "session", sess)
    return cli, sess


# ── Request body shape ──────────────────────────────────────────────────


def test_text2video_request_omits_fast_pretreatment(client):
    """The user's reported failure mode: text2video, standard model,
    no frame inputs. The wire body MUST NOT contain ``fast_pretreatment``
    or the live API replies with 2013."""
    cli, sess = client
    ok, task_id = cli.video_generate(
        prompt="a cat walking on a beach",
        model="MiniMax-Hailuo-2.3",
        duration=6,
        resolution="768P",
        prompt_optimizer=False,
    )
    assert ok is True
    assert task_id == "stub-123"
    body = sess.last_json
    assert "fast_pretreatment" not in body, (
        "fast_pretreatment is not part of the Hailuo 2.3 spec; sending it "
        "triggers [Error 2013] from the live API."
    )
    # Sanity: required keys present.
    assert body["model"] == "MiniMax-Hailuo-2.3"
    assert body["prompt"] == "a cat walking on a beach"
    assert body["duration"] == 6
    assert body["resolution"] == "768P"
    assert body["prompt_optimizer"] is False


def test_text2video_request_minimal_keys(client):
    """The wire body should contain exactly the documented keys for a
    pure text2video call — no extra defaults bleeding through."""
    cli, sess = client
    cli.video_generate(prompt="hello")
    body = sess.last_json
    assert set(body.keys()) == {
        "model",
        "prompt",
        "duration",
        "resolution",
        "prompt_optimizer",
    }


def test_image2video_adds_first_frame_image(client):
    cli, sess = client
    cli.video_generate(
        prompt="a cat walks",
        first_frame_image="data:image/png;base64,AAAA",
    )
    assert sess.last_json["first_frame_image"] == "data:image/png;base64,AAAA"
    assert "fast_pretreatment" not in sess.last_json


def test_sef_adds_both_frames(client):
    cli, sess = client
    cli.video_generate(
        prompt="a cat walks",
        first_frame_image="data:image/png;base64,AAAA",
        last_frame_image="data:image/png;base64,BBBB",
    )
    assert sess.last_json["first_frame_image"] == "data:image/png;base64,AAAA"
    assert sess.last_json["last_frame_image"] == "data:image/png;base64,BBBB"
    assert "fast_pretreatment" not in sess.last_json


def test_s2v_adds_subject_reference(client):
    cli, sess = client
    cli.video_generate(
        prompt="a cat walks",
        subject_reference=["data:image/png;base64,AAAA"],
    )
    assert sess.last_json["subject_reference"] == ["data:image/png;base64,AAAA"]
    assert "fast_pretreatment" not in sess.last_json


# ── format_api_error surfaces the live status_msg ───────────────────────


def test_format_api_error_includes_api_status_msg():
    """The previous code lost the API's ``status_msg`` and always printed
    the canned 'Please check the request parameters' hint. Append the
    live message so the user can see which field is wrong."""
    rendered = format_api_error(2013, "param prompt_optimizer is invalid")
    assert "param prompt_optimizer is invalid" in rendered
    # Original prefix preserved for backward compatibility.
    assert rendered.startswith("[Error 2013] invalid params.")


def test_format_api_error_without_status_msg_stays_canonical():
    """When the API didn't supply a status_msg (or echoed the canned
    text), keep the original message — no trailing ``(API: ...)``."""
    assert format_api_error(2013, "") == (
        "[Error 2013] invalid params. Please check the request parameters."
    )
    # Echoed canned text should be deduplicated too.
    assert format_api_error(2013, "invalid params") == (
        "[Error 2013] invalid params. Please check the request parameters."
    )
