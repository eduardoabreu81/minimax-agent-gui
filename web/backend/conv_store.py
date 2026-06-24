"""Conversation persistence layer.

This module isolates the storage backend behind a ``ConversationStore``
Protocol so the backend code (``web/backend/main.py``) talks to a
stable interface instead of touching JSON files directly. The current
implementation is JSON-on-disk (one file per conversation, easy to
inspect, zero dependencies). When the project outgrows it (typically
>500 conversations OR >1k messages in any single conversation, or when
full-text search / multi-user / cloud sync enter the roadmap), drop in
a ``SQLiteConversationStore`` that implements the same Protocol — no
refactor of callers needed.

## Why Protocol and not ABC?

We don't need runtime inheritance enforcement; the goal is purely to
document the contract and let static checkers (mypy/pyright) catch
missing methods. ``typing.Protocol`` is structural — any class with
the right methods satisfies it without inheriting.

## Future migration path (SQLite)

The stub ``SQLiteConversationStore`` at the bottom of this file is a
roadmap placeholder. When implementing:

- Use ``sqlite3`` stdlib (no extra dependency).
- One table ``conversations(id PRIMARY KEY, title, created_at,
  updated_at, type, workspace_dir, payload_json)`` — payload kept as
  JSON blob for simplicity (SQLite has no structured-message type and
  the messages are heterogeneous).
- Index ``updated_at`` for the list view; add FTS5 virtual table on
  ``messages.text(content)`` for full-text search.
- WAL mode (``PRAGMA journal_mode=WAL``) for concurrent reads/writes.
- Replace ``CONVERSATIONS_DIR`` discovery with a single
  ``storage.db`` file path.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Optional, Protocol, runtime_checkable


# ---------------------------------------------------------------------------
# Interface
# ---------------------------------------------------------------------------


@runtime_checkable
class ConversationStore(Protocol):
    """Stable interface every backend caller depends on.

    All methods are synchronous — the Studio backend wraps them in
    ``asyncio.to_thread`` at the call site (or calls them directly
    when not in an async context, e.g. WebSocket handlers).
    """

    def load(self, conv_id: str) -> dict:
        """Return the full conversation record.

        Shape:
            {
                "id": str,
                "title": str,
                "messages": list[dict],
                "created_at": str (ISO 8601),
                "updated_at": str (ISO 8601),
                "workspace_dir": str | None,
            }

        Returns an empty default ``{"id": ..., "title": "New Chat",
        "messages": []}`` when the conversation does not exist (so
        callers can treat missing as new).
        """
        ...

    def save(self, conv_id: str, title: str, messages: list, *,
             workspace_dir: Optional[str] = None) -> None:
        """Persist the conversation (overwrites the previous record).

        ``workspace_dir`` is optional metadata; chat sessions pass
        ``None``, coding sessions pass the resolved workspace path.
        Implementations are responsible for stamping ``created_at`` /
        ``updated_at`` consistently — callers don't compute them.
        """
        ...

    def list_all(self, type_filter: str = "") -> list[dict]:
        """Return conversation summaries, newest first.

        ``type_filter`` is ``""`` (all), ``"chat"`` (only non-coding)
        or ``"coding"`` (only sessions whose id starts with
        ``coding-``).

        Each entry shape:
            {
                "id": str,
                "title": str,
                "created_at": str,
                "updated_at": str,
                "message_count": int,
                "workspace_dir": str | None,
                "type": "chat" | "coding",
            }
        """
        ...

    def delete(self, conv_id: str) -> bool:
        """Delete the conversation. Returns True if it existed."""
        ...

    def search(self, query: str, type_filter: str = "") -> list[dict]:
        """Search by title, message content, or attachment name.

        Returns results ordered by relevance (then updated_at desc).
        Each entry includes a short ``snippet`` for preview.

        JSON impl does a linear scan; SQLite impl should use FTS5.
        """
        ...


# ---------------------------------------------------------------------------
# JSON implementation (current)
# ---------------------------------------------------------------------------


class JSONConversationStore:
    """One-file-per-conversation storage under ``conversations_dir``.

    Pros: zero deps, human-readable, ``git diff``-friendly.
    Cons: O(N) list/search, no concurrency safety on simultaneous
    writes, full read into memory for every load.

    For the Studio's current scale (<500 conversations, <1k messages
    each) this is fine. Migrate to SQLite when scale demands.
    """

    def __init__(self, conversations_dir: Path):
        self.dir = conversations_dir

    def _path(self, conv_id: str) -> Path:
        return self.dir / f"{conv_id}.json"

    def load(self, conv_id: str) -> dict:
        path = self._path(conv_id)
        if not path.exists():
            return {"id": conv_id, "title": "New Chat", "messages": []}
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def save(self, conv_id: str, title: str, messages: list, *,
             workspace_dir: Optional[str] = None) -> None:
        path = self._path(conv_id)
        iso_now = datetime.now().isoformat()
        data: dict = {"id": conv_id, "title": title, "messages": messages}
        if workspace_dir is not None:
            data["workspace_dir"] = workspace_dir
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    existing = json.load(f)
                data["created_at"] = existing.get("created_at", iso_now)
            except Exception:
                data["created_at"] = iso_now
        else:
            data["created_at"] = iso_now
        data["updated_at"] = iso_now
        # Write atomically: tmp file + rename, so a crash mid-write
        # never leaves a half-written conversation behind.
        tmp = path.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp.replace(path)

    def list_all(self, type_filter: str = "") -> list[dict]:
        conversations: list[dict] = []
        for p in self.dir.glob("*.json"):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                continue
            conv_id = data.get("id", p.stem)
            is_coding = conv_id.startswith("coding-")
            if type_filter == "chat" and is_coding:
                continue
            if type_filter == "coding" and not is_coding:
                continue
            ws = data.get("workspace_dir")
            conversations.append({
                "id": conv_id,
                "title": data.get("title", "Untitled"),
                "created_at": data.get("created_at", ""),
                "updated_at": data.get("updated_at", ""),
                "message_count": len(data.get("messages", [])),
                "workspace_dir": ws if isinstance(ws, str) and ws else None,
                "type": "coding" if is_coding else "chat",
            })
        conversations.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
        return conversations

    def delete(self, conv_id: str) -> bool:
        path = self._path(conv_id)
        if path.exists():
            path.unlink()
            return True
        return False

    @staticmethod
    def _snippet(text: str, query_lower: str, context: int = 60) -> str:
        """Extract a short snippet around the first match of query in text."""
        if not text:
            return ""
        idx = text.lower().find(query_lower)
        if idx == -1:
            return text[:100] + ("..." if len(text) > 100 else "")
        start = max(0, idx - context)
        end = min(len(text), idx + len(query_lower) + context)
        snippet = text[start:end]
        if start > 0:
            snippet = "..." + snippet
        if end < len(text):
            snippet = snippet + "..."
        return snippet

    def search(self, query: str, type_filter: str = "") -> list[dict]:
        if not query or not query.strip():
            return []
        q = query.strip().lower()
        results: list[dict] = []

        for p in self.dir.glob("*.json"):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                continue

            conv_id = data.get("id", p.stem)
            is_coding = conv_id.startswith("coding-")
            if type_filter == "chat" and is_coding:
                continue
            if type_filter == "coding" and not is_coding:
                continue

            title = data.get("title", "")
            messages = data.get("messages", [])

            matches: list[dict] = []

            # Title match
            if q in title.lower():
                matches.append({
                    "field": "title",
                    "snippet": self._snippet(title, q, 40),
                })

            # Message + attachment matches (collect ALL, not just first)
            for i, msg in enumerate(messages):
                content = msg.get("content", msg.get("text", ""))
                if q in content.lower():
                    matches.append({
                        "field": "message",
                        "snippet": self._snippet(content, q, 60),
                        "message_index": i,
                    })

                attachment = msg.get("attachment", "")
                if attachment and q in attachment.lower():
                    matches.append({
                        "field": "attachment",
                        "snippet": self._snippet(attachment, q, 40),
                        "message_index": i,
                    })

            if not matches:
                continue

            results.append({
                "id": conv_id,
                "title": title or "Untitled",
                "type": "coding" if is_coding else "chat",
                "updated_at": data.get("updated_at", ""),
                "message_count": len(messages),
                "matches": matches,
                "workspace_dir": data.get("workspace_dir"),
            })

        results.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
        return results


# ---------------------------------------------------------------------------
# SQLite implementation (roadmap)
# ---------------------------------------------------------------------------
#
# When scale demands, replace JSONConversationStore with this and flip
# the ``conversation_store`` factory in web/backend/main.py. Callers
# don't change.
#
# class SQLiteConversationStore:
#     """Schema (single-table for simplicity, FTS5 for search):
#
#         CREATE TABLE conversations (
#             id TEXT PRIMARY KEY,
#             title TEXT NOT NULL,
#             type TEXT NOT NULL,                 -- 'chat' | 'coding'
#             created_at TEXT NOT NULL,
#             updated_at TEXT NOT NULL,
#             workspace_dir TEXT,
#             payload_json TEXT NOT NULL          -- messages + metadata
#         );
#         CREATE INDEX idx_updated_at ON conversations(updated_at DESC);
#         CREATE INDEX idx_type ON conversations(type);
#
#         CREATE VIRTUAL TABLE conversations_fts USING fts5(
#             id UNINDEXED,
#             title,
#             body,
#             content='conversations',
#             content_rowid='rowid'
#         );
#
#     Notes:
#     - PRAGMA journal_mode=WAL on open (concurrent reads + 1 writer)
#     - Wrap writes in transactions
#     - Keep payload as JSON blob (heterogeneous message shapes, no
#       reason to normalize further)
#     - search() uses FTS5 MATCH with snippet() for highlight
#     - Backup: ``VACUUM INTO 'backup.db'`` produces a clean snapshot
#     """
#     pass