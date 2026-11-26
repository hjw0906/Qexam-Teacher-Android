import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { ToastHost } from "./components/ui";
import { CostApprovalDialog } from "./components/CostApprovalDialog";
import { HomePage } from "./pages/HomePage";
import { NewProjectPage } from "./pages/NewProjectPage";
import { ProjectListPage } from "./pages/ProjectListPage";
import { AISettingsPage } from "./pages/AISettingsPage";
import { PreferencesPage } from "./pages/PreferencesPage";
import { Workspace } from "./components/Workspace";
import { useProjectStore } from "./store/projectStore";
import { useAiStore } from "./store/aiStore";
import { loadPreferences } from "./lib/storage";

export default function App() {
  const view = useProjectStore((state) => state.view);
  const project = useProjectStore((state) => state.project);
  const dirty = useProjectStore((state) => state.dirty);
  const setTab = useProjectStore((state) => state.setTab);
  const initProject = useProjectStore((state) => state.init);
  const initAi = useAiStore((state) => state.init);
  const [exportSignal, setExportSignal] = useState(0);

  useEffect(() => {
    initProject();
    void initAi();
  }, [initAi, initProject]);

  useEffect(() => {
    const seconds = loadPreferences().autosaveSeconds;
    if (!seconds) return;
    const timer = window.setInterval(() => {
      void useProjectStore.getState().autosave();
    }, Math.max(10, seconds) * 1000);
    return () => window.clearInterval(timer);
  }, [view]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!useProjectStore.getState().dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (useProjectStore.getState().project) {
        void useProjectStore.getState().save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 text-slate-900">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onExport={() => {
            if (!project) return;
            setTab("editor");
            setExportSignal((value) => value + 1);
          }}
        />
        <main className="flex min-h-0 flex-1 flex-col">
          {view === "home" ? <HomePage /> : null}
          {view === "new" ? <NewProjectPage /> : null}
          {view === "projects" ? <ProjectListPage /> : null}
          {view === "ai" ? <AISettingsPage /> : null}
          {view === "prefs" ? <PreferencesPage /> : null}
          {view === "workspace" ? <Workspace exportSignal={exportSignal} /> : null}
        </main>
      </div>
      <CostApprovalDialog />
      <ToastHost />
    </div>
  );
}
