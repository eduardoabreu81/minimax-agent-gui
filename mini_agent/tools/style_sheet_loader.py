"""Style sheet loader — reusable prompt fragments for image generation.

Mirrors the storage / validation / CRUD shape of ``skill_loader.py`` but
scoped to image-prompt fragments. One directory per sheet, one
``STYLE.md`` inside. User-only (no multi-source discovery).

A sheet body is plain text. The literal ``{prompt}`` placeholder may
appear 0 or 1 times:
  - 0 occurrences → at apply time the user prompt is prepended as
    ``"<user_prompt>, <body>"``.
  - 1 occurrence  → the user prompt is substituted at that position.
  - ≥2 occurrences → rejected at validation time (ambiguity guard).
"""

from __future__ import annotations

import os
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import yaml

# ─── Constants ──────────────────────────────────────────────────────────────

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
NAME_MAX = 64
DESCRIPTION_MAX = 1024
BODY_MAX = 1000  # leaves ≥500 chars for user prompt under PROMPT_MAX=1500
PLACEHOLDER = "{prompt}"
PLACEHOLDER_MAX = 1


class StyleSheetValidationError(ValueError):
    """Raised when a style sheet name, description, or body fails validation."""


# ─── Data model ─────────────────────────────────────────────────────────────


@dataclass
class StyleSheet:
    name: str
    description: str
    body: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    path: Optional[Path] = None


# ─── Validation ─────────────────────────────────────────────────────────────


def _validate_name(raw: str) -> str:
    """Lowercase letters/digits/hyphens, 1–64 chars, leading alnum.

    Identical schema to skills (Kimi / agentskills.io). No auto-lowercase —
    uppercase is rejected so the on-disk name matches the frontmatter name.
    """
    name = (raw or "").strip()
    if not NAME_RE.match(name):
        raise StyleSheetValidationError(
            f"Style sheet name must be 1-{NAME_MAX} chars, lowercase "
            f"letters/digits/hyphens, starting with a letter or digit. "
            f"Got: {name!r}"
        )
    return name


def _validate_description(raw: str) -> str:
    desc = (raw or "").strip()
    if not desc:
        raise StyleSheetValidationError("Style sheet description is required.")
    if len(desc) > DESCRIPTION_MAX:
        raise StyleSheetValidationError(
            f"Style sheet description must be ≤{DESCRIPTION_MAX} chars "
            f"(got {len(desc)})."
        )
    return desc


def _validate_body(raw: str) -> str:
    """Body must be 1–BODY_MAX chars and contain {prompt} 0 or 1 times."""
    body = (raw or "")
    if not body.strip():
        raise StyleSheetValidationError("Style sheet body is required.")
    if len(body) > BODY_MAX:
        raise StyleSheetValidationError(
            f"Style sheet body must be ≤{BODY_MAX} chars (got {len(body)})."
        )
    count = body.count(PLACEHOLDER)
    if count > PLACEHOLDER_MAX:
        raise StyleSheetValidationError(
            f"Style sheet body may contain {PLACEHOLDER!r} at most "
            f"{PLACEHOLDER_MAX} time(s); found {count}."
        )
    return body


# ─── Frontmatter parsing (mirrors SkillLoader._parse_frontmatter) ───────────


_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.DOTALL)


def _parse_frontmatter(content: str) -> Tuple[dict, str]:
    """Parse ``---\\n...\\n---\\n...`` into ``(frontmatter_dict, body)``.

    No frontmatter block → returns ``({}, full_content)``.
    Malformed YAML → returns ``({}, full_content)`` (lenient on read).
    """
    m = _FRONTMATTER_RE.match(content)
    if not m:
        return {}, content
    fm_raw, body = m.group(1), m.group(2)
    try:
        fm = yaml.safe_load(fm_raw) or {}
        if not isinstance(fm, dict):
            return {}, content
    except yaml.YAMLError:
        return {}, content
    return fm, body


# ─── Internal helpers ───────────────────────────────────────────────────────


