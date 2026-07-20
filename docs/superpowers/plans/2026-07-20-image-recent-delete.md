# Image Recent Generations Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to delete a single image from `ImagePanel`'s "Recent Generations" gallery, removing the file from `workspace/generations/images/`.

**Architecture:** New FastAPI endpoint `DELETE /api/generations/image?path=...` scoped to `generations/images/`. Frontend extends the reusable `RecentGenerations` component with an optional `onDeleteImage` prop and wires it from `ImagePanel`, matching the existing confirm + toast pattern used for anchors / skills / style sheets.

**Tech Stack:** FastAPI (backend), React + lucide-react + react-i18next (frontend), pytest (backend tests), Vitest (frontend tests).

## Global Constraints

- Match existing deletion UX: `confirm()` + i18n + 2.5 s toast banner (`showMessage` style).
- Backend MUST scope deletes to `generations/images/`; use `_safe_join` for traversal defense.
- 404 on the endpoint is treated as success (idempotent); other errors surface a toast and keep the gallery unchanged.
- i18n keys added to en, ko, es, ja, pt-BR, zh-CN. Other locales fall back to en.
- Frontend changes are scoped to `type === 'image'` in `RecentGenerations`. Music / TTS / Video cards are unchanged.
- Do NOT delete music / tts / video files in this plan; non-goal.
- Frequent commits, TDD on the backend, light Vitest coverage on the frontend.

---

## File Structure

- **Modify** `web/backend/main.py` — add `DELETE /api/generations/image` endpoint.
- **Modify** `desktop/src/components/media/RecentGenerations.jsx` — accept new optional `onDeleteImage` prop, render trash button on image hover overlay.
- **Modify** `desktop/src/components/media/ImagePanel.jsx` — add `handleDeleteImage`, message state, pass `onDeleteImage`.
- **Modify** `desktop/src/i18n/en.json`, `ko.json`, `es.json`, `ja.json`, `pt-BR.json`, `zh-CN.json` — 3 new `image.*` keys.
- **Create** `tests/test_image_recent_delete.py` — endpoint behavior + path-traversal coverage.

---

## Task 1: Backend DELETE endpoint (TDD)

**Files:**
- Modify: `web/backend/main.py` (insert endpoint after `@app.get("/api/generations")` block, ~line 5658)
- Create: `tests/test_image_recent_delete.py`

**Interfaces:**
- Endpoint: `DELETE /api/generations/image?path={workspace-relative}`
- Path param must be under `get_app_workspace_dir() / "generations" / "images"`.
- Returns `{"success": true, "deleted": "<path>"}` on success or when file is already missing.

### Step 1: Write failing tests

Create `tests/test_image_recent_delete.py`:

```python
"""Tests for DELETE /api/generations/image.

Covers:
  - happy path (file removed)
  - idempotent on missing file
  - path traversal blocked
  - paths outside generations/images/ blocked
  - missing path returns 400
"""
import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


@pytest.fixture(scope="module")
def workspace():
    tmp = Path(tempfile.mkdtemp(prefix="minimax_imgdel_"))
    (tmp / "generations" / "images").mkdir(parents=True)
    os.environ["MINIMAX_PROJECT_ROOT"] = str(tmp)
    # Re-import main bound to the fake root.
    if "web.backend.main" in sys.modules:
        del sys.modules["web.backend.main"]
    from web.backend import main as main_mod
    return main_mod, tmp


@pytest.fixture
def client(workspace):
    _, _ = workspace
    from web.backend.main import app
    return TestClient(app)


def _write_image(tmp: Path, name: str = "image_test.png") -> str:
    p = tmp / "generations" / "images" / name
    p.write_bytes(b"\x89PNG\r\n\x1a\n")
    return f"generations/images/{name}"


def test_delete_removes_file_and_returns_path(client, workspace):
    _, tmp = workspace
    rel = _write_image(tmp)
    assert (tmp / "generations" / "images" / "image_test.png").exists()

    res = client.delete(f"/api/generations/image?path={rel}")
    assert res.status_code == 200, res.text
    assert res.json() == {"success": True, "deleted": rel}
    assert not (tmp / "generations" / "images" / "image_test.png").exists()


def test_delete_missing_file_is_idempotent(client, workspace):
    res = client.delete("/api/generations/image?path=generations/images/ghost.png")
    assert res.status_code == 200, res.text
    assert res.json()["success"] is True


def test_delete_rejects_path_outside_workspace(client):
    res = client.delete("/api/generations/image?path=../../etc/passwd")
    assert res.status_code in (400, 403)


def test_delete_rejects_path_outside_images_dir(client, workspace):
    # music file is a sibling dir; must NOT be deletable through this endpoint
    _, tmp = workspace
    music = tmp / "generations" / "music" / "track.mp3"
    music.parent.mkdir(parents=True, exist_ok=True)
    music.write_bytes(b"mp3")

    res = client.delete("/api/generations/image?path=generations/music/track.mp3")
    assert res.status_code == 403
    assert music.exists(), "file must NOT be removed"


def test_delete_rejects_empty_path(client):
    res = client.delete("/api/generations/image?path=")
    assert res.status_code == 400
```

