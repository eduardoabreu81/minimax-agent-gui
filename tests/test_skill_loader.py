"""
Unit tests for the multi-source SkillLoader (Kimi / agentskills.io spec).

Covers:
  - Canonical `<name>/SKILL.md` layout
  - Flat `<name>.md` layout (Kimi single-file)
  - Frontmatter parsing (YAML required for `name` and `description` fields)
  - Description fallback chain (frontmatter → body line 1 → skip)
  - Schema validation (Kimi: name regex, description length, compatibility length)
  - Progressive Disclosure Level 1 (metadata prompt, grouped by scope)
  - Path rewriting (Level 3+: scripts/, references/, assets/, markdown links)
  - to_prompt includes Skill Root Directory
  - Backward-compatible single-dir constructor
"""

import tempfile
from pathlib import Path

import pytest

from mini_agent.tools.skill_loader import (
    Skill,
    SkillLoader,
    SkillSource,
    _validate_description,
    _validate_name,
)


# ── Schema validation helpers ────────────────────────────────────────────


def test_validate_name_accepts_lowercase_with_hyphens():
    assert _validate_name("my-skill") == "my-skill"
    assert _validate_name("skill123") == "skill123"
    assert _validate_name("a") == "a"
    assert _validate_name("a-b-c-123") == "a-b-c-123"


def test_validate_name_rejects_uppercase():
    with pytest.raises(ValueError):
        _validate_name("My-Skill")


def test_validate_name_rejects_underscore():
    with pytest.raises(ValueError):
        _validate_name("my_skill")


def test_validate_name_rejects_too_long():
    with pytest.raises(ValueError):
        _validate_name("a" * 65)


def test_validate_name_rejects_starts_with_hyphen():
    with pytest.raises(ValueError):
        _validate_name("-skill")


def test_validate_description_enforces_length():
    assert _validate_description("hello") == "hello"
    assert _validate_description("a" * 1024) == "a" * 1024
    with pytest.raises(ValueError):
        _validate_description("a" * 1025)
    with pytest.raises(ValueError):
        _validate_description("")
    with pytest.raises(ValueError):
        _validate_description("   ")


# ── Skill dataclass ──────────────────────────────────────────────────────


def test_skill_to_dict_includes_source_metadata():
    s = Skill(
        name="x",
        description="y",
        content="z",
        license="MIT",
        source=SkillSource.USER,
        skill_path=Path("/tmp/x/SKILL.md"),
    )
    d = s.to_dict()
    assert d["source"] == "user"
    assert d["source_label"] == "User"
    assert d["read_only"] is False
    assert d["license"] == "MIT"
    assert d["skill_path"].endswith("SKILL.md")


def test_skill_source_read_only():
    assert SkillSource.USER.read_only is False
    assert SkillSource.BUILTIN.read_only is True
    assert SkillSource.EXTERNAL_CLAUDE.read_only is True


def test_skill_source_priority_user_wins():
    """User > Extra > Generic > Claude > Codex > Gemini > Built-in.

    Priority is encoded so smaller numbers win on name collision. We assert
    the ordering by sorting the priority table and checking it matches our
    intent (USER smallest, BUILTIN largest).
    """
    expected_order = [
        SkillSource.USER,             # 0 — highest priority
        SkillSource.EXTRA,            # 1
        SkillSource.EXTERNAL_GENERIC, # 2
        SkillSource.EXTERNAL_CLAUDE,  # 3
        SkillSource.EXTERNAL_CODEX,   # 4
        SkillSource.EXTERNAL_GEMINI,  # 5
        SkillSource.BUILTIN,          # 6 — lowest priority
    ]
    priorities = [s.priority for s in expected_order]
    # Strictly increasing = USER wins, BUILTIN loses.
    assert priorities == sorted(priorities), (
        f"expected ascending priority order, got {priorities}"
    )
    # Also confirm the extremes.
    assert SkillSource.USER.priority < SkillSource.BUILTIN.priority


