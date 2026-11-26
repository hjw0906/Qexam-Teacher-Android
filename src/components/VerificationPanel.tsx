import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info, ShieldCheck, Sparkles, StopCircle, XCircle } from "lucide-react";
import { Badge, Button, Card, EmptyState, ProgressBar, SectionHeader } from "./ui";
import { AiGate } from "./AiGate";
import { useAiAction } from "./useAiAction";
import { useProjectStore } from "../store/projectStore";
import { verifyQuality } from "../lib/gemini/tasks";
import { toast } from "../store/uiStore";
import { formatDateTime } from "../lib/utils";
import type { VerificationReport, VerifySeverity } from "../lib/types";

const CHECK_ITEMS = [
  "원문과 요약의 의미 일치",
  "해석 누락 여부",
  "영어 문맥 오류",
  "문법 오류",
  "단어 뜻의 적절성",
  "빈칸 정답의 명확성",
  "순서 배열의 논리적 타당성",
  "답안지와 문제의 일치 여부",
];

const SEVERITY_STYLES: Record<VerifySeverity, { tone: "red" | "amber" | "blue"; icon: typeof Info; label: string }> = {
  error: { tone: "red", icon: XCircle, label: "오류" },
  warning: { tone: "amber", icon: AlertTriangle, label: "경고" },
  info: { tone: "blue", icon: Info, label: "참고" },
};

export function VerificationPanel() {
  const project = useProjectStore((state) => state.project);
  const update = useProjectStore((state) => state.update);
  const { busy, progress, run, cancel } = useAiAction();
  const [confirmRun, setConfirmRun] = useState(false);

  const report: VerificationReport | null = project?.verification ?? null;
  if (!project) return null;

  const hasMaterial = Boolean(project.analysis || project.workbook || project.easy || project.vocab);

  async function generate() {
    if (!project) return;
    setConfirmRun(false);
    await run("품질 검증", async (signal, onProgress) => {
      const result = await verifyQuality({
        passageText: project.passage.text,
        analysis: project.analysis,
        easy: project.easy,
        vocab: project.vocab,
        workbook: project.workbook,
        answerKey: project.answerKey,
        options: { signal, onProgress },
      });
      update((local) => {
        local.verification = result.report;
      });
      toast.success(
        "검증을 완료했습니다.",
        `결과: ${result.report.overall.toUpperCase()} · 의견 ${result.report.issues.length}건`,
      );
    });
  }

  return (
    <AiGate>
      <div className="scroll-area h-full px-6 py-6">
        <div className="mx-auto max-w-4xl">
          <SectionHeader
            title="AI 품질 검증"
            description="생성한 자료를 별도의 검증 요청으로 점검합니다. 검증은 원본을 자동 수정하지 않고 제안만 보여줍니다."
            actions={
              <>
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                  loading={busy === "품질 검증"}
                  onClick={() => setConfirmRun(true)}
                  disabled={!hasMaterial}
                >
                  {report ? "다시 검증" : "검증 실행"}
                </Button>
                {busy ? (
                  <Button size="sm" variant="ghost" icon={<StopCircle className="h-3.5 w-3.5" />} onClick={cancel}>
                    취소
                  </Button>
                ) : null}
              </>
            }
          />

          {busy ? (
            <div className="mt-4">
              <p className="text-xs font-medium text-brand-700">{progress || "자료를 검증하는 중…"}</p>
              <ProgressBar value={60} className="mt-1.5" />
            </div>
          ) : null}

          {confirmRun ? (
            <Card className="mt-4 border-brand-200 bg-brand-50/60 p-4">
              <p className="text-sm font-bold text-brand-900">검증을 실행할까요?</p>
              <p className="mt-1 text-xs leading-relaxed text-brand-800">
                검증 요청도 Gemini 사용량을 소비합니다. 무료 모델은 무료 한도를, 유료 모델 허용 시에는
                설정한 예산을 사용합니다. 한도에 도달하면 다른 모델로 자동 전환되거나 예산 초과로 차단됩니다.
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="primary" onClick={() => void generate()}>
                  검증 실행
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRun(false)}>
                  취소
                </Button>
              </div>
            </Card>
          ) : null}

          <Card className="mt-4 p-4">
            <p className="text-sm font-bold text-slate-800">검증 항목</p>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {CHECK_ITEMS.map((item) => (
                <div key={item} className="flex items-center gap-1.5 text-xs text-slate-600">
                  <ShieldCheck className="h-3.5 w-3.5 text-brand-500" />
                  {item}
                </div>
              ))}
            </div>
          </Card>

          {!report ? (
            <div className="mt-5">
              <EmptyState
                icon={<ShieldCheck className="h-8 w-8" />}
                title="검증 결과가 없습니다"
                description={hasMaterial ? "‘검증 실행’을 눌러 현재 자료를 점검하세요." : "먼저 분석·워크북 등을 생성하세요."}
              />
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={report.overall === "pass" ? "green" : report.overall === "fail" ? "red" : "amber"}>
                    {report.overall === "pass" ? "통과" : report.overall === "fail" ? "오류 발견" : "검토 권장"}
                  </Badge>
                  <Badge tone="slate">모델 {report.modelId}</Badge>
                  <span className="text-[11px] text-slate-500">{formatDateTime(report.createdAt)}</span>
                  <Badge tone="slate">의견 {report.issues.length}건</Badge>
                </div>
                <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-slate-700">{report.summary}</p>
              </Card>

              {report.issues.length ? (
                report.issues.map((issue, index) => {
                  const style = SEVERITY_STYLES[issue.severity];
                  const Icon = style.icon;
                  return (
                    <Card key={index} className="p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={style.tone}>
                          <Icon className="h-3 w-3" />
                          {style.label}
                        </Badge>
                        <span className="text-xs font-semibold text-slate-800">{issue.category}</span>
                        {issue.target ? (
                          <span className="text-[11px] text-slate-500">· {issue.target}</span>
                        ) : null}
                      </div>
                      <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-slate-700">{issue.message}</p>
                      {issue.suggestion ? (
                        <div className="mt-2 rounded-lg bg-brand-50/70 p-2.5">
                          <p className="text-[10px] font-semibold text-brand-700">수정 제안</p>
                          <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-brand-900">
                            {issue.suggestion}
                          </p>
                        </div>
                      ) : null}
                    </Card>
                  );
                })
              ) : (
                <Card className="flex items-center gap-2 p-4">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <p className="text-xs text-slate-600">검증에서 발견된 문제가 없습니다.</p>
                </Card>
              )}

              <p className="text-[10px] leading-relaxed text-slate-400">
                검증 결과는 자동으로 원본 자료에 적용되지 않습니다. 필요한 부분만 직접 수정하세요.
              </p>
            </div>
          )}
        </div>
      </div>
    </AiGate>
  );
}
