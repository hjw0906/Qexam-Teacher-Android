import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  FileText,
  FileUp,
  Gauge,
  Layers,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { Badge, Button, Card, ProgressBar } from "./ui";
import { ACCEPTED_PASSAGE_FILES, useIngestStore } from "../store/ingestStore";
import { formatBytes, formatDateTime } from "../lib/utils";
import type { IngestFile } from "../lib/ingest/types";

const TIER_LABEL: Record<string, string> = {
  constrained: "저사양 모드",
  standard: "표준 모드",
  ample: "고성능 모드",
};

function statusLabel(entry: IngestFile): string {
  switch (entry.status) {
    case "preparing":
      return "파일 확인 중";
    case "ready":
      return "처리 대기";
    case "running":
      return "처리 중";
    case "paused":
      return "일시정지";
    case "done":
      return "완료";
    case "failed":
      return "실패";
    case "canceled":
      return "중단됨";
    default:
      return "";
  }
}

function statusTone(entry: IngestFile): "blue" | "green" | "amber" | "red" | "slate" {
  if (entry.status === "running") return "blue";
  if (entry.status === "done") return entry.pages.some((page) => page.status === "failed") ? "amber" : "green";
  if (entry.status === "failed") return "red";
  if (entry.status === "paused" || entry.status === "ready") return "amber";
  return "slate";
}

function pageCounts(entry: IngestFile) {
  const selected = entry.pages.filter(
    (page) => (!entry.selectedPages || entry.selectedPages.includes(page.index)) && page.kind !== "blank",
  );
  const done = selected.filter((page) => page.status === "done").length;
  const failed = selected.filter((page) => page.status === "failed").length;
  const pending = selected.filter((page) => page.status === "pending").length;
  return { total: selected.length, done, failed, pending };
}

