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

    ``refused`` is True when the hard limit (50%) is hit, meaning
    NO refs were expanded and the original message should be
    returned unchanged. ``soft_warning`` is set when the total
    exceeds 25% of the context limit but stays under 50% — all
    refs still expand, the caller surfaces a yellow warning.
    """

    results: list[ExpansionResult] = field(default_factory=list)
    total_bytes: int = 0
    soft_warning: str = ""
    refused: bool = False
    refusal_reason: str = ""

    def to_dict(self) -> dict:
        return {
            "results": [r.to_dict() for r in self.results],
            "total_bytes": self.total_bytes,
            "soft_warning": self.soft_warning,
            "refused": self.refused,
            "refusal_reason": self.refusal_reason,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Size limits
# ─────────────────────────────────────────────────────────────────────────────

# Hermes spec: soft 25% / hard 50% of context length.
# We compute against a model_limit (in TOKENS) provided by the caller.
# Bytes → tokens is approximate; we use 1 token ≈ 4 bytes (English
# prose average). This matches the rough heuristic used elsewhere
# in the project (see mini_agent/agent.py _estimate_tokens fallback).
_BYTES_PER_TOKEN = 4

# Soft/hard thresholds. Hermes spec literal values.
SOFT_LIMIT_FRACTION = 0.25
HARD_LIMIT_FRACTION = 0.50


def _check_size_limits(
    total_bytes: int,
    model_limit: int,
) -> tuple[bool, str, bool, str]:
    """Compute soft/hard limit flags for a given byte total.

    Returns (soft_warning_str, soft_warning, refused, refusal_reason).

    Note the unusual return order: the first tuple element is the
    soft_warning message (string, possibly empty), the second is a
    bool (kept for back-compat), then refused bool + reason. We use
    strings as the primary signal because the caller (frontend)
    surfaces the message text directly.
    """
    if model_limit <= 0:
        # No limit info → can't evaluate. Default to no warning/refusal.
        return "", False, False, ""

    limit_bytes = model_limit * _BYTES_PER_TOKEN
    soft_limit = int(limit_bytes * SOFT_LIMIT_FRACTION)
    hard_limit = int(limit_bytes * HARD_LIMIT_FRACTION)

    if total_bytes >= hard_limit:
        return (
            "",
            False,
            True,
            f"expanded content is {total_bytes:,} bytes "
            f"(>= {int(HARD_LIMIT_FRACTION * 100)}% of context, "
            f"hard limit). Original message returned unchanged.",
        )
    if total_bytes >= soft_limit:
        return (
            f"expanded content is {total_bytes:,} bytes "
            f"(>= {int(SOFT_LIMIT_FRACTION * 100)}% of context). "
            f"Consider removing some @-refs.",
            True,
            False,
            "",
        )
    return "", False, False, ""


# ─────────────────────────────────────────────────────────────────────────────
# Main expand dispatcher
# ─────────────────────────────────────────────────────────────────────────────


def _expand_single(ref: Ref, workspace: Path) -> ExpansionResult:
    """Expand one ref. Returns ExpansionResult with either content or error.

    Per-ref failures (sensitive path, binary file, network error)
    become ``error`` strings attached to the result — they do NOT
    abort the rest of the expansion. The caller surfaces them as
    warning chips in the UI.
    """
    result = ExpansionResult(ref=ref)

    if ref.type == "diff":
        out = git_diff(workspace)
    elif ref.type == "staged":
        out = git_staged(workspace)
    elif ref.type == "git":
        try:
            n = int(ref.value)
        except ValueError:
            return _err(ref, f"@git: requires a number, got {ref.value!r}")
        out = git_log_n(workspace, n)
    elif ref.type == "url":
        out = fetch_url(ref.value)
    elif ref.type == "file":
        try:
            resolved = resolve_workspace_path(workspace, ref.value)
        except (PermissionError, ValueError) as e:
            return _err(ref, str(e))

        # Sensitive path check FIRST (before filesystem access)
        if (reason := is_sensitive(resolved)) is not None:
            return _err(ref, f"sensitive path ({reason})")

        if not resolved.exists():
            return _err(ref, f"file not found: {ref.value}")
        if not resolved.is_file():
            return _err(ref, f"not a file: {ref.value}")

        if _looks_like_binary(resolved):
            return _err(ref, "binary files are not supported")

        # Parse line range from value (if present)
        line_range = None
        if _looks_like_line_range(ref.value):
            try:
                _, range_part = ref.value.rsplit(":", 1)
                if "-" in range_part:
                    a, b = range_part.split("-", 1)
                    line_range = (int(a), int(b))
                else:
                    line_range = (int(range_part), int(range_part))
            except (ValueError, IndexError):
                line_range = None  # fall through to full file

        try:
            out = _read_text_file(resolved, line_range=line_range)
        except (OSError, UnicodeDecodeError) as e:
            return _err(ref, f"read failed: {e.__class__.__name__}")

    elif ref.type == "folder":
        try:
            resolved = resolve_workspace_path(workspace, ref.value)
        except (PermissionError, ValueError) as e:
            return _err(ref, str(e))

        if (reason := is_sensitive(resolved)) is not None:
            return _err(ref, f"sensitive path ({reason})")

        try:
            listing, _count = read_folder_tree(resolved)
        except FileNotFoundError:
            return _err(ref, f"folder not found: {ref.value}")
        out = listing
    else:
        return _err(ref, f"unknown ref type: {ref.type}")

    # Check for sentinel BLOCKED markers (git errors, URL errors)
    if isinstance(out, str) and out.startswith("[BLOCKED:"):
        return _err(ref, out.removeprefix("[BLOCKED:").removesuffix("]"))

    result.content = out
    result.size_bytes = len(out.encode("utf-8"))
    return result


def _err(ref: Ref, message: str) -> ExpansionResult:
    """Build an ExpansionResult with an error and no content."""
    r = ExpansionResult(ref=ref)
    r.error = message
    return r


def expand_refs(
    refs: Iterable[Ref],
    workspace_dir: Path,
    *,
    model_limit: int = 0,
) -> ExpansionReport:
    """Expand all refs against ``workspace_dir``.

    The hard limit (50% of context) is enforced AT THE END: if the
    total expanded bytes exceeds it, ``ExpansionReport.refused`` is
    set to True and ``results`` is empty. The caller (frontend) sees
    the refusal and returns the original message unchanged — none
    of the partial expansions are kept.

    The soft limit (25%) is enforced as a warning on the report; all
    refs still expand in this case.

    Per-ref failures (sensitive path, binary, network error) become
    ``error`` strings on individual results. They do NOT block the
    other refs.
    """
    report = ExpansionReport()

    for ref in refs:
        result = _expand_single(ref, workspace_dir)
        report.results.append(result)
        # Only successful expansions count toward the total. Errors
        # and blocked refs contribute 0 bytes (they have no content).
        report.total_bytes += result.size_bytes

    # Enforce hard limit AT THE END. If total > 50% of context, the
    # entire expansion is rejected (return original message unchanged).
    soft_msg, _soft_flag, refused, reason = _check_size_limits(
        report.total_bytes, model_limit
    )
    report.soft_warning = soft_msg
    if refused:
        report.refused = True
        report.refusal_reason = reason
        # Drop the partial results — caller will use the original msg
        report.results = []
        report.total_bytes = 0

    return report
