import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  FilePlus2,
  FolderOpen,
  GraduationCap,
  RotateCcw,
  Sparkles,
  Timer,
} from "lucide-react";
import { Badge, Button, Card, EmptyState, KeyValue, SectionHeader } from "../components/ui";
import { useAiStore } from "../store/aiStore";
import { useProjectStore } from "../store/projectStore";
import { formatDateTime, relativeTime } from "../lib/utils";
import { loadDraft } from "../lib/storage";
import { catalogMeta } from "../store/aiStore";
import { isTauri } from "../lib/tauri";

export function HomePage() {
  const setView = useProjectStore((state) => state.setView);
  const recents = useProjectStore((state) => state.recents);
  const openRecent = useProjectStore((state) => state.openRecent);
  const restoreDraft = useProjectStore((state) => state.restoreDraft);
  const openFromFile = useProjectStore((state) => state.openFromFile);

  const keyPresent = useAiStore((state) => state.keyPresent);
  const models = useAiStore((state) => state.models);
  const tier = useAiStore((state) => state.tier);
  const lastCheckedAt = useAiStore((state) => state.lastCheckedAt);
  const usage = useAiStore((state) => state.usage);

  const [draft, setDraft] = useState(() => loadDraft());
  useEffect(() => {
    setDraft(loadDraft());
  }, [recents.length]);

  const freeModels = models.filter((model) => model.textCapable && model.freeTier === "free");
  const today = new Date().toISOString().slice(0, 10);
  const todayRequests = usage.filter((record) => record.at.slice(0, 10) === today).length;

  return (
    <div className="scroll-area h-full">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <Card className="overflow-hidden border-0 bg-gradient-to-br from-brand-600 via-brand-600 to-brand-700 p-8 text-white shadow-pop">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-xl">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-brand-100">
                Qexam Teacher
              </p>
              <h1 className="mt-2 text-[28px] font-extrabold leading-tight">
                지문 하나로 학습지·워크북·답안지까지
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-brand-50">
                영어·한글 지문을 붙여넣거나 파일로 첨부하면 Google Gemini가 분석하고,
                문해력 해설·단어 시험·워크북·교사용 답안지를 만든 뒤 자유롭게 편집해 PDF/PNG로
                출력합니다. 모든 자료는 내 PC에만 저장됩니다.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  className="border-0 bg-white text-brand-700 hover:bg-brand-50"
                  icon={<FilePlus2 className="h-4 w-4" />}
                  onClick={() => setView("new")}
                >
                  새 프로젝트 시작
                </Button>
                <Button
                  variant="ghost"
                  className="border border-white/30 text-white hover:bg-white/10"
                  icon={<FolderOpen className="h-4 w-4" />}
                  onClick={() => setView("projects")}
                >
                  최근 프로젝트
                </Button>
                <Button
                  variant="ghost"
                  className="text-white hover:bg-white/10"
                  icon={<Sparkles className="h-4 w-4" />}
                  onClick={() => setView("ai")}
                >
                  AI 설정
                </Button>
              </div>
            </div>
            <div className="w-full max-w-[300px] rounded-xl bg-white/10 p-4 backdrop-blur">
              <div className="flex items-center gap-2 text-xs font-semibold text-brand-50">
                <Activity className="h-3.5 w-3.5" /> Gemini 상태
              </div>
              <div className="mt-2 space-y-1.5 text-brand-50/90">
                <KeyValue
                  label="API 키"
                  value={keyPresent ? "저장됨 (암호화)" : "미등록"}
                />
                <KeyValue
                  label="티어"
                  value={tier === "free" ? "Free (서버 증거)" : tier === "paid" ? "Paid" : "확인 불가"}
                />
                <KeyValue label="무료 모델" value={`${freeModels.length}개`} />
                <KeyValue label="오늘 요청" value={`${todayRequests}회 (자체 기록)`} />
                <KeyValue label="마지막 점검" value={lastCheckedAt ? relativeTime(lastCheckedAt) : "-"} />
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-brand-100/80">
                무료 여부: {catalogMeta.sourceLabel} · {catalogMeta.checkedAt}
              </p>
            </div>
          </div>
        </Card>

        {draft ? (
          <Card className="mt-5 flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50 px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-amber-900">복구할 수 있는 작업이 있습니다</p>
              <p className="mt-0.5 text-xs text-amber-700">
                {formatDateTime(draft.savedAt)} 자동 저장본 · {draft.path ?? "저장 경로 없음"}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={() => void restoreDraft()}
            >
              작업 복구
            </Button>
          </Card>
        ) : null}

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <Card className="p-5">
            <SectionHeader
              title="최근 프로젝트"
              description="프로젝트는 .qws 파일 하나로 저장되어 다른 PC에서도 열 수 있습니다."
              actions={
                <Button size="sm" variant="ghost" onClick={() => setView("projects")}>
                  전체 보기
                </Button>
              }
            />
            <div className="mt-4 space-y-2">
              {recents.length ? (
                recents.slice(0, 4).map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => void openRecent(entry)}
                    className="flex w-full items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left transition hover:border-brand-300 hover:bg-brand-50/40"
                  >
                    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                      <GraduationCap className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">{entry.name}</p>
                      <p className="truncate text-[11px] text-slate-500">
                        {relativeTime(entry.updatedAt)} · {entry.storage === "file" ? entry.path : "로컬 저장"}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 flex-none text-slate-300" />
                  </button>
                ))
              ) : (
                <EmptyState
                  title="아직 프로젝트가 없습니다"
                  description="새 프로젝트를 만들고 지문을 붙여넣어 보세요."
                  action={
                    <Button size="sm" variant="primary" onClick={() => setView("new")}>
                      새 프로젝트
                    </Button>
                  }
                />
              )}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
              <Button size="sm" variant="secondary" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => setView("projects")}>
                파일에서 불러오기
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void openFromFile()}>
                .qws 열기
              </Button>
              <span className="ml-auto text-[11px] text-slate-400">
                {isTauri ? "데스크톱 모드 · DPAPI 암호화" : "브라우저 미리보기 모드"}
              </span>
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader title="작업 순서" description="처음 사용해도 이 순서대로 따라 하면 됩니다." />
            <ol className="mt-4 space-y-3">
              {[
                { icon: Sparkles, title: "AI 설정", body: "Gemini API 키를 저장하고 모델 정책과 예산을 정합니다." },
                { icon: FilePlus2, title: "지문 준비", body: "텍스트 입력 또는 PDF·이미지 첨부 후 OCR 결과를 수정합니다." },
                { icon: GraduationCap, title: "자료 생성", body: "분석 → 쉬운 설명 → 단어 시험 → 워크북 → 답안지 → 검증." },
                { icon: Timer, title: "편집·출력", body: "문서 편집기에서 다듬고 PDF/PNG로 내보내거나 인쇄합니다." },
              ].map((step, index) => {
                const Icon = step.icon;
                return (
                  <li key={step.title} className="flex gap-3">
                    <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {index + 1}. {step.title}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{step.body}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="mt-4 rounded-lg bg-slate-50 p-3">
              <Badge tone="blue">무료 우선 · 기본값</Badge>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                기본 설정은 무료 티어 모델만 자동 호출합니다. AI 설정에서 유료 모델 사용을 허용하면
                가격이 확인된 유료 모델도 후보가 되며, 예산과 요청당 한도를 넘는 호출은 차단됩니다.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
