import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileText, Sparkles, StopCircle } from "lucide-react";
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
import { useLocalDraft } from "./useLocalDraft";
import { useProjectStore } from "../store/projectStore";
import { createAnswerKey } from "../lib/gemini/tasks";
import { toast } from "../store/uiStore";
import { composeDocument } from "../lib/compose";
import { formatDateTime, nowIso } from "../lib/utils";
import { PROBLEM_KIND_LABELS, type AnswerKey } from "../lib/types";

export function AnswersPanel() {
  const project = useProjectStore((state) => state.project);
  const update = useProjectStore((state) => state.update);
  const applyPages = useProjectStore((state) => state.applyPages);
  const setTab = useProjectStore((state) => state.setTab);
  const { busy, progress, run, cancel } = useAiAction();

  const existing = project?.answerKey ?? null;
  const { draft, setDraft, dirty } = useLocalDraft<AnswerKey>(existing, existing?.createdAt ?? null);

  const workbook = project?.workbook ?? null;
  const problemMap = useMemo(
    () => new Map(workbook?.problems.map((problem) => [problem.id, problem]) ?? []),
    [workbook],
  );

  if (!project) return null;

  const stale = Boolean(draft && workbook && draft.sourceWorkbookId !== workbook.id);
  const consistency = checkConsistency(draft, workbook?.problems.map((problem) => problem.id) ?? []);

  async function generate() {
    const target = project;
    const currentWorkbook = workbook;
    if (!target || !currentWorkbook) return;
    await run("답안지 생성", async (signal, onProgress) => {
      const result = await createAnswerKey(target.passage.text, currentWorkbook, { signal, onProgress });
      update((local) => {
        local.answerKey = result.answerKey;
      });
      toast.success(
        "교사용 답안지를 만들었습니다.",
        `${result.answerKey.entries.length}개 정답 · 누락 ${result.answerKey.missingProblemIds.length}건`,
      );
    });
  }

  function save() {
    if (!draft) return;
    update((local) => {
      local.answerKey = { ...draft };
    });
    toast.success("답안지를 저장했습니다.");
  }

  function recheck() {
    if (!draft || !workbook) return;
    const ids = workbook.problems.map((problem) => problem.id);
    const answered = new Set(draft.entries.map((entry) => entry.problemId));
    const missingProblemIds = ids.filter((id) => !answered.has(id));
    const known = new Set(ids);
    const orphanProblemIds = draft.entries
      .filter((entry) => !known.has(entry.problemId))
      .map((entry) => entry.problemId);
    setDraft({
      ...draft,
      sourceWorkbookId: workbook.id,
      missingProblemIds,
      orphanProblemIds,
    });
    toast.info(
      "연결 상태를 확인했습니다.",
      `누락 ${missingProblemIds.length}건 · 연결되지 않은 답안 ${orphanProblemIds.length}건`,
    );
  }

  function sendToEditor() {
    const target = project;
    if (!target?.answerKey) return;
    const pages = composeDocument(target, "answers");
    applyPages([...target.pages, ...pages]);
    setTab("editor");
    toast.success("답안지를 문서로 보냈습니다.", `${pages.length}페이지 추가`);
  }

  return (
    <AiGate>
      <div className="scroll-area h-full px-6 py-6">
        <div className="mx-auto max-w-4xl">
          <SectionHeader
            title="교사용 답안지"
            description="학생용 문제와 동일한 문제 ID를 사용합니다. 문제를 수정하면 연결 상태를 다시 확인하세요."
            actions={
              <>
                {draft ? (
                  <Button size="sm" variant="secondary" icon={<FileText className="h-3.5 w-3.5" />} onClick={sendToEditor}>
                    문서로 보내기
                  </Button>
                ) : null}
                {draft ? (
                  <Button size="sm" variant="secondary" icon={<ClipboardCheck className="h-3.5 w-3.5" />} onClick={recheck}>
                    연결 상태 확인
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                  loading={busy === "답안지 생성"}
                  onClick={() => void generate()}
                  disabled={!workbook}
                >
                  {existing ? "답안지 다시 생성" : "답안지 생성"}
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
              <p className="text-xs font-medium text-brand-700">{progress || "정답과 해설을 정리하는 중…"}</p>
              <ProgressBar value={50} className="mt-1.5" />
            </div>
          ) : null}

          {!workbook ? (
            <div className="mt-5">
              <EmptyState
                icon={<ClipboardCheck className="h-8 w-8" />}
                title="먼저 워크북을 만들어야 합니다"
                description="답안지는 워크북의 문제 ID와 연결되므로 워크북 생성 후 만들 수 있습니다."
                action={
                  <Button size="sm" variant="primary" onClick={() => setTab("workbook")}>
                    워크북으로 이동
                  </Button>
                }
              />
            </div>
          ) : !draft ? (
            <div className="mt-5">
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm font-semibold text-slate-800">워크북 {workbook.problems.length}문항이 준비되어 있습니다.</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    답안지 생성은 무료 사용량을 소비합니다. 필요한 경우에만 실행하세요.
                  </p>
                </div>
                <Button variant="primary" size="sm" onClick={() => void generate()}>
                  답안지 생성
                </Button>
              </Card>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                <Badge tone="blue">모델 {draft.modelId}</Badge>
                <span>생성 {formatDateTime(draft.createdAt)}</span>
                <Badge tone={consistency.ok ? "green" : "amber"}>
                  {consistency.ok ? "문제와 일치" : `연결 확인 필요 (${consistency.issues}건)`}
                </Badge>
                {stale ? <Badge tone="red">이전 워크북 기준</Badge> : null}
                {dirty ? <Badge tone="amber">저장되지 않은 수정</Badge> : null}
                {dirty ? (
                  <Button size="sm" variant="primary" className="ml-auto" onClick={save}>
                    수정 저장
                  </Button>
                ) : null}
              </div>

              {!consistency.ok || stale ? (
                <Card className="flex items-start gap-2 border-amber-200 bg-amber-50 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-600" />
                  <div className="flex-1 text-[11px] leading-relaxed text-amber-800">
                    {stale
                      ? "워크북이 다시 생성되어 답안지가 이전 문제 ID를 참조하고 있습니다. ‘답안지 다시 생성’을 권장합니다."
                      : "일부 문제에 답안이 없거나, 삭제된 문제의 답안이 남아 있습니다."}
                    {draft.missingProblemIds.length ? (
                      <p className="mt-1">누락된 문제: {draft.missingProblemIds.length}개</p>
                    ) : null}
                    {draft.orphanProblemIds.length ? (
                      <p>연결되지 않은 답안: {draft.orphanProblemIds.length}개</p>
                    ) : null}
                  </div>
                </Card>
              ) : (
                <Card className="flex items-center gap-2 border-emerald-200 bg-emerald-50 p-3">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <p className="text-[11px] text-emerald-800">
                    모든 문제에 답안이 연결되어 있고, 문제 ID가 일치합니다.
                  </p>
                </Card>
              )}

              {draft.entries.map((entry, index) => {
                const problem = problemMap.get(entry.problemId);
                return (
                  <Card key={entry.problemId} className="p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-50 text-[11px] font-bold text-brand-700">
                        {problem?.number ?? index + 1}
                      </span>
                      <Badge tone="slate">{problem ? PROBLEM_KIND_LABELS[problem.kind] : "알 수 없는 문제"}</Badge>
                      <span className="text-[10px] font-mono text-slate-400">{entry.problemId}</span>
                      {!problem ? <Badge tone="red">문제 없음</Badge> : null}
                    </div>
                    {problem ? (
                      <p className="mt-2 text-xs leading-relaxed text-slate-600">{problem.prompt}</p>
                    ) : null}
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="정답">
                        <Input
                          value={entry.answer}
                          onChange={(event) => {
                            const entries = [...draft.entries];
                            entries[index] = { ...entry, answer: event.target.value };
                            setDraft({ ...draft, entries });
                          }}
                        />
                      </Field>
                      <Field label="허용 대체 답안 (쉼표 구분)">
                        <Input
                          value={entry.alternatives.join(", ")}
                          onChange={(event) => {
                            const entries = [...draft.entries];
                            entries[index] = {
                              ...entry,
                              alternatives: event.target.value
                                .split(",")
                                .map((value) => value.trim())
                                .filter(Boolean),
                            };
                            setDraft({ ...draft, entries });
                          }}
                        />
                      </Field>
                    </div>
                    <Field label="해설" className="mt-3">
                      <Textarea
                        rows={2}
                        value={entry.explanation}
                        onChange={(event) => {
                          const entries = [...draft.entries];
                          entries[index] = { ...entry, explanation: event.target.value };
                          setDraft({ ...draft, entries });
                        }}
                      />
                    </Field>
                    <Field label="정답의 근거" className="mt-3">
                      <Textarea
                        rows={2}
                        value={entry.evidence}
                        onChange={(event) => {
                          const entries = [...draft.entries];
                          entries[index] = { ...entry, evidence: event.target.value };
                          setDraft({ ...draft, entries });
                        }}
                      />
                    </Field>
                  </Card>
                );
              })}

              {draft.notes.length ? (
                <Card className="p-4">
                  <p className="text-sm font-bold text-slate-800">전체 참고 사항</p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-600">
                    {draft.notes.map((note, index) => (
                      <li key={index}>{note}</li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              {draft.missingProblemIds.length ? (
                <Card className="p-4">
                  <p className="text-sm font-bold text-red-700">답안이 없는 문제</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {draft.missingProblemIds.map((id) => {
                      const problem = problemMap.get(id);
                      return (
                        <li key={id}>
                          #{problem?.number ?? "?"} {problem?.prompt.slice(0, 60) ?? id}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              ) : null}

              {dirty ? (
                <div className="sticky bottom-3 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
                  <span className="text-xs font-medium text-amber-800">수정한 내용이 저장되지 않았습니다.</span>
                  <Button size="sm" variant="primary" onClick={save}>
                    수정 저장
                  </Button>
                </div>
              ) : null}
            </div>
          )}

          <p className="mt-4 text-[10px] leading-relaxed text-slate-400">
            답안지 생성은 학생용 문제를 다시 만들지 않고 ID를 그대로 사용합니다. 문제를 수정한 뒤에는
            ‘연결 상태 확인’으로 누락·불일치를 확인하세요.
          </p>
          <p className="mt-1 text-[10px] text-slate-400">수정 시각 {formatDateTime(nowIso())}</p>
        </div>
      </div>
    </AiGate>
  );
}

function checkConsistency(
  answerKey: AnswerKey | null,
  problemIds: string[],
): { ok: boolean; issues: number } {
  if (!answerKey) return { ok: true, issues: 0 };
  const answered = new Set(answerKey.entries.map((entry) => entry.problemId));
  const missing = problemIds.filter((id) => !answered.has(id)).length;
  const known = new Set(problemIds);
  const orphans = answerKey.entries.filter((entry) => !known.has(entry.problemId)).length;
  return { ok: missing === 0 && orphans === 0, issues: missing + orphans };
}
