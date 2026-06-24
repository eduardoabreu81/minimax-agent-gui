// ContextRefAutocomplete — popover that appears when the user is in
// the middle of typing an @-reference. Suggests:
//   - The 6 ref types when the user has typed just "@" or "@<partial>"
//   - File/folder paths when the user has typed "@file:" or "@folder:"
//
// Visual design (as of 2026-06-24):
//   - 420px wide (was 320px) so long paths don't truncate as much
//   - Each row: 24px icon | filename (medium mono) on top, parent
//     dir (dim mono) below | size right-aligned in human-readable
//     format (1.2 KB not 1234 bytes)
//   - Folders grouped first, then files (with subtle section header)
//   - Footer hint: keyboard navigation
//   - Folder icon: yellow; file icon: muted. Bigger (h-5 w-5) so the
//     type is obvious at a glance.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Folder,
  FileText,
  GitBranch,
  GitCommit,
  Globe,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// The 6 ref types with their trigger prefixes + icons. Shown when
// the user types "@" or a partial type.
const REF_TYPES = [
  { type: "file",   label: "File",           prefix: "@file:",   Icon: FileText,   desc: "Inject file contents" },
  { type: "folder", label: "Folder",         prefix: "@folder:", Icon: Folder,     desc: "Inject directory tree" },
  { type: "diff",   label: "Diff (unstaged)", prefix: "@diff",   Icon: GitBranch,  desc: "git diff (working tree)" },
  { type: "staged", label: "Diff (staged)",  prefix: "@staged",  Icon: GitBranch,  desc: "git diff --staged" },
  { type: "git",    label: "Recent commits", prefix: "@git:N",   Icon: GitCommit,  desc: "Last N commits (1-10)" },
  { type: "url",    label: "URL",            prefix: "@url:",    Icon: Globe,      desc: "Fetch web page content" },
];

// ---- Path / size formatting helpers ----

/** Split a workspace-relative path into [parent, basename]. Returns
 *  [null, fullPath] if there's no parent (e.g. "src"). */
function splitPath(p) {
  const parts = p.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 1) return [null, p];
  return [parts.slice(0, -1).join("/"), parts[parts.length - 1]];
}

