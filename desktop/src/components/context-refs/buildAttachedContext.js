// buildAttachedContext — turns a /api/context-refs/expand report into
// the "--- Attached Context ---" block appended to a user message
// before it goes to the agent. Pure logic, no React or fetch.
//
// Extracted from Composer.tsx so the same formatter is used by the
// in-place ChatPanel wiring (where the @-ref hook is wired around
// the existing inline textarea) and by the Composer.tsx "clean"
// reference implementation.

/**
 * @param {{results: Array<{ref: {raw: string, type: string}, content: string, error: string, size_bytes: number}>, refused?: boolean, refusal_reason?: string}} report
 * @returns {string} The attached-context block (empty string if no successful expansions).
 */
export function buildAttachedContext(report) {
  if (!report || !Array.isArray(report.results)) return "";
  const ok = report.results.filter((r) => !r.error && r.content);
  if (ok.length === 0) return "";

  const lines = ["--- Attached Context ---"];
  for (const r of ok) {
    lines.push("");
    lines.push(`### ${r.ref.raw}  (${r.size_bytes} bytes)`);
    lines.push("");
    lines.push(r.content);
  }
  lines.push("");
  lines.push("--- End Attached Context ---");
  return lines.join("\n");
}