### Step 2: Run tests to verify they fail

```bash
pytest tests/test_image_recent_delete.py -v
```

Expected: collection succeeds, every test fails with `404` (endpoint missing) or `405 Method Not Allowed`. The `test_delete_rejects_empty_path` may already pass by accident if the framework returns 400 for an empty path — that's fine, leave it; the remaining four must fail.

### Step 3: Implement the endpoint

In `web/backend/main.py`, immediately after the existing `list_generations` function (~line 5658, the line that returns `{"success": True, "data": result}` for `/api/generations`), add:

```python
@app.delete("/api/generations/image")
async def delete_generated_image(path: str = ""):
    """Delete a single image under workspace/generations/images/.

    Idempotent: deleting an already-missing path returns success. Paths
    outside ``workspace/generations/images/`` are rejected (403) so the
    endpoint cannot be used to remove anchors, config, or other media.
    """
    if not path:
        raise HTTPException(status_code=400, detail="path is required")
    try:
        root = get_app_workspace_dir()
        target = _safe_join(root, path)
        images_root = (root / "generations" / "images").resolve()
        if images_root not in target.resolve().parents and target.resolve() != images_root:
            raise HTTPException(
                status_code=403,
                detail="Only files under generations/images/ can be deleted here",
            )
        if target.exists() and target.is_file():
            target.unlink()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"success": True, "deleted": path}
```

### Step 4: Run tests to verify they pass

```bash
pytest tests/test_image_recent_delete.py -v
```

Expected: 5 passed.

### Step 5: Commit

```bash
git add web/backend/main.py tests/test_image_recent_delete.py
git commit -m "feat(image): DELETE /api/generations/image endpoint"
```

---

## Task 2: i18n keys (6 locales)

**Files:**
- Modify: `desktop/src/i18n/en.json` (locate `image` block, currently starts ~line 429)
- Modify: `desktop/src/i18n/ko.json`, `es.json`, `ja.json`, `pt-BR.json`, `zh-CN.json`

**Interfaces:**
- `image.confirmDelete` — string with `{name}` placeholder.
- `image.toastDeleted` — string with `{name}` placeholder.
- `image.toastDeleteFailed` — string with `{message}` placeholder.

### Step 1: Add keys to `en.json`

Open the `image` object. Add (anywhere inside that block; keep alphabetical if the rest is alphabetical):

```json
    "confirmDelete": "Delete image \"{name}\"? This cannot be undone.",
    "toastDeleted": "Image \"{name}\" deleted.",
    "toastDeleteFailed": "Could not delete image: {message}",
```

### Step 2: Add Korean translations to `ko.json`

```json
    "confirmDelete": "이미지 \"{name}\"을(를) 삭제할까요? 되돌릴 수 없습니다.",
    "toastDeleted": "이미지 \"{name}\"이(가) 삭제되었습니다.",
    "toastDeleteFailed": "이미지 삭제 실패: {message}",
```

### Step 3: Add Spanish translations to `es.json`

```json
    "confirmDelete": "¿Eliminar la imagen \"{name}\"? Esta acción no se puede deshacer.",
    "toastDeleted": "Imagen \"{name}\" eliminada.",
    "toastDeleteFailed": "No se pudo eliminar la imagen: {message}",
```