# ── Single-dir constructor (backward compat) ────────────────────────────


def test_backward_compat_single_dir_constructor():
    with tempfile.TemporaryDirectory() as tmp:
        loader = SkillLoader(tmp)  # legacy form
        assert len(loader.sources) == 1
        assert loader.sources[0][1] == SkillSource.BUILTIN


# ── Canonical layout ─────────────────────────────────────────────────────


def test_load_canonical_skill_with_full_frontmatter():
    with tempfile.TemporaryDirectory() as tmp:
        skill_dir = Path(tmp) / "test-skill"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text(
            "---\n"
            "name: test-skill\n"
            "description: A test skill\n"
            "license: MIT\n"
            "allowed-tools:\n"
            "  - read_file\n"
            "  - write_file\n"
            "metadata:\n"
            "  author: Test Author\n"
            "  version: \"1.0\"\n"
            "---\n\n"
            "Skill content here.\n",
            encoding="utf-8",
        )
        loader = SkillLoader(tmp)
        skill = loader.load_skill(skill_dir / "SKILL.md")
        assert skill is not None
        assert skill.name == "test-skill"
        assert skill.description == "A test skill"
        assert skill.license == "MIT"
        assert skill.allowed_tools == ["read_file", "write_file"]
        assert skill.metadata["author"] == "Test Author"
        assert skill.metadata["version"] == "1.0"


def test_load_skill_with_only_body_no_frontmatter_uses_fallback():
    """No frontmatter → name from dir, description from body line 1."""
    with tempfile.TemporaryDirectory() as tmp:
        skill_dir = Path(tmp) / "my-tool"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text(
            "This is a tool I built for testing.\n\nMore body.\n",
            encoding="utf-8",
        )
        loader = SkillLoader(tmp)
        skill = loader.load_skill(skill_dir / "SKILL.md")
        assert skill is not None
        assert skill.name == "my-tool"
        assert skill.description.startswith("This is a tool")


def test_load_skill_with_empty_body_is_skipped():
    """No frontmatter + empty body → no description → skip."""
    with tempfile.TemporaryDirectory() as tmp:
        skill_dir = Path(tmp) / "broken"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text("", encoding="utf-8")
        loader = SkillLoader(tmp)
        skill = loader.load_skill(skill_dir / "SKILL.md")
        assert skill is None
        assert any("description" in e for e in loader.last_scan_errors)


def test_load_skill_with_invalid_name_is_skipped():
    with tempfile.TemporaryDirectory() as tmp:
        skill_dir = Path(tmp) / "broken_name"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text(
            "---\nname: broken_name\ndescription: test\n---\nbody\n",
            encoding="utf-8",
        )
        loader = SkillLoader(tmp)
        skill = loader.load_skill(skill_dir / "SKILL.md")
        assert skill is None
        assert any("lowercase" in e or "letters/digits/hyphens" in e for e in loader.last_scan_errors)


# ── Flat layout ──────────────────────────────────────────────────────────


def test_flat_layout_uses_filename_as_name():
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "deploy.md").write_text(
            "---\ndescription: How we deploy\n---\n\nRun `npm run deploy`.\n",
            encoding="utf-8",
        )
        loader = SkillLoader(tmp)
        loader.discover_skills()
        skill = loader.get_skill("deploy")
        assert skill is not None
        assert skill.description == "How we deploy"
        assert "npm run deploy" in skill.content


def test_flat_layout_with_subdir_shadowing_subdir_wins():
    """`<root>/foo/SKILL.md` shadows `<root>/foo.md`."""
    with tempfile.TemporaryDirectory() as tmp:
        # flat
        (Path(tmp) / "foo.md").write_text("flat\n", encoding="utf-8")
        # subdir
        foo_dir = Path(tmp) / "foo"
        foo_dir.mkdir()
        (foo_dir / "SKILL.md").write_text(
            "---\nname: foo\ndescription: subdir version\n---\nbody\n",
            encoding="utf-8",
        )
        loader = SkillLoader(tmp)
        loader.discover_skills()
        skill = loader.get_skill("foo")
        assert skill is not None
        assert skill.description == "subdir version"
        assert any("shadowed" in e for e in loader.last_scan_errors)


