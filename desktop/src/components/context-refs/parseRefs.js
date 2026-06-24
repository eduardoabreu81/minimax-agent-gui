// parseRefs — JS port of the Python regex in web/backend/context_refs.py.
// See docs/roadmap/v0.5-hermes-context-features.md for the spec.
//
// Recognizes 6 syntaxes:
//   @file:path/to/file.py            inject file contents
//   @file:path/to/file.py:10-25      inject specific line range (1-indexed)
//   @folder:path/to/dir              inject directory tree listing
//   @diff                            inject ``git diff``
//   @staged                          inject ``git diff --staged``
//   @git:N                           inject last N commits (1-10)
//   @url:https://example.com         fetch and inject web page content
//
// Trailing punctuation (.,;!?)\"') is stripped from the value
// EXCEPT when the type is "file" and the value has a line-range
// suffix (e.g. "@file:foo.py:10-25" — the colon before the range
// must NOT be stripped).
//
// Duplicate refs are preserved (the user might want to reference
// the same file twice in one message).

const REF_REGEX = /@(file|folder|git|url):([^\s@]*)|@(diff|staged)\b/gi;

// Characters that are safe to strip from the END of a ref value
// without changing its meaning. The opening parenthesis is allowed
// because "@file:main.py)" should drop the trailing ")" but keep
// "@file:(...)" if the path itself starts with "(".
const TRAILING_PUNCT = new Set([",", ".", ";", ":", "!", "?", ")", "\"", "'"]);

function looksLikeLineRange(value) {
  // Matches "path:N" or "path:N-M" — line range syntax for @file:
  return /^[^\s@]+:\d+(-\d+)?$/.test(value);
}

/**
 * Find all @-references in the given text.
 * @param {string} text
 * @returns {Array<{raw: string, type: string, value: string, start: number, end: number}>}
 */
export function parseRefs(text) {
  if (!text) return [];
  const out = [];
  // Reset lastIndex to be safe — global regexes are stateful.
  REF_REGEX.lastIndex = 0;
  let m;
  while ((m = REF_REGEX.exec(text)) !== null) {
    let type;
    let value;
    if (m[1] !== undefined) {
      // Colon form: @type:value
      type = m[1].toLowerCase();
      value = m[2] || "";
    } else {
      // Bare form: @diff or @staged
      type = (m[3] || "").toLowerCase();
      value = "";
    }

    // Strip trailing punctuation from value, but preserve line-range colons
    let end = m.index + m[0].length;
    if (
      value.length > 0 &&
      TRAILING_PUNCT.has(value[value.length - 1]) &&
      !(type === "file" && looksLikeLineRange(value))
    ) {
      value = value.slice(0, -1);
      end -= 1;
    }

    out.push({
      raw: text.slice(m.index, end),
      type,
      value,
      start: m.index,
      end,
    });
  }
  return out;
}

/**
 * Find the @-reference at the given cursor position, if any.
 * @param {string} text
 * @param {number} cursor
 * @returns {{type?: string, value: string, start: number, end: number} | null}
 */
export function partialRefAt(text, cursor) {
  // Look backwards from cursor for the most recent @
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  // The partial ref must not contain whitespace
  const partial = before.slice(at);
  if (/\s/.test(partial)) return null;

  // Parse the partial: "@file:foo" → type="file", value="foo"
  //                     "@diff"    → type="diff", value=""
  //                     "@fol"     → type=undefined, value="fol" (still typing)
  const colonIdx = partial.indexOf(":");
  if (colonIdx >= 0) {
    const type = partial.slice(1, colonIdx);
    const value = partial.slice(colonIdx + 1);
    return { type, value, start: at, end: cursor };
  }
  return { value: partial.slice(1), start: at, end: cursor };
}
