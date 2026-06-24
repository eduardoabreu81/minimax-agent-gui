"""Tests for /api/config/defaults/audio — shared audio_setting between
Music + Speech panels (TAURI_SPEC.md §7)."""

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

CFG_PATH = r"C:\Users\Eduardo\OneDrive\Documentos\GitHub\minimax-agent-gui\config\config.yaml"
os.makedirs(os.path.dirname(CFG_PATH), exist_ok=True)
# Reset the config so each test starts with the hardcoded fallback.
# This avoids pollution from earlier suites that persist their own
# ``music.audio_setting`` (test_music_phase1 writes 44100/256000/2 here).
INITIAL_CFG = "minimax:\n  api_key: sk-test-fake\n  api_base: https://api.minimax.io\n  region: global\n"
with open(CFG_PATH, "w", encoding="utf-8") as f:
    f.write(INITIAL_CFG)


with mock.patch.object(mc.MiniMaxSyncClient, "_post_json", lambda *a, **kw: (True, {})):
    from fastapi.testclient import TestClient  # noqa: E402

    import main as backend  # noqa: E402

    client = TestClient(backend.app)

    def expect(label, actual, want):
        ok = "OK" if actual == want else "FAIL"
        print(f"  [{ok}] {label}: got={actual} want={want}")
        return actual == want

    print("=== T1: GET defaults — fallback when not configured ===")
    r = client.get("/api/config/defaults/audio")
    expect("status", r.status_code, 200)
    d = r.json()
    # Hardcoded fallback: sample_rate=32000, bitrate=128000, format=mp3, channel=1
    expect("sample_rate fallback", d.get("sample_rate"), 32000)
    expect("bitrate fallback", d.get("bitrate"), 128000)
    expect("format fallback", d.get("format"), "mp3")
    expect("channel fallback", d.get("channel"), 1)

    print()
    print("=== T2: PUT defaults — valid values ===")
    r = client.put(
        "/api/config/defaults/audio",
        json={"sample_rate": 44100, "bitrate": 256000, "format": "mp3", "channel": 2},
    )
    expect("status", r.status_code, 200)
    d = r.json()
    expect("success", d.get("success"), True)
    saved = d.get("defaults", {}).get("audio", {})
    expect("saved sample_rate", saved.get("sample_rate"), 44100)
    expect("saved bitrate", saved.get("bitrate"), 256000)
    expect("saved channel", saved.get("channel"), 2)

    print()
    print("=== T3: GET defaults — now returns the persisted values ===")
    r = client.get("/api/config/defaults/audio")
    expect("status", r.status_code, 200)
    d = r.json()
    expect("sample_rate", d.get("sample_rate"), 44100)
    expect("bitrate", d.get("bitrate"), 256000)
    expect("channel", d.get("channel"), 2)

    print()
    print("=== T4: PUT defaults — invalid sample_rate → 400 ===")
    r = client.put(
        "/api/config/defaults/audio",
        json={"sample_rate": 11025, "bitrate": 128000, "format": "mp3", "channel": 1},
    )
    expect("status", r.status_code, 400)

    print()
    print("=== T5: PUT defaults — invalid format → 400 ===")
    r = client.put(
        "/api/config/defaults/audio",
        json={"sample_rate": 32000, "bitrate": 128000, "format": "ogg", "channel": 1},
    )
    expect("status", r.status_code, 400)

    print()
    print("=== T6: PUT defaults — invalid channel → 400 ===")
    r = client.put(
        "/api/config/defaults/audio",
        json={"sample_rate": 32000, "bitrate": 128000, "format": "mp3", "channel": 7},
    )
    expect("status", r.status_code, 400)

    print()
    print("All generation defaults tests done.")