// Vitest for the context-refs frontend pieces.
//
// Covers the JS parser (mirror of the Python regex), the autocomplete
// helper, and the chips component (status surface). The hook itself
// (useContextRefs) is harder to unit-test cleanly because of the
// debounced network calls; we cover that via the integration test
// of the Composer wiring in batch 7.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseRefs, partialRefAt } from "./parseRefs.js";
import { ContextRefChips } from "./ContextRefChips.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// parseRefs
// ─────────────────────────────────────────────────────────────────────────────

describe("parseRefs", () => {
  it("parses @file: ref", () => {
    const refs = parseRefs("Review @file:src/main.py please");
    expect(refs).toHaveLength(1);
    expect(refs[0].type).toBe("file");
    expect(refs[0].value).toBe("src/main.py");
    expect(refs[0].raw).toBe("@file:src/main.py");
  });

  it("parses @file: with line range", () => {
    const refs = parseRefs("Look at @file:foo.py:10-25");
    expect(refs[0].value).toBe("foo.py:10-25");
    // Line range colons preserved
    expect(refs[0].raw).toBe("@file:foo.py:10-25");
  });

  it("parses @file: with single line", () => {
    const refs = parseRefs("Line 42 → @file:foo.py:42");
    expect(refs[0].value).toBe("foo.py:42");
  });

  it("parses @folder: ref", () => {
    const refs = parseRefs("What's in @folder:src/components?");
    expect(refs[0].type).toBe("folder");
    expect(refs[0].value).toBe("src/components");
  });

  it("parses @diff (no colon)", () => {
    const refs = parseRefs("What changed? @diff");
    expect(refs[0].type).toBe("diff");
    expect(refs[0].value).toBe("");
    expect(refs[0].raw).toBe("@diff");
  });

  it("parses @staged (no colon)", () => {
    const refs = parseRefs("Show staged: @staged");
    expect(refs[0].type).toBe("staged");
    expect(refs[0].raw).toBe("@staged");
  });

  it("parses @git:N", () => {
    const refs = parseRefs("Recent: @git:5");
    expect(refs[0].type).toBe("git");
    expect(refs[0].value).toBe("5");
  });

  it("parses @url: ref", () => {
    const refs = parseRefs("Read this @url:https://example.com/foo");
    expect(refs[0].type).toBe("url");
    expect(refs[0].value).toBe("https://example.com/foo");
  });

  it("strips trailing punctuation", () => {
    const refs = parseRefs("Check @file:main.py, and @file:test.py.");
    expect(refs[0].value).toBe("main.py");
    expect(refs[1].value).toBe("test.py");
  });

  it("preserves line-range colons when stripping punctuation", () => {
    // The colon before "10-25" must NOT be stripped even though
    // it's a "trailing" colon from a punctuation view.
    const refs = parseRefs("Range: @file:foo.py:10-25,");
    expect(refs[0].value).toBe("foo.py:10-25");
  });

  it("parses multiple refs in one message", () => {
    const refs = parseRefs("Review @diff and @file:src/main.py");
    expect(refs.map((r) => r.type)).toEqual(["diff", "file"]);
    expect(refs[0].start).toBeLessThan(refs[1].start);
  });

  it("returns empty array for no refs", () => {
    expect(parseRefs("just a message")).toEqual([]);
    expect(parseRefs("")).toEqual([]);
    // Bare @ with no colon
    expect(parseRefs("ping @ someone")).toEqual([]);
    // Unknown type
    expect(parseRefs("@unknown:foo")).toEqual([]);
  });

  it("preserves duplicate refs", () => {
    const refs = parseRefs("@file:a.py and again @file:a.py");
    expect(refs).toHaveLength(2);
  });

  it("is case-insensitive on the type", () => {
    const refs = parseRefs("@File:foo.py");
    expect(refs[0].type).toBe("file");
  });

  it("captures correct start/end offsets", () => {
    const text = "Hi @file:foo.py bye";
    const refs = parseRefs(text);
    expect(text.slice(refs[0].start, refs[0].end)).toBe("@file:foo.py");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// partialRefAt
// ─────────────────────────────────────────────────────────────────────────────

describe("partialRefAt", () => {
  it("returns null when there's no @", () => {
    expect(partialRefAt("hello world", 5)).toBeNull();
  });

  it("returns the partial when cursor is right after @", () => {
    // "Hello @" is 7 chars; cursor 7 is just past the @ (position 6).
    // text.slice(0, 7) = "Hello @" which contains the @.
    const p = partialRefAt("Hello @", 7);
    expect(p).not.toBeNull();
    expect(p.value).toBe("");
    expect(p.start).toBe(6);
  });

  it("captures a partial type (e.g. @fo)", () => {
    const p = partialRefAt("@fo", 3);
    expect(p).not.toBeNull();
    expect(p.type).toBeUndefined(); // no colon yet
    expect(p.value).toBe("fo");
  });

  it("captures a full type with value (e.g. @file:src/mai)", () => {
    const p = partialRefAt("@file:src/mai", 13);
    expect(p).not.toBeNull();
    expect(p.type).toBe("file");
    expect(p.value).toBe("src/mai");
  });

  it("returns null if there's whitespace in the partial", () => {
    // The @ is far back; the partial contains " "
    expect(partialRefAt("Hello @file:foo bar", 17)).toBeNull();
  });

  it("handles cursor in middle of text", () => {
    const text = "Review @file:src/main.py please";
    // Cursor right after "main." (before "py")
    const p = partialRefAt(text, text.indexOf("@file:src/main.") + "@file:src/main.".length);
    expect(p).not.toBeNull();
    expect(p.type).toBe("file");
    expect(p.value).toBe("src/main.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ContextRefChips
// ─────────────────────────────────────────────────────────────────────────────

describe("ContextRefChips", () => {
  it("renders nothing when parsed is empty", () => {
    const { container } = render(
      <ContextRefChips parsed={[]} report={null} isExpanding={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one chip per parsed ref", () => {
    const parsed = [
      { raw: "@file:a.py", type: "file", value: "a.py", start: 0, end: 10 },
      { raw: "@diff", type: "diff", value: "", start: 11, end: 16 },
    ];
    render(<ContextRefChips parsed={parsed} report={null} isExpanding={false} />);
    expect(screen.getByTestId("ref-chip-file")).toBeInTheDocument();
    expect(screen.getByTestId("ref-chip-diff")).toBeInTheDocument();
  });

  it("shows error state when result has error", () => {
    const parsed = [{ raw: "@file:secret", type: "file", value: "secret", start: 0, end: 12 }];
    const report = {
      results: [
        {
          ref: parsed[0],
          content: "",
          warning: "",
          error: "sensitive path",
          size_bytes: 0,
        },
      ],
      total_bytes: 0,
      soft_warning: "",
      refused: false,
      refusal_reason: "",
      parsed_refs: parsed,
    };
    const { container } = render(
      <ContextRefChips parsed={parsed} report={report} isExpanding={false} />
    );
    const chip = container.querySelector('[data-testid="ref-chip-file"]');
    expect(chip).toBeInTheDocument();
    expect(chip?.getAttribute("title")).toContain("sensitive path");
    // Should have red error class
    expect(chip?.className).toMatch(/red/);
  });

  it("shows ok state when result has content", () => {
    const parsed = [{ raw: "@file:a.py", type: "file", value: "a.py", start: 0, end: 10 }];
    const report = {
      results: [
        {
          ref: parsed[0],
          content: "print('hi')",
          warning: "",
          error: "",
          size_bytes: 11,
        },
      ],
      total_bytes: 11,
      soft_warning: "",
      refused: false,
      refusal_reason: "",
      parsed_refs: parsed,
    };
    const { container } = render(
      <ContextRefChips parsed={parsed} report={report} isExpanding={false} />
    );
    const chip = container.querySelector('[data-testid="ref-chip-file"]');
    expect(chip?.getAttribute("title")).toContain("11 bytes");
    // Should have green success class
    expect(chip?.className).toMatch(/emerald/);
  });

  it("shows soft warning footer when set", () => {
    const parsed = [{ raw: "@file:a.py", type: "file", value: "a.py", start: 0, end: 10 }];
    const report = {
      results: [],
      total_bytes: 5000,
      soft_warning: "expanded content is 5,000 bytes (>= 25% of context)",
      refused: false,
      refusal_reason: "",
      parsed_refs: parsed,
    };
    render(<ContextRefChips parsed={parsed} report={report} isExpanding={false} />);
    expect(screen.getByTestId("soft-limit-warning")).toBeInTheDocument();
    expect(screen.getByText(/5,000 bytes/)).toBeInTheDocument();
  });

  it("shows the expanding spinner when isExpanding is true", () => {
    const parsed = [{ raw: "@file:a.py", type: "file", value: "a.py", start: 0, end: 10 }];
    render(<ContextRefChips parsed={parsed} report={null} isExpanding={true} />);
    expect(screen.getByText(/expanding/)).toBeInTheDocument();
  });
});
