"""
Skill Loader — Multi-source loader for Agent Skills (Kimi / agentskills.io spec).

Loads SKILL.md files from multiple directories:

  - Built-in:  PROJECT_ROOT/mini_agent/skills/                (read-only, ships with package)
  - User:      <user_data_dir>/skills/                         (writable, cross-project)
  - Extra:     paths from config `skills.extra_skill_dirs`     (configurable, read-only)
  - Brand:     ~/.claude/skills, ~/.codex/skills, ~/.gemini/skills
  - Generic:   ~/.config/agents/skills, ~/.agents/skills

Priority (lower number = higher priority = wins on name collision):

    User > Extra > Generic > Claude > Codex > Gemini > Built-in

Each skill is either:
  - canonical `<name>/SKILL.md` (subdir layout)
  - flat `<name>.md` (single-file layout; name defaults to filename without `.md`)

If both exist in the same directory, the subdir wins (with a warning logged).

YAML frontmatter is optional. Description fallback chain (Kimi):
  1. frontmatter `description:`
  2. first non-empty line of the body (truncated to 240 chars)
  3. `"No description provided."`

Schema validation (agentskills.io / Kimi):
  - name:           1-64 chars, `[a-z0-9-]+`, must start with letter/digit
  - description:    1-1024 chars (required for activation; missing → skill skipped)
  - compatibility: ≤500 chars (optional)

Public surface:
  - Skill dataclass + SkillSource enum
  - SkillLoader (multi-source discovery + lookup)
  - write_skill / update_skill / delete_skill / read_skill_raw (CRUD on user dir)
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import yaml


# ─── Validation (Kimi / agentskills.io spec) ──────────────────────────────

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
NAME_MAX = 64
DESCRIPTION_MAX = 1024
COMPATIBILITY_MAX = 500
DESCRIPTION_FALLBACK_MAX = 240  # truncate body line 1 to 240 chars (Kimi)


def _validate_name(raw: str) -> str:
    """Validate against Kimi / agentskills.io: lowercase letters/digits/hyphens only.

    We do NOT auto-lowercase — uppercase is rejected so the on-disk name
    matches what the user typed. (CRUD helpers can normalise before calling.)
    """
    name = (raw or "").strip()
    if not NAME_RE.match(name):
        raise ValueError(
            f"Skill name must be 1-{NAME_MAX} chars, lowercase letters/digits/hyphens, "
            f"starting with a letter or digit. Got: {name!r}"
        )
    return name


def _validate_description(raw: str) -> str:
    desc = (raw or "").strip()
    if not desc:
        raise ValueError("Skill description is required (or the body must start with one).")
    if len(desc) > DESCRIPTION_MAX:
        raise ValueError(
            f"Skill description must be ≤{DESCRIPTION_MAX} chars (got {len(desc)})."
        )
    return desc


# ─── SkillSource enum ──────────────────────────────────────────────────────


class SkillSource(str, Enum):
    """Where a skill was loaded from. Maps to a UI badge + read-only flag."""

    BUILTIN = "builtin"
    USER = "user"
    EXTRA = "extra"
    EXTERNAL_CLAUDE = "external:claude"
    EXTERNAL_CODEX = "external:codex"
    EXTERNAL_GEMINI = "external:gemini"
    EXTERNAL_GENERIC = "external:generic"

    @property
    def label(self) -> str:
        return {
            SkillSource.BUILTIN: "Built-in",
            SkillSource.USER: "User",
            SkillSource.EXTRA: "Extra",
            SkillSource.EXTERNAL_CLAUDE: "Claude",
            SkillSource.EXTERNAL_CODEX: "Codex",
            SkillSource.EXTERNAL_GEMINI: "Gemini",
            SkillSource.EXTERNAL_GENERIC: "Generic",
        }[self]

    @property
    def priority(self) -> int:
        """Lower = higher priority (wins on name collision)."""
        return {
            SkillSource.USER: 0,
            SkillSource.EXTRA: 1,
            SkillSource.EXTERNAL_GENERIC: 2,
            SkillSource.EXTERNAL_CLAUDE: 3,
            SkillSource.EXTERNAL_CODEX: 4,
            SkillSource.EXTERNAL_GEMINI: 5,
            SkillSource.BUILTIN: 6,
        }[self]

    @property
    def read_only(self) -> bool:
        return self != SkillSource.USER


# ─── Skill dataclass ───────────────────────────────────────────────────────


@dataclass
class Skill:
    """Skill data structure."""

    name: str
    description: str
    content: str
    license: Optional[str] = None
    compatibility: Optional[str] = None
    allowed_tools: Optional[List[str]] = None
    metadata: Optional[Dict[str, str]] = None
    skill_type: Optional[str] = None  # "flow" reserved for future
    source: SkillSource = SkillSource.BUILTIN
    skill_path: Optional[Path] = None

    def to_prompt(self) -> str:
        """Format skill as a prompt fragment (injected when activated)."""
        skill_root = str(self.skill_path.parent) if self.skill_path else "unknown"
        return f"""