# ── Discover & lookup ────────────────────────────────────────────────────


def test_discover_skills_recursive():
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(3):
            d = Path(tmp) / f"skill-{i}"
            d.mkdir()
            (d / "SKILL.md").write_text(
                f"---\nname: skill-{i}\ndescription: Test {i}\n---\n\nContent {i}\n",
                encoding="utf-8",
            )
        loader = SkillLoader(tmp)
        skills = loader.discover_skills()
        assert len(skills) == 3
        assert sorted(loader.list_skills()) == ["skill-0", "skill-1", "skill-2"]


def test_get_skill_returns_none_for_unknown():
    with tempfile.TemporaryDirectory() as tmp:
        loader = SkillLoader(tmp)
        loader.discover_skills()
        assert loader.get_skill("nope") is None


# ── Metadata prompt (Progressive Disclosure Level 1) ─────────────────────


def test_metadata_prompt_lists_names_and_descriptions():
    with tempfile.TemporaryDirectory() as tmp:
        for name in ("pdf", "docx", "canvas-design"):
            d = Path(tmp) / name
            d.mkdir()
            (d / "SKILL.md").write_text(
                f"---\nname: {name}\ndescription: {name} description\n---\n\nbody\n",
                encoding="utf-8",
            )
        loader = SkillLoader(tmp)
        loader.discover_skills()
        prompt = loader.get_skills_metadata_prompt()
        assert "pdf" in prompt
        assert "docx" in prompt
        assert "canvas-design" in prompt
        assert "Available Skills" in prompt
        # No full body in metadata prompt
        assert "Detailed Skill Content" not in prompt


# ── Path rewriting (Progressive Disclosure Level 3+) ────────────────────


def test_nested_document_path_processing():
    with tempfile.TemporaryDirectory() as tmp:
        skill_dir = Path(tmp) / "test-skill"
        skill_dir.mkdir()
        (skill_dir / "reference.md").write_text("Reference content", encoding="utf-8")
        (skill_dir / "forms.md").write_text("Forms content", encoding="utf-8")
        (skill_dir / "SKILL.md").write_text(
            "---\nname: test-skill\ndescription: Test with nested docs\n---\n\n"
            "For advanced features, see reference.md.\n"
            "If you need forms, read forms.md and follow instructions.\n",
            encoding="utf-8",
        )
        loader = SkillLoader(tmp)
        skill = loader.load_skill(skill_dir / "SKILL.md")
        assert skill is not None
        assert str(skill_dir / "reference.md") in skill.content
        assert str(skill_dir / "forms.md") in skill.content
        assert "use read_file" in skill.content.lower()


def test_script_path_processing():
    with tempfile.TemporaryDirectory() as tmp:
        skill_dir = Path(tmp) / "test-skill"
        skill_dir.mkdir()
        (skill_dir / "scripts").mkdir()
        (skill_dir / "scripts" / "test_script.py").write_text("# script", encoding="utf-8")
        (skill_dir / "SKILL.md").write_text(
            "---\nname: test-skill\ndescription: Test with scripts\n---\n\n"
            "Run: python scripts/test_script.py\n",
            encoding="utf-8",
        )
        loader = SkillLoader(tmp)
        skill = loader.load_skill(skill_dir / "SKILL.md")
        assert skill is not None
        assert str(skill_dir / "scripts" / "test_script.py") in skill.content


def test_skill_to_prompt_includes_root_directory():
    with tempfile.TemporaryDirectory() as tmp:
        skill_dir = Path(tmp) / "test-skill"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text(
            "---\nname: test-skill\ndescription: A test skill\n---\n\nbody\n",
            encoding="utf-8",
        )
        loader = SkillLoader(tmp)
        skill = loader.load_skill(skill_dir / "SKILL.md")
        assert skill is not None
        prompt = skill.to_prompt()
        assert "Skill Root Directory" in prompt
        assert str(skill_dir) in prompt


