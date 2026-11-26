import { FileText, Sparkles, StopCircle, Wand2 } from "lucide-react";
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
import { createEasyExplanation } from "../lib/gemini/tasks";
import { toast } from "../store/uiStore";
import { composeDocument } from "../lib/compose";
import { formatDateTime, nowIso } from "../lib/utils";
import type { EasyExplanation } from "../lib/types";

export function EasyPanel() {
  const project = useProjectStore((state) => state.project);
  const update = useProjectStore((state) => state.update);
  const applyPages = useProjectStore((state) => state.applyPages);
  const setTab = useProjectStore((state) => state.setTab);
  const { busy, progress, run, cancel } = useAiAction();

  const existing = project?.easy ?? null;
  const { draft, setDraft, dirty } = useLocalDraft<EasyExplanation>(existing, existing?.createdAt ?? null);

  if (!project) return null;

  async function generate() {
    const target = project;
    if (!target) return;
    await run("쉬운 설명 생성", async (signal, onProgress) => {
      const result = await createEasyExplanation(target.passage.text, target.analysis, {
        signal,
        onProgress,
      });
      update((local) => {
        local.easy = result.easy;
      });
      toast.success("쉬운 설명을 생성했습니다.", `모델: ${result.modelId}`);
    });
  }

  function save() {
    if (!draft) return;
    update((local) => {
      local.easy = { ...draft, editedAt: nowIso() };
    });
    toast.success("수정 내용을 저장했습니다.");
  }

  function sendToEditor() {
    const target = project;
    if (!target?.easy) return;
    const pages = composeDocument(target, "easy");
    applyPages([...target.pages, ...pages]);
    setTab("editor");
    toast.success("쉬운 설명을 문서로 보냈습니다.", `${pages.length}페이지 추가`);
  }

  function patch(partial: Partial<EasyExplanation>) {
    setDraft((previous) => (previous ? { ...previous, ...partial } : previous));
  }

  return (
    <AiGate>
      <div className="scroll-area h-full px-6 py-6">
        <div className="mx-auto max-w-4xl">
          <SectionHeader
            title="쉬운 설명"
            description="문해력이 약한 학생을 위해 개념·배경지식·문단별 해설을 쉽게 풀어 씁니다."
            actions={
              <>
                {existing ? (
                  <Button size="sm" variant="secondary" icon={<FileText className="h-3.5 w-3.5" />} onClick={sendToEditor}>
                    문서로 보내기
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Wand2 className="h-3.5 w-3.5" />}
                  loading={busy === "쉬운 설명 생성"}
                  onClick={() => void generate()}
                >
                  {existing ? "다시 생성" : "쉬운 설명 생성"}
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
              <p className="text-xs font-medium text-brand-700">{progress || "학생 눈높이로 다시 쓰는 중…"}</p>
              <ProgressBar value={45} className="mt-1.5" />
            </div>
          ) : null}

          {!existing || !draft ? (
            <div className="mt-5">
              <EmptyState
                icon={<Sparkles className="h-8 w-8" />}
                title="쉬운 설명이 없습니다"
                description="지문 분석을 먼저 하면 더 정확한 설명이 생성됩니다. 생성 결과는 편집할 수 있습니다."
              />
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                <Badge tone="blue">모델 {existing.modelId}</Badge>
                <span>생성 {formatDateTime(existing.createdAt)}</span>
                {existing.editedAt ? <span>· 수정 {formatDateTime(existing.editedAt)}</span> : null}
                {dirty ? <Badge tone="amber">저장되지 않은 수정</Badge> : null}
                {dirty ? (
                  <Button size="sm" variant="primary" className="ml-auto" onClick={save}>
                    수정 저장
                  </Button>
                ) : null}
              </div>

              <Card className="p-5">
                <Field label="배경지식">
                  <Textarea rows={3} value={draft.background} onChange={(event) => patch({ background: event.target.value })} />
                </Field>
                <Field label="핵심 정리 (한 줄)" className="mt-4">
                  <Textarea rows={2} value={draft.summary} onChange={(event) => patch({ summary: event.target.value })} />
                </Field>
              </Card>

              <Card className="p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-800">어려운 개념</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => patch({ concepts: [...draft.concepts, { term: "", explanation: "" }] })}
                  >
                    + 개념 추가
                  </Button>
                </div>
                <div className="mt-2 space-y-3">
                  {draft.concepts.map((concept, index) => (
                    <div key={index} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex gap-2">
                        <Input
                          placeholder="개념"
                          value={concept.term}
                          onChange={(event) => {
                            const concepts = [...draft.concepts];
                            concepts[index] = { ...concept, term: event.target.value };
                            patch({ concepts });
                          }}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => patch({ concepts: draft.concepts.filter((_, i) => i !== index) })}
                        >
                          삭제
                        </Button>
                      </div>
                      <Textarea
                        rows={2}
                        className="mt-2"
                        placeholder="쉬운 설명"
                        value={concept.explanation}
                        onChange={(event) => {
                          const concepts = [...draft.concepts];
                          concepts[index] = { ...concept, explanation: event.target.value };
                          patch({ concepts });
                        }}
                      />
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-800">일상 속 사례</p>
                  <Button size="sm" variant="ghost" onClick={() => patch({ examples: [...draft.examples, ""] })}>
                    + 사례 추가
                  </Button>
                </div>
                <div className="mt-2 space-y-2">
                  {draft.examples.map((example, index) => (
                    <div key={index} className="flex gap-2">
                      <Textarea
                        rows={2}
                        value={example}
                        onChange={(event) => {
                          const examples = [...draft.examples];
                          examples[index] = event.target.value;
                          patch({ examples });
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => patch({ examples: draft.examples.filter((_, i) => i !== index) })}
                      >
                        삭제
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-5">
                <p className="text-sm font-bold text-slate-800">문단별 쉬운 해설</p>
                <div className="mt-2 space-y-3">
                  {draft.paragraphs.map((paragraph, index) => (
                    <div key={index}>
                      <div className="mb-1 flex items-center gap-2">
                        <Input
                          type="number"
                          className="w-16"
                          value={paragraph.index}
                          onChange={(event) => {
                            const paragraphs = [...draft.paragraphs];
                            paragraphs[index] = { ...paragraph, index: Number(event.target.value) || index + 1 };
                            patch({ paragraphs });
                          }}
                        />
                        <span className="text-xs text-slate-500">문단</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto"
                          onClick={() => patch({ paragraphs: draft.paragraphs.filter((_, i) => i !== index) })}
                        >
                          삭제
                        </Button>
                      </div>
                      <Textarea
                        rows={3}
                        value={paragraph.easy}
                        onChange={(event) => {
                          const paragraphs = [...draft.paragraphs];
                          paragraphs[index] = { ...paragraph, easy: event.target.value };
                          patch({ paragraphs });
                        }}
                      />
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-5">
                <p className="text-sm font-bold text-slate-800">어려운 문장 바꾸기</p>
                <div className="mt-2 space-y-3">
                  {draft.rewrittenSentences.map((sentence, index) => (
                    <div key={index} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[11px] font-semibold text-slate-500">원문</p>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            patch({ rewrittenSentences: draft.rewrittenSentences.filter((_, i) => i !== index) })
                          }
                        >
                          삭제
                        </Button>
                      </div>
                      <Textarea
                        rows={2}
                        value={sentence.original}
                        onChange={(event) => {
                          const rewrittenSentences = [...draft.rewrittenSentences];
                          rewrittenSentences[index] = { ...sentence, original: event.target.value };
                          patch({ rewrittenSentences });
                        }}
                      />
                      <p className="mt-2 text-[11px] font-semibold text-brand-600">쉬운 문장</p>
                      <Textarea
                        rows={2}
                        value={sentence.easy}
                        onChange={(event) => {
                          const rewrittenSentences = [...draft.rewrittenSentences];
                          rewrittenSentences[index] = { ...sentence, easy: event.target.value };
                          patch({ rewrittenSentences });
                        }}
                      />
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => patch({ rewrittenSentences: [...draft.rewrittenSentences, { original: "", easy: "" }] })}
                  >
                    + 문장 추가
                  </Button>
                </div>
              </Card>

              <Card className="p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-800">주요 용어</p>
                  <Button size="sm" variant="ghost" onClick={() => patch({ glossary: [...draft.glossary, { term: "", meaning: "", usage: "" }] })}>
                    + 용어 추가
                  </Button>
                </div>
                <div className="mt-2 space-y-2">
                  {draft.glossary.map((term, index) => (
                    <div key={index} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_1.4fr_1.4fr_auto]">
                      <Input
                        placeholder="용어"
                        value={term.term}
                        onChange={(event) => {
                          const glossary = [...draft.glossary];
                          glossary[index] = { ...term, term: event.target.value };
                          patch({ glossary });
                        }}
                      />
                      <Input
                        placeholder="뜻"
                        value={term.meaning}
                        onChange={(event) => {
                          const glossary = [...draft.glossary];
                          glossary[index] = { ...term, meaning: event.target.value };
                          patch({ glossary });
                        }}
                      />
                      <Input
                        placeholder="쓰임"
                        value={term.usage}
                        onChange={(event) => {
                          const glossary = [...draft.glossary];
                          glossary[index] = { ...term, usage: event.target.value };
                          patch({ glossary });
                        }}
                      />
                      <Button size="sm" variant="ghost" onClick={() => patch({ glossary: draft.glossary.filter((_, i) => i !== index) })}>
                        삭제
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>

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
        </div>
      </div>
    </AiGate>
  );
}
