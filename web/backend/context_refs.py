"""Context references — inline @-prefixed references expanded at message time.

Hermes spec: https://hermes-agent.nousresearch.com/docs/user-guide/features/context-references

Supported syntaxes (the user types these in the composer, the frontend
expands them locally and the agent sees the content under an
``--- Attached Context ---`` block):

    @file:path/to/file.py            inject file contents
    @file:path/to/file.py:10-25      inject specific line range (1-indexed, inclusive)
    @folder:path/to/dir              inject directory tree listing (max 200 files)
    @diff                            inject ``git diff`` (unstaged working tree)
    @staged                          inject ``git diff --staged``
    @git:5                           inject last 5 commits with patches (max 10)
    @url:https://example.com         fetch and inject web page content

Security:
    - All paths resolved relative to ``workspace_dir`` (the per-session
      coding workspace, or the app workspace for non-coding sessions).
    - Sensitive paths (SSH keys, cloud creds, .env) blocked by default.
    - Binary files rejected with a warning chip.
    - Out-of-workspace paths rejected.
    - Soft limit 25% of context length: warn, proceed.
    - Hard limit 50% of context length: refuse all, original message
      returned unchanged.

Failure model: each ref is independently expanded. Failures become warning
chips attached to the ref (e.g. ``[BLOCKED: sensitive path]``); the
refusal of one ref does NOT block the rest. Only the hard size limit
refuses ALL expansion and returns the original message unchanged.

This module is the backend piece. The frontend (composer + autocomplete)
calls ``expand_refs(refs, workspace_dir, model_limit)`` via the
``POST /api/context-refs/expand`` endpoint.
"""

from __future__ import annotations

import logging
import mimetypes
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Ref parsing
# ─────────────────────────────────────────────────────────────────────────────

# Regex matches the 7 supported syntaxes. ``@diff`` and ``@staged``
# have NO colon (they're just bare tokens); the others have ``:value``.
# Two patterns to handle both:
#   1) ``@(file|folder|git|url):value`` — value-required types
#   2) ``@(diff|staged)\b`` — value-less types (word boundary so
#      ``@diff`` doesn't match ``@difference``)
# Trailing punctuation (.,;!? etc.) is stripped from the value
# after matching — see the spec example "Check @file:main.py, and…"
_REF_RE = re.compile(
    r"@(file|folder|git|url):([^\s@]*)"
    r"|@(diff|staged)\b",
    re.IGNORECASE,
)


@dataclass
class Ref:
    """A single @-reference parsed from the user message.

    ``raw`` is the original substring as typed (with the @).
    ``type`` is the lowercase type ("file", "folder", etc.).
    ``value`` is the argument after the colon (empty for @diff/@staged).
    ``start`` / ``end`` are the character offsets in the source message.
    """

    raw: str
    type: str
    value: str
    start: int
    end: int

    @property
    def display(self) -> str:
        """What we show in the UI for this ref. ``@file:foo.py:10-25``."""
        return self.raw


def parse_refs(text: str) -> list[Ref]:
    """Extract all @-references from a message.

    Strips trailing punctuation from the value before matching
    (e.g. ``@file:main.py,`` becomes ``@file:main.py`` with the comma
    left in the surrounding text). Duplicates are preserved (the caller
    decides whether to dedupe; the user might want to reference the same
    file twice in a long message).
    """
    out: list[Ref] = []
    for m in _REF_RE.finditer(text):
        # The two patterns give us groups in different positions:
        #   colon-form:   group(1)=type, group(2)=value
        #   bare-form:    group(3)=type, group(4)=None
        if m.group(1) is not None:
            rtype = m.group(1).lower()
            value = m.group(2) or ""
        else:
            rtype = m.group(3).lower()
            value = ""

        # Strip trailing punctuation from value: ",.;:!?)\"'"
        # The leading colon in @file:foo.py:10-25 is the type separator;
        # we only strip from the END, and we only strip ONE character
        # (the regex stops at whitespace so multi-char junk is excluded).
        # But preserve line-range colons: @file:foo.py:10-25
        if value and value[-1] in ",.;:!?)\"'" and not (
            rtype == "file" and _looks_like_line_range(value)
        ):
            value = value[:-1]
            end = m.end() - 1
        else:
            end = m.end()

        out.append(
            Ref(
                raw=text[m.start():end],
                type=rtype,
                value=value,
                start=m.start(),
                end=end,
            )
        )
    return out


