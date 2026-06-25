"""End-to-end tests for the music-cover flow (Phase 2).

Covers:
  - /api/minimax/music/preprocess — preprocess endpoint (validation + happy path)
  - /api/music with music-cover / music-cover-free — extended MusicRequest
    model (exclusivity, prompt requirements, lyrics rules per cover mode)
  - Pydantic-level mutual exclusion (audio_url / audio_base64 / cover_feature_id)
  - Rejection of is_instrumental and lyrics_optimizer on cover models
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

# Fake audio payload (same as Phase 1 — backend decodes the same hex).
FAKE_HEX = "00" * 24
FAKE_GENERATION_PAYLOAD = {
    "data": {"audio": FAKE_HEX, "status": 2},
    "extra_info": {
        "music_duration": 42000,
        "music_sample_rate": 44100,
        "music_channel": 2,
        "bitrate": 256000,
        "music_size": 24,
    },
    "trace_id": "fake-trace-cover",
    "base_resp": {"status_code": 0, "status_msg": "success"},
}

FAKE_PREPROCESS_PAYLOAD = {
    "cover_feature_id": "a1b2c3d4e5f67890abcdef1234567890",
    "formatted_lyrics": "[Verse 1]\nFirst line of the song\n\n[Chorus]\nThis is the chorus",
    "structure_result": '{"num_segments":2,"segments":[{"start":0,"end":15,"label":"verse"},{"start":15,"end":30,"label":"chorus"}]}',
    "audio_duration": 90,
    "trace_id": "fake-trace-preprocess",
    "base_resp": {"status_code": 0, "status_msg": "success"},
}

# Per-test overrides. Each endpoint router picks the right payload.
GENERATION_PAYLOAD = {"value": FAKE_GENERATION_PAYLOAD}
PREPROCESS_PAYLOAD = {"value": FAKE_PREPROCESS_PAYLOAD}

def fake_post_json(self, endpoint, data, timeout=120.0):
    if endpoint == "/v1/music_generation":
        return True, GENERATION_PAYLOAD["value"]
    if endpoint == "/v1/music_cover_preprocess":
        return True, PREPROCESS_PAYLOAD["value"]
    return False, {"status_msg": f"Unexpected endpoint: {endpoint}"}

# Make sure a config.yaml exists so get_minimax_config works.
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

    # ============ /api/minimax/music/preprocess ============

    print("=== T1: preprocess — happy path with audio_url ===")
    r = client.post(
        "/api/minimax/music/preprocess",
        json={"audio_url": "https://example.com/song.mp3"},
    )
    expect("status", r.status_code, 200)
    d = r.json()
    expect("success", d.get("success"), True)
    expect("cover_feature_id present", bool(d.get("cover_feature_id")), True)
    expect("formatted_lyrics present", bool(d.get("formatted_lyrics")), True)
    expect("audio_duration present", bool(d.get("audio_duration")), True)
    expect("feature_expires_at present", bool(d.get("feature_expires_at")), True)
    print(f"  cover_feature_id={d.get('cover_feature_id')[:16]}... expires_at={d.get('feature_expires_at')[:19]}")

    print()
    print("=== T2: preprocess — neither audio_url nor audio_base64 → 400 ===")
    r = client.post("/api/minimax/music/preprocess", json={})
    expect("status", r.status_code, 400)

    print()
    print("=== T3: preprocess — both audio_url and audio_base64 → 400 ===")
    r = client.post(
        "/api/minimax/music/preprocess",
        json={"audio_url": "https://x.com/a.mp3", "audio_base64": "abc"},
    )
    expect("status", r.status_code, 400)

    # ============ /api/music with music-cover ============

    print()
    print("=== T4: music-cover one-step — audio_url + prompt + (auto-ASR lyrics) ===")
    r = client.post(
        "/api/music",
        json={
            "model": "music-cover",
            "prompt": "Jazz, smooth, late night lounge, saxophone",
            "lyrics": "",
            "audio_url": "https://example.com/original.mp3",
        },
    )
    expect("status", r.status_code, 200)
    d = r.json()
    expect("filename ends in .mp3", (d.get("filename") or "").endswith(".mp3"), True)

    print()
    print("=== T5: music-cover two-step — cover_feature_id + lyrics ===")
    r = client.post(
        "/api/music",
        json={
            "model": "music-cover",
            "prompt": "Jazz, smooth, late night lounge, saxophone",
            "lyrics": "[Verse 1]\nCustom lyrics for the cover\n\n[Chorus]\nSing it out",
            "cover_feature_id": "abc123feature",
        },
    )
    expect("status", r.status_code, 200)

    print()
    print("=== T6: music-cover two-step — cover_feature_id without lyrics → 422 ===")
    r = client.post(
        "/api/music",
        json={
            "model": "music-cover",
            "prompt": "Jazz, smooth, late night lounge, saxophone",
            "lyrics": "",
            "cover_feature_id": "abc123feature",
        },
    )
    expect("status", r.status_code, 422)
    msgs = [e.get("msg", "") for e in r.json().get("detail", [])[:1]]
    print(f"  msg: {msgs[0][:140] if msgs else '(none)'}")

    print()
    print("=== T7: music-cover — no audio source (all 3 empty) → 422 ===")
    r = client.post(
        "/api/music",
        json={
            "model": "music-cover",
            "prompt": "Jazz, smooth, late night lounge, saxophone",
            "lyrics": "Some lyrics",
        },
    )
    expect("status", r.status_code, 422)

    print()
    print("=== T8: music-cover — audio_url + cover_feature_id (both set) → 422 ===")
    r = client.post(
        "/api/music",
        json={
            "model": "music-cover",
            "prompt": "Jazz, smooth, late night lounge, saxophone",
            "lyrics": "Some lyrics",
            "audio_url": "https://x.com/a.mp3",
            "cover_feature_id": "abc",
        },
    )
    expect("status", r.status_code, 422)

    print()
    print("=== T9: music-cover — prompt < 10 chars → 422 ===")
    r = client.post(
        "/api/music",
        json={
            "model": "music-cover",
            "prompt": "Jazz",
            "lyrics": "Some lyrics",
            "audio_url": "https://x.com/a.mp3",
        },
    )
    expect("status", r.status_code, 422)

    print()
    print("=== T10: music-cover — prompt > 300 chars → 422 ===")
    r = client.post(
        "/api/music",
        json={
            "model": "music-cover",
            "prompt": "x" * 301,
            "lyrics": "Some lyrics",
            "audio_url": "https://x.com/a.mp3",
        },
    )
    expect("status", r.status_code, 422)

    print()
    print("=== T11: music-cover — is_instrumental rejected → 422 ===")
    r = client.post(
        "/api/music",
        json={
            "model": "music-cover",
            "prompt": "Jazz, smooth, late night lounge",
            "lyrics": "Some lyrics",
            "is_instrumental": True,
            "audio_url": "https://x.com/a.mp3",
        },
    )
    expect("status", r.status_code, 422)

    print()
    print("=== T12: music-cover — lyrics_optimizer rejected → 422 ===")
    r = client.post(
        "/api/music",
        json={
            "model": "music-cover",
            "prompt": "Jazz, smooth, late night lounge",
            "lyrics": "Some lyrics",
            "lyrics_optimizer": True,
            "audio_url": "https://x.com/a.mp3",
        },
    )
    expect("status", r.status_code, 422)

    print()
    print("=== T13: music-cover-free (free tier) — same flow as music-cover ===")
    r = client.post(
        "/api/music",
        json={
            "model": "music-cover-free",
            "prompt": "Acoustic, campfire, storytelling vibe",
            "lyrics": "Some lyrics",
            "audio_url": "https://x.com/a.mp3",
        },
    )
    expect("status", r.status_code, 200)

    print()
    print("=== T14: Phase 1 guard — music-2.6 + audio_url still rejected ===")
    r = client.post(
        "/api/music",
        json={
            "model": "music-2.6",
            "prompt": "Blues",
            "lyrics": "[Verse] x",
            "audio_url": "https://x.com/a.mp3",
        },
    )
    expect("status", r.status_code, 422)

    print()
    print("All music-cover tests done.")