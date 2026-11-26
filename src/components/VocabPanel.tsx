import { useState } from "react";
import { FileText, ListChecks, Shuffle, Sparkles, StopCircle } from "lucide-react";
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
  Select,
  Textarea,
  Toggle,
} from "./ui";
import { AiGate } from "./AiGate";
import { useAiAction } from "./useAiAction";
import { useLocalDraft } from "./useLocalDraft";
import { useProjectStore } from "../store/projectStore";
import { createVocabSet, shuffle as shuffleArray } from "../lib/gemini/tasks";
import { toast } from "../store/uiStore";
import { composeDocument } from "../lib/compose";
import { formatDateTime, nowIso, uid } from "../lib/utils";
import type { Difficulty, VocabDirection, VocabSet } from "../lib/types";

const COUNTS = [10, 15, 20, 25, 30];

export function VocabPanel() {
  const project = useProjectStore((state) => state.project);
  const update = useProjectStore((state) => state.update);
  const applyPages = useProjectStore((state) => state.applyPages);
  const setTab = useProjectStore((state) => state.setTab);
  const { busy, progress, run, cancel } = useAiAction();

  const existing = project?.vocab ?? null;
  const { draft, setDraft, dirty } = useLocalDraft<VocabSet>(existing, existing?.createdAt ?? null);

  const [count, setCount] = useState(15);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [direction, setDirection] = useState<VocabDirection>("en-ko");
  const [shuffle, setShuffle] = useState(true);

  if (!project) return null;

  async function generate() {
    const target = project;
    if (!target) return;
    await run("단어 시험 생성", async (signal, onProgress) => {
      const result = await createVocabSet(
        target.passage.text,
        { count, difficulty, direction, shuffle },
        { signal, onProgress },
      );
      update((local) => {
        local.vocab = result.vocab;
      });
      toast.success("단어를 선정했습니다.", `${result.vocab.items.length}개 · 모델 ${result.modelId}`);
    });
  }

  function save() {
    if (!draft) return;
    update((local) => {
      local.vocab = { ...draft, editedAt: nowIso() };
    });
    toast.success("단어 목록을 저장했습니다.");
  }

  function sendToEditor(withAnswers: boolean) {
    const target = project;
    if (!target?.vocab) return;
    const pages = composeDocument(target, withAnswers ? "vocabAnswers" : "vocab");
    applyPages([...target.pages, ...pages]);
    setTab("editor");
    toast.success("단어 시험을 문서로 보냈습니다.", `${pages.length}페이지 추가`);
  }

  function patch(partial: Partial<VocabSet>) {
    setDraft((previous) => (previous ? { ...previous, ...partial } : previous));
  }

  const selectedCount = draft?.items.filter((item) => item.selected).length ?? 0;

  return (
    <AiGate>
      <div className="scroll-area h-full px-6 py-6">
        <div className="mx-auto max-w-4xl">
          <SectionHeader
            title="영어 단어 시험"
            description="지문에서 실제로 사용된 의미를 기준으로 핵심 어휘를 선정합니다."
            actions={
              <>
                {draft ? (
                  <>
                    <Button size="sm" variant="secondary" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => sendToEditor(false)}>
                      학생용 문서
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => sendToEditor(true)}>
                      정답 문서
                    </Button>
                  </>
                ) : null}
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                  loading={busy === "단어 시험 생성"}
                  onClick={() => void generate()}
                >
                  {existing ? "다시 선정" : "단어 선정"}
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
            <div className="flex flex-wrap items-end gap-3">
              <Field label="문항 수">
                <Select value={String(count)} onChange={(event) => setCount(Number(event.target.value))} className="w-24">
                  {COUNTS.map((value) => (
                    <option key={value} value={value}>
                      {value}개
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="방향">
                <SegmentedControl
                  value={direction}
                  onChange={(value) => {
                    setDirection(value);
                    if (draft) patch({ direction: value });
                  }}
                  options={[
                    { value: "en-ko", label: "영어 → 한글" },
                    { value: "ko-en", label: "한글 → 영어" },
                  ]}
                />
              </Field>
              <Field label="난이도">
                <SegmentedControl
                  value={difficulty}
                  onChange={setDifficulty}
                  options={[
                    { value: "easy", label: "쉬움" },
                    { value: "medium", label: "보통" },
                    { value: "hard", label: "어려움" },
                  ]}
                />
              </Field>
              <div className="pb-1">
                <Toggle checked={shuffle} onChange={setShuffle} label="순서 섞기" />
              </div>
              {draft ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  icon={<Shuffle className="h-3.5 w-3.5" />}
                  onClick={() => {
                    patch({ items: shuffleArray(draft.items) });
                    toast.info("단어 순서를 섞었습니다.", "저장 버튼을 눌러 반영하세요.");
                  }}
                >
                  순서 섞기
                </Button>
              ) : null}
            </div>
          </Card>

          {busy ? (
            <div className="mt-4">
              <p className="text-xs font-medium text-brand-700">{progress || "어휘를 고르는 중…"}</p>
              <ProgressBar value={40} className="mt-1.5" />
            </div>
          ) : null}

          {!draft ? (
            <div className="mt-5">
              <EmptyState
                icon={<ListChecks className="h-8 w-8" />}
                title="아직 단어 목록이 없습니다"
                description="문항 수와 난이도를 정하고 ‘단어 선정’을 눌러 주세요."
              />
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                <Badge tone="blue">모델 {existing?.modelId}</Badge>
                <span>생성 {formatDateTime(existing?.createdAt)}</span>
                <Badge tone="slate">
                  선택 {selectedCount}/{draft.items.length}
                </Badge>
                {dirty ? <Badge tone="amber">저장되지 않은 수정</Badge> : null}
                <div className="ml-auto flex gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      patch({
                        items: [
                          ...draft.items,
                          {
                            id: uid("voc"),
                            word: "",
                            meaning: "",
                            partOfSpeech: "",
                            context: "",
                            selected: true,
                          },
                        ],
                      })
                    }
                  >
                    + 단어 추가
                  </Button>
                  {dirty ? (
                    <Button size="sm" variant="primary" onClick={save}>
                      수정 저장
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="w-10 px-2 py-2">선택</th>
                      <th className="px-2 py-2">단어</th>
                      <th className="px-2 py-2">뜻</th>
                      <th className="px-2 py-2">품사</th>
                      <th className="px-2 py-2">문맥</th>
                      <th className="w-10 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draft.items.map((item, index) => (
                      <tr key={item.id} className={item.selected ? "" : "opacity-50"}>
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={item.selected}
                            onChange={(event) => {
                              const items = [...draft.items];
                              items[index] = { ...item, selected: event.target.checked };
                              patch({ items });
                            }}
                            className="h-3.5 w-3.5 accent-brand-600"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={item.word}
                            className="h-8 py-1 text-xs"
                            onChange={(event) => {
                              const items = [...draft.items];
                              items[index] = { ...item, word: event.target.value };
                              patch({ items });
                            }}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={item.meaning}
                            className="h-8 py-1 text-xs"
                            onChange={(event) => {
                              const items = [...draft.items];
                              items[index] = { ...item, meaning: event.target.value };
                              patch({ items });
                            }}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={item.partOfSpeech}
                            className="h-8 w-20 py-1 text-xs"
                            onChange={(event) => {
                              const items = [...draft.items];
                              items[index] = { ...item, partOfSpeech: event.target.value };
                              patch({ items });
                            }}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={item.context}
                            className="h-8 py-1 text-xs"
                            onChange={(event) => {
                              const items = [...draft.items];
                              items[index] = { ...item, context: event.target.value };
                              patch({ items });
                            }}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => patch({ items: draft.items.filter((_, i) => i !== index) })}
                          >
                            삭제
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Card className="p-4">
                <Field label="시험지 안내문 (선택)" hint="문서로 보낼 때 함께 출력할 안내문입니다.">
                  <Textarea
                    rows={2}
                    value={draft.direction === "en-ko" ? "다음 영어 단어의 뜻을 쓰시오." : "다음 뜻에 해당하는 영어 단어를 쓰시오."}
                    readOnly
                  />
                </Field>
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