# ── Multi-source priority & dedupe ───────────────────────────────────────


def test_multi_source_priority_user_overrides_builtin():
    with tempfile.TemporaryDirectory() as builtin_tmp:
        # Built-in skill "docx"
        builtin_dir = Path(builtin_tmp) / "docx"
        builtin_dir.mkdir()
        (builtin_dir / "SKILL.md").write_text(
            "---\nname: docx\ndescription: BUILTIN version\n---\nbody\n",
            encoding="utf-8",
        )
        with tempfile.TemporaryDirectory() as user_tmp:
            # User skill "docx" shadows it
            user_dir = Path(user_tmp) / "docx"
            user_dir.mkdir()
            (user_dir / "SKILL.md").write_text(
                "---\nname: docx\ndescription: USER version\n---\nbody\n",
                encoding="utf-8",
            )
            loader = SkillLoader(sources=[
                (Path(user_tmp), SkillSource.USER),
                (Path(builtin_tmp), SkillSource.BUILTIN),
            ])
            loader.discover_skills()
            skill = loader.get_skill("docx")
            assert skill is not None
            assert skill.source == SkillSource.USER
            assert "USER version" in skill.description


def test_missing_source_dir_is_silently_skipped():
    """Kimi behavior: paths that don't exist are silently skipped."""
    loader = SkillLoader(sources=[
        (Path("/nonexistent/path/that/should/not/exist"), SkillSource.USER),
        (Path("/another/missing/path"), SkillSource.EXTRA),
    ])
    skills = loader.discover_skills()
    assert skills == []
    assert loader.last_scan_errors == []


def test_grouped_by_source_groups_correctly():
    with tempfile.TemporaryDirectory() as t1, tempfile.TemporaryDirectory() as t2:
        # t1 = builtin (2 skills)
        for name in ("a", "b"):
            d = Path(t1) / name
            d.mkdir()
            (d / "SKILL.md").write_text(
                f"---\nname: {name}\ndescription: {name}\n---\nbody\n",
                encoding="utf-8",
            )
        # t2 = user (1 skill)
        d = Path(t2) / "c"
        d.mkdir()
        (d / "SKILL.md").write_text(
            "---\nname: c\ndescription: c\n---\nbody\n",
            encoding="utf-8",
        )
        loader = SkillLoader(sources=[
            (Path(t2), SkillSource.USER),
            (Path(t1), SkillSource.BUILTIN),
        ])
        loader.discover_skills()
        grouped = loader.get_skills_grouped_by_source()
        assert sorted(grouped["user"][0].name for _ in [0]) == ["c"]
        assert sorted(s.name for s in grouped["builtin"]) == ["a", "b"]


def test_metadata_prompt_groups_by_scope_and_omits_empty():
    with tempfile.TemporaryDirectory() as t1, tempfile.TemporaryDirectory() as t2:
        d = Path(t1) / "ub"
        d.mkdir()
        (d / "SKILL.md").write_text(
            "---\nname: ub\ndescription: User-built\n---\nbody\n",
            encoding="utf-8",
        )
        d = Path(t2) / "bi"
        d.mkdir()
        (d / "SKILL.md").write_text(
            "---\nname: bi\ndescription: Built-in\n---\nbody\n",
            encoding="utf-8",
        )
        loader = SkillLoader(sources=[
            (Path(t1), SkillSource.USER),
            (Path(t2), SkillSource.BUILTIN),
        ])
        loader.discover_skills()
        prompt = loader.get_skills_metadata_prompt()
        assert "### User skills" in prompt
        assert "### Built-in skills" in prompt
        # No External / Extra / Generic groups (empty)
        assert "### External" not in prompt
        assert "### Extra skills" not in prompt