export function IngestPanel({
  onInsert,
  compact = false,
}: {
  onInsert: (entry: IngestFile) => void;
  compact?: boolean;
}) {
  const files = useIngestStore((state) => state.files);
  const addFiles = useIngestStore((state) => state.addFiles);
  const restore = useIngestStore((state) => state.restore);
  const start = useIngestStore((state) => state.start);
  const pause = useIngestStore((state) => state.pause);
  const resume = useIngestStore((state) => state.resume);
  const cancel = useIngestStore((state) => state.cancel);
  const retryFailed = useIngestStore((state) => state.retryFailed);
  const setSelection = useIngestStore((state) => state.setSelection);
  const remove = useIngestStore((state) => state.remove);
  const refreshResources = useIngestStore((state) => state.refreshResources);
  const resourceText = useIngestStore((state) => state.resourceText);
  const budget = useIngestStore((state) => state.budget);

  const [dragging, setDragging] = useState(false);
  const [selectionDrafts, setSelectionDrafts] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void restore();
  }, [restore]);

  const doneUninserted = files.filter(
    (entry) => entry.status === "done" && !entry.inserted && entry.text.trim(),
  );

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <div
        className={`rounded-xl border-2 border-dashed p-4 transition ${
          dragging ? "border-brand-400 bg-brand-50/60" : "border-slate-200 bg-slate-50/60"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const dropped = Array.from(event.dataTransfer.files ?? []);
          if (dropped.length) void addFiles(dropped);
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <FileUp className="h-4 w-4 text-brand-600" />
            <span className="font-medium">파일 첨부</span>
            <span className="text-slate-400">TXT · PDF · PNG · JPG · JPEG · WEBP · 여러 개 동시 선택</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>
              파일 선택
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPTED_PASSAGE_FILES}
              className="hidden"
              onChange={(event) => {
                const picked = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (picked.length) void addFiles(picked);
              }}
            />
            {doneUninserted.length > 1 ? (
              <Button
                size="sm"
                variant="primary"
                icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
                onClick={() => doneUninserted.forEach((entry) => onInsert(entry))}
              >
                완료 {doneUninserted.length}개 모두 넣기
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1">
            <Gauge className="h-3 w-3 text-slate-400" />
            {TIER_LABEL[budget.tier] ?? budget.tier} · 동시 {budget.concurrency} · OCR 배율 {budget.ocrScale}×
          </span>
          <span className="text-slate-400">{resourceText}</span>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-brand-600 hover:underline"
            onClick={refreshResources}
          >
            <RefreshCw className="h-3 w-3" /> 리소스 다시 확인
          </button>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          파일 크기·페이지 수·개수에 고정 제한을 두지 않습니다. PC 메모리와 CPU에 맞춰 페이지 단위로 나누어
          처리하고, 완료된 페이지는 즉시 저장되어 중단 후 이어서 처리할 수 있습니다.
        </p>
      </div>

      {files.length ? (
        <div className="space-y-2">
          {files.map((entry) => {
            const counts = pageCounts(entry);
            const isPdf = entry.kind === "pdf";
            const busy = entry.status === "running" || entry.status === "preparing";
            const canStart =
              Boolean(entry.file) &&
              (entry.status === "ready" || entry.status === "paused" || entry.status === "canceled");
            return (
              <Card key={entry.id} className="p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 flex-none text-slate-400" />
                      <span className="truncate text-xs font-semibold text-slate-800">{entry.name}</span>
                      <Badge tone={statusTone(entry)}>{statusLabel(entry)}</Badge>
                      <Badge tone="slate">{entry.kind === "pdf" ? "PDF" : entry.kind === "image" ? "이미지" : "텍스트"}</Badge>
                      <span className="text-[11px] text-slate-400">{formatBytes(entry.size)}</span>
                      {isPdf && entry.pageCount !== null ? (
                        <span className="text-[11px] text-slate-400">· {entry.pageCount}페이지</span>
                      ) : null}
                      {entry.dimensions ? (
                        <span className="text-[11px] text-slate-400">
                          · {entry.dimensions.width}×{entry.dimensions.height}px
                        </span>
                      ) : null}
                      {entry.needsOcr !== null ? (
                        <Badge tone={entry.needsOcr ? "amber" : "slate"}>
                          {entry.needsOcr ? "OCR 필요" : "텍스트 추출"}
                        </Badge>
                      ) : null}
                      {entry.recovered ? <Badge tone="blue">이전 작업 재사용</Badge> : null}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{entry.plan}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {busy ? (
                      <>
                        <Button size="sm" variant="ghost" icon={<Pause className="h-3 w-3" />} onClick={() => pause(entry.id)}>
                          일시정지
                        </Button>
                        <Button size="sm" variant="ghost" icon={<X className="h-3 w-3" />} onClick={() => cancel(entry.id)}>
                          취소
                        </Button>
                      </>
                    ) : null}
                    {canStart ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Play className="h-3 w-3" />}
                        onClick={() => void (entry.status === "paused" ? resume(entry.id) : start(entry.id))}
                      >
                        {entry.status === "paused" ? "이어서 처리" : "처리 시작"}
                      </Button>
                    ) : null}
                    {entry.pages.some((page) => page.status === "failed") && entry.status !== "running" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<RotateCcw className="h-3 w-3" />}
                        onClick={() => void retryFailed(entry.id)}
                      >
                        실패 페이지만 재시도
                      </Button>
                    ) : null}
                    {entry.text.trim() ? (
                      <Button
                        size="sm"
                        variant={entry.inserted ? "ghost" : "primary"}
                        icon={<ArrowDownToLine className="h-3 w-3" />}
                        onClick={() => onInsert(entry)}
                      >
                        {entry.inserted ? "다시 넣기" : "지문에 넣기"}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 className="h-3 w-3" />}
                      onClick={() => remove(entry.id)}
                      title="첨부와 저장된 페이지 결과를 삭제합니다."
                    >
                      삭제
                    </Button>
                  </div>
                </div>

                {(busy || entry.status === "paused") && (
                  <div className="mt-2">
                    <div className="flex items-center gap-2 text-[11px] text-brand-700">
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />}
                      <span className="truncate">{entry.statusText}</span>
                      <span className="ml-auto tabular-nums">{entry.progress}%</span>
                    </div>
                    <ProgressBar value={entry.progress} className="mt-1" />
                  </div>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" /> 완료 {counts.done}
                  </span>
                  <span>남은 {counts.pending}</span>
                  {counts.failed ? (
                    <span className="inline-flex items-center gap-1 text-red-600">
                      <AlertTriangle className="h-3 w-3" /> 실패 {counts.failed}
                    </span>
                  ) : null}
                  {entry.pages.length > 1 ? (
                    <span>
                      선택 {entry.selectedPages ? `${entry.selectedPages.length}페이지` : "전체"}
                    </span>
                  ) : null}
                  {entry.elapsedMs > 1000 ? <span>소요 {(entry.elapsedMs / 1000).toFixed(1)}초</span> : null}
                  <span className="text-slate-400">{entry.text ? `추출 ${entry.text.length.toLocaleString()}자` : "추출 전"}</span>
                  <span className="text-slate-300">{formatDateTime(entry.addedAt)}</span>
                </div>

                {isPdf && entry.pageCount && entry.pageCount > 1 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Layers className="h-3 w-3 text-slate-400" />
                    <input
                      className="input h-8 w-48 text-[11px]"
                      placeholder="예: 1-5, 8, 10-12 (비우면 전체)"
                      value={selectionDrafts[entry.id] ?? ""}
                      onChange={(event) =>
                        setSelectionDrafts((previous) => ({ ...previous, [entry.id]: event.target.value }))
                      }
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setSelection(entry.id, selectionDrafts[entry.id] ?? "")}
                    >
                      페이지 범위 적용
                    </Button>
                    <span className="text-[11px] text-slate-400">
                      필요한 페이지만 골라 처리하면 OCR 시간과 무료 사용량을 아낄 수 있습니다.
                    </span>
                  </div>
                ) : null}

                {entry.error ? (
                  <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-[11px] leading-relaxed text-red-700">
                    {entry.error}
                  </div>
                ) : null}

                {entry.notes.length ? (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                    <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-amber-700">
                      {entry.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
