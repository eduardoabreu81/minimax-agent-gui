"""Tests for the context-refs backend core.

Covers:
  - Ref parser (all 6 syntaxes + line range + trailing punctuation)
  - Sensitive path blocklist (file exact match + directory prefix)
  - Path resolution (relative + line range + absolute reject + traversal reject)
  - Binary detection (null-byte scan)
  - Folder tree listing (max 200 entries + truncation marker)
  - Git operations (diff, staged, log) via subprocess
"""

import subprocess
from pathlib import Path

import pytest

from web.backend import context_refs as cr


# ─────────────────────────────────────────────────────────────────────────────
# Ref parser
# ─────────────────────────────────────────────────────────────────────────────


class TestParseRefs:
    def test_file_ref(self):
        refs = cr.parse_refs("Review @file:src/main.py please")
        assert len(refs) == 1
        assert refs[0].type == "file"
        assert refs[0].value == "src/main.py"
        assert refs[0].raw == "@file:src/main.py"

    def test_file_with_line_range(self):
        refs = cr.parse_refs("Look at @file:foo.py:10-25")
        assert refs[0].value == "foo.py:10-25"
        # Line range colons must NOT be stripped
        assert refs[0].raw == "@file:foo.py:10-25"

    def test_file_with_single_line(self):
        refs = cr.parse_refs("Line 42 → @file:foo.py:42")
        assert refs[0].value == "foo.py:42"

    def test_folder_ref(self):
        refs = cr.parse_refs("What's in @folder:src/components?")
        assert refs[0].type == "folder"
        assert refs[0].value == "src/components"

    def test_diff_ref(self):
        refs = cr.parse_refs("What changed? @diff")
        assert refs[0].type == "diff"
        assert refs[0].value == ""

    def test_staged_ref(self):
        refs = cr.parse_refs("Show staged: @staged")
        assert refs[0].type == "staged"
        assert refs[0].value == ""

    def test_git_ref(self):
        refs = cr.parse_refs("Recent: @git:5")
        assert refs[0].type == "git"
        assert refs[0].value == "5"

    def test_url_ref(self):
        refs = cr.parse_refs("Read this @url:https://example.com/foo")
        assert refs[0].type == "url"
        assert refs[0].value == "https://example.com/foo"

    def test_trailing_punctuation_stripped(self):
        # The comma stays in the surrounding text but is stripped from the value
        refs = cr.parse_refs("Check @file:main.py, and also @file:test.py.")
        assert refs[0].value == "main.py"
        assert refs[1].value == "test.py"

    def test_multiple_refs_in_message(self):
        text = "Review @diff and @file:src/main.py and @folder:src"
        refs = cr.parse_refs(text)
        assert [r.type for r in refs] == ["diff", "file", "folder"]
        # Spans should be in the source order
        assert refs[0].start < refs[1].start < refs[2].start

    def test_no_refs(self):
        assert cr.parse_refs("just a normal message") == []
        assert cr.parse_refs("") == []
        # @ alone, no colon → not matched
        assert cr.parse_refs("ping @ someone") == []
        # Unknown type → not matched
        assert cr.parse_refs("@unknown:foo") == []

    def test_offsets_are_correct(self):
        text = "Hi @file:foo.py bye"
        refs = cr.parse_refs(text)
        assert text[refs[0].start:refs[0].end] == "@file:foo.py"

    def test_duplicate_refs_preserved(self):
        # The user might want to reference the same file twice
        refs = cr.parse_refs("@file:a.py and again @file:a.py")
        assert len(refs) == 2
        assert refs[0].value == refs[1].value == "a.py"


# ─────────────────────────────────────────────────────────────────────────────
# Sensitive path blocklist
# ─────────────────────────────────────────────────────────────────────────────


