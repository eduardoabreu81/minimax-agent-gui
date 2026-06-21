import { useState } from "react";
import { FileText, GitBranch, Terminal as TerminalIcon, FolderOpen, Wrench, CheckCircle2, Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TabId = "files" | "diff" | "terminal" | "tools" | "preview";

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "files", label: "Files", icon: FileText },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "diff", label: "Diff", icon: GitBranch },
  { id: "terminal", label: "Terminal", icon: TerminalIcon },
  { id: "preview", label: "Preview", icon: FolderOpen },
];

export interface WorkPanelProps {
  activeTools: { name: string; status: "pending" | "done" | "error" }[];
}

export function WorkPanel({ activeTools }: WorkPanelProps) {
  const [active, setActive] = useState<TabId>("files");

  return (
    <aside className="flex h-full w-80 flex-col border-l border-border bg-card">
      <Tabs className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="min-w-0 flex-1 overflow-x-auto">
            <TabsList>
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <TabsTrigger
                  key={t.id}
                  active={active === t.id}
                  onClick={() => setActive(t.id)}
                >
                  <Icon className="mr-1.5 h-3.5 w-3.5" />
                  {t.label}
                  {t.id === "tools" && activeTools.length > 0 && (
                    <span className="ml-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground/10 px-1 text-[9px] font-semibold">
                      {activeTools.length}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
            </TabsList>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <TabsContent active={active === "files"}>
            <EmptyState
              title="No files open"
              description="Files opened by the agent will appear here."
            />
          </TabsContent>
          <TabsContent active={active === "tools"}>
            <ToolsActivity tools={activeTools} />
          </TabsContent>
          <TabsContent active={active === "diff"}>
            <EmptyState
              title="No changes"
              description="Git diffs from agent edits will appear here."
            />
          </TabsContent>
          <TabsContent active={active === "terminal"}>
            <EmptyState
              title="Terminal idle"
              description="xterm.js terminal will mount here in Phase 3."
            />
          </TabsContent>
          <TabsContent active={active === "preview"}>
            <EmptyState
              title="No preview"
              description="Sandboxed preview of generated artifacts will appear here."
            />
          </TabsContent>
        </div>

        <div className="border-t border-border p-2">
          <Button variant="ghost" size="sm" className="w-full justify-start text-xs">
            <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
            Open workspace folder
          </Button>
        </div>
      </Tabs>
    </aside>
  );
}

function ToolsActivity({ tools }: { tools: { name: string; status: "pending" | "done" | "error" }[] }) {
  if (tools.length === 0) {
    return (
      <EmptyState
        title="No tools running"
        description="When the agent invokes a tool (read, write, bash, web search), it'll show up here live."
      />
    );
  }
  return (
    <div className="space-y-2">
      {tools.map((t, i) => (
        <div
          key={`${t.name}-${i}`}
          className="flex items-center gap-2 rounded-md border border-border bg-background p-2"
        >
          {t.status === "pending" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
          ) : t.status === "done" ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <span className="h-3.5 w-3.5 rounded-full bg-red-500" />
          )}
          <span className={cn("text-xs font-medium", t.status === "pending" ? "text-foreground" : "text-muted-foreground")}>
            {t.name}
          </span>
          <span className="ml-auto text-[10px] uppercase text-muted-foreground">
            {t.status}
          </span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className={cn("flex h-40 flex-col items-center justify-center text-center")}>
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground/70">{description}</p>
    </div>
  );
}
