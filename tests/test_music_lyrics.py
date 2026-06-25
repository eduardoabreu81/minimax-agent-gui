"""End-to-end tests for the music-lyrics flow (Phase 3 — lyrics_generation).

Covers:
  - /api/minimax/music/lyrics — happy path (write_full_song + edit modes)
  - Pydantic Literal validation for mode
  - Per-mode validation (prompt required in write, lyrics required in edit)
  - Length limits (prompt ≤2000, lyrics ≤3500 in edit)
  - Error code mapping (2013 → 400, 1008 → 402, etc.)
"""

import os
import sys
from pathlib import Path
import unittest.mock as mock

import mini_max_mcp.client as mc  # noqa: E402

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CFG_PATH = PROJECT_ROOT / 'config' / 'config.yaml'
# Resolve PROJECT_ROOT from this test file's location so paths work
# cross-platform without hardcoding any developer-specific path.
os.environ.setdefault("MINIMAX_PROJECT_ROOT", str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "web" / "backend"))

FAKE_LYRICS_PAYLOAD = {
    "song_title": "Midnight Rain",
    "style_tags": "Soulful, Blues, Rainy Night, Electric Guitar",
    "lyrics": (
        "[Verse]\nThe sky is cryin' on the roof tonight\n"
        "[Chorus]\nMidnight rain, fallin' down on me"
    ),
    "trace_id": "fake-trace-lyrics",
    "base_resp": {"status_code": 0, "status_msg": "success"},
}

LYRICS_PAYLOAD = {"value": FAKE_LYRICS_PAYLOAD}

def fake_post_json(self, endpoint, data, timeout=120.0):
    if endpoint == "/v1/lyrics_generation":
        return True, LYRICS_PAYLOAD["value"]
    return False, {"status_msg": f"Unexpected endpoint: {endpoint}"}

os.makedirs(os.path.dirname(CFG_PATH), exist_ok=True)
if not os.path.exists(CFG_PATH):
    with open(CFG_PATH, "w", encoding="utf-8") as f:
        f.write("minimax:\n  api_key: sk-test-fake\n  api_base: https://api.minimax.io\n  region: global\n")

with mock.patch.object(mc.MiniMaxSyncClient, "_post_json", fake_post_json):
    from fastapi.testclient import TestClient  # noqa: E402

    import main as backend  # noqa: E402

    client = TestClient(backend.app)

    def expect(label, actual, want):
        ok = "OK" if actual == want else "FAIL"
        print(f"  [{ok}] {label}: got={actual} want={want}")
        return actual == want

    print("=== T1: write_full_song — happy path ===")
    r = client.post(
        "/api/minimax/music/lyrics",
        json={
            "mode": "write_full_song",
            "prompt": "A soulful blues song about a rainy night",
            "title": "Midnight Rain",
        },
    )
    expect("status", r.status_code, 200)
    d = r.json()
    expect("success", d.get("success"), True)
    expect("song_title", d.get("song_title"), "Midnight Rain")
    expect("style_tags present", bool(d.get("style_tags")), True)
    expect("lyrics present", bool(d.get("lyrics")), True)
    expect("trace_id", d.get("trace_id"), "fake-trace-lyrics")

    print()
    print("=== T2: edit mode — happy path with existing lyrics ===")
    r = client.post(
        "/api/minimax/music/lyrics",
        json={
            "mode": "edit",
            "prompt": "Make the chorus more upbeat",
            "lyrics": "[Verse]\nThe sky is cryin' on the roof tonight\n[Chorus]\nRain",
        },
    )
    expect("status", r.status_code, 200)
    d = r.json()
    expect("success", d.get("success"), True)

    print()
    print("=== T3: write_full_song without prompt → 400 ===")
    r = client.post(
        "/api/minimax/music/lyrics",
        json={"mode": "write_full_song", "prompt": ""},
    )
    expect("status", r.status_code, 400)

    print()
    print("=== T4: edit mode without existing lyrics → 400 ===")
    r = client.post(
        "/api/minimax/music/lyrics",
        json={"mode": "edit", "prompt": "Make it shorter", "lyrics": ""},
    )
    expect("status", r.status_code, 400)

    print()
    print("=== T5: prompt > 2000 chars → 400 ===")
    r = client.post(
        "/api/minimax/music/lyrics",
        json={"mode": "write_full_song", "prompt": "x" * 2001},
    )
    expect("status", r.status_code, 400)

    print()
    print("=== T6: edit lyrics > 3500 chars → 400 ===")
    r = client.post(
        "/api/minimax/music/lyrics",
        json={"mode": "edit", "prompt": "refine", "lyrics": "x" * 3501},
    )
    expect("status", r.status_code, 400)

    print()
    print("=== T7: invalid mode (Literal) → 422 ===")
    r = client.post(
        "/api/minimax/music/lyrics",
        json={"mode": "refine", "prompt": "x"},
    )
    expect("status", r.status_code, 422)

    print()
    print("=== T8: 2013 (invalid params) maps to 400 ===")
    LYRICS_PAYLOAD["value"] = {
        "base_resp": {"status_code": 2013, "status_msg": "invalid params"},
    }
    r = client.post(
        "/api/minimax/music/lyrics",
        json={"mode": "write_full_song", "prompt": "x"},
    )
    expect("status", r.status_code, 400)

    print()
    print("=== T9: 1008 (insufficient balance) maps to 402 ===")
    LYRICS_PAYLOAD["value"] = {
        "base_resp": {"status_code": 1008, "status_msg": "insufficient balance"},
    }
    r = client.post(
        "/api/minimax/music/lyrics",
        json={"mode": "write_full_song", "prompt": "x"},
    )
    expect("status", r.status_code, 402)

    print()
    print("=== T10: empty title is allowed (auto-generated by API) ===")
    LYRICS_PAYLOAD["value"] = FAKE_LYRICS_PAYLOAD
    r = client.post(
        "/api/minimax/music/lyrics",
        json={"mode": "write_full_song", "prompt": "A rainy blues song", "title": ""},
    )
    expect("status", r.status_code, 200)

    print()
    print("All music-lyrics tests done.")