def _looks_like_line_range(value: str) -> bool:
    """True if value matches ``path:N`` or ``path:N-M`` (line range syntax)."""
    # Match e.g. "foo.py:10-25" or "foo.py:42"
    return bool(re.match(r"^[^:]+:\d+(-\d+)?$", value))


# ─────────────────────────────────────────────────────────────────────────────
# Sensitive path blocklist
# ─────────────────────────────────────────────────────────────────────────────

# Hermes spec: ~/.ssh, ~/.aws, ~/.gnupg, ~/.kube, $HERMES_HOME/skills/.hub,
#              ~/.netrc, ~/.pgpass, ~/.npmrc, ~/.pypirc, ~/.bashrc, etc.
#
# We block by ABSOLUTE path match (after `Path.resolve()`), so a
# `~/./ssh/id_rsa` won't slip through `~/.ssh/`. Matching is prefix-based
# for directories, exact for files.
#
# $HERMES_HOME is a placeholder; we resolve it against the user's home
# directory (the `~` shortcut) since our app doesn't have a separate
# HERMES_HOME. `~/.hermes/skills/.hub` would be the Hermes equivalent.
SENSITIVE_FILE_PATHS = (
    "~/.ssh/id_rsa",
    "~/.ssh/id_ed25519",
    "~/.ssh/authorized_keys",
    "~/.ssh/config",
    "~/.netrc",
    "~/.pgpass",
    "~/.npmrc",
    "~/.pypirc",
    "~/.bashrc",
    "~/.zshrc",
    "~/.profile",
    "~/.bash_profile",
    "~/.zprofile",
    "~/.hermes/.env",
)
SENSITIVE_DIR_PATHS = (
    "~/.ssh",
    "~/.aws",
    "~/.gnupg",
    "~/.kube",
    "~/.hermes/skills/.hub",
)


def _resolve_home(path: str) -> Path:
    """Expand ``~`` to the user home directory."""
    return Path(path).expanduser().resolve()


def is_sensitive(resolved_path: Path) -> Optional[str]:
    """Return a reason string if the path is sensitive, else None.

    Blocklist checks are done against the resolved (absolute) path
    after symlink resolution, so e.g. ``~/./ssh/id_rsa`` is caught.
    """
    try:
        resolved = resolved_path.resolve()
    except (OSError, RuntimeError):
        return None  # let the caller surface the real error

    for blocked in SENSITIVE_FILE_PATHS:
        target = _resolve_home(blocked)
        if resolved == target:
            return "sensitive credential file"

    for blocked in SENSITIVE_DIR_PATHS:
        target = _resolve_home(blocked)
        try:
            resolved.relative_to(target)
            return f"inside blocked directory {target.name}"
        except ValueError:
            continue

    return None


# ─────────────────────────────────────────────────────────────────────────────
# Path resolution + workspace bound
# ─────────────────────────────────────────────────────────────────────────────


def resolve_workspace_path(workspace_dir: Path, ref_path: str) -> Path:
    """Resolve a ref path against the workspace, rejecting out-of-workspace.

    Paths are relative to ``workspace_dir``. Absolute paths in the ref
    are rejected outright (Hermes spec: "All paths are resolved relative
    to the working directory. References that resolve outside the
    allowed workspace root are rejected.").

    ``..`` is allowed INSIDE the workspace (e.g. ``../sibling`` if the
    workspace is nested), but the final resolved path must still be
    inside ``workspace_dir`` after canonicalization.
    """
    ref_path_str = ref_path.strip()
    if not ref_path_str:
        raise ValueError("empty path")
    # Strip line range suffix for resolution
    if _looks_like_line_range(ref_path_str):
        file_part = ref_path_str.rsplit(":", 1)[0]
    else:
        file_part = ref_path_str

    p = Path(file_part)
    if p.is_absolute():
        raise PermissionError(f"absolute paths not allowed: {ref_path_str}")

    workspace = workspace_dir.resolve()
    candidate = (workspace / p).resolve()

    # Verify the candidate is inside the workspace. This blocks
    # ``../../etc/passwd`` and similar traversal even after
    # canonicalization.
    try:
        candidate.relative_to(workspace)
    except ValueError:
        raise PermissionError(
            f"path is outside the allowed workspace: {ref_path_str}"
        )

    return candidate


# ─────────────────────────────────────────────────────────────────────────────
# File / folder readers
# ─────────────────────────────────────────────────────────────────────────────