# Skill: {self.name}

{self.description}

**Skill Root Directory:** `{skill_root}`

All files and references in this skill are relative to this directory.

---

{self.content}
"""

    def to_dict(self) -> dict:
        """Serialize for API responses (no full content; fetch via GET /{name})."""
        return {
            "name": self.name,
            "description": self.description,
            "license": self.license,
            "compatibility": self.compatibility,
            "allowed_tools": self.allowed_tools,
            "source": self.source.value,
            "source_label": self.source.label,
            "read_only": self.source.read_only,
            "skill_path": str(self.skill_path) if self.skill_path else None,
            "skill_type": self.skill_type,
        }


# ─── SkillLoader (multi-source) ────────────────────────────────────────────


class SkillLoader:
    """Multi-source skill loader.

    Two constructor signatures (kept backward-compatible):

      SkillLoader("./skills")                                  # legacy: 1 built-in source
      SkillLoader(sources=[(Path("./skills"), SkillSource.BUILTIN)])  # new
    """

    def __init__(
        self,
        skills_dir: Optional[str] = None,
        sources: Optional[List[Tuple[Path, SkillSource]]] = None,
    ):
        if sources is None:
            # Legacy single-dir constructor → one built-in source.
            base = Path(skills_dir) if skills_dir else Path("./skills")
            sources = [(base, SkillSource.BUILTIN)]
        self.sources: List[Tuple[Path, SkillSource]] = list(sources)
        self.loaded_skills: Dict[str, Skill] = {}
        self.last_scan_errors: List[str] = []

    # ── Source registration ─────────────────────────────────────────────

    def add_source(self, path: Path, source: SkillSource) -> None:
        """Register or replace a source dir for a given SkillSource enum."""
        self.sources = [(p, s) for p, s in self.sources if s != source]
        self.sources.append((path, source))

    # ── Path expansion ──────────────────────────────────────────────────

    @staticmethod
    def expand_path(raw: str, project_root: Optional[Path] = None) -> Path:
        """Expand ``~`` and ``%ENV%`` in a path string; resolve relative paths.

        - ``~``  → $HOME (Unix) or %USERPROFILE% (Windows)
        - ``%FOO%`` → os.environ['FOO']
        - relative → resolved against ``project_root`` (or CWD if None)
        """
        if not raw:
            return Path(raw)
        expanded = os.path.expandvars(os.path.expanduser(raw))
        p = Path(expanded)
        if not p.is_absolute() and project_root is not None:
            p = project_root / p
        return p

    # ── Discovery ──────────────────────────────────────────────────────

    def discover_skills(self) -> List[Skill]:
        """Walk all registered sources in priority order; dedupe by ``name``.

        Higher-priority sources win (registered earlier in ``self.sources``;
        ties broken by ``SkillSource.priority``).
        """
        self.loaded_skills = {}
        self.last_scan_errors = []

        # Sort by source.priority once (lower wins) so the registered list
        # order is the final tiebreaker for equal priorities.
        ordered = sorted(self.sources, key=lambda ps: ps[1].priority)

        for path, source in ordered:
            if not path.exists() or not path.is_dir():
                # Non-existent dirs are silently skipped (Kimi behavior).
                continue
            try:
                self._scan_dir(path, source)
            except Exception as e:
                self.last_scan_errors.append(f"{path}: {e}")

        return list(self.loaded_skills.values())

    def _scan_dir(self, root: Path, source: SkillSource) -> None:
        """Walk one source dir for SKILL.md files and flat .md files."""
        # 1) Canonical subdir layout: <root>/<name>/SKILL.md
        for skill_md in root.rglob("SKILL.md"):
            skill = self.load_skill(skill_md, source)
            if skill:
                self._register(skill)

        # 2) Flat layout: <root>/<name>.md (single file)
        try:
            for entry in root.iterdir():
                if entry.is_file() and entry.suffix == ".md" and entry.stem != "SKILL":
                    flat_skill = self._load_flat(entry, source)
                    if flat_skill:
                        self._register(flat_skill)
        except (PermissionError, OSError):
            # Can't read top-level — keep walking subdirs only.
            pass

    def _register(self, skill: Skill) -> None:
        """Add skill to loaded_skills unless shadowed by higher-priority source."""
        if skill.name in self.loaded_skills:
            # Shadowed by earlier (higher-priority) source. Drop the warning
            # here — callers can introspect ``last_scan_errors`` if interested.
            return
        self.loaded_skills[skill.name] = skill

    # ── Load one skill (canonical SKILL.md) ────────────────────────────

    def load_skill(
        self,
        skill_path: Path,
        source: SkillSource = SkillSource.BUILTIN,
    ) -> Optional[Skill]:
        """Load a single ``<name>/SKILL.md`` file.

        Returns ``None`` and appends to ``last_scan_errors`` on failure.
        Kimi schema: ``name`` and ``description`` are optional in frontmatter;
        missing values fall back to dir-name + first body line (truncated 240).
        """
        try:
            content = skill_path.read_text(encoding="utf-8")
        except Exception as e:
            self.last_scan_errors.append(f"read {skill_path}: {e}")
            return None

        default_name = skill_path.parent.name
        frontmatter, body = self._parse_frontmatter(content)

        name = self._resolve_name(frontmatter.get("name"), default_name, skill_path)
        if name is None:
            return None
        description = self._resolve_description(
            frontmatter.get("description"), body, skill_path
        )
        if description is None:
            return None

        compat = frontmatter.get("compatibility")
        if compat and len(str(compat)) > COMPATIBILITY_MAX:
            self.last_scan_errors.append(
                f"{skill_path}: compatibility > {COMPATIBILITY_MAX} chars"
            )
            compat = None

        processed_body = self._process_skill_paths(body or "", skill_path.parent)

        return Skill(
            name=name,
            description=description,
            content=processed_body,
            license=frontmatter.get("license"),
            compatibility=str(compat) if compat else None,
            allowed_tools=frontmatter.get("allowed-tools"),
            metadata=frontmatter.get("metadata"),
            skill_type=frontmatter.get("type"),
            source=source,
            skill_path=skill_path,
        )

    # ── Load one flat skill ─────────────────────────────────────────────

    def _load_flat(self, md_path: Path, source: SkillSource) -> Optional[Skill]:
        """Load a flat ``<name>.md`` skill (single-file layout)."""
        # Subdir with same name wins.
        sibling = md_path.parent / md_path.stem / "SKILL.md"
        if sibling.exists():
            self.last_scan_errors.append(
                f"{md_path}: shadowed by subdirectory {sibling}"
            )
            return None

        try:
            content = md_path.read_text(encoding="utf-8")
        except Exception as e:
            self.last_scan_errors.append(f"read {md_path}: {e}")
            return None

        frontmatter, body = self._parse_frontmatter(content)

        name = self._resolve_name(frontmatter.get("name"), md_path.stem, md_path)
        if name is None:
            return None
        description = self._resolve_description(
            frontmatter.get("description"), body, md_path
        )
        if description is None:
            return None

        compat = frontmatter.get("compatibility")
        if compat and len(str(compat)) > COMPATIBILITY_MAX:
            self.last_scan_errors.append(
                f"{md_path}: compatibility > {COMPATIBILITY_MAX} chars"
            )
            compat = None

        processed_body = self._process_skill_paths(body or "", md_path.parent)

        return Skill(
            name=name,
            description=description,
            content=processed_body,
            license=frontmatter.get("license"),
            compatibility=str(compat) if compat else None,
            allowed_tools=frontmatter.get("allowed-tools"),
            metadata=frontmatter.get("metadata"),
            skill_type=frontmatter.get("type"),
            source=source,
            skill_path=md_path,
        )

    # ── Frontmatter parsing ─────────────────────────────────────────────

    @staticmethod
    def _parse_frontmatter(content: str) -> Tuple[dict, str]:
        """Parse ``---\\n...\\n---\\n...`` into ``(dict, body)``.

        When no frontmatter block is present, returns ``({}, full_content)``
        so the body fallback chain (first non-empty line as description) still
        works on raw markdown files without YAML.
        """
        match = re.match(r"^---\n(.*?)\n---\n?(.*)$", content, re.DOTALL)
        if not match:
            return {}, content
        try:
            fm = yaml.safe_load(match.group(1)) or {}
        except yaml.YAMLError:
            return {}, match.group(2).strip()
        return fm, match.group(2).strip()

    # ── Resolution helpers ──────────────────────────────────────────────

    def _resolve_name(
        self, raw_name: Optional[str], default_name: str, source_path: Path
    ) -> Optional[str]:
        candidate = (raw_name or default_name or "").strip().lower()
        try:
            return _validate_name(candidate)
        except ValueError as e:
            self.last_scan_errors.append(f"{source_path}: {e}")
            return None

    def _resolve_description(
        self,
        raw_desc: Optional[str],
        body: Optional[str],
        source_path: Path,
    ) -> Optional[str]:
        if raw_desc:
            candidate = str(raw_desc).strip()
        else:
            # Fallback: first non-empty line of body, truncated (Kimi).
            candidate = next(
                (ln.strip() for ln in (body or "").splitlines() if ln.strip()),
                "",
            )[:DESCRIPTION_FALLBACK_MAX]
        try:
            return _validate_description(candidate)
        except ValueError as e:
            self.last_scan_errors.append(f"{source_path}: {e}")
            return None

    # ── Progressive-disclosure path rewriting (unchanged) ───────────────

    def _process_skill_paths(self, content: str, skill_dir: Path) -> str:
        """Replace relative paths with absolute paths so the Agent can read them.

        Supports Progressive Disclosure Level 3+: scripts/, references/,
        assets/, and inline markdown link targets all resolve to absolute
        paths that the Agent can open directly.
        """
        def replace_dir_path(match):
            prefix = match.group(1)
            rel_path = match.group(2)
            abs_path = skill_dir / rel_path
            if abs_path.exists():
                return f"{prefix}{abs_path}"
            return match.group(0)

        pattern_dirs = r"(python\s+|`)((?:scripts|references|assets)/[^\s`\)]+)"
        content = re.sub(pattern_dirs, replace_dir_path, content)

        def replace_doc_path(match):
            prefix = match.group(1)
            filename = match.group(2)
            suffix = match.group(3)
            abs_path = skill_dir / filename
            if abs_path.exists():
                return f"{prefix}`{abs_path}` (use read_file to access){suffix}"
            return match.group(0)

        pattern_docs = r"(see|read|refer to|check)\s+([a-zA-Z0-9_-]+\.(?:md|txt|json|yaml))([.,;\s])"
        content = re.sub(pattern_docs, replace_doc_path, content, flags=re.IGNORECASE)

        def replace_markdown_link(match):
            prefix = match.group(1) if match.group(1) else ""
            link_text = match.group(2)
            filepath = match.group(3)
            clean_path = filepath[2:] if filepath.startswith("./") else filepath
            abs_path = skill_dir / clean_path
            if abs_path.exists():
                return f"{prefix}[{link_text}](`{abs_path}`) (use read_file to access)"
            return match.group(0)

        pattern_markdown = (
            r"(?:(Read|See|Check|Refer to|Load|View)\s+)?"
            r"\[(`?[^`\]]+`?)\]\(((?:\./)?[^)]+\.(?:md|txt|json|yaml|js|py|html))\)"
        )
        content = re.sub(pattern_markdown, replace_markdown_link, content, flags=re.IGNORECASE)

        return content

    # ── Lookup ──────────────────────────────────────────────────────────

    def get_skill(self, name: str) -> Optional[Skill]:
        return self.loaded_skills.get(name)

    def list_skills(self) -> List[str]:
        return list(self.loaded_skills.keys())

    def get_skills_grouped_by_source(self) -> Dict[str, List[Skill]]:
        """Group skills by ``source.value``; each group sorted by name."""
        grouped: Dict[str, List[Skill]] = {}
        for skill in self.loaded_skills.values():
            grouped.setdefault(skill.source.value, []).append(skill)
        for group in grouped.values():
            group.sort(key=lambda s: s.name)
        return grouped

    # ── System-prompt metadata ──────────────────────────────────────────

    def get_skills_metadata_prompt(self) -> str:
        """System-prompt fragment grouped by scope (Kimi behavior).

        Empty groups are omitted. Scope order is highest-priority first.
        """
        if not self.loaded_skills:
            return ""

        grouped = self.get_skills_grouped_by_source()
        scope_order = [
            SkillSource.USER.value,
            SkillSource.EXTRA.value,
            SkillSource.EXTERNAL_GENERIC.value,
            SkillSource.EXTERNAL_CLAUDE.value,
            SkillSource.EXTERNAL_CODEX.value,
            SkillSource.EXTERNAL_GEMINI.value,
            SkillSource.BUILTIN.value,
        ]

        parts = [
            "## Available Skills\n",
            "You have access to specialized skills loaded from multiple sources. "
            "Each skill provides expert guidance for specific tasks.\n",
            "Load a skill's full content with the `get_skill` tool when needed.\n",
        ]

        for scope in scope_order:
            skills = grouped.get(scope)
            if not skills:
                continue
            label = SkillSource(scope).label
            parts.append(f"\n### {label} skills")
            for s in skills:
                parts.append(f"- `{s.name}`: {s.description}")

        return "\n".join(parts)


# ─── CRUD helpers (operate on a user_dir) ──────────────────────────────────


class SkillValidationError(ValueError):
    """Raised when a skill name or frontmatter fails Kimi schema validation."""


def _atomic_write(path: Path, text: str) -> None:
    """Write ``text`` to ``path`` via tmp+rename for atomicity."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def write_skill(
    user_dir: Path,
    name: str,
    description: str,
    body: str,
    *,
    license: Optional[str] = None,
    compatibility: Optional[str] = None,
    allowed_tools: Optional[List[str]] = None,
    metadata: Optional[Dict[str, str]] = None,
    skill_type: Optional[str] = None,
) -> Skill:
    """Create a new skill in ``user_dir/<name>/SKILL.md``.

    Raises ``SkillValidationError`` on invalid name/description.
    """
    try:
        validated_name = _validate_name(name)
        validated_desc = _validate_description(description)
    except (ValueError, SkillValidationError) as e:
        raise SkillValidationError(str(e)) from e

    skill_path = user_dir / validated_name / "SKILL.md"
    if skill_path.exists():
        raise SkillValidationError(f"Skill '{validated_name}' already exists in user dir.")

    frontmatter = {"name": validated_name, "description": validated_desc}
    if license:
        frontmatter["license"] = license
    if compatibility:
        if len(compatibility) > COMPATIBILITY_MAX:
            raise SkillValidationError(
                f"compatibility must be ≤{COMPATIBILITY_MAX} chars (got {len(compatibility)})"
            )
        frontmatter["compatibility"] = compatibility
    if allowed_tools:
        frontmatter["allowed-tools"] = allowed_tools
    if metadata:
        frontmatter["metadata"] = metadata
    if skill_type:
        frontmatter["type"] = skill_type

    text = "---\n" + yaml.safe_dump(
        frontmatter, allow_unicode=True, sort_keys=False, default_flow_style=False
    ) + "---\n\n" + body.lstrip()

    _atomic_write(skill_path, text)
    return Skill(
        name=validated_name,
        description=validated_desc,
        content=body,
        license=license,
        compatibility=compatibility,
        allowed_tools=allowed_tools,
        metadata=metadata,
        skill_type=skill_type,
        source=SkillSource.USER,
        skill_path=skill_path,
    )


