import {
  Activity,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FileText,
  GraduationCap,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Badge, Button, Card, EmptyState, SectionHeader } from "./ui";
import { PassageEditor } from "./PassageEditor";
import { AnalysisPanel } from "./AnalysisPanel";
import { EasyPanel } from "./EasyPanel";
import { VocabPanel } from "./VocabPanel";
import { WorkbookPanel } from "./WorkbookPanel";
import { AnswersPanel } from "./AnswersPanel";
import { VerificationPanel } from "./VerificationPanel";
import { Editor } from "./editor/Editor";
import { ElementInspector, PageSettingsPanel } from "./editor/Inspector";
import { ModelQuickSelect } from "./ModelTable";
import { useProjectStore } from "../store/projectStore";
import { useAiStore } from "../store/aiStore";
import { WORKSPACE_TABS, type WorkspaceTab } from "../lib/types";
import { relativeTime } from "../lib/utils";
import { cn } from "../lib/utils";
import { costTotals, tierLabel } from "../lib/gemini/usage";
import { formatUsd } from "../lib/gemini/pricing";

export function Workspace({ exportSignal }: { exportSignal: number }) {
  const project = useProjectStore((state) => state.project);
  const tab = useProjectStore((state) => state.tab);
  const setTab = useProjectStore((state) => state.setTab);
  const setView = useProjectStore((state) => state.setView);

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <EmptyState
          title="열린 프로젝트가 없습니다"
          description="새 프로젝트를 만들거나 저장된 .qws 파일을 불러오세요."
          action={
            <Button variant="primary" onClick={() => setView("new")}>
              새 프로젝트
            </Button>
          }
        />
      </div>
    );
  }

  const ready: Record<WorkspaceTab, boolean> = {
    passage: project.passage.text.trim().length > 0,
    analysis: Boolean(project.analysis),
    easy: Boolean(project.easy),
    vocab: Boolean(project.vocab),
    workbook: Boolean(project.workbook),
    answers: Boolean(project.answerKey),
    verify: Boolean(project.verification),
    editor: project.pages.some((page) => page.elements.length > 0),
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-0.5 overflow-x-auto border-b border-slate-200 bg-white px-3">
        {WORKSPACE_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-[13px] transition",
              tab === item.id
                ? "font-semibold text-brand-700"
                : "font-medium text-slate-500 hover:text-slate-800",
            )}
          >
            {item.label}
            {ready[item.id] ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : null}
            {tab === item.id ? (
              <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-600" />
            ) : null}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {tab === "passage" ? <PassageEditor /> : null}
          {tab === "analysis" ? <AnalysisPanel /> : null}
          {tab === "easy" ? <EasyPanel /> : null}
          {tab === "vocab" ? <VocabPanel /> : null}
          {tab === "workbook" ? <WorkbookPanel /> : null}
          {tab === "answers" ? <AnswersPanel /> : null}
          {tab === "verify" ? <VerificationPanel /> : null}
          {tab === "editor" ? <Editor exportSignal={exportSignal} /> : null}
        </div>

        <aside className="scroll-area w-[302px] flex-none space-y-3 border-l border-slate-200 bg-slate-50/70 p-3">
          {tab === "editor" ? (
            <>
              <PageSettingsPanel />
              <ElementInspector />
            </>
          ) : (
            <>
              <AiToolsPanel />
              <ProjectStatusCard />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function AiToolsPanel() {
  const models = useAiStore((state) => state.models);
  const keyPresent = useAiStore((state) => state.keyPresent);
  const keyValid = useAiStore((state) => state.keyValid);
  const policy = useAiStore((state) => state.policy);
  const tier = useAiStore((state) => state.tier);
  const lastCheckedAt = useAiStore((state) => state.lastCheckedAt);
  const preferredModelId = useAiStore((state) => state.preferredModelId);
  const setPreferredModel = useAiStore((state) => state.setPreferredModel);
  const usage = useAiStore((state) => state.usage);
  const setView = useProjectStore((state) => state.setView);
  const setTab = useProjectStore((state) => state.setTab);
  const tab = useProjectStore((state) => state.tab);

  const freeModels = models.filter((model) => model.textCapable && model.freeAvailable);
  const pricedModels = models.filter((model) => model.textCapable && model.paidAvailable);
  const totals = costTotals(usage);
  const today = new Date().toISOString().slice(0, 10);
  const todayRequests = usage.filter((record) => record.at.slice(0, 10) === today).length;
  const lastRecord = usage[0];

  const quickLinks: { tab: WorkspaceTab; label: string; icon: typeof Sparkles }[] = [
    { tab: "analysis", label: "지문 분석", icon: Sparkles },
    { tab: "easy", label: "쉬운 설명", icon: Wand2 },
    { tab: "vocab", label: "단어 시험", icon: BookOpen },
    { tab: "workbook", label: "워크북", icon: ClipboardList },
    { tab: "answers", label: "답안지", icon: ClipboardCheck },
    { tab: "verify", label: "품질 검증", icon: Activity },
  ];

  return (
    <>
      <Card className="p-4">
        <SectionHeader title="AI 도구" description="Gemini 연결 상태와 모델 전환을 관리합니다." />
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">연결</span>
            <Badge tone={keyPresent && keyValid ? "green" : "amber"}>
              {keyPresent ? (keyValid ? "사용 가능" : "확인 필요") : "키 미등록"}
            </Badge>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">티어</span>
            <span className="font-medium text-slate-700">{tierLabel(tier)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">무료 모델</span>
            <span className="font-medium text-slate-700">{freeModels.length}개</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">유료 모델 (가격 확인)</span>
            <span className="font-medium text-slate-700">{pricedModels.length}개</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">모델 정책</span>
            <span className="font-medium text-slate-700">
              {policy.allowPaidModels ? "유료 허용" : "무료 전용"}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">오늘 예상 비용</span>
            <span className="font-medium text-slate-700">{formatUsd(totals.todayUsd)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">오늘 요청</span>
            <span className="font-medium text-slate-700">{todayRequests}회</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">마지막 점검</span>
            <span className="text-[11px] text-slate-600">{lastCheckedAt ? relativeTime(lastCheckedAt) : "-"}</span>
          </div>
          {lastRecord ? (
            <div className="rounded-lg bg-slate-50 p-2 text-[10px] leading-relaxed text-slate-500">
              마지막 사용: {lastRecord.modelId} · {lastRecord.ok ? "성공" : `실패 (${lastRecord.errorKind})`} ·{" "}
              {relativeTime(lastRecord.at)}
            </div>
          ) : null}
          {!keyPresent || !keyValid ? (
            <Button size="sm" variant="primary" className="w-full" onClick={() => setView("ai")}>
              AI 설정 열기
            </Button>
          ) : null}
        </div>
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-[11px] font-semibold text-slate-600">우선 사용 모델</p>
          <div className="mt-1.5">
            <ModelQuickSelect value={preferredModelId} onChange={setPreferredModel} models={models} />
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
            자동 선택 시 작업 적합도가 높은 무료 모델부터 시도하고, 한도 초과(429) 시 다음 무료 모델로
            자동 전환합니다.
          </p>
        </div>
      </Card>

      <Card className="p-4">
        <SectionHeader title="빠른 이동" />
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <button
                key={link.tab}
                type="button"
                onClick={() => setTab(link.tab)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-medium transition",
                  tab === link.tab
                    ? "border-brand-300 bg-brand-50 text-brand-700"
                    : "border-slate-200 bg-white text-slate-600 hover:border-brand-200",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {link.label}
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="border-brand-100 bg-brand-50/50 p-4">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-800">
          <GraduationCap className="h-3.5 w-3.5" /> 생성 옵션 안내
        </div>
        <ul className="mt-2 space-y-1 text-[10px] leading-relaxed text-brand-900/70">
          <li>· 단어 시험: 문항 수·방향·난이도·순서 섞기를 선택합니다.</li>
          <li>· 워크북: 7가지 유형별 문항 수를 지정합니다.</li>
          <li>· 답안지: 워크북 생성 후 같은 문제 ID로 만듭니다.</li>
          <li>· 검증: 무료 사용량을 소비하므로 필요할 때만 실행하세요.</li>
        </ul>
      </Card>
    </>
  );
}

function ProjectStatusCard() {
  const project = useProjectStore((state) => state.project);
  if (!project) return null;
  const rows = [
    { label: "지문", value: `${project.passage.text.trim().length.toLocaleString()}자` },
    { label: "분석", value: project.analysis ? "완료" : "없음" },
    { label: "쉬운 설명", value: project.easy ? "완료" : "없음" },
    { label: "단어", value: project.vocab ? `${project.vocab.items.length}개` : "없음" },
    { label: "워크북", value: project.workbook ? `${project.workbook.problems.length}문항` : "없음" },
    { label: "답안지", value: project.answerKey ? `${project.answerKey.entries.length}개` : "없음" },
    { label: "검증", value: project.verification ? project.verification.overall.toUpperCase() : "없음" },
    { label: "페이지", value: `${project.pages.length}장` },
  ];
  return (
    <Card className="p-4">
      <SectionHeader title="프로젝트 현황" />
      <div className="mt-2 space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between text-[11px]">
            <span className="text-slate-500">{row.label}</span>
            <span className="font-medium text-slate-700">{row.value}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-slate-50 p-2 text-[10px] text-slate-500">
        <FileText className="h-3 w-3" />
        {project.passage.sources.length}개 첨부 · {project.settings.defaultPageSize}
      </div>
    </Card>
  );
}
