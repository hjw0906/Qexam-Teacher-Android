import { useState } from "react";
import { ClipboardList, FileText, ListChecks, Plus, Sparkles, StopCircle } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  ProgressBar,
  SectionHeader,
  SegmentedControl,
  Textarea,
  Toggle,
} from "./ui";
import { AiGate } from "./AiGate";
import { useAiAction } from "./useAiAction";
import { useLocalDraft } from "./useLocalDraft";
import { useProjectStore } from "../store/projectStore";
import { createWorkbook } from "../lib/gemini/tasks";
import { toast } from "../store/uiStore";
import { composeDocument } from "../lib/compose";
import { formatDateTime, nowIso, uid } from "../lib/utils";
import {
  PROBLEM_KIND_LABELS,
  type Difficulty,
  type ProblemCounts,
  type ProblemKind,
  type Workbook,
  type WorkbookProblem,
} from "../lib/types";

const KINDS = Object.keys(PROBLEM_KIND_LABELS) as ProblemKind[];

const DEFAULT_COUNTS: ProblemCounts = {
  lineTranslation: 3,
  sentenceOrder: 2,
  paragraphOrder: 1,
  koreanBlank: 2,
  englishBlank: 2,
  vocabBlank: 2,
  sentenceCompletion: 1,
};

export function WorkbookPanel() {
  const project = useProjectStore((state) => state.project);
  const update = useProjectStore((state) => state.update);
  const applyPages = useProjectStore((state) => state.applyPages);
  const setTab = useProjectStore((state) => state.setTab);
  const { busy, progress, run, cancel } = useAiAction();

  const existing = project?.workbook ?? null;
  const { draft, setDraft, dirty } = useLocalDraft<Workbook>(existing, existing?.createdAt ?? null);

  const [counts, setCounts] = useState<ProblemCounts>(existing?.counts ?? DEFAULT_COUNTS);
  const [difficulty, setDifficulty] = useState<Difficulty>(existing?.difficulty ?? "medium");
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!project) return null;
  const totalRequested = Object.values(counts).reduce((sum, value) => sum + value, 0);

  async function generate() {
    const target = project;
    if (!target) return;
    if (totalRequested === 0) {
      toast.warning("문제 개수를 하나 이상 입력해 주세요.");
      return;
    }
    await run("워크북 생성", async (signal, onProgress) => {
      const result = await createWorkbook(target.passage.text, target.analysis, counts, difficulty, {
        signal,
        onProgress,
      });
      update((local) => {
        local.workbook = result.workbook;
        if (local.answerKey && local.answerKey.sourceWorkbookId !== result.workbook.id) {
          local.answerKey = local.answerKey;
        }
      });
      toast.success(
        "워크북을 생성했습니다.",
        `${result.workbook.problems.length}문항 · 검토 필요 ${result.workbook.problems.filter((p) => p.needsReview).length}건`,
      );
    });
  }

  function save() {
    if (!draft) return;
    update((local) => {
      local.workbook = { ...draft, editedAt: nowIso() };
    });
    toast.success("워크북 수정 내용을 저장했습니다.");
  }

  function sendToEditor(withAnswers: boolean) {
    const target = project;
    if (!target?.workbook) return;
    const pages = composeDocument(target, withAnswers ? "answers" : "workbook");
    applyPages([...target.pages, ...pages]);
    setTab("editor");
    toast.success("워크북을 문서로 보냈습니다.", `${pages.length}페이지 추가`);
  }

  function patchProblem(problemId: string, partial: Partial<WorkbookProblem>) {
    setDraft((previous) =>
      previous
        ? {
            ...previous,
            problems: previous.problems.map((problem) =>
              problem.id === problemId ? { ...problem, ...partial } : problem,
            ),
          }
        : previous,
    );
  }

  return (
    <AiGate>
      <div className="scroll-area h-full px-6 py-6">
        <div className="mx-auto max-w-4xl">
          <SectionHeader
            title="워크북 제작"
            description="유형별 문제 수를 지정하면 지문에 맞춰 문제를 만들고, 각 문제에 고유 ID를 부여합니다."
            actions={
              <>
                {draft ? (
                  <>
                    <Button size="sm" variant="secondary" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => sendToEditor(false)}>
                      학생용 문서
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => sendToEditor(true)}>
                      답안 포함 문서
                    </Button>
                    <Button size="sm" variant="ghost" icon={<ListChecks className="h-3.5 w-3.5" />} onClick={() => setTab("answers")}>
                      답안지 만들기
                    </Button>
                  </>
                ) : null}
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                  loading={busy === "워크북 생성"}
                  onClick={() => void generate()}
                >
                  {existing ? "다시 생성" : "워크북 생성"}
                </Button>
                {busy ? (
                  <Button size="sm" variant="ghost" icon={<StopCircle className="h-3.5 w-3.5" />} onClick={cancel}>
                    취소
                  </Button>
                ) : null}
              </>
            }
          />

          <Card className="mt-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {KINDS.map((kind) => (
                <Field key={kind} label={PROBLEM_KIND_LABELS[kind]}>
                  <Input
                    type="number"
                    min={0}
                    max={12}
                    value={counts[kind]}
                    onChange={(event) =>
                      setCounts((previous) => ({
                        ...previous,
                        [kind]: Math.max(0, Math.min(12, Number(event.target.value) || 0)),
                      }))
                    }
                  />
                </Field>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <div>
                <span className="mr-2 text-xs font-semibold text-slate-600">난이도</span>
                <SegmentedControl
                  value={difficulty}
                  onChange={setDifficulty}
                  options={[
                    { value: "easy", label: "쉬움" },
                    { value: "medium", label: "보통" },
                    { value: "hard", label: "어려움" },
                  ]}
                />
              </div>
              <Badge tone="slate">요청 {totalRequested}문항</Badge>
              <p className="text-[11px] text-slate-500">
                무료 모델의 출력 한도를 고려해 한 번에 최대 40문항 이하를 권장합니다.
              </p>
            </div>
          </Card>

          {busy ? (
            <div className="mt-4">
              <p className="text-xs font-medium text-brand-700">{progress || "문제를 만드는 중…"}</p>
              <ProgressBar value={55} className="mt-1.5" />
            </div>
          ) : null}

          {!draft ? (
            <div className="mt-5">
              <EmptyState
                icon={<ClipboardList className="h-8 w-8" />}
                title="아직 워크북이 없습니다"
                description="유형별 문항 수를 정하고 ‘워크북 생성’을 눌러 주세요."
              />
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                <Badge tone="blue">모델 {existing?.modelId}</Badge>
                <span>생성 {formatDateTime(existing?.createdAt)}</span>
                <Badge tone="slate">{draft.problems.length}문항</Badge>
                {draft.problems.some((problem) => problem.needsReview) ? (
                  <Badge tone="amber">
                    검토 필요 {draft.problems.filter((problem) => problem.needsReview).length}건
                  </Badge>
                ) : null}
                {dirty ? <Badge tone="amber">저장되지 않은 수정</Badge> : null}
                <div className="ml-auto flex gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Plus className="h-3.5 w-3.5" />}
                    onClick={() =>
                      setDraft((previous) =>
                        previous
                          ? {
                              ...previous,
                              problems: [
                                ...previous.problems,
                                {
                                  id: uid("prob"),
                                  kind: "englishBlank",
                                  number: previous.problems.length + 1,
                                  prompt: "",
                                  segments: [],
                                  answer: "",
                                  alternatives: [],
                                  explanation: "",
                                  evidence: "",
                                  needsReview: true,
                                  sourceSentence: "",
                                },
                              ],
                            }
                          : previous,
                      )
                    }
                  >
                    문제 추가
                  </Button>
                  {dirty ? (
                    <Button size="sm" variant="primary" onClick={save}>
                      수정 저장
                    </Button>
                  ) : null}
                </div>
              </div>

              {draft.problems.map((problem) => {
                const open = expanded === problem.id;
                return (
                  <Card key={problem.id} className="overflow-hidden">
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 px-4 py-3 text-left hover:bg-slate-50"
                      onClick={() => setExpanded(open ? null : problem.id)}
                    >
                      <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-md bg-brand-50 text-[11px] font-bold text-brand-700">
                        {problem.number}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone="slate">{PROBLEM_KIND_LABELS[problem.kind]}</Badge>
                          {problem.needsReview ? <Badge tone="amber">검토 필요</Badge> : null}
                          <span className="text-[10px] font-mono text-slate-400">{problem.id}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-700">
                          {problem.prompt || "(문제 내용 없음)"}
                        </p>
                      </div>
                    </button>
                    {open ? (
                      <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3">
                        <Field label="문제 지시문/내용">
                          <Textarea
                            rows={3}
                            value={problem.prompt}
                            onChange={(event) => patchProblem(problem.id, { prompt: event.target.value })}
                          />
                        </Field>
                        {problem.kind === "sentenceOrder" || problem.kind === "paragraphOrder" ? (
                          <Field label="조각 (한 줄에 하나)" className="mt-3">
                            <Textarea
                              rows={4}
                              value={problem.segments.join("\n")}
                              onChange={(event) =>
                                patchProblem(problem.id, {
                                  segments: event.target.value.split("\n").filter((line) => line.trim()),
                                })
                              }
                            />
                          </Field>
                        ) : null}
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <Field label="정답">
                            <Input
                              value={problem.answer}
                              onChange={(event) => patchProblem(problem.id, { answer: event.target.value })}
                            />
                          </Field>
                          <Field label="허용 대체 답안 (쉼표 구분)">
                            <Input
                              value={problem.alternatives.join(", ")}
                              onChange={(event) =>
                                patchProblem(problem.id, {
                                  alternatives: event.target.value
                                    .split(",")
                                    .map((value) => value.trim())
                                    .filter(Boolean),
                                })
                              }
                            />
                          </Field>
                        </div>
                        <Field label="해설" className="mt-3">
                          <Textarea
                            rows={2}
                            value={problem.explanation}
                            onChange={(event) => patchProblem(problem.id, { explanation: event.target.value })}
                          />
                        </Field>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <Field label="근거 (지문 인용)">
                            <Textarea
                              rows={2}
                              value={problem.evidence}
                              onChange={(event) => patchProblem(problem.id, { evidence: event.target.value })}
                            />
                          </Field>
                          <Field label="원문 문장">
                            <Textarea
                              rows={2}
                              value={problem.sourceSentence}
                              onChange={(event) => patchProblem(problem.id, { sourceSentence: event.target.value })}
                            />
                          </Field>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <Toggle
                            checked={problem.needsReview}
                            onChange={(value) => patchProblem(problem.id, { needsReview: value })}
                            label="검토 필요 표시"
                            description="정답이 불명확하거나 복수 정답이 가능한 문제입니다."
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setDraft((previous) =>
                                previous
                                  ? {
                                      ...previous,
                                      problems: previous.problems
                                        .filter((item) => item.id !== problem.id)
                                        .map((item, index) => ({ ...item, number: index + 1 })),
                                    }
                                  : previous,
                              )
                            }
                          >
                            문제 삭제
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </Card>
                );
              })}

              {dirty ? (
                <div className="sticky bottom-3 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
                  <span className="text-xs font-medium text-amber-800">
                    문제를 수정했습니다. 저장하면 답안지 연결 상태를 다시 확인해야 합니다.
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setTab("answers")}>
                      답안지 연결 확인
                    </Button>
                    <Button size="sm" variant="primary" onClick={save}>
                      수정 저장
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </AiGate>
  );
}