def _read_text_file(path: Path, line_range: Optional[tuple[int, int]] = None) -> str:
    """Read a text file as UTF-8. Optional 1-indexed inclusive line range."""
    content = path.read_text(encoding="utf-8", errors="replace")
    if line_range is None:
        return content
    start, end = line_range
    lines = content.splitlines(keepends=True)
    # 1-indexed inclusive (Hermes spec). Clamp to valid range so an
    # out-of-bounds request returns what we can rather than erroring.
    selected = lines[max(start - 1, 0):end]
    return "".join(selected)


def _looks_like_binary(path: Path, head_bytes: int = 8192) -> bool:
    """Detect binary via null-byte scan in the first 8KB.

    MIME type via mimetypes is unreliable (many source files don't have
    a registered MIME). Hermes spec uses null-byte scan; we match.
    """
    try:
        with open(path, "rb") as f:
            chunk = f.read(head_bytes)
    except OSError:
        return False
    if not chunk:
        return False  # empty file → treat as text
    # Null byte is a strong binary signal
    if b"\x00" in chunk:
        return True
    # Also reject if mimetypes says it's not text/* and not application/json etc.
    mime, _ = mimetypes.guess_type(str(path))
    if mime and not mime.startswith("text/") and mime not in (
        "application/json",
        "application/xml",
        "application/javascript",
        "application/x-yaml",
        "application/yaml",
        "application/toml",
    ):
        # Could still be text in a weird extension; fall back to the
        # null-byte check (already passed) so we accept it.
        return False
    return False


def read_folder_tree(
    root: Path,
    max_entries: int = 200,
) -> tuple[str, int]:
    """Return a tree-style listing of ``root`` and the total entry count.

    Hermes spec: max 200 folder entries, excess replaced with ``- ...``.
    """
    if not root.exists() or not root.is_dir():
        raise FileNotFoundError(f"folder not found: {root}")

    entries: list[str] = []
    truncated = False

    def _walk(directory: Path, prefix: str) -> None:
        nonlocal truncated
        if len(entries) >= max_entries:
            truncated = True
            return
        try:
            children = sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except (PermissionError, OSError):
            entries.append(f"{prefix}[permission denied]")
            return
        for child in children:
            if len(entries) >= max_entries:
                truncated = True
                return
            try:
                size = child.stat().st_size if child.is_file() else 0
            except OSError:
                size = 0
            kind = "/" if child.is_dir() else ""
            entries.append(f"{prefix}{child.name}{kind}  ({_format_size(size)})")
            if child.is_dir():
                _walk(child, prefix + "  ")

    _walk(root, "")
    listing = "\n".join(entries) if entries else "(empty)"
    if truncated:
        listing += f"\n- ... (truncated at {max_entries} entries)"
    return listing, len(entries)


def _format_size(n: int) -> str:
    if n < 1024:
        return f"{n}B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f}KB"
    return f"{n / (1024 * 1024):.1f}MB"


# ─────────────────────────────────────────────────────────────────────────────
# Git operations
# ─────────────────────────────────────────────────────────────────────────────


def _run_git(workspace: Path, *args: str, max_bytes: int = 5_000_000) -> str:
    """Run a git command in ``workspace`` and return stdout.

    5MB hard cap on stdout. On failure (non-zero exit, timeout, missing
    git binary) returns the stderr wrapped in a warning marker so the
    caller can decide whether to surface it.
    """
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=10,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError:
        return f"[BLOCKED: git binary not found in PATH]"
    except subprocess.TimeoutExpired:
        return f"[BLOCKED: git {' '.join(args)} timed out]"

    if result.returncode != 0:
        stderr = result.stderr.strip()[:500]
        return f"[BLOCKED: git {' '.join(args)} failed: {stderr}]"

    out = result.stdout
    if len(out) > max_bytes:
        out = out[:max_bytes] + f"\n[...truncated at {max_bytes} bytes]"
    return out


def git_diff(workspace: Path) -> str:
    """``git diff`` (unstaged working tree changes). Empty if clean."""
    return _run_git(workspace, "diff", "--no-color")


def git_staged(workspace: Path) -> str:
    """``git diff --staged``. Empty if no staged changes."""
    return _run_git(workspace, "diff", "--staged", "--no-color")