def read_skill_raw(user_dir: Path, name: str) -> Optional[Tuple[dict, str, Path]]:
    """Read raw frontmatter + body from ``user_dir/<name>/SKILL.md``.

    Returns ``(frontmatter_dict, body_str, path)`` or ``None`` if missing.
    """
    try:
        validated = _validate_name(name)
    except ValueError as e:
        raise SkillValidationError(str(e)) from e

    skill_path = user_dir / validated / "SKILL.md"
    if not skill_path.exists():
        return None
    content = skill_path.read_text(encoding="utf-8")
    fm, body = SkillLoader._parse_frontmatter(content)
    return (fm or {}, body or "", skill_path)


def update_skill(
    user_dir: Path,
    name: str,
    *,
    description: Optional[str] = None,
    body: Optional[str] = None,
    license: Optional[str] = None,
    compatibility: Optional[str] = None,
    allowed_tools: Optional[List[str]] = None,
    metadata: Optional[Dict[str, str]] = None,
) -> Skill:
    """Update an existing skill in ``user_dir/<name>/SKILL.md``.

    Frontmatter fields not passed are preserved; ``body`` replaces the markdown
    body. ``description`` and ``license`` can be cleared by passing an empty
    string (description cannot be cleared — that's a hard requirement).
    """
    existing = read_skill_raw(user_dir, name)
    if existing is None:
        raise SkillValidationError(f"Skill '{name}' does not exist in user dir.")
    fm, old_body, skill_path = existing

    # Merge frontmatter: provided fields override; license/compat/tools can be
    # cleared by passing "" / [] / None explicitly.
    merged = dict(fm)
    if description is not None:
        try:
            merged["description"] = _validate_description(description)
        except ValueError as e:
            raise SkillValidationError(str(e)) from e
    elif "description" not in merged:
        # Preserve legacy: don't accidentally drop description.
        raise SkillValidationError("Skill description is required.")
    if license is not None:
        if license == "":
            merged.pop("license", None)
        else:
            merged["license"] = license
    if compatibility is not None:
        if compatibility == "":
            merged.pop("compatibility", None)
        elif len(compatibility) > COMPATIBILITY_MAX:
            raise SkillValidationError(
                f"compatibility must be ≤{COMPATIBILITY_MAX} chars"
            )
        else:
            merged["compatibility"] = compatibility
    if allowed_tools is not None:
        if allowed_tools == []:
            merged.pop("allowed-tools", None)
        else:
            merged["allowed-tools"] = allowed_tools
    if metadata is not None:
        merged["metadata"] = metadata

    new_body = body if body is not None else old_body

    text = "---\n" + yaml.safe_dump(
        merged, allow_unicode=True, sort_keys=False, default_flow_style=False
    ) + "---\n\n" + new_body.lstrip()
    _atomic_write(skill_path, text)

    return Skill(
        name=str(merged.get("name", name)),
        description=str(merged["description"]),
        content=new_body,
        license=merged.get("license"),
        compatibility=merged.get("compatibility"),
        allowed_tools=merged.get("allowed-tools"),
        metadata=merged.get("metadata"),
        skill_type=merged.get("type"),
        source=SkillSource.USER,
        skill_path=skill_path,
    )


