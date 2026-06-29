import { useState } from "react";
import {
  Code2,
  Search,
  Image as ImageIcon,
  Music,
  Video,
  Settings,
  Sparkles,
  Plus,
  MessageSquare,
  PanelLeft,
  Sun,
  Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type ExpertId = "code" | "research" | "image" | "music" | "video" | "settings";

interface Expert {
  id: ExpertId;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const EXPERTS: Expert[] = [
  { id: "code", label: "Code", description: "Build, debug, refactor", icon: Code2, color: "text-sky-500" },
  { id: "research", label: "Research", description: "Search & synthesize", icon: Search, color: "text-emerald-500" },
  { id: "image", label: "Image", description: "Generate & edit images", icon: ImageIcon, color: "text-pink-500" },
  { id: "music", label: "Music", description: "Compose & produce", icon: Music, color: "text-violet-500" },
  { id: "video", label: "Video", description: "Text/image to video", icon: Video, color: "text-orange-500" },
  { id: "settings", label: "Settings", description: "App preferences", icon: Settings, color: "text-zinc-500" },
];

interface AppSidebarProps {
  activeExpert: ExpertId;
  onExpertChange: (id: ExpertId) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  dark: boolean;
  onToggleTheme: () => void;
}

export function AppSidebar({
  activeExpert,
  onExpertChange,
  collapsed,
  onToggleCollapse,
  dark,
  onToggleTheme,
}: AppSidebarProps) {
  return (
    <aside
      className={cn(
        "flex flex-col border-r border-border bg-sidebar text-sidebar-foreground transition-all duration-200",
        collapsed ? "w-14" : "w-64"
      )}
    >
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-border px-3">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-sky-500 to-violet-600">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold">MiniMax Studio</span>
              <span className="text-[10px] text-muted-foreground">Desktop</span>
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onToggleCollapse}
          aria-label="Toggle sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
      </div>

      {/* New chat */}
      {!collapsed && (
        <div className="p-2">
          <Button
            variant="outline"
            className="w-full justify-start gap-2 text-sm"
          >
            <Plus className="h-4 w-4" />
            New chat
          </Button>
        </div>
      )}

      {/* Experts list */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {EXPERTS.map((expert) => {
          const Icon = expert.icon;
          const active = activeExpert === expert.id;
          return (
            <button
              key={expert.id}
              onClick={() => onExpertChange(expert.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", expert.color)} />
              {!collapsed && (
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-medium leading-tight">{expert.label}</span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {expert.description}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-2 space-y-1">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={onToggleTheme}
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {!collapsed && <span>{dark ? "Light" : "Dark"} theme</span>}
        </Button>
      </div>
    </aside>
  );
}

export type { Expert };
