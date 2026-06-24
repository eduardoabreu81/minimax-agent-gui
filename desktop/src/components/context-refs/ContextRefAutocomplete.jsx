// ContextRefAutocomplete — popover that appears when the user is in
// the middle of typing an @-reference. Suggests:
//   - The 6 ref types when the user has typed just "@" or "@<partial>"
//   - File/folder paths when the user has typed "@file:" or "@folder:"

import { useEffect, useRef, useState } from "react";
import { Folder, FileText, GitBranch, GitCommit, Globe, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// The 6 ref types with their trigger prefixes + icons. Shown when
// the user types "@" or a partial type.
const REF_TYPES = [
  { type: "file",   label: "File",          prefix: "@file:",   Icon: FileText,   desc: "Inject file contents" },
  { type: "folder", label: "Folder",        prefix: "@folder:", Icon: Folder,     desc: "Inject directory tree" },
  { type: "diff",   label: "Diff (unstaged)", prefix: "@diff",  Icon: GitBranch,  desc: "git diff (working tree)" },
  { type: "staged", label: "Diff (staged)", prefix: "@staged",  Icon: GitBranch,  desc: "git diff --staged" },
  { type: "git",    label: "Recent commits", prefix: "@git:N",   Icon: GitCommit,  desc: "Last N commits (1-10)" },
  { type: "url",    label: "URL",           prefix: "@url:",    Icon: Globe,      desc: "Fetch web page content" },
];

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

  // Reset active index when the partial changes
  useEffect(() => {
    setActiveIdx(0);
  }, [partial?.start, partial?.value]);

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

  // Decide what to show:
  //   1) No type yet ("@" or "@fo" partial) → show the 6 ref types
  //   2) Type=file or folder → show file/folder suggestions
  //   3) Type=diff/staged/git/url → no autocomplete (value is fixed)
  const showTypePicker = !partial.type;
  const showPathSuggestions =
    (partial.type === "file" || partial.type === "folder") &&
    suggestions.length > 0;
  const showEmptyState =
    (partial.type === "file" || partial.type === "folder") &&
    suggestions.length === 0 &&
    !isLoading;

  const items = showTypePicker
    ? REF_TYPES.filter((t) => {
        if (!partial.type) return true;
        return t.type.startsWith(partial.type);
      }).map((t) => ({
        key: t.type,
        label: t.label,
        desc: t.desc,
        Icon: t.Icon,
        insertion: t.prefix,
      }))
    : showPathSuggestions
    ? suggestions.map((s) => ({
        key: s.path,
        label: s.path + (s.is_dir ? "/" : ""),
        desc: s.is_dir ? "folder" : `${s.size} bytes`,
        Icon: s.is_dir ? Folder : FileText,
        insertion: `@${partial.type}:${s.path}`,
      }))
    : [];

  if (showEmptyState) {
    items.push({
      key: "__empty__",
      label: partial.value ? `No matches for "${partial.value}"` : "Type to search files…",
      desc: "",
      Icon: AlertCircle,
      insertion: "",
    });
  }

  if (items.length === 0) return null;

  return (
    <div
      ref={popoverRef}
      role="listbox"
      data-testid="context-ref-autocomplete"
      className="absolute z-50 mt-1 w-80 max-h-64 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
    >
      {items.map((item, i) => {
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
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px]",
              isActive && "bg-accent text-accent-foreground",
              !item.insertion && "cursor-default opacity-60"
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="flex-1 truncate">
              <div className="font-mono">{item.label}</div>
              {item.desc && (
                <div className="text-[10px] text-muted-foreground">{item.desc}</div>
              )}
            </div>
            {isLoading && i === 0 && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </button>
        );
      })}
    </div>
  );
}