class TestSensitivePath:
    """Sensitive path detection uses a module-level blocklist. Tests
    monkeypatch the blocklist to point at the tmp_path so we don't
    actually touch the user's real ``~/.ssh`` etc. (which may not
    exist on a CI runner)."""

    def test_ssh_key_blocked(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        # Point the SSH key block at a file inside our tmp dir
        fake_key = tmp_path / "id_rsa"
        fake_key.write_text("secret")
        monkeypatch.setattr(
            cr, "SENSITIVE_FILE_PATHS",
            (str(fake_key),),
        )
        reason = cr.is_sensitive(fake_key.resolve())
        assert reason is not None
        assert "credential" in reason.lower()

    def test_aws_dir_blocked(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        # Point the AWS dir block at a dir inside our tmp dir
        fake_aws = tmp_path / ".aws"
        fake_aws.mkdir()
        creds = fake_aws / "credentials"
        creds.write_text("aws_secret")
        monkeypatch.setattr(
            cr, "SENSITIVE_DIR_PATHS",
            (str(fake_aws),),
        )
        reason = cr.is_sensitive(creds.resolve())
        assert reason is not None
        assert "blocked" in reason.lower() or "aws" in reason.lower()

    def test_normal_file_not_blocked(self, tmp_path: Path):
        normal = tmp_path / "normal.txt"
        normal.write_text("hello")
        assert cr.is_sensitive(normal.resolve()) is None

    def test_ssh_dir_prefix_blocked(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        # Any file INSIDE the blocked dir should be blocked, not just a specific filename
        fake_ssh = tmp_path / ".ssh"
        fake_ssh.mkdir()
        other = fake_ssh / "random_config"
        other.write_text("stuff")
        monkeypatch.setattr(
            cr, "SENSITIVE_DIR_PATHS",
            (str(fake_ssh),),
        )
        reason = cr.is_sensitive(other.resolve())
        assert reason is not None


# ─────────────────────────────────────────────────────────────────────────────
# Path resolution
# ─────────────────────────────────────────────────────────────────────────────


class TestResolveWorkspacePath:
    def test_relative_inside_workspace(self, tmp_path: Path):
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "main.py").write_text("x")
        p = cr.resolve_workspace_path(tmp_path, "src/main.py")
        assert p == (tmp_path / "src" / "main.py").resolve()

    def test_line_range_stripped_for_resolution(self, tmp_path: Path):
        (tmp_path / "foo.py").write_text("a\nb\nc\n")
        p = cr.resolve_workspace_path(tmp_path, "foo.py:10-25")
        # Line range stripped; resolves to the file
        assert p.name == "foo.py"

    def test_absolute_path_rejected(self, tmp_path: Path):
        # On Windows, Path("/etc/passwd") is NOT is_absolute() (no drive),
        # so it falls through to the relative resolution and gets caught
        # by the "outside the allowed workspace" check. Either error
        # message is acceptable — both block the path.
        with pytest.raises(PermissionError):
            cr.resolve_workspace_path(tmp_path, "/etc/passwd")

    def test_path_traversal_rejected(self, tmp_path: Path):
        with pytest.raises(PermissionError, match="outside the allowed workspace"):
            cr.resolve_workspace_path(tmp_path, "../../etc/passwd")

    def test_empty_path_rejected(self, tmp_path: Path):
        with pytest.raises(ValueError, match="empty path"):
            cr.resolve_workspace_path(tmp_path, "")


# ─────────────────────────────────────────────────────────────────────────────
# Binary detection
# ─────────────────────────────────────────────────────────────────────────────


class TestBinaryDetection:
    def test_text_file_not_binary(self, tmp_path: Path):
        f = tmp_path / "code.py"
        f.write_text("def hello():\n    return 'world'\n", encoding="utf-8")
        assert cr._looks_like_binary(f) is False

    def test_binary_file_detected(self, tmp_path: Path):
        f = tmp_path / "blob.bin"
        f.write_bytes(b"\x00\x01\x02\x03binary content\x00")
        assert cr._looks_like_binary(f) is True

    def test_empty_file_not_binary(self, tmp_path: Path):
        f = tmp_path / "empty.txt"
        f.write_text("")
        assert cr._looks_like_binary(f) is False

    def test_json_file_not_binary(self, tmp_path: Path):
        f = tmp_path / "data.json"
        f.write_text('{"key": "value"}', encoding="utf-8")
        assert cr._looks_like_binary(f) is False


# ─────────────────────────────────────────────────────────────────────────────
# Folder tree listing
# ─────────────────────────────────────────────────────────────────────────────


class TestFolderTree:
    def test_simple_tree(self, tmp_path: Path):
        (tmp_path / "a.py").write_text("x")
        (tmp_path / "b.md").write_text("x")
        sub = tmp_path / "sub"
        sub.mkdir()
        (sub / "c.txt").write_text("x")
        listing, count = cr.read_folder_tree(tmp_path)
        assert count == 4  # 2 files + 1 dir + 1 file inside
        assert "a.py" in listing
        assert "sub/" in listing
        assert "(empty)" not in listing

    def test_truncation_at_200(self, tmp_path: Path):
        for i in range(250):
            (tmp_path / f"f{i:03d}.txt").write_text("x")
        listing, count = cr.read_folder_tree(tmp_path, max_entries=200)
        assert count == 200
        assert "truncated" in listing
        # The spec example: "Excess entries replaced with - ..."
        assert "- ..." in listing

    def test_empty_folder(self, tmp_path: Path):
        empty = tmp_path / "empty"
        empty.mkdir()
        listing, count = cr.read_folder_tree(empty)
        assert "(empty)" in listing

    def test_nonexistent_folder(self, tmp_path: Path):
        with pytest.raises(FileNotFoundError):
            cr.read_folder_tree(tmp_path / "does_not_exist")


# ─────────────────────────────────────────────────────────────────────────────
# Git operations
# ─────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def git_workspace(tmp_path: Path) -> Path:
    """A tmp dir with a git repo containing 2 commits and 1 unstaged change."""
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=repo, check=True)
    (repo / "a.txt").write_text("first\n")
    subprocess.run(["git", "add", "a.txt"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "first"], cwd=repo, check=True)
    (repo / "a.txt").write_text("first\nsecond\n")  # unstaged change
    (repo / "b.txt").write_text("staged content\n")
    subprocess.run(["git", "add", "b.txt"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "second"], cwd=repo, check=True)
    # Now we have: 2 commits, a.txt modified (unstaged), nothing staged
    (repo / "b.txt").write_text("staged content\nmore\n")
    subprocess.run(["git", "add", "b.txt"], cwd=repo, check=True)  # now staged
    return repo


class TestGitOperations:
    def test_diff_shows_unstaged(self, git_workspace: Path):
        out = cr.git_diff(git_workspace)
        assert "second" in out  # a.txt change appears in unstaged diff

    def test_staged_shows_staged(self, git_workspace: Path):
        out = cr.git_staged(git_workspace)
        assert "more" in out  # b.txt staged change

    def test_log_n_includes_patches(self, git_workspace: Path):
        out = cr.git_log_n(git_workspace, 2)
        assert "first" in out or "second" in out  # commit messages
        assert "diff" in out.lower() or "@@" in out  # patch markers

    def test_log_n_clamps_to_10(self, git_workspace: Path):
        # Asking for 999 should not error; clamps to 10
        out = cr.git_log_n(git_workspace, 999)
        assert isinstance(out, str)
        # We only have 2 commits so we shouldn't see 10 commits worth
        assert "first" in out
        assert "second" in out

    def test_log_n_min_1(self, git_workspace: Path):
        out = cr.git_log_n(git_workspace, 0)
        assert isinstance(out, str)
        assert "second" in out  # the latest commit

    def test_diff_outside_git_repo(self, tmp_path: Path):
        # No .git directory → git command fails
        out = cr.git_diff(tmp_path)
        assert "BLOCKED" in out or "failed" in out.lower()


# ─────────────────────────────────────────────────────────────────────────────
# Line-range parsing for files
# ─────────────────────────────────────────────────────────────────────────────


class TestLooksLikeLineRange:
    def test_single_line(self):
        assert cr._looks_like_line_range("foo.py:42") is True

    def test_range(self):
        assert cr._looks_like_line_range("foo.py:10-25") is True

    def test_no_line_range(self):
        assert cr._looks_like_line_range("foo.py") is False
        assert cr._looks_like_line_range("path/to/dir") is False
        assert cr._looks_like_line_range("foo.py:") is False


# ─────────────────────────────────────────────────────────────────────────────
# URL fetcher
# ─────────────────────────────────────────────────────────────────────────────


class TestStripHtml:
    def test_strips_tags(self):
        out = cr._strip_html("<p>Hello <b>world</b></p>")
        assert out == "Hello world"

    def test_strips_script_blocks(self):
        out = cr._strip_html("<p>visible</p><script>alert(1)</script>")
        assert "visible" in out
        assert "alert" not in out

    def test_strips_style_blocks(self):
        out = cr._strip_html("<p>visible</p><style>.x{}</style>")
        assert "visible" in out
        assert ".x{}" not in out

    def test_decodes_common_entities(self):
        out = cr._strip_html("<p>AT&amp;T &nbsp; &lt;3</p>")
        assert "AT&T" in out
        assert "<3" in out

    def test_collapses_whitespace(self):
        out = cr._strip_html("<p>line\n\n   one</p><p>two</p>")
        assert "  " not in out
        assert "line one two" in out


class TestFetchUrl:
    """URL fetch uses httpx; we hit a tiny local http.server to avoid
    depending on the network. If the test environment can't bind a
    socket, the tests are skipped (not failed) so CI on locked-down
    runners doesn't break."""

    @pytest.fixture
    def http_server(self):
        import http.server
        import socketserver
        import threading

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/hello":
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html")
                    self.end_headers()
                    self.wfile.write(b"<html><body><h1>Hi</h1><p>there</p></body></html>")
                elif self.path == "/forbidden":
                    self.send_response(403)
                    self.end_headers()
                elif self.path == "/big":
                    self.send_response(200)
                    self.send_header("Content-Type", "text/plain")
                    self.end_headers()
                    self.wfile.write(b"x" * 100_000)
                else:
                    self.send_response(404)
                    self.end_headers()

            def log_message(self, format, *args):  # silence stderr
                pass

        try:
            server = socketserver.TCPServer(("127.0.0.1", 0), Handler)
        except OSError:
            pytest.skip("can't bind local socket for URL test")
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        yield f"127.0.0.1:{port}"
        server.shutdown()

    def test_blocks_non_http_scheme(self):
        out = cr.fetch_url("file:///etc/passwd")
        assert "BLOCKED" in out
        assert "scheme" in out.lower()

    def test_blocks_ftp_scheme(self):
        out = cr.fetch_url("ftp://example.com/foo")
        assert "BLOCKED" in out

    def test_fetches_html_and_strips(self, http_server: str):
        out = cr.fetch_url(f"http://{http_server}/hello")
        assert "Hi" in out
        assert "there" in out
        # Tags should be gone
        assert "<h1>" not in out
        assert "<p>" not in out

    def test_handles_http_error(self, http_server: str):
        out = cr.fetch_url(f"http://{http_server}/forbidden")
        assert "BLOCKED" in out
        assert "403" in out

    def test_truncates_large_response(self, http_server: str):
        out = cr.fetch_url(f"http://{http_server}/big", max_bytes=1000)
        assert "truncated" in out
        # Should have cut the content but still contain some 'x's
        assert "x" in out

    def test_handles_404(self, http_server: str):
        out = cr.fetch_url(f"http://{http_server}/missing")
        assert "BLOCKED" in out
        assert "404" in out