def delete_skill(user_dir: Path, name: str) -> bool:
    """Delete ``user_dir/<name>/`` (recursively). Returns True on success."""
    try:
        validated = _validate_name(name)
    except ValueError as e:
        raise SkillValidationError(str(e)) from e

    skill_dir = user_dir / validated
    if not skill_dir.exists():
        return False
    import shutil

    shutil.rmtree(skill_dir)
    return True


# ─── Convenience: build a default loader from config + env ────────────────


def get_default_user_dir() -> Path:
    """Resolve the default user data dir for skills (cross-platform)."""
    if os.name == "nt":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / "MiniMaxStudio" / "skills"
    # macOS / Linux: XDG-style home dir.
    xdg = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(xdg) / "MiniMaxStudio" / "skills"


def get_default_external_paths() -> Dict[SkillSource, Path]:
    """Return the default external skill dirs (Claude, Codex, Gemini, Generic).

    Missing dirs are not errors — the loader silently skips them.
    """
    home = Path.home()
    if os.name == "nt":
        userprofile = Path(os.environ.get("USERPROFILE") or home)
        return {
            SkillSource.EXTERNAL_CLAUDE: userprofile / ".claude" / "skills",
            SkillSource.EXTERNAL_CODEX: userprofile / ".codex" / "skills",
            SkillSource.EXTERNAL_GEMINI: userprofile / ".gemini" / "skills",
            SkillSource.EXTERNAL_GENERIC: userprofile / ".config" / "agents" / "skills",
        }
    return {
        SkillSource.EXTERNAL_CLAUDE: home / ".claude" / "skills",
        SkillSource.EXTERNAL_CODEX: home / ".codex" / "skills",
        SkillSource.EXTERNAL_GEMINI: home / ".gemini" / "skills",
        SkillSource.EXTERNAL_GENERIC: home / ".config" / "agents" / "skills",
    }
