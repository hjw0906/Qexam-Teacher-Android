import { useEffect, useState } from "react";
import { Sparkles, TriangleAlert } from "lucide-react";
import { Button, Card, Field, Input, SectionHeader, Select, Textarea } from "../components/ui";
import { IngestPanel } from "../components/IngestPanel";
import { useIngestStore } from "../store/ingestStore";
import { terminateOcr } from "../lib/ingest/recognize";
import { useProjectStore } from "../store/projectStore";
import { useAiStore } from "../store/aiStore";
import { toast } from "../store/uiStore";
import { detectLanguage } from "../lib/utils";
import type { IngestFile } from "../lib/ingest/types";
import type { Passage, PassageSource } from "../lib/types";

const AUTO_INSERT_LIMIT = 250_000;

function sourceFrom(entry: IngestFile): PassageSource {
  return {
    name: entry.name,
    kind: entry.kind === "image" ? "image" : entry.kind === "pdf" ? "pdf" : "txt",
    addedAt: entry.addedAt,
    size: entry.size,
    pages: entry.pageCount ?? undefined,
    method:
      entry.kind === "pdf"
        ? entry.needsOcr
          ? "PDF · 텍스트+OCR"
          : "PDF 텍스트 추출"
        : entry.kind === "image"
          ? "이미지 OCR"
          : "텍스트 파일",
    chars: entry.text.length,
  };
}

export function NewProjectPage() {
  const newProject = useProjectStore((state) => state.newProject);
  const setView = useProjectStore((state) => state.setView);
  const keyPresent = useAiStore((state) => state.keyPresent);
  const keyValid = useAiStore((state) => state.keyValid);
  const files = useIngestStore((state) => state.files);
  const markInserted = useIngestStore((state) => state.markInserted);

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [language, setLanguage] = useState<Passage["language"]>("auto");
  const [sources, setSources] = useState<PassageSource[]>([]);
  const [notes, setNotes] = useState<string[]>([]);

  const detectLang = language === "auto" ? detectLanguage(text) : language;
  const charCount = text.trim().length;

  function insertEntry(entry: IngestFile, options: { auto?: boolean } = {}) {
    const body = entry.text.trim();
    if (!body) {
      toast.warning("아직 추출된 텍스트가 없습니다.", "처리가 끝난 뒤 다시 시도해 주세요.");
      return;
    }
    const source = sourceFrom(entry);
    setText((previous) => (previous.trim() ? `${previous.trim()}\n\n${body}` : body));
    setSources((previous) =>
      previous.some((item) => item.name === source.name && item.size === source.size)
        ? previous
        : [...previous, source],
    );
    setNotes((previous) => [...new Set([...previous, ...entry.notes])]);
    const base = entry.name.replace(/\.[^.]+$/, "");
    setTitle((previous) => previous || base);
    setName((previous) => previous || base);
    markInserted(entry.id);
    if (!options.auto) {
      toast.success("지문에 넣었습니다.", `${entry.name} · ${body.length.toLocaleString()}자`);
    }
  }

  // Small and medium attachments are copied into the passage automatically so
  // the common flow stays one click. Very large extractions need an explicit
  // click, because a multi-hundred-thousand character textarea becomes sluggish.
  useEffect(() => {
    for (const entry of files) {
      if (
        entry.status === "done" &&
        !entry.inserted &&
        entry.text.trim() &&
        entry.text.length <= AUTO_INSERT_LIMIT
      ) {
        insertEntry(entry, { auto: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  function submit() {
    if (!text.trim()) {
      toast.warning("지문을 입력해 주세요.");
      return;
    }
    const passage: Passage = {
      title: title.trim() || name.trim() || "지문",
      text: text.trim(),
      language,
      sources,
      ocrNotes: notes,
    };
    newProject(name.trim() || title.trim() || "새 프로젝트", passage);
  }

  return (
    <div className="scroll-area h-full">
      <div className="mx-auto max-w-5xl px-8 py-8">
        <SectionHeader
          title="새 프로젝트"
          description="지문을 붙여넣거나 PDF·텍스트·이미지 파일을 첨부하세요. 파일 크기나 페이지 수 제한 없이 PC 성능에 맞춰 페이지 단위로 처리합니다."
          actions={
            <Button variant="ghost" size="sm" onClick={() => setView("home")}>
              홈으로
            </Button>
          }
        />

        {!keyPresent || !keyValid ? (
          <Card className="mt-4 flex items-start gap-3 border-amber-200 bg-amber-50 p-4">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-none text-amber-600" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900">AI 기능을 쓰려면 설정이 필요합니다</p>
              <p className="mt-0.5 text-xs leading-relaxed text-amber-700">
                지문 입력과 편집은 지금도 가능합니다. AI 생성은 Gemini API 키 저장과 연결 확인 후에
                활성화됩니다. 무료 모델만 사용할지, 유료 모델까지 허용할지는 AI 설정에서 정합니다.
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setView("ai")}>
              AI 설정
            </Button>
          </Card>
        ) : null}

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_280px]">
          <Card className="p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="프로젝트 이름">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="예: 2026 고2 여름특강 Week 1"
                />
              </Field>
              <Field label="지문 제목">
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="예: The Paradox of Choice"
                />
              </Field>
            </div>

            <div className="mt-4">
              <IngestPanel onInsert={(entry) => insertEntry(entry)} />
            </div>

            <Field
              label="지문 내용"
              className="mt-4"
              hint={
                <>
                  {charCount.toLocaleString()}자 · 감지 언어: {detectLang === "ko" ? "한국어" : "영어"} ·
                  OCR 결과가 애매한 부분은 반드시 직접 수정하세요.
                </>
              }
            >
              <Textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={16}
                placeholder="영어 또는 한글 지문을 붙여넣으세요.&#10;&#10;예)&#10;Choice overload is the psychological stress consumers feel when...&#10;..."
              />
            </Field>

            {sources.length ? (
              <div className="mt-3">
                <p className="text-xs font-semibold text-slate-600">첨부 파일</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {sources.map((source, index) => (
                    <span
                      key={`${source.name}-${index}`}
                      className="chip bg-white text-slate-600 ring-1 ring-slate-200"
                    >
                      {source.name}
                      <span className="text-slate-400">
                        · {source.method ?? source.kind.toUpperCase()}
                        {source.pages ? ` · ${source.pages}p` : ""}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {notes.length ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-900">인식 참고 사항</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-amber-700">
                  {notes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">지문 언어</span>
                <Select
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as Passage["language"])}
                  className="w-36"
                >
                  <option value="auto">자동 감지</option>
                  <option value="en">영어</option>
                  <option value="ko">한국어</option>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => void terminateOcr()}>
                  OCR 엔진 종료
                </Button>
                <Button
                  variant="primary"
                  icon={<Sparkles className="h-4 w-4" />}
                  onClick={submit}
                  disabled={!text.trim()}
                >
                  프로젝트 만들기
                </Button>
              </div>
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="p-4">
              <p className="text-sm font-bold text-slate-800">이렇게 진행됩니다</p>
              <ol className="mt-3 space-y-2.5 text-xs leading-relaxed text-slate-600">
                <li>1. 지문을 입력하거나 파일을 첨부합니다.</li>
                <li>2. 파일은 페이지 단위로 처리되고 완료분이 즉시 저장됩니다.</li>
                <li>3. 추출이 끝나면 지문에 자동으로 들어갑니다.</li>
                <li>4. 지문 분석 → 쉬운 설명 → 단어 → 워크북 → 답안지 → 검증 순서로 만듭니다.</li>
                <li>5. 문서 편집기에서 다듬고 PDF/PNG로 출력합니다.</li>
              </ol>
            </Card>
            <Card className="p-4">
              <p className="text-sm font-bold text-slate-800">파일 처리 안내</p>
              <ul className="mt-2 space-y-2 text-[11px] leading-relaxed text-slate-500">
                <li>· 텍스트 PDF는 로컬에서 바로 추출하고, 스캔·혼합 PDF는 필요한 페이지만 OCR합니다.</li>
                <li>· 페이지 범위를 지정하면 그 페이지만 처리합니다(빈 페이지는 자동 제외).</li>
                <li>· 처리 중 일시정지·취소할 수 있고, 완료 페이지는 재사용됩니다.</li>
                <li>· 앱을 닫았다가 같은 파일을 다시 첨부하면 이전 결과를 건너뛰고 이어서 처리합니다.</li>
                <li>· OCR·PDF 처리는 모두 이 PC에서 실행되며 파일이 외부로 전송되지 않습니다.</li>
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