/** Human-readable byte count: 1234 → "1.2 KB", 1234567 → "1.2 MB". */
function humanSize(bytes) {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * @param {Object} props
 * @param {{type?: string, value: string, start: number, end: number} | null} props.partial
 * @param {Array<{path: string, is_dir: boolean, size: number}>} props.suggestions
 * @param {boolean} props.isLoading
 * @param {(insertion: string) => void} props.onSelect
 * @param {() => void} props.onClose
 * @param {React.RefObject<HTMLElement>} props.anchorRef
 */
export function ContextRefAutocomplete({
  partial,
  suggestions,
  isLoading,
  onSelect,
  onClose,
  anchorRef,
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const popoverRef = useRef(null);

  // Decide what to show:
  //   1) No type yet ("@" or "@fo" partial) → show the 6 ref types
  //   2) Type=file or folder → show file/folder suggestions
  //   3) Type=diff/staged/git/url → no autocomplete (value is fixed)
  const showTypePicker = partial && !partial.type;
  const showPathSuggestions =
    partial && (partial.type === "file" || partial.type === "folder") &&
    suggestions.length > 0;
  const showEmptyState =
    partial && (partial.type === "file" || partial.type === "folder") &&
    suggestions.length === 0 &&
    !isLoading;

  // Build a flat list of renderable items with a stable shape:
  //   { key, label, sublabel, size, Icon, iconClass, insertion }
  // For path suggestions we also separate folders and files so they
  // can be grouped visually in the popover. The empty-state row is
  // folded into the same memo so it doesn't get duplicated on
  // re-renders (we used to push it after the memo and the second
  // render appended a duplicate, causing React duplicate-key
  // warnings).
  const { flatItems, groups } = useMemo(() => {
    if (!partial) return { flatItems: [], groups: [] };
    if (showTypePicker) {
      const filtered = REF_TYPES.filter((t) => {
        if (!partial.type) return true;
        return t.type.startsWith(partial.type);
      });
      const items = filtered.map((t) => ({
        key: t.type,
        label: t.label,
        sublabel: t.desc,
        size: null,
        Icon: t.Icon,
        iconClass: "text-muted-foreground",
        insertion: t.prefix,
      }));
      return {
        flatItems: items,
        groups: [{ key: "types", label: null, items }],
      };
    }
    if (showPathSuggestions) {
      const folders = [];
      const files = [];
      for (const s of suggestions) {
        const [parent, name] = splitPath(s.path);
        const node = {
          key: s.path,
          label: name + (s.is_dir ? "/" : ""),
          sublabel: parent,
          size: s.is_dir ? null : humanSize(s.size),
          Icon: s.is_dir ? Folder : FileText,
          iconClass: s.is_dir ? "text-yellow-500" : "text-muted-foreground",
          insertion: `@${partial.type}:${s.path}`,
        };
        (s.is_dir ? folders : files).push(node);
      }
      const flat = [...folders, ...files];
      const gs = [];
      if (folders.length) gs.push({ key: "folders", label: "Folders", items: folders });
      if (files.length)   gs.push({ key: "files",   label: "Files",   items: files });
      // Empty-state row (no suggestions match the prefix). Shown as
      // a single disabled row in its own group, alongside the file
      // suggestions (which may also be empty).
      if (showEmptyState) {
        const empty = {
          key: "__empty__",
          label: partial.value ? `No matches for "${partial.value}"` : "Type to search files…",
          sublabel: null,
          size: null,
          Icon: AlertCircle,
          iconClass: "text-muted-foreground",
          insertion: "",
        };
        flat.push(empty);
        gs.push({ key: "empty", label: null, items: [empty] });
      }
      return { flatItems: flat, groups: gs };
    }
    return { flatItems: [], groups: [] };
  }, [partial, showTypePicker, showPathSuggestions, showEmptyState, suggestions]);

  // Reset active index when the partial changes
  useEffect(() => {
    setActiveIdx(0);
  }, [partial?.start, partial?.value]);

  // Keyboard navigation: arrow up/down to move the active index,
  // Enter to select, Escape to close.
  useEffect(() => {
    if (!partial) return;
    const onKey = (e) => {
      if (flatItems.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % flatItems.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + flatItems.length) % flatItems.length);
      } else if (e.key === "Enter" && !e.shiftKey) {
        const item = flatItems[activeIdx];
        if (item?.insertion) {
          e.preventDefault();
          onSelect(item.insertion);
        }
      }
    };
    // We attach at the document level because the textarea is the
    // active element; the Composer doesn't currently route these
    // keys to the popover.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [partial, flatItems, activeIdx, onSelect]);

  // Close on outside click
  useEffect(() => {
    if (!partial) return;
    const onClick = (e) => {
      if (
        popoverRef.current?.contains(e.target) ||
        anchorRef.current?.contains(e.target)
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [partial, onClose, anchorRef]);

  if (!partial) return null;
  if (flatItems.length === 0) return null;

  // Compute the global index for each item so the active highlight
  // is consistent across groups.
  let runningIdx = 0;

  return (
    <div
      ref={popoverRef}
      role="listbox"
      data-testid="context-ref-autocomplete"
      className="absolute z-50 bottom-full left-0 mb-1.5 w-full max-w-[420px] max-h-[28rem] overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
    >
      {groups.map((group, gi) => (
        <div key={group.key}>
          {gi > 0 && <div className="border-t border-border/50" />}
          {group.label && (
            <div
              className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              data-testid={`autocomplete-group-${group.key}`}
            >
              {group.label}
            </div>
          )}
          {group.items.map((item) => {
            const i = runningIdx++;
            const Icon = item.Icon;
            const isActive = i === activeIdx;
            return (
              <button
                type="button"
                key={item.key}
                role="option"
                aria-selected={isActive}
                data-testid={`autocomplete-item-${item.key}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => {
                  if (item.insertion) onSelect(item.insertion);
                }}
                disabled={!item.insertion}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left",
                  isActive && "bg-accent text-accent-foreground",
                  !item.insertion && "cursor-default opacity-60"
                )}
              >
                <Icon className={cn("h-5 w-5 shrink-0", item.iconClass)} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-mono font-medium truncate">
                    {item.label}
                  </div>
                  {item.sublabel && (
                    <div className="text-[11px] font-mono text-muted-foreground truncate">
                      {item.sublabel}
                    </div>
                  )}
                </div>
                {item.size && (
                  <div className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                    {item.size}
                  </div>
                )}
                {isLoading && i === 0 && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      ))}

      {/* Footer: keyboard hint. Always shown (even when there are no
          groups) so the user knows ↑↓ Enter Esc are bound. */}
      <div className="border-t border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground flex items-center justify-between">
        <span>
          <kbd className="font-mono">↑↓</kbd> navigate · <kbd className="font-mono">↵</kbd> select · <kbd className="font-mono">Esc</kbd> close
        </span>
      </div>
    </div>
  );
}