def git_log_n(workspace: Path, n: int) -> str:
    """Last ``n`` commits with full patches. ``n`` clamped to [1, 10]."""
    n = max(1, min(n, 10))
    # --no-color so the model sees clean text
    # -p shows the patch, --stat adds a summary per commit
    return _run_git(workspace, "log", f"-{n}", "--no-color", "-p", "--stat")


# ─────────────────────────────────────────────────────────────────────────────
# URL fetcher
# ─────────────────────────────────────────────────────────────────────────────

# Hermes spec does not specify a default URL size cap, but a 50KB cap
# keeps a single @url: from blowing up the context window. This matches
# the spec's general "size limits keep context bounded" stance.
URL_MAX_BYTES = 50_000
URL_TIMEOUT_SECONDS = 10.0

# Schemes we allow. http/https/file only. file:// is a future option
# (would resolve to local fs read), but we don't ship it now — the
# spec lists only http(s).
_ALLOWED_URL_SCHEMES = ("http", "https")


def _strip_html(html: str) -> str:
    """Cheap HTML → text. Hermes spec doesn't require rich extraction;
    we just drop tags + collapse whitespace. For a real implementation
    we'd use readability-lxml or html2text, but the spec is happy with
    a stripped version as long as the model gets the prose.
    """
    # Remove script/style blocks first (their content is not visible text)
    html = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE)
    # Strip remaining tags
    text = re.sub(r"<[^>]+>", " ", html)
    # Decode common HTML entities (basic set; full list is huge)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    # Collapse runs of whitespace
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def fetch_url(url: str, *, max_bytes: int = URL_MAX_BYTES) -> str:
    """Fetch a URL and return its text content.

    Limits:
      - 50KB response cap (truncated with a marker)
      - 10s timeout
      - http/https only
      - HTML responses are stripped to text; plain text is returned as-is
    """
    parsed = urlparse(url)
    if parsed.scheme not in _ALLOWED_URL_SCHEMES:
        return f"[BLOCKED: URL scheme '{parsed.scheme}' not allowed]"

    try:
        # `follow_redirects=True` is httpx's default. We cap redirects
        # implicitly via the timeout. Don't enable a separate redirect
        # cap for now — spec doesn't require it.
        response = httpx.get(
            url,
            timeout=URL_TIMEOUT_SECONDS,
            headers={"User-Agent": "minimax-agent/0.4 (context-refs)"},
        )
        response.raise_for_status()
    except httpx.TimeoutException:
        return f"[BLOCKED: URL fetch timed out after {URL_TIMEOUT_SECONDS}s]"
    except httpx.HTTPStatusError as e:
        return f"[BLOCKED: URL returned HTTP {e.response.status_code}]"
    except httpx.RequestError as e:
        return f"[BLOCKED: URL fetch failed: {e.__class__.__name__}]"

    raw = response.content
    if len(raw) > max_bytes:
        raw = raw[:max_bytes]
        truncated_marker = f"\n[...truncated at {max_bytes} bytes]"
    else:
        truncated_marker = ""

    content_type = response.headers.get("content-type", "").lower()
    if "html" in content_type or not content_type:
        text = _strip_html(raw.decode("utf-8", errors="replace"))
    else:
        text = raw.decode("utf-8", errors="replace")

    return text + truncated_marker


# ─────────────────────────────────────────────────────────────────────────────
# Result types
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class ExpansionResult:
    """One ref's expansion outcome (success or warning)."""

    ref: Ref
    content: str = ""
    warning: str = ""
    error: str = ""
    size_bytes: int = 0

    @property
    def ok(self) -> bool:
        return not self.error

    def to_dict(self) -> dict:
        return {
            "ref": self.ref.display,
            "type": self.ref.type,
            "value": self.ref.value,
            "content": self.content,
            "warning": self.warning,
            "error": self.error,
            "size_bytes": self.size_bytes,
        }


@dataclass
class ExpansionReport:
    """The full response for an expand request.

    ``total_bytes`` is the sum of all successful expansions'
    ``size_bytes``. The caller compares this against the model's
    context limit to decide whether to warn (25%) or refuse (50%).
    """

    results: list[ExpansionResult] = field(default_factory=list)
    total_bytes: int = 0
    soft_limit_hit: bool = False
    hard_limit_hit: bool = False

    def to_dict(self) -> dict:
        return {
            "results": [r.to_dict() for r in self.results],
            "total_bytes": self.total_bytes,
            "soft_limit_hit": self.soft_limit_hit,
            "hard_limit_hit": self.hard_limit_hit,
        }
