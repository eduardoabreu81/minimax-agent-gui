// ContextRefChips — renders a chip per parsed ref. Each chip shows
// the ref name and an icon indicating state:
//   - Green check: expansion succeeded
//   - Red triangle: expansion failed (sensitive path, binary, not found, etc.)
//   - Spinner: expansion pending
//   - Neutral: ref not yet expanded
//
// Plus an aggregate "size / limit" footer if the soft limit is hit.

import { CheckCircle2, AlertTriangle, Loader2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

const ICON_FOR_TYPE = {
  file: "📄",
  folder: "📁",
  diff: "🔀",
  staged: "📦",
  git: "📜",
  url: "🌐",
};

function chipStateFor(ref, report) {
  if (!report) return "pending";
  const result = report.results.find(
    (r) => r.ref.start === ref.start && r.ref.end === ref.end
  );
  if (!result) return "pending";
  if (result.error) return "error";
  if (result.content) return "ok";
  return "unknown";
}

/**
 * @param {Object} props
 * @param {Array<{raw: string, type: string, value: string, start: number, end: number}>} props.parsed
 * @param {Object | null} props.report
 * @param {boolean} props.isExpanding
 */
export function ContextRefChips({ parsed, report, isExpanding }) {
  if (parsed.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-1.5" data-testid="context-ref-chips">
      {parsed.map((ref, i) => {
        const state = chipStateFor(ref, report);
        return (
          <Chip
            key={`${ref.start}-${i}`}
            ref_={ref}
            state={state}
            result={report?.results.find(
              (r) => r.ref.start === ref.start && r.ref.end === ref.end
            )}
          />
        );
      })}

      {isExpanding && (
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          expanding…
        </span>
      )}

      {report?.soft_warning && (
        <div
          className="mt-1 w-full rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[10.5px] text-amber-900"
          data-testid="soft-limit-warning"
        >
          ⚠ {report.soft_warning}
        </div>
      )}
    </div>
  );
}

function Chip({ ref_, state, result }) {
  const icon = ICON_FOR_TYPE[ref_.type] || "•";
  const stateClass =
    state === "ok"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : state === "error"
      ? "border-red-300 bg-red-50 text-red-900"
      : state === "pending"
      ? "border-border bg-secondary/40 text-muted-foreground"
      : "border-border bg-secondary/20 text-muted-foreground";

  return (
    <span
      data-testid={`ref-chip-${ref_.type}`}
      title={
        state === "error"
          ? result?.error || "Error"
          : state === "ok"
          ? `${result?.size_bytes || 0} bytes`
          : "Pending…"
      }
      className={cn(
        "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-mono",
        stateClass
      )}
    >
      <span>{icon}</span>
      <span className="max-w-[200px] truncate">{ref_.raw}</span>
      {state === "ok" && <CheckCircle2 className="h-3 w-3" />}
      {state === "error" && <AlertTriangle className="h-3 w-3" />}
      {state === "pending" && <Circle className="h-3 w-3" />}
    </span>
  );
}
