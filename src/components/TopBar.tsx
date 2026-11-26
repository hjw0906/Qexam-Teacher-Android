import { Download, Save, SaveAll, ShieldCheck, X } from "lucide-react";
import { Badge, Button } from "./ui";
import { useProjectStore } from "../store/projectStore";
import { useAiStore } from "../store/aiStore";
import { formatDateTime, relativeTime } from "../lib/utils";

export function TopBar({ onExport }: { onExport?: () => void }) {
  const project = useProjectStore((state) => state.project);
  const dirty = useProjectStore((state) => state.dirty);
  const saving = useProjectStore((state) => state.saving);
  const lastSavedAt = useProjectStore((state) => state.lastSavedAt);
  const filePath = useProjectStore((state) => state.filePath);
  const save = useProjectStore((state) => state.save);
  const closeProject = useProjectStore((state) => state.closeProject);
  const setView = useProjectStore((state) => state.setView);
  const setTab = useProjectStore((state) => state.setTab);
  const keyPresent = useAiStore((state) => state.keyPresent);
  const tier = useAiStore((state) => state.tier);

  return (
    <header className="flex h-14 flex-none items-center gap-3 border-b border-slate-200 bg-white px-5">
      <div className="min-w-0 flex-1">
        {project ? (
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[15px] font-bold text-slate-900">{project.name}</h1>
            {dirty ? (
              <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> 저장 안 됨
              </span>
            ) : (
              <span className="text-[11px] text-slate-400">
                {lastSavedAt ? `저장됨 · ${relativeTime(lastSavedAt)}` : "로컬 프로젝트"}
              </span>
            )}
          </div>
        ) : (
          <div>
            <h1 className="text-[15px] font-bold text-slate-900">Qexam Teacher</h1>
            <p className="text-[11px] text-slate-500">AI 기반 학습지 제작 스튜디오</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Badge tone={keyPresent ? (tier === "free" ? "green" : "blue") : "slate"}>
          <ShieldCheck className="h-3 w-3" />
          {keyPresent ? (tier === "free" ? "무료 티어 확인" : "Gemini 연결") : "API 미설정"}
        </Badge>
        {project ? (
          <span
            className="hidden max-w-[220px] truncate text-[11px] text-slate-400 lg:block"
            title={filePath ?? "아직 저장되지 않음"}
          >
            {filePath ?? "저장 경로 없음"}
          </span>
        ) : null}
      </div>

      {project ? (
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            icon={<Save className="h-3.5 w-3.5" />}
            loading={saving}
            onClick={() => void save()}
            title={formatDateTime(lastSavedAt)}
          >
            저장
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<SaveAll className="h-3.5 w-3.5" />}
            onClick={() => void save({ saveAs: true })}
          >
            다른 이름으로
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<Download className="h-3.5 w-3.5" />}
            onClick={() => {
              setTab("editor");
              onExport?.();
            }}
          >
            내보내기
          </Button>
          <button
            type="button"
            onClick={() => closeProject()}
            title="프로젝트 닫기"
            className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <Button size="sm" variant="primary" onClick={() => setView("new")}>
          새 프로젝트
        </Button>
      )}
    </header>
  );
}