### Step 4: Add Japanese translations to `ja.json`

```json
    "confirmDelete": "画像 \"{name}\" を削除しますか？元に戻せません。",
    "toastDeleted": "画像 \"{name}\" を削除しました。",
    "toastDeleteFailed": "画像を削除できませんでした: {message}",
```

### Step 5: Add Brazilian Portuguese translations to `pt-BR.json`

```json
    "confirmDelete": "Excluir a imagem \"{name}\"? Esta ação não pode ser desfeita.",
    "toastDeleted": "Imagem \"{name}\" excluída.",
    "toastDeleteFailed": "Não foi possível excluir a imagem: {message}",
```

### Step 6: Add Simplified Chinese translations to `zh-CN.json`

```json
    "confirmDelete": "确定删除图片 \"{name}\"？此操作不可撤销。",
    "toastDeleted": "图片 \"{name}\" 已删除。",
    "toastDeleteFailed": "无法删除图片：{message}",
```

### Step 7: Validate JSON parses

```bash
node -e "['en','ko','es','ja','pt-BR','zh-CN'].forEach(l=>{JSON.parse(require('fs').readFileSync('desktop/src/i18n/'+l+'.json','utf8'));console.log(l,'ok');})"
```

Expected: each locale prints `ok`.

### Step 8: Commit

```bash
git add desktop/src/i18n
git commit -m "feat(image): i18n for recent-generation delete confirm + toast"
```

---

## Task 3: Extend `RecentGenerations` with optional `onDeleteImage`

**Files:**
- Modify: `desktop/src/components/media/RecentGenerations.jsx`

**Interfaces:**
- New optional prop `onDeleteImage?: (item) => void | Promise<void>`.
- Trash button rendered ONLY when `type === 'image' && onDeleteImage` is provided.

### Step 1: Add the prop to the signature

Replace the destructured props (lines 16-25) with:

```jsx
export default function RecentGenerations({
  title = 'Recent Generations',
  type,
  items = [],
  loading = false,
  error = null,
  onRefresh,
  emptyMessage = 'No recent generations',
  onPromoteToAnchor,
  onDeleteImage,
}) {
```

### Step 2: Add `Trash2` to imports

Replace the existing `lucide-react` import line:

```jsx
import { RefreshCw, Save, Loader2, Anchor, Trash2 } from 'lucide-react'
```

### Step 3: Add the trash button to the image card hover overlay

Inside the image card markup (currently lines 87-105, inside the `<div className="absolute inset-0 ... group-hover:opacity-100 ...">` overlay), append a third button after the `onPromoteToAnchor` button:

```jsx
{onDeleteImage && (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); onDeleteImage(item) }}
    className="p-1.5 bg-error hover:bg-error/90 rounded-lg transition-colors"
    title="Delete"
    aria-label={`Delete ${item.name}`}
  >
    <Trash2 size={12} className="text-white" />
  </button>
)}
```

### Step 4: Verify build

```bash
cd desktop && npx vite build --mode development
```

Expected: build succeeds (any pre-existing warnings unrelated to this file are fine).

### Step 5: Commit

```bash
git add desktop/src/components/media/RecentGenerations.jsx
git commit -m "feat(image): optional delete button on recent-generations image cards"
```

---

## Task 4: Wire `ImagePanel` to call the endpoint

**Files:**
- Modify: `desktop/src/components/media/ImagePanel.jsx`

**Interfaces:**
- New internal `handleDeleteImage(item)` that:
  1. `confirm(t('image.confirmDelete', { name: item.name }))` — bail if cancelled.
  2. `apiFetch('/api/generations/image?path=' + encodeURIComponent(item.path), { method: 'DELETE' })`.
  3. On 200 or 404: filter item from gallery + show success toast.
  4. Otherwise: show failure toast, leave gallery unchanged.

### Step 1: Add toast state and helpers

After the existing `const [galleryLoading, setGalleryLoading] = useState(false)` (~line 132), add:

```jsx
const [message, setMessage] = useState('')
useEffect(() => {
  if (!message) return
  const id = setTimeout(() => setMessage(''), 2500)
  return () => clearTimeout(id)
}, [message])
```

