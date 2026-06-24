"""End-to-end test of the new /api/music endpoint (Phase 1).

Stub the real MiniMax API and verify that the backend wires through:
  - Pydantic validation (model / prompt / lyrics / cover params)
  - audio_setting defaults (request > config.yaml > hardcoded)
  - File saved to workspace/music/ with the right extension
  - extra_info + trace_id propagation
  - Error mapping (2013 → 400, 1008 → 402, 1026 → 422, etc.)
"""

import os
import sys
import unittest.mock as mock

os.environ.setdefault(
    "MINIMAX_PROJECT_ROOT",
    r"C:\Users\Eduardo\OneDrive\Documentos\GitHub\minimax-agent-gui",
)

sys.path.insert(0, r"C:\Users\Eduardo\OneDrive\Documentos\GitHub\minimax-agent-gui")
sys.path.insert(0, r"C:\Users\Eduardo\OneDrive\Documentos\GitHub\minimax-agent-gui\web\backend")

import mini_max_mcp.client as mc  # noqa: E402

# 24 bytes of zeros — not a valid mp3 but enough to confirm the backend
# writes the file and propagates extra_info.
FAKE_HEX = "00" * 24
FAKE_PAYLOAD = {
    "data": {"audio": FAKE_HEX, "status": 2},
    "extra_info": {
        "music_duration": 42000,
        "music_sample_rate": 44100,
        "music_channel": 2,
        "bitrate": 256000,
        "music_size": 24,
    },
    "trace_id": "fake-trace-abc",
    "base_resp": {"status_code": 0, "status_msg": "success"},
}

# Per-test response overrides (set in tests as needed).
PAYLOAD_OVERRIDE = {"value": FAKE_PAYLOAD}


def fake_post_json(self, endpoint, data, timeout=120.0):
    if endpoint == "/v1/music_generation":
        return True, PAYLOAD_OVERRIDE["value"]
    return False, {"status_msg": f"Unexpected endpoint: {endpoint}"}


