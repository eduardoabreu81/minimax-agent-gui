"""
Unit tests for skill CRUD helpers (write_skill / update_skill / delete_skill /
read_skill_raw) on the user data dir.

Kimi schema is enforced server-side: invalid name or description raises
SkillValidationError (HTTP 400 in the API layer).
"""

import tempfile
from pathlib import Path

import pytest

from mini_agent.tools.skill_loader import (
    SkillValidationError,
    delete_skill,
    read_skill_raw,
    update_skill,
    write_skill,
)


def test_write_skill_creates_directory_and_file():
    with tempfile.TemporaryDirectory() as user_dir:
        skill = write_skill(
            Path(user_dir),
            name="my-skill",
            description="My first skill",
            body="# My Skill\n\nBody content.",
            license="MIT",
            allowed_tools=["read_file"],
        )
        assert skill.skill_path.exists()
        assert skill.skill_path.parent.name == "my-skill"
        assert skill.source.value == "user"


def test_write_skill_writes_valid_frontmatter():
    with tempfile.TemporaryDirectory() as user_dir:
        skill = write_skill(
            Path(user_dir),
            name="yaml-test",
            description="Verifying YAML shape",
            body="Body.",
            license="Apache-2.0",
            allowed_tools=["bash", "read_file"],
            metadata={"version": "1.0.0"},
        )
        text = skill.skill_path.read_text(encoding="utf-8")
        assert text.startswith("---\n")
        assert "name: yaml-test" in text
        assert "description: Verifying YAML shape" in text
        assert "license: Apache-2.0" in text
        assert "allowed-tools:" in text
        assert "metadata:" in text


def test_write_skill_rejects_invalid_name():
    with tempfile.TemporaryDirectory() as user_dir:
        with pytest.raises(SkillValidationError) as exc:
            write_skill(Path(user_dir), name="Invalid Name!", description="x", body="x")
        assert "lowercase letters/digits/hyphens" in str(exc.value)


def test_write_skill_rejects_oversized_description():
    with tempfile.TemporaryDirectory() as user_dir:
        with pytest.raises(SkillValidationError) as exc:
            write_skill(Path(user_dir), name="valid", description="x" * 1025, body="x")
        assert "1024" in str(exc.value)


def test_write_skill_rejects_empty_description():
    with tempfile.TemporaryDirectory() as user_dir:
        with pytest.raises(SkillValidationError):
            write_skill(Path(user_dir), name="valid", description="", body="x")


def test_write_skill_rejects_duplicate_name():
    with tempfile.TemporaryDirectory() as user_dir:
        write_skill(Path(user_dir), name="dup", description="first", body="x")
        with pytest.raises(SkillValidationError) as exc:
            write_skill(Path(user_dir), name="dup", description="second", body="y")
        assert "already exists" in str(exc.value)


def test_write_skill_rejects_oversized_compatibility():
    with tempfile.TemporaryDirectory() as user_dir:
        with pytest.raises(SkillValidationError):
            write_skill(
                Path(user_dir),
                name="c",
                description="d",
                body="x",
                compatibility="a" * 501,
            )


def test_read_skill_raw_roundtrip():
    with tempfile.TemporaryDirectory() as user_dir:
        write_skill(
            Path(user_dir),
            name="rt",
            description="Roundtrip",
            body="Body content here.",
            license="MIT",
        )
        raw = read_skill_raw(Path(user_dir), "rt")
        assert raw is not None
        fm, body, path = raw
        assert fm["name"] == "rt"
        assert fm["description"] == "Roundtrip"
        assert fm["license"] == "MIT"
        assert "Body content" in body
        assert path.exists()


def test_read_skill_raw_returns_none_for_missing():
    with tempfile.TemporaryDirectory() as user_dir:
        assert read_skill_raw(Path(user_dir), "nope") is None


def test_update_skill_changes_body_and_description():
    with tempfile.TemporaryDirectory() as user_dir:
        write_skill(Path(user_dir), name="u", description="Original", body="Old body")
        updated = update_skill(
            Path(user_dir),
            name="u",
            description="Updated",
            body="# New body\n",
        )
        assert updated.description == "Updated"
        assert updated.content.startswith("# New body")

        # Verify on disk
        raw = read_skill_raw(Path(user_dir), "u")
        assert raw[0]["description"] == "Updated"
        assert "New body" in raw[1]


def test_update_skill_preserves_unspecified_fields():
    with tempfile.TemporaryDirectory() as user_dir:
        write_skill(
            Path(user_dir),
            name="u",
            description="D",
            body="B",
            license="MIT",
            allowed_tools=["read_file"],
        )
        # Update only body
        updated = update_skill(Path(user_dir), name="u", body="new body")
        assert updated.license == "MIT"
        assert updated.allowed_tools == ["read_file"]
        assert updated.description == "D"


def test_update_skill_can_clear_license_with_empty_string():
    with tempfile.TemporaryDirectory() as user_dir:
        write_skill(Path(user_dir), name="u", description="D", body="B", license="MIT")
        updated = update_skill(Path(user_dir), name="u", license="")
        assert updated.license is None


def test_update_skill_rejects_missing_skill():
    with tempfile.TemporaryDirectory() as user_dir:
        with pytest.raises(SkillValidationError):
            update_skill(Path(user_dir), name="nope", description="d")


def test_update_skill_rejects_dropping_description():
    with tempfile.TemporaryDirectory() as user_dir:
        write_skill(Path(user_dir), name="u", description="D", body="B")
        # Force-clear description by passing empty string
        with pytest.raises(SkillValidationError):
            update_skill(Path(user_dir), name="u", description="")


def test_delete_skill_removes_directory():
    with tempfile.TemporaryDirectory() as user_dir:
        write_skill(Path(user_dir), name="del", description="D", body="B")
        skill_dir = Path(user_dir) / "del"
        assert skill_dir.exists()
        ok = delete_skill(Path(user_dir), "del")
        assert ok
        assert not skill_dir.exists()


def test_delete_skill_returns_false_for_missing():
    with tempfile.TemporaryDirectory() as user_dir:
        assert delete_skill(Path(user_dir), "nope") is False


def test_delete_skill_rejects_invalid_name():
    with tempfile.TemporaryDirectory() as user_dir:
        with pytest.raises(SkillValidationError):
            delete_skill(Path(user_dir), "INVALID NAME")


def test_full_lifecycle():
    """create → read → update → delete → read (gone)"""
    with tempfile.TemporaryDirectory() as user_dir:
        # 1. create
        write_skill(Path(user_dir), name="life", description="v1", body="first")

        # 2. read
        raw = read_skill_raw(Path(user_dir), "life")
        assert raw is not None
        assert raw[0]["description"] == "v1"

        # 3. update
        update_skill(Path(user_dir), name="life", description="v2", body="second")

        # 4. read again
        raw = read_skill_raw(Path(user_dir), "life")
        assert raw[0]["description"] == "v2"
        assert "second" in raw[1]

        # 5. delete
        assert delete_skill(Path(user_dir), "life")

        # 6. gone
        assert read_skill_raw(Path(user_dir), "life") is None
