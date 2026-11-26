import { useEffect, useMemo, useState } from "react";
import { FileText, ListChecks, RefreshCw, Sparkles, StopCircle } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  ProgressBar,
  SectionHeader,
  Textarea,
} from "./ui";
import { AiGate } from "./AiGate";
import { useAiAction } from "./useAiAction";
import { useProjectStore } from "../store/projectStore";
import { useAiStore } from "../store/aiStore";
import { analysisPlan, analyzePassage } from "../lib/gemini/tasks";
import { toast } from "../store/uiStore";
import { composeDocument } from "../lib/compose";
import { formatDateTime, nowIso } from "../lib/utils";
import type { PassageAnalysis } from "../lib/types";

export function AnalysisPanel() {
  const project = useProjectStore((state) => state.project);
  const update = useProjectStore((state) => state.update);
  const applyPages = useProjectStore((state) => state.applyPages);
  const setTab = useProjectStore((state) => state.setTab);
  const { busy, progress, run, cancel } = useAiAction();
  const models = useAiStore((state) => state.models);
  const passageText = project?.passage.text ?? "";
  const plan = useMemo(() => analysisPlan(passageText, models), [passageText, models]);

  const analysis = project?.analysis ?? null;
  const [draft, setDraft] = useState<PassageAnalysis | null>(analysis);

  useEffect(() => {
    setDraft(analysis);
  }, [analysis?.createdAt]);

  const dirty = useMemo(
    () => Boolean(draft && analysis && JSON.stringify(draft) !== JSON.stringify(analysis)),
    [draft, analysis],
  );

  if (!project) return null;
  const hasPassage = project.passage.text.trim().length > 0;

  async function generate() {
    const target = project;
    if (!target) return;
    await run("지문 분석", async (signal, onProgress) => {
      const result = await analyzePassage(target.passage.text, target.passage.title, {
        signal,
        onProgress,
      });
      update((local) => {
        local.analysis = result.analysis;
      });
      toast.success("지문 분석을 완료했습니다.", `사용 모델: ${result.modelId}`);
    });
  }

  function saveEdits() {
    if (!draft) return;
    update((local) => {
      local.analysis = { ...draft, editedAt: nowIso() };
    });
    toast.success("수정 내용을 저장했습니다.");
  }

  function sendToEditor() {
    const target = project;
    if (!target?.analysis) return;
    const pages = composeDocument(target, "analysis");
    applyPages([...target.pages, ...pages]);
    setTab("editor");
    toast.success("분석 결과를 문서 편집기로 보냈습니다.", `${pages.length}페이지 추가`);
  }

  function patch(partial: Partial<PassageAnalysis>) {
    setDraft((previous) => (previous ? { ...previous, ...partial } : previous));
  }

  return (
    <AiGate>
      <div className="scroll-area h-full px-6 py-6">
        <div className="mx-auto max-w-4xl">
          <SectionHeader
            title="지문 분석"
            description="주제·요지·논리 구조·문단별 역할을 정리합니다. 결과는 직접 수정할 수 있습니다."
            actions={
              <>
                {analysis ? (
                  <Button size="sm" variant="secondary" icon={<FileText className="h-3.5 w-3.5" />} onClick={sendToEditor}>
                    문서로 보내기
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                  loading={busy === "지문 분석"}
                  onClick={() => void generate()}
                  disabled={!hasPassage}
                >
                  {analysis ? "다시 분석" : "지문 분석 실행"}
                </Button>
                {busy ? (
                  <Button size="sm" variant="ghost" icon={<StopCircle className="h-3.5 w-3.5" />} onClick={cancel}>
                    취소
                  </Button>
                ) : null}
              </>
            }
          />

          {plan.needsChunking ? (
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] leading-relaxed text-blue-700">
              긴 지문입니다 (약 {plan.estimatedTokens.toLocaleString()} 토큰). 문단·문장 경계에서{" "}
              <b>{plan.chunkCount}개 구간</b>으로 나누어 순차 분석한 뒤 하나의 결과로 합칩니다. 구간별 결과는
              이 PC에 저장되어 실패하거나 한도를 초과해도 완료된 구간을 다시 요청하지 않습니다.
              {plan.modelInputLimit ? ` (모델 입력 한도 ${plan.modelInputLimit.toLocaleString()} 토큰)` : ""}
            </div>
          ) : null}

          {busy ? (
            <div className="mt-4">
              <p className="text-xs font-medium text-brand-700">{progress || "AI가 지문을 읽고 있습니다…"}</p>
              <ProgressBar value={progress ? 60 : 25} className="mt-1.5" />
            </div>
          ) : null}

          {!hasPassage ? (
            <Card className="mt-4 p-5">
              <p className="text-sm text-slate-600">지문이 비어 있습니다. ‘지문’ 탭에서 원문을 입력해 주세요.</p>
              <Button className="mt-3" size="sm" variant="secondary" onClick={() => setTab("passage")}>
                지문 입력으로 이동
              </Button>
            </Card>
          ) : null}

          {!analysis ? (
            <div className="mt-5">
              <EmptyState
                icon={<ListChecks className="h-8 w-8" />}
                title="아직 분석 결과가 없습니다"
                description="‘지문 분석 실행’을 누르면 설정한 정책과 예산에 맞는 Gemini 모델이 자동 선택됩니다."
              />
            </div>
          ) : draft ? (
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                <Badge tone="blue">모델 {analysis.modelId}</Badge>
                {analysis.chunkCount && analysis.chunkCount > 1 ? (
                  <Badge tone="slate">{analysis.chunkCount}구간 통합</Badge>
                ) : null}
                <span>생성 {formatDateTime(analysis.createdAt)}</span>
                {analysis.editedAt ? <span>· 수정 {formatDateTime(analysis.editedAt)}</span> : null}
                {dirty ? <Badge tone="amber">저장되지 않은 수정</Badge> : null}
                <div className="ml-auto flex gap-1.5">
                  <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={generate}>
                    재분석
                  </Button>
                  {dirty ? (
                    <Button size="sm" variant="primary" onClick={saveEdits}>
                      수정 저장
                    </Button>
                  ) : null}
                </div>
              </div>

              <Card className="p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="제목">
                    <Input value={draft.title} onChange={(event) => patch({ title: event.target.value })} />
                  </Field>
                  <Field label="주제">
                    <Input value={draft.topic} onChange={(event) => patch({ topic: event.target.value })} />
                  </Field>
                </div>
                <Field label="요지" className="mt-4">
                  <Textarea rows={3} value={draft.gist} onChange={(event) => patch({ gist: event.target.value })} />
                </Field>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="한 줄 요약">
                    <Input
                      value={draft.oneLineSummary}
                      onChange={(event) => patch({ oneLineSummary: event.target.value })}
                    />
                  </Field>
                  <Field label="핵심 주장">
                    <Input value={draft.thesis} onChange={(event) => patch({ thesis: event.target.value })} />
                  </Field>
                </div>
              </Card>

              <Card className="p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-800">핵심 근거</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => patch({ keyEvidence: [...draft.keyEvidence, ""] })}
                  >
                    + 근거 추가
                  </Button>
                </div>
                <div className="mt-2 space-y-2">
                  {draft.keyEvidence.map((evidence, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <span className="mt-2 w-4 text-[11px] text-slate-400">{index + 1}</span>
                      <Textarea
                        rows={2}
                        value={evidence}
                        onChange={(event) => {
                          const keyEvidence = [...draft.keyEvidence];
                          keyEvidence[index] = event.target.value;
                          patch({ keyEvidence });
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => patch({ keyEvidence: draft.keyEvidence.filter((_, i) => i !== index) })}
                      >
                        삭제
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-5">
                <p className="text-sm font-bold text-slate-800">주요 문장</p>
                <div className="mt-2 space-y-3">
                  {draft.keySentences.map((sentence, index) => (
                    <div key={index} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-start gap-2">
                        <span className="mt-2 w-4 text-[11px] text-slate-400">{index + 1}</span>
                        <div className="flex-1 space-y-2">
                          <Textarea
                            rows={2}
                            value={sentence.text}
                            onChange={(event) => {
                              const keySentences = [...draft.keySentences];
                              keySentences[index] = { ...sentence, text: event.target.value };
                              patch({ keySentences });
                            }}
                          />
                          <Input
                            value={sentence.note}
                            placeholder="문장의 역할/의미"
                            onChange={(event) => {
                              const keySentences = [...draft.keySentences];
                              keySentences[index] = { ...sentence, note: event.target.value };
                              patch({ keySentences });
                            }}
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            patch({ keySentences: draft.keySentences.filter((_, i) => i !== index) })
                          }
                        >
                          삭제
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-5">
                <p className="text-sm font-bold text-slate-800">문단별 정리</p>
                <div className="mt-2 space-y-3">
                  {draft.paragraphs.map((paragraph, index) => (
                    <div key={index} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={paragraph.index}
                          className="w-16"
                          onChange={(event) => {
                            const paragraphs = [...draft.paragraphs];
                            paragraphs[index] = { ...paragraph, index: Number(event.target.value) || index + 1 };
                            patch({ paragraphs });
                          }}
                        />
                        <Input
                          value={paragraph.role}
                          placeholder="문단 역할 (도입, 근거, 반박…)"
                          className="flex-1"
                          onChange={(event) => {
                            const paragraphs = [...draft.paragraphs];
                            paragraphs[index] = { ...paragraph, role: event.target.value };
                            patch({ paragraphs });
                          }}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => patch({ paragraphs: draft.paragraphs.filter((_, i) => i !== index) })}
                        >
                          삭제
                        </Button>
                      </div>
                      <Textarea
                        rows={3}
                        className="mt-2"
                        value={paragraph.content}
                        onChange={(event) => {
                          const paragraphs = [...draft.paragraphs];
                          paragraphs[index] = { ...paragraph, content: event.target.value };
                          patch({ paragraphs });
                        }}
                      />
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-5">
                <p className="text-sm font-bold text-slate-800">논리 구조</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  지문에 맞는 구조를 사용합니다. 억지로 분류하지 않으며, 필요 없으면 비워 두세요.
                </p>
                <Field label="구조 이름" className="mt-3">
                  <Input
                    value={draft.structureLabel ?? ""}
                    placeholder="예: 문제 → 원인 → 해결"
                    onChange={(event) => patch({ structureLabel: event.target.value || null })}
                  />
                </Field>
                <div className="mt-3 space-y-2">
                  {draft.structureSteps.map((step, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        value={step}
                        onChange={(event) => {
                          const structureSteps = [...draft.structureSteps];
                          structureSteps[index] = event.target.value;
                          patch({ structureSteps });
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => patch({ structureSteps: draft.structureSteps.filter((_, i) => i !== index) })}
                      >
                        삭제
                      </Button>
                    </div>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => patch({ structureSteps: [...draft.structureSteps, ""] })}>
                    + 단계 추가
                  </Button>
                </div>
              </Card>

              {dirty ? (
                <div className="sticky bottom-3 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
                  <span className="text-xs font-medium text-amber-800">수정한 내용이 저장되지 않았습니다.</span>
                  <Button size="sm" variant="primary" onClick={saveEdits}>
                    수정 저장
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </AiGate>
  );
}