def _atomic_write(path: Path, text: str) -> None:
    """Write ``text`` to ``path`` via tmp+rename for atomicity."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _serialize(
    name: str,
    description: str,
    body: str,
    *,
    created_at: Optional[str] = None,
    updated_at: Optional[str] = None,
) -> str:
    """Render the full STYLE.md text (frontmatter + body)."""
    fm: Dict[str, str] = {"name": name, "description": description}
    if created_at:
        fm["created_at"] = created_at
    if updated_at:
        fm["updated_at"] = updated_at
    return (
        "---\n"
        + yaml.safe_dump(
            fm, allow_unicode=True, sort_keys=False, default_flow_style=False
        )
        + "---\n\n"
        + body.lstrip()
    )


def _from_disk(sheet_dir: Path) -> Optional[StyleSheet]:
    """Read ``sheet_dir/STYLE.md`` into a :class:`StyleSheet` (or None)."""
    sheet_path = sheet_dir / "STYLE.md"
    if not sheet_path.exists():
        return None
    content = sheet_path.read_text(encoding="utf-8")
    fm, body = _parse_frontmatter(content)
    return StyleSheet(
        name=str(fm.get("name") or sheet_dir.name),
        description=str(fm.get("description") or ""),
        body=body,
        created_at=fm.get("created_at"),
        updated_at=fm.get("updated_at"),
        path=sheet_path,
    )


# ─── CRUD ───────────────────────────────────────────────────────────────────


def write_style_sheet(
    user_dir: Path,
    name: str,
    description: str,
    body: str,
) -> StyleSheet:
    """Create a new style sheet at ``user_dir/<name>/STYLE.md``.

    Raises :class:`StyleSheetValidationError` on invalid name/description/body
    or if the sheet already exists.
    """
    validated_name = _validate_name(name)
    validated_desc = _validate_description(description)
    validated_body = _validate_body(body)

    sheet_path = user_dir / validated_name / "STYLE.md"
    if sheet_path.exists():
        raise StyleSheetValidationError(
            f"Style sheet '{validated_name}' already exists in user dir."
        )

    now = _now_iso()
    text = _serialize(
        validated_name, validated_desc, validated_body,
        created_at=now, updated_at=now,
    )
    _atomic_write(sheet_path, text)

    return StyleSheet(
        name=validated_name,
        description=validated_desc,
        body=validated_body,
        created_at=now,
        updated_at=now,
        path=sheet_path,
    )


def read_style_sheet_raw(
    user_dir: Path, name: str
) -> Optional[Tuple[dict, str, Path]]:
    """Read raw frontmatter + body from ``user_dir/<name>/STYLE.md``.

    Returns ``(frontmatter_dict, body_str, path)`` or ``None`` if missing.
    """
    validated = _validate_name(name)
    sheet_path = user_dir / validated / "STYLE.md"
    if not sheet_path.exists():
        return None
    content = sheet_path.read_text(encoding="utf-8")
    fm, body = _parse_frontmatter(content)
    return (fm or {}, body or "", sheet_path)


def update_style_sheet(
    user_dir: Path,
    name: str,
    *,
    description: Optional[str] = None,
    body: Optional[str] = None,
) -> StyleSheet:
    """Update an existing style sheet.

    Fields not passed are preserved. ``body`` is re-validated for the
    ``{prompt}`` count rule on every update.
    """
    validated = _validate_name(name)
    existing = read_style_sheet_raw(user_dir, validated)
    if existing is None:
        raise StyleSheetValidationError(
            f"Style sheet '{validated}' does not exist in user dir."
        )
    fm, old_body, sheet_path = existing

    merged = dict(fm)
    new_desc = old_desc = str(merged.get("description") or "")
    if description is not None:
        new_desc = _validate_description(description)
        merged["description"] = new_desc
    elif not old_desc:
        # Defensive: a sheet without description shouldn't exist, but if it
        # does (legacy / hand-edited), refuse to silently preserve emptiness.
        raise StyleSheetValidationError(
            "Existing style sheet has no description; provide one."
        )

    new_body = old_body
    if body is not None:
        new_body = _validate_body(body)

    # Bump updated_at; preserve created_at.
    created_at = merged.get("created_at") or _now_iso()
    updated_at = _now_iso()
    text = _serialize(
        str(merged.get("name") or validated),
        new_desc,
        new_body,
        created_at=created_at,
        updated_at=updated_at,
    )
    _atomic_write(sheet_path, text)

    return StyleSheet(
        name=str(merged.get("name") or validated),
        description=new_desc,
        body=new_body,
        created_at=created_at,
        updated_at=updated_at,
        path=sheet_path,
    )


def delete_style_sheet(user_dir: Path, name: str) -> bool:
    """Delete ``user_dir/<name>/`` recursively. Returns True on success."""
    validated = _validate_name(name)
    sheet_dir = user_dir / validated
    if not sheet_dir.exists():
        return False
    shutil.rmtree(sheet_dir)
    return True


def list_style_sheets(user_dir: Path) -> List[StyleSheet]:
    """List all style sheets in ``user_dir``, sorted by name."""
    if not user_dir.exists():
        return []
    out: List[StyleSheet] = []
    for entry in sorted(user_dir.iterdir()):
        if not entry.is_dir():
            continue
        sheet = _from_disk(entry)
        if sheet is not None:
            out.append(sheet)
    return out


# ─── Prompt combination ─────────────────────────────────────────────────────

PROMPT_MAX = 1500  # mirrors ImagePanel.jsx PROMPT_MAX / image_generation cap


def combine_prompt(user_prompt: str, style_body: str) -> str:
    """Merge a user prompt with a style sheet body.

    - If ``style_body`` contains ``{prompt}`` exactly once, the user prompt
      is substituted at that position.
    - If ``style_body`` contains no ``{prompt}``, the user prompt is
      prepended as ``"<user_prompt>, <body>"`` (or whichever side is empty).
    """
    if PLACEHOLDER in style_body:
        return style_body.replace(PLACEHOLDER, user_prompt, 1)
    if not user_prompt.strip():
        return style_body
    if not style_body.strip():
        return user_prompt
    return f"{user_prompt}, {style_body}"


# ─── Convenience ────────────────────────────────────────────────────────────


def get_default_user_dir() -> Path:
    """Resolve the default user data dir for style sheets (cross-platform).

    Sibling of the skills dir under ``MiniMaxStudio/``.
    """
    if os.name == "nt":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / "MiniMaxStudio" / "style-sheets"
    # macOS / Linux: XDG-style home dir.
    xdg = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(xdg) / "MiniMaxStudio" / "style-sheets"