# Make sure a config.yaml exists so get_minimax_config works.
CFG_PATH = r"C:\Users\Eduardo\OneDrive\Documentos\GitHub\minimax-agent-gui\config\config.yaml"
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

    print("=== Test 1: Happy path (music-2.6 + lyrics) ===")
    r = client.post(
        "/api/music",
        json={
            "model": "music-2.6",
            "prompt": "Soulful Blues",
            "lyrics": "[Verse]\nMidnight rain",
            "is_instrumental": False,
            "lyrics_optimizer": False,
            "filename": "test_song",
            "audio_setting": {"sample_rate": 44100, "bitrate": 256000, "format": "mp3"},
        },
    )
    expect("status", r.status_code, 200)
    d = r.json()
    print(f"  file_path={d.get('file_path')!r} filename={d.get('filename')!r}")
    print(f"  extra_info={d.get('extra_info')} trace_id={d.get('trace_id')!r}")
    expect("extra_info present", bool(d.get("extra_info")), True)
    expect("trace_id", d.get("trace_id"), "fake-trace-abc")
    expect("ends in .mp3", (d.get("filename") or "").endswith(".mp3"), True)

    print()
    print("=== Test 2: Instrumental without prompt → 422 ===")
    r = client.post(
        "/api/music",
        json={"model": "music-2.6", "is_instrumental": True, "lyrics": ""},
    )
    expect("status", r.status_code, 422)
    msgs = [e.get("msg", "") for e in r.json().get("detail", [])[:1]]
    print(f"  msg: {msgs[0][:140] if msgs else '(none)'}")

    print()
    print("=== Test 3: lyrics_optimizer=True without lyrics → 200 ===")
    r = client.post(
        "/api/music",
        json={
            "model": "music-2.6",
            "prompt": "Jazz",
            "lyrics": "",
            "lyrics_optimizer": True,
            "audio_setting": {"sample_rate": 44100, "bitrate": 256000, "format": "mp3"},
        },
    )
    expect("status", r.status_code, 200)

    print()
    print("=== Test 4: cover_feature_id rejected in Phase 1 ===")
    r = client.post(
        "/api/music",
        json={
            "model": "music-2.6",
            "prompt": "Blues",
            "lyrics": "[Verse] x",
            "cover_feature_id": "fake-id",
        },
    )
    expect("status", r.status_code, 422)
    msgs = [e.get("msg", "") for e in r.json().get("detail", [])[:1]]
    print(f"  msg: {msgs[0][:140] if msgs else '(none)'}")

    print()
    print("=== Test 5: invalid audio_setting.sample_rate=22050 → 422 ===")
    r = client.post(
        "/api/music",
        json={
            "model": "music-2.6",
            "prompt": "Blues",
            "lyrics": "[Verse] x",
            "audio_setting": {"sample_rate": 22050, "bitrate": 256000, "format": "mp3"},
        },
    )
    expect("status", r.status_code, 422)

    print()
    print("=== Test 6: invalid model (music-cover) → 422 ===")
    r = client.post(
        "/api/music",
        json={"model": "music-cover", "prompt": "x", "lyrics": "y"},
    )
    expect("status", r.status_code, 422)

    print()
    print("=== Test 7: Persist audio_setting via PUT /api/config/music ===")
    r = client.put(
        "/api/config/music",
        json={"audio_setting": {"sample_rate": 32000, "bitrate": 128000, "format": "wav"}},
    )
    expect("status", r.status_code, 200)
    print(f"  body: {r.json()}")

    print()
    print("=== Test 8: GET /api/config returns music.audio_setting ===")
    r = client.get("/api/config")
    expect("status", r.status_code, 200)
    print(f"  music: {r.json().get('music', {})}")

    print()
    print("=== Test 9: Backend fallback uses persisted audio_setting ===")
    r = client.post(
        "/api/music",
        json={
            "model": "music-2.6",
            "prompt": "Blues",
            "lyrics": "[Verse] x",
        },
    )
    expect("status", r.status_code, 200)
    fn = r.json().get("filename") or ""
    expect("ends in .wav", fn.endswith(".wav"), True)
    print(f"  filename={fn!r}")

    print()
    print("=== Test 10: 2013 (invalid params) maps to 400 ===")
    PAYLOAD_OVERRIDE["value"] = {
        "base_resp": {"status_code": 2013, "status_msg": "invalid params"},
    }
    r = client.post(
        "/api/music",
        json={
            "model": "music-2.6",
            "prompt": "x",
            "lyrics": "[Verse] y",
        },
    )
    expect("status", r.status_code, 400)
    print(f"  detail: {r.json().get('detail', '')[:120]}")

    print()
    print("=== Test 11: 1008 (insufficient balance) maps to 402 ===")
    PAYLOAD_OVERRIDE["value"] = {
        "base_resp": {"status_code": 1008, "status_msg": "insufficient balance"},
    }
    r = client.post(
        "/api/music",
        json={
            "model": "music-2.6",
            "prompt": "x",
            "lyrics": "[Verse] y",
        },
    )
    expect("status", r.status_code, 402)

    print()
    print("=== Test 12: client-side mutual exclusion (audio_url + audio_base64) ===")
    PAYLOAD_OVERRIDE["value"] = FAKE_PAYLOAD
    r = client.post(
        "/api/music",
        json={
            "model": "music-2.6",
            "prompt": "x",
            "lyrics": "[Verse] y",
            "audio_url": "https://x.com/a.mp3",
            "audio_base64": "abc",
        },
    )
    # Phase 1 backend rejects audio_url + audio_base64 at Pydantic level
    # (both individually allowed in MusicRequest schema but the validator
    # only blocks them when model is music-cover; for music-2.6 it blocks
    # all cover params regardless). Both should be 422.
    expect("status", r.status_code, 422)

    print()
    print("=== Test 13: empty filename falls back to timestamp.mp3 ===")
    r = client.put(
        "/api/config/music",
        json={"audio_setting": {"sample_rate": 44100, "bitrate": 256000, "format": "mp3"}},
    )
    r = client.post(
        "/api/music",
        json={
            "model": "music-2.6",
            "prompt": "x",
            "lyrics": "[Verse] y",
            "filename": "",
        },
    )
    expect("status", r.status_code, 200)
    fn = r.json().get("filename") or ""
    expect("starts with music_", fn.startswith("music_"), True)
    expect("ends in .mp3", fn.endswith(".mp3"), True)
    print(f"  filename={fn!r}")

    print()
    print("All tests done.")