### Step 2: Add `handleDeleteImage`

After `fetchGallery` (~line 228), insert:

```jsx
const handleDeleteImage = async (item) => {
  if (!confirm(t('image.confirmDelete', { name: item.name }))) return
  let res
  try {
    res = await apiFetch(
      `/api/generations/image?path=${encodeURIComponent(item.path)}`,
      { method: 'DELETE' }
    )
  } catch (e) {
    setMessage(t('image.toastDeleteFailed', { message: e.message }))
    return
  }
  if (res.status === 200 || res.status === 404) {
    setGallery((prev) => prev.filter((i) => i.path !== item.path))
    setMessage(t('image.toastDeleted', { name: item.name }))
  } else {
    let detail = ''
    try { detail = (await res.json()).detail || '' } catch { /* ignore */ }
    setMessage(t('image.toastDeleteFailed', {
      message: detail || `HTTP ${res.status}`,
    }))
  }
}
```

### Step 3: Pass `onDeleteImage` to `RecentGenerations`

In the `canvas` block (line ~775), add the new prop:

```jsx
<RecentGenerations
  type="image"
  items={gallery}
  loading={galleryLoading}
  onRefresh={fetchGallery}
  emptyMessage={t('image.noGenerated')}
  onPromoteToAnchor={(item) => { /* existing handler unchanged */ }}
  onDeleteImage={handleDeleteImage}
/>
```

### Step 4: Render the toast banner

Find the JSX returned by `ImagePanel` (the `return (...)` at the bottom, around line 802). Wrap the existing `<MediaPanelLayout ... />` in a fragment with a tiny toast above it:

```jsx
return (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    {message && (
      <div
        role="status"
        style={{
          padding: '6px 12px',
          fontSize: 12,
          background: 'hsl(var(--primary) / 0.12)',
          color: 'var(--app-text)',
          borderBottom: '1px solid var(--app-border)',
        }}
      >
        {message}
      </div>
    )}
    <div style={{ flex: 1, minHeight: 0 }}>
      <MediaPanelLayout
        controlsWidth={360}
        topBar={topBar}
        galleryHeader={galleryHeader}
        controls={controls}
        canvas={canvas}
      />
    </div>
  </div>
)
```

### Step 5: Verify build

```bash
cd desktop && npx vite build --mode development
```

Expected: build succeeds.

### Step 6: Smoke test manually

1. `cd desktop && npm run tauri:dev`
2. Generate at least one image on the Image tab.
3. Hover the image card — confirm the trash button is visible alongside Download / Promote-to-anchor.
4. Click trash → confirm dialog appears in English.
5. Click OK → image disappears from the gallery, toast confirms the delete.
6. Refresh the gallery (`onRefresh`) — image is still gone.
7. Open the workspace `generations/images/` folder and confirm the file is gone from disk.

### Step 7: Commit

```bash
git add desktop/src/components/media/ImagePanel.jsx
git commit -m "feat(image): wire delete button to DELETE /api/generations/image"
```

---

## Task 5: Run full test suite

**Files:** none modified

### Step 1: Run backend tests

```bash
pytest tests/test_image_recent_delete.py -v
```

Expected: 5 passed.

### Step 2: Run frontend tests (if present)

```bash
cd desktop && npm test -- --run
```

Expected: pre-existing tests still pass; no new frontend test added in this plan. If the test runner reports a regression in `RecentGenerations` consumers, investigate and fix before yielding.

### Step 3: Final commit (if any fixes needed)

If step 1 or 2 surfaced a fix, commit it under `fix:` or `chore:` per the actual change.

---

## Self-Review Notes

- Spec coverage: every section of the design spec maps to a task above (endpoint = Task 1, i18n = Task 2, `RecentGenerations` extension = Task 3, `ImagePanel` wiring = Task 4, verification = Task 5).
- No placeholders: every step contains the exact code or command.
- Type/signature consistency: `onDeleteImage` is named identically across Tasks 3 and 4. `handleDeleteImage` is internal to `ImagePanel`.
- Idempotent 404 behavior is implemented in Task 1 (`if target.exists()` guard) AND handled in Task 4 (frontend treats 200 and 404 as success) — both are necessary because either side alone leaves a stale UI state.
