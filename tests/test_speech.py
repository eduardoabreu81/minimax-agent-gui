"""End-to-end tests for the Speech flow (TAURI_SPEC.md §6b).

Covers:
  - /api/minimax/speech/synthesize — T2A sync
  - /api/minimax/speech/synthesize-async (create + poll)
  - /api/minimax/speech/voices — list
  - /api/minimax/speech/clone/upload — sample upload
  - /api/minimax/speech/clone — register clone
  - /api/minimax/speech/design — design voice
  - DELETE /api/minimax/speech/voices/{type}/{id}
  - Error mapping (2038 → 403, 2013 → 400, etc.)
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

FAKE_HEX = "00" * 24
FAKE_SYNTH_PAYLOAD = {
    "data": {"audio": FAKE_HEX, "status": 2},
    "extra_info": {
        "audio_length": 11124,
        "audio_sample_rate": 32000,
        "audio_size": 179926,
        "bitrate": 128000,
        "usage_characters": 18,
        "audio_format": "mp3",
        "audio_channel": 1,
    },
    "trace_id": "fake-trace-t2a",
    "base_resp": {"status_code": 0, "status_msg": "success"},
}

FAKE_ASYNC_CREATE_PAYLOAD = {
    "task_id": "95157322514444",
    "file_id": 95157322514496,
    "usage_characters": 100,
    "task_token": "eyJhbGciOiJSUz",
    "base_resp": {"status_code": 0, "status_msg": "success"},
}

FAKE_ASYNC_QUERY_DONE = {
    "task_id": 95157322514444,
    "status": "Success",
    "file_id": 95157322514496,
    "base_resp": {"status_code": 0, "status_msg": "success"},
}
FAKE_ASYNC_QUERY_PROCESSING = {
    "task_id": 95157322514444,
    "status": "Processing",
    "base_resp": {"status_code": 0, "status_msg": "success"},
}

FAKE_VOICES_PAYLOAD = {
    "system_voice": [
        {
            "voice_id": "English_Graceful_Lady",
            "voice_name": "Graceful Lady",
            "description": ["Warm female narrator"],
        },
    ],
    "voice_cloning": [
        {"voice_id": "my-narrator-01", "description": [], "created_time": "2025-08-20"},
    ],
    "voice_generation": [
        {"voice_id": "ttv-voice-20250820-abc", "description": [], "created_time": "2025-08-20"},
    ],
    "base_resp": {"status_code": 0, "status_msg": "success"},
}

FAKE_CLONE_PAYLOAD = {
    "demo_audio": "https://example.com/demo.mp3",
    "extra_info": {"audio_length": 11124, "audio_sample_rate": 32000, "audio_size": 179926, "bitrate": 128000, "word_count": 18, "usage_characters": 18},
    "trace_id": "fake-trace-clone",
    "base_resp": {"status_code": 0, "status_msg": "success"},
}

FAKE_DESIGN_PAYLOAD = {
    "voice_id": "ttv-voice-20250820-xyz",
    "trial_audio": FAKE_HEX,
    "base_resp": {"status_code": 0, "status_msg": "success"},
}

FAKE_DELETE_PAYLOAD = {
    "voice_id": "my-narrator-01",
    "created_time": "1728962464",
    "base_resp": {"status_code": 0, "status_msg": "success"},
}

FAKE_UPLOAD_PAYLOAD = {
    "file": {"file_id": 123456789, "bytes": 5896337, "created_at": 1700469398, "filename": "sample.mp3", "purpose": "voice_clone"},
    "base_resp": {"status_code": 0, "status_msg": "success"},
}

# Per-endpoint response overrides.
ROUTES = {
    "/v1/t2a_v2": FAKE_SYNTH_PAYLOAD,
    "/v1/t2a_async_v2": FAKE_ASYNC_CREATE_PAYLOAD,
    "/v1/query/t2a_async_query_v2": FAKE_ASYNC_QUERY_DONE,
    "/v1/get_voice": FAKE_VOICES_PAYLOAD,
    "/v1/voice_clone": FAKE_CLONE_PAYLOAD,
    "/v1/voice_design": FAKE_DESIGN_PAYLOAD,
    "/v1/delete_voice": FAKE_DELETE_PAYLOAD,
    "/v1/files/upload": FAKE_UPLOAD_PAYLOAD,
}

def fake_post_json(self, endpoint, data, timeout=120.0):
    if endpoint in ROUTES:
        return True, ROUTES[endpoint]
    return False, {"status_msg": f"Unexpected endpoint: {endpoint}"}

def fake_get_json(self, endpoint, params=None, timeout=60.0):
    if endpoint == "/v1/query/t2a_async_query_v2":
        return True, FAKE_ASYNC_QUERY_DONE
    return False, {"status_msg": f"Unexpected GET endpoint: {endpoint}"}

os.makedirs(os.path.dirname(CFG_PATH), exist_ok=True)
if not os.path.exists(CFG_PATH):
    with open(CFG_PATH, "w", encoding="utf-8") as f:
        f.write("minimax:\n  api_key: sk-test-fake\n  api_base: https://api.minimax.io\n  region: global\n")

with mock.patch.object(mc.MiniMaxSyncClient, "_post_json", fake_post_json), \
     mock.patch.object(mc.MiniMaxSyncClient, "_get_json", fake_get_json):
    from fastapi.testclient import TestClient  # noqa: E402

    import main as backend  # noqa: E402

    client = TestClient(backend.app)

    def expect(label, actual, want):
        ok = "OK" if actual == want else "FAIL"
        print(f"  [{ok}] {label}: got={actual} want={want}")
        return actual == want

    # ============ T2A sync ============

    print("=== T1: synthesize — happy path ===")
    r = client.post(
        "/api/minimax/speech/synthesize",
        json={
            "text": "Hello, world!",
            "model": "speech-2.8-hd",
            "voice_id": "English_Graceful_Lady",
            "speed": 1.0,
            "vol": 5.0,
            "pitch": 0,
        },
    )
    expect("status", r.status_code, 200)
    d = r.json()
    expect("success", d.get("success"), True)
    expect("file_path present", bool(d.get("file_path")), True)
    expect("ends in .mp3", (d.get("filename") or "").endswith(".mp3"), True)
    expect("trace_id", d.get("trace_id"), "fake-trace-t2a")

    print()
    print("=== T2: synthesize — empty text → 422 ===")
    r = client.post("/api/minimax/speech/synthesize", json={"text": ""})
    expect("status", r.status_code, 422)

    print()
    print("=== T3: synthesize — 2038 (no clone permission) maps to 403 ===")
    # Reuse with voice_clone payload shape — but for synth, simulate a
    # generic API error. Use a fake error response.
    ROUTES["/v1/t2a_v2"] = {
        "data": {"audio": "", "status": 2},
        "base_resp": {"status_code": 2038, "status_msg": "no clone permission"},
    }
    r = client.post("/api/minimax/speech/synthesize", json={"text": "hello"})
    expect("status", r.status_code, 403)
    # Restore
    ROUTES["/v1/t2a_v2"] = FAKE_SYNTH_PAYLOAD

    print()
    print("=== T4: synthesize — 2013 maps to 400 ===")
    ROUTES["/v1/t2a_v2"] = {
        "data": {"audio": "", "status": 2},
        "base_resp": {"status_code": 2013, "status_msg": "invalid params"},
    }
    r = client.post("/api/minimax/speech/synthesize", json={"text": "hello"})
    expect("status", r.status_code, 400)
    ROUTES["/v1/t2a_v2"] = FAKE_SYNTH_PAYLOAD

    # ============ Async ============

    print()
    print("=== T5: synthesize-async create — happy path ===")
    r = client.post(
        "/api/minimax/speech/synthesize-async",
        json={"text": "Long text goes here", "model": "speech-2.8-hd"},
    )
    expect("status", r.status_code, 200)
    d = r.json()
    expect("success", d.get("success"), True)
    expect("task_id present", bool(d.get("task_id")), True)
    expect("file_id present", d.get("file_id") is not None, True)

    print()
    print("=== T6: synthesize-async query — Success ===")
    r = client.get("/api/minimax/speech/synthesize-async/95157322514444")
    expect("status", r.status_code, 200)
    d = r.json()
    expect("status", d.get("status"), "success")
    expect("file_id present", d.get("file_id") is not None, True)

    # ============ Voices list ============

    print()
    print("=== T7: voices — happy path (all) ===")
    r = client.get("/api/minimax/speech/voices?voice_type=all")
    expect("status", r.status_code, 200)
    d = r.json()
    expect("system_voice count", len(d.get("system_voice", [])), 1)
    expect("voice_cloning count", len(d.get("voice_cloning", [])), 1)
    expect("voice_generation count", len(d.get("voice_generation", [])), 1)

    # ============ Clone ============

    print()
    print("=== T8: clone — invalid voice_id (too short) → 400 ===")
    r = client.post(
        "/api/minimax/speech/clone",
        json={"file_id": 12345, "voice_id": "abc"},  # only 3 chars
    )
    expect("status", r.status_code, 400)

    print()
    print("=== T9: clone — invalid voice_id (starts with digit) → 400 ===")
    r = client.post(
        "/api/minimax/speech/clone",
        json={"file_id": 12345, "voice_id": "1narrator01"},
    )
    expect("status", r.status_code, 400)

    print()
    print("=== T10: clone — happy path ===")
    r = client.post(
        "/api/minimax/speech/clone",
        json={
            "file_id": 12345,
            "voice_id": "my-narrator-01",
            "text": "Preview text",
            "model": "speech-2.8-hd",
            "need_noise_reduction": True,
        },
    )
    expect("status", r.status_code, 200)
    d = r.json()
    expect("success", d.get("success"), True)
    expect("demo_audio present", bool(d.get("demo_audio")), True)

    # ============ Design ============

    print()
    print("=== T11: design — happy path ===")
    r = client.post(
        "/api/minimax/speech/design",
        json={
            "prompt": "Warm male narrator, British accent",
            "preview_text": "Once upon a time...",
        },
    )
    expect("status", r.status_code, 200)
    d = r.json()
    expect("voice_id present", bool(d.get("voice_id")), True)
    expect("trial_audio_path present", bool(d.get("trial_audio_path")), True)

    print()
    print("=== T12: design — preview_text > 500 → 422 (Pydantic max_length) ===")
    r = client.post(
        "/api/minimax/speech/design",
        json={
            "prompt": "Warm male",
            "preview_text": "x" * 501,
        },
    )
    expect("status", r.status_code, 422)

    # ============ Delete ============

    print()
    print("=== T13: delete voice — happy path ===")
    r = client.delete("/api/minimax/speech/voices/voice_cloning/my-narrator-01")
    expect("status", r.status_code, 200)
    d = r.json()
    expect("success", d.get("success"), True)
    expect("voice_id", d.get("voice_id"), "my-narrator-01")

    print()
    print("=== T14: delete voice — invalid voice_type → 400 ===")
    r = client.delete("/api/minimax/speech/voices/system/English_Graceful_Lady")
    expect("status", r.status_code, 400)

    print()
    print("All speech tests done.")