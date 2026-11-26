import { useState } from "react";
import { FileText, Maximize2, Sparkles } from "lucide-react";
import { Badge, Button, Card, Field, Input, SectionHeader, Select, Textarea } from "./ui";
import { useProjectStore } from "../store/projectStore";
import { useAiStore } from "../store/aiStore";
import { detectLanguage, formatBytes, formatDateTime } from "../lib/utils";
import type { Passage } from "../lib/types";

export function PassageEditor() {
  const project = useProjectStore((state) => state.project);
  const update = useProjectStore((state) => state.update);
  const setTab = useProjectStore((state) => state.setTab);
  const keyValid = useAiStore((state) => state.keyValid);
  const keyPresent = useAiStore((state) => state.keyPresent);
  const [expanded, setExpanded] = useState(false);

  if (!project) return null;
  const passage = project.passage;
  const detected = passage.language === "auto" ? detectLanguage(passage.text) : passage.language;

  function patch(partial: Partial<Passage>) {
    update((draft) => {
      draft.passage = { ...draft.passage, ...partial };
    });
  }

  return (
    <div className={`scroll-area h-full ${expanded ? "" : "px-6 py-6"}`}>
      <div className={expanded ? "h-full" : "mx-auto max-w-4xl"}>
        {!expanded ? (
          <SectionHeader
            title="지문"
            description="AI 분석과 모든 자료 생성의 기준이 되는 원문입니다. OCR로 추출한 경우 애매한 부분을 직접 수정하세요."
            actions={
              <>
                <Badge tone="blue">{passage.text.trim().length.toLocaleString()}자</Badge>
                <Badge tone="slate">{detected === "ko" ? "한국어" : "영어"}</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Maximize2 className="h-3.5 w-3.5" />}
                  onClick={() => setExpanded(true)}
                >
                  크게 보기
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                  onClick={() => setTab("analysis")}
                >
                  분석 화면으로
                </Button>
              </>
            }
          />
        ) : (
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
            <span className="text-sm font-semibold text-slate-700">지문 편집 (전체 화면)</span>
            <Button size="sm" variant="ghost" onClick={() => setExpanded(false)}>
              닫기
            </Button>
          </div>
        )}

        <div className={expanded ? "p-4" : "mt-4 space-y-4"}>
          <Card className={expanded ? "p-4" : "p-5"}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="지문 제목">
                <Input value={passage.title} onChange={(event) => patch({ title: event.target.value })} />
              </Field>
              <Field label="지문 언어">
                <Select
                  value={passage.language}
                  onChange={(event) => patch({ language: event.target.value as Passage["language"] })}
                >
                  <option value="auto">자동 감지 ({detected === "ko" ? "한국어" : "영어"})</option>
                  <option value="en">영어</option>
                  <option value="ko">한국어</option>
                </Select>
              </Field>
            </div>

            <Field
              label="원문"
              className="mt-4"
              hint="원문은 저장 시 그대로 보존됩니다. 긴 지문은 문단 경계에서 나누어 순차 분석한 뒤 하나의 결과로 합칩니다."
            >
              <Textarea
                value={passage.text}
                onChange={(event) => patch({ text: event.target.value })}
                rows={expanded ? 30 : 18}
                className={expanded ? "min-h-[65vh] font-serif text-[13px]" : "font-serif text-[13px]"}
              />
            </Field>

            {passage.sources.length ? (
              <div className="mt-3">
                <p className="text-xs font-semibold text-slate-600">첨부 파일</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {passage.sources.map((source, index) => (
                    <span key={`${source.name}-${index}`} className="chip bg-slate-100 text-slate-600">
                      <FileText className="h-3 w-3" />
                      {source.name}
                      {source.method ? <span className="text-slate-400">· {source.method}</span> : null}
                      {source.pages ? <span className="text-slate-400">· {source.pages}p</span> : null}
                      {source.size ? (
                        <span className="text-slate-400">· {formatBytes(source.size)}</span>
                      ) : null}
                      <span className="text-slate-400">{formatDateTime(source.addedAt)}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {passage.ocrNotes.length ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-900">OCR 인식 참고 사항</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-amber-700">
                  {passage.ocrNotes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          {!expanded ? (
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <p className="flex-1 text-xs leading-relaxed text-slate-500">
                  {keyPresent && keyValid
                    ? "준비되었습니다. ‘지문 분석’에서 주제·구조·문단별 정리를 생성하세요."
                    : "AI 기능을 사용하려면 AI 설정에서 API 키를 저장하고 연결을 확인하세요."}
                </p>
                <Button size="sm" variant="primary" onClick={() => setTab("analysis")}>
                  지문 분석 열기
                </Button>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
