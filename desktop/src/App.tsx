import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppSidebar, type ExpertId } from "@/components/sidebar/AppSidebar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { WorkPanel } from "@/components/workpanel/WorkPanel";

type BackendStatus = "starting" | "running" | "stopped" | "error";

const EXPERT_LABELS: Record<ExpertId, string> = {
  code: "Code",
  research: "Research",
  image: "Image",
  music: "Music",
  video: "Video",
  settings: "Settings",
};

function App() {
  const [activeExpert, setActiveExpert] = useState<ExpertId>("code");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dark, setDark] = useState(true);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("stopped");
  const [backendMessage, setBackendMessage] = useState<string | undefined>();
  const [activeTools, setActiveTools] = useState<
    { name: string; status: "pending" | "done" | "error" }[]
  >([]);

  // Apply theme
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // Auto-start backend on mount
  useEffect(() => {
    void startBackend();
  }, []);

  const startBackend = async () => {
    setBackendStatus("starting");
    setBackendMessage(undefined);
    try {
      const msg = await invoke<string>("start_backend", { pythonPath: null });
      setBackendStatus("running");
      setBackendMessage(msg);
      // eslint-disable-next-line no-console
      console.log("[backend]", msg);
    } catch (err) {
      setBackendStatus("error");
      setBackendMessage(String(err));
      // eslint-disable-next-line no-console
      console.error("[backend] start failed:", err);
    }
  };

  const handleToolActivity = useCallback(
    (tools: { name: string; status: "pending" | "done" | "error" }[]) => {
      setActiveTools(tools);
    },
    []
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <AppSidebar
        activeExpert={activeExpert}
        onExpertChange={setActiveExpert}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        dark={dark}
        onToggleTheme={() => setDark((v) => !v)}
      />
      <main className="flex flex-1 overflow-hidden">
        <ChatPanel
          expertLabel={EXPERT_LABELS[activeExpert]}
          backendStatus={backendStatus}
          backendMessage={backendMessage}
          onToolActivity={handleToolActivity}
        />
        <WorkPanel activeTools={activeTools} />
      </main>
    </div>
  );
}

export default App;
