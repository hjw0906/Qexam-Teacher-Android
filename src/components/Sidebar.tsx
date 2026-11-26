import {
  FilePlus2,
  FolderOpen,
  Home,
  Settings,
  Sparkles,
  CircleDot,
} from "lucide-react";
import { cn } from "../lib/utils";
import { APP_NAME } from "../lib/types";
import type { MainView } from "../lib/types";
import { useAiStore } from "../store/aiStore";
import { useProjectStore } from "../store/projectStore";

const NAV: { id: MainView; label: string; icon: typeof Home; hint: string }[] = [
  { id: "home", label: "홈", icon: Home, hint: "시작 화면" },
  { id: "new", label: "새 프로젝트", icon: FilePlus2, hint: "지문으로 새 자료 만들기" },
  { id: "projects", label: "프로젝트 목록", icon: FolderOpen, hint: "최근 프로젝트와 불러오기" },
  { id: "ai", label: "AI 설정", icon: Sparkles, hint: "Gemini 키·모델·사용량" },
  { id: "prefs", label: "환경 설정", icon: Settings, hint: "저장·편집 기본값" },
];

export function Sidebar() {
  const view = useProjectStore((state) => state.view);
  const setView = useProjectStore((state) => state.setView);
  const hasProject = useProjectStore((state) => Boolean(state.project));
  const keyPresent = useAiStore((state) => state.keyPresent);
  const keyValid = useAiStore((state) => state.keyValid);
  const aiReady = keyPresent && keyValid;

  return (
    <aside className="flex w-[228px] flex-none flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <img src="/logo.png" alt="" className="h-9 w-9 rounded-lg" />
        <div className="leading-tight">
          <p className="text-[15px] font-extrabold tracking-tight text-slate-900">{APP_NAME}</p>
          <p className="text-[10px] font-medium text-slate-400">AI Worksheet Studio</p>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5 px-3">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={cn(
                "group flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition",
                active
                  ? "bg-brand-50 font-semibold text-brand-700"
                  : "font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900",
              )}
              title={item.hint}
            >
              <Icon className={cn("h-4 w-4", active ? "text-brand-600" : "text-slate-400")} />
              {item.label}
            </button>
          );
        })}

        {hasProject ? (
          <button
            type="button"
            onClick={() => setView("workspace")}
            className={cn(
              "mt-1 flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition",
              view === "workspace"
                ? "bg-brand-50 font-semibold text-brand-700"
                : "font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900",
            )}
          >
            <CircleDot
              className={cn("h-4 w-4", view === "workspace" ? "text-brand-600" : "text-slate-400")}
            />
            작업 화면
          </button>
        ) : null}
      </nav>

      <div className="mt-auto px-3 pb-4">
        <button
          type="button"
          onClick={() => setView("ai")}
          className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-left transition hover:border-brand-200 hover:bg-brand-50/60"
        >
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                aiReady ? "bg-emerald-500" : keyPresent ? "bg-amber-500" : "bg-slate-300",
              )}
            />
            <span className="text-[11px] font-semibold text-slate-700">
              {aiReady ? "Gemini 연결됨" : keyPresent ? "확인 필요" : "API 키 미등록"}
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
            {aiReady
              ? "연결 확인 완료 · 정책에 따라 모델 자동 선택"
              : "AI 기능을 쓰려면 AI 설정에서 API 키를 저장하고 연결을 확인하세요."}
          </p>
        </button>
        <p className="mt-3 px-1 text-[10px] text-slate-400">v1.0.0 · 로컬 저장 · 오프라인 편집</p>
      </div>
    </aside>
  );
}
