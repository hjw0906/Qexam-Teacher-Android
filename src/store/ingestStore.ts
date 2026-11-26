import { create } from "zustand";
import {
  currentBudget,
  describeResources,
  ensureHeadroom,
  mapPool,
  readResources,
  yieldToUi,
  type IngestBudget,
  type ResourceSnapshot,
} from "../lib/ingest/resources";
import {
  extractPdfPageText,
  inspectPdfPage,
  openPdf,
  parsePageSelection,
  releaseCanvas,
  renderPdfPage,
} from "../lib/ingest/pdf";
import { prepareImageForOcr, readImageInfo, releaseImage } from "../lib/ingest/images";
import { recognizeCanvas, recognizeTiles } from "../lib/ingest/recognize";
import {
  describeIngestError,
  IngestError,
  type IngestFile,
  type IngestKind,
  type IngestPage,
} from "../lib/ingest/types";
import {
  deleteFileCheckpoint,
  listFileCheckpoints,
  loadPageCheckpoints,
  saveFileCheckpoint,
  savePageCheckpoint,
} from "../lib/ingest/checkpoint";
import { formatBytes, nowIso, uid } from "../lib/utils";

export const ACCEPTED_PASSAGE_FILES =
  ".txt,.pdf,.png,.jpg,.jpeg,.webp,text/plain,application/pdf,image/png,image/jpeg,image/webp";

const controllers = new Map<string, AbortController>();
const pausedIds = new Set<string>();
const runningIds = new Set<string>();
let restoredOnce = false;

export function detectIngestKind(file: File): IngestKind | null {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (name.endsWith(".pdf") || type === "application/pdf") return "pdf";
  if (
    name.endsWith(".png") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".webp") ||
    type.startsWith("image/")
  ) {
    return "image";
  }
  if (name.endsWith(".txt") || type === "text/plain" || type === "") return "text";
  return null;
}

export function signatureOf(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified ?? 0}`;
}

function selectedPagesOf(entry: IngestFile): IngestPage[] {
  return entry.pages.filter(
    (page) => (!entry.selectedPages || entry.selectedPages.includes(page.index)) && page.kind !== "blank",
  );
}

export function computeProgress(pages: IngestPage[], selected: number[] | null): number {
  const relevant = pages.filter(
    (page) => (!selected || selected.includes(page.index)) && page.kind !== "blank",
  );
  if (!relevant.length) return pages.length ? 100 : 0;
  const finished = relevant.filter((page) => page.status === "done" || page.status === "failed").length;
  return Math.min(100, Math.round((finished / relevant.length) * 100));
}

function pdfPlan(pages: IngestPage[]): string {
  const text = pages.filter((page) => page.kind === "text").length;
  const scan = pages.filter((page) => page.kind === "scan").length;
  const mixed = pages.filter((page) => page.kind === "mixed").length;
  const blank = pages.filter((page) => page.kind === "blank").length;
  const ocr = pages.filter((page) => page.needsOcr).length;
  const parts = [`${pages.length}페이지`];
  if (text) parts.push(`텍스트 ${text}`);
  if (scan) parts.push(`스캔 ${scan}`);
  if (mixed) parts.push(`혼합 ${mixed}`);
  if (blank) parts.push(`빈 페이지 ${blank}`);
  if (ocr) parts.push(`OCR 필요 ${ocr}`);
  return `PDF · ${parts.join(" · ")}`;
}

function buildNotes(entry: IngestFile): string[] {
  const notes: string[] = [];
  if (entry.recovered) {
    const reused = entry.pages.filter((page) => page.status === "done" && page.text).length;
    if (reused) notes.push(`이전 작업에서 완료된 ${reused}개 페이지 결과를 그대로 재사용했습니다.`);
  }
  const failed = entry.pages.filter((page) => page.status === "failed");
  if (failed.length) {
    const list = failed.slice(0, 12).map((page) => (entry.kind === "pdf" ? `${page.index}페이지` : "이미지"));
    notes.push(`실패: ${list.join(", ")}${failed.length > 12 ? ` 외 ${failed.length - 12}개` : ""}. ‘실패 페이지만 재시도’로 다시 실행할 수 있습니다.`);
  }
  const lowConfidence = entry.pages.filter(
    (page) => page.status === "done" && page.needsOcr && typeof page.confidence === "number" && page.confidence < 70,
  );
  if (lowConfidence.length) {
    const list = lowConfidence.slice(0, 8).map((page) => `${page.index}페이지`);
    notes.push(`OCR 신뢰도가 낮은 페이지: ${list.join(", ")}. 해당 부분은 직접 수정해 주세요.`);
  }
  if (entry.pages.some((page) => page.status === "done" && page.needsOcr)) {
    notes.push("OCR로 읽은 텍스트는 원본과 다를 수 있습니다. 숫자·고유명사는 특히 확인해 주세요.");
  }
  return notes;
}

function assertActive(id: string, signal: AbortSignal): void {
  if (signal.aborted) {
    throw new IngestError("aborted", "작업을 중단했습니다.", "완료된 페이지는 저장되어 있습니다.");
  }
  if (!runningIds.has(id)) {
    throw new IngestError("aborted", "작업이 중단되었습니다.", "완료된 페이지는 저장되어 있습니다.");
  }
}

async function waitWhilePaused(id: string, signal: AbortSignal): Promise<void> {
  while (pausedIds.has(id)) {
    assertActive(id, signal);
    await yieldToUi(180);
  }
  assertActive(id, signal);
}

async function readTextFile(file: File, id: string, signal: AbortSignal): Promise<string> {
  const parts: string[] = [];
  const decoder = new TextDecoder("utf-8");
  const reader = file.stream().getReader();
  let bytes = 0;
  try {
    for (;;) {
      await waitWhilePaused(id, signal);
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        bytes += value.byteLength;
        parts.push(decoder.decode(value, { stream: true }));
        if (file.size > 0) {
          useIngestStore.getState().patch(id, {
            statusText: `텍스트 읽는 중 · ${formatBytes(bytes)} / ${formatBytes(file.size)}`,
            progress: Math.min(90, Math.round((bytes / file.size) * 90)),
          });
        }
        if (parts.length % 8 === 0) await yieldToUi();
      }
    }
    parts.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }
  return parts.join("");
}

function pageTemplate(index: number): IngestPage {
  return { index, kind: "text", status: "pending", chars: 0, needsOcr: false, text: "" };
}

function makeEntry(file: File, kind: IngestKind): IngestFile {
  return {
    id: uid("ing"),
    signature: signatureOf(file),
    name: file.name,
    kind,
    mime: file.type || (kind === "pdf" ? "application/pdf" : kind === "text" ? "text/plain" : "image/*"),
    size: file.size,
    addedAt: nowIso(),
    updatedAt: nowIso(),
    status: "preparing",
    pages: [],
    pageCount: kind === "pdf" ? null : 1,
    needsOcr: kind === "image" ? true : null,
    plan: kind === "text" ? `텍스트 · ${formatBytes(file.size)}` : "파일 확인 중",
    statusText: "파일 확인 중",
    text: "",
    notes: [],
    error: null,
    progress: 0,
    selectedPages: null,
    recovered: false,
    inserted: false,
    elapsedMs: 0,
    file,
  };
}

async function prepareFile(id: string): Promise<void> {
  const store = useIngestStore.getState();
  const entry = store.files.find((item) => item.id === id);
  if (!entry || !entry.file) return;
  const file = entry.file;
  const controller = controllers.get(id) ?? new AbortController();
  controllers.set(id, controller);
  const signal = controller.signal;
  store.patch(id, { status: "preparing", error: null, statusText: "파일 확인 중" });

  try {
    if (entry.kind === "pdf") {
      const { doc, pdfjs } = await openPdf(file);
      try {
        const savedPages = new Map((await loadPageCheckpoints(entry.signature)).map((page) => [page.index, page]));
        const pages: IngestPage[] = [];
        for (let index = 1; index <= doc.numPages; index += 1) {
          while (pausedIds.has(id)) {
            if (signal.aborted) {
              throw new IngestError("aborted", "작업을 중단했습니다.", "완료된 페이지는 저장되어 있습니다.");
            }
            await yieldToUi(200);
          }
          if (signal.aborted) {
            throw new IngestError("aborted", "작업을 중단했습니다.", "완료된 페이지는 저장되어 있습니다.");
          }
          const proxy = await doc.getPage(index);
          try {
            const info = await inspectPdfPage(proxy, index, pdfjs);
            const saved = savedPages.get(index);
            const page: IngestPage = {
              index,
              kind: info.kind,
              status:
                saved?.status === "done"
                  ? "done"
                  : info.kind === "blank"
                    ? "skipped"
                    : "pending",
              chars: saved?.text ? saved.text.length : info.chars,
              needsOcr: info.needsOcr,
              text: saved?.text ?? "",
            };
            if (saved?.confidence !== undefined) page.confidence = saved.confidence;
            if (saved?.error) page.error = saved.error;
            pages.push(page);
          } finally {
            proxy.cleanup();
          }
          useIngestStore.getState().patch(id, {
            pages,
            statusText: `페이지 구조 확인 ${index}/${doc.numPages}`,
            progress: Math.round((index / doc.numPages) * 100),
          });
          await yieldToUi();
        }

        const needsOcr = pages.some((page) => page.needsOcr && page.status !== "done");
        useIngestStore.getState().patch(id, {
          pages,
          pageCount: doc.numPages,
          needsOcr,
          status: "ready",
          plan: pdfPlan(pages),
          progress: computeProgress(pages, null),
          recovered: savedPages.size > 0,
          statusText: "준비 완료",
        });
      } finally {
        await doc.destroy().catch(() => undefined);
      }
      return;
    }

    if (entry.kind === "image") {
      const info = await readImageInfo(file);
      const budget = currentBudget();
      const scale = Math.min(1, Math.max(0.5, Math.sqrt(budget.maxCanvasPixels / Math.max(1, info.pixels))));
      const saved = (await loadPageCheckpoints(entry.signature))[0];
      const page: IngestPage = {
        ...pageTemplate(1),
        kind: "scan",
        needsOcr: true,
        status: saved?.status === "done" ? "done" : "pending",
        text: saved?.text ?? "",
        chars: saved?.text?.length ?? 0,
      };
      if (saved?.confidence !== undefined) page.confidence = saved.confidence;
      useIngestStore.getState().patch(id, {
        pages: [page],
        pageCount: 1,
        needsOcr: true,
        dimensions: { width: info.width, height: info.height },
        plan: `이미지 · ${info.width}×${info.height}px${scale < 1 ? ` · OCR용 ${Math.round(scale * 100)}% 축소` : ""}`,
        status: "ready",
        recovered: Boolean(saved),
        statusText: "준비 완료",
        progress: page.status === "done" ? 100 : 0,
      });
      return;
    }

    const saved = (await loadPageCheckpoints(entry.signature))[0];
    const page: IngestPage = {
      ...pageTemplate(1),
      status: saved?.status === "done" ? "done" : "pending",
      text: saved?.text ?? "",
      chars: saved?.text?.length ?? 0,
    };
    useIngestStore.getState().patch(id, {
      pages: [page],
      pageCount: 1,
      needsOcr: false,
      status: "ready",
      recovered: Boolean(saved),
      statusText: "준비 완료",
      progress: page.status === "done" ? 100 : 0,
    });
  } catch (error) {
    const described = describeIngestError(error);
    if (described.code === "aborted") {
      const paused = pausedIds.has(id);
      useIngestStore.getState().patch(id, {
        status: paused ? "paused" : "canceled",
        statusText: paused ? "일시정지됨" : "중단됨",
        error: null,
      });
      return;
    }
    useIngestStore.getState().patch(id, {
      status: "failed",
      error: `${described.message} ${described.hint}`.trim(),
      statusText: "실패",
    });
  }
}

function patchPage(
  id: string,
  index: number,
  partial: Partial<IngestPage>,
): IngestPage | null {
  const store = useIngestStore.getState();
  const entry = store.files.find((item) => item.id === id);
  if (!entry) return null;
  const pages = entry.pages.map((page) => (page.index === index ? { ...page, ...partial } : page));
  store.patch(id, { pages, progress: computeProgress(pages, entry.selectedPages) });
  return pages.find((page) => page.index === index) ?? null;
}

async function runPdf(id: string, file: File, signature: string, signal: AbortSignal): Promise<void> {
  const store = useIngestStore.getState();
  const entry = store.files.find((item) => item.id === id);
  if (!entry) return;
  const budget = currentBudget();
  const { doc } = await openPdf(file);

  try {
    const isSelected = (index: number) =>
      (!entry.selectedPages || entry.selectedPages.includes(index)) && index >= 1;
    const pending = entry.pages.filter(
      (page) => isSelected(page.index) && page.kind !== "blank" && page.status !== "done",
    );
    const textPending = pending.filter((page) => !page.needsOcr);
    const ocrPending = pending.filter((page) => page.needsOcr);

    await mapPool(textPending, budget.concurrency, async (page) => {
      try {
        await waitWhilePaused(id, signal);
        const proxy = await doc.getPage(page.index);
        let text = "";
        try {
          useIngestStore.getState().patch(id, {
            statusText: `${page.index}페이지 텍스트 추출 중`,
          });
          text = await extractPdfPageText(proxy);
        } finally {
          proxy.cleanup();
        }
        const updated = patchPage(id, page.index, {
          status: text.trim() ? "done" : "failed",
          text,
          chars: text.length,
          ...(text.trim() ? {} : { error: "텍스트를 추출하지 못했습니다." }),
        });
        if (updated) await savePageCheckpoint(signature, updated);
      } catch (error) {
        if (error instanceof IngestError && error.code === "aborted") throw error;
        const described = describeIngestError(error);
        const updated = patchPage(id, page.index, { status: "failed", error: described.message });
        if (updated) await savePageCheckpoint(signature, updated);
      }
      await yieldToUi();
    });

    for (const page of ocrPending) {
      await waitWhilePaused(id, signal);
      await ensureHeadroom(budget);
      let proxy: Awaited<ReturnType<typeof doc.getPage>> | null = null;
      let canvas: HTMLCanvasElement | null = null;
      try {
        proxy = await doc.getPage(page.index);
        useIngestStore.getState().patch(id, {
          statusText: `${page.index}페이지 이미지 변환 중`,
        });
        canvas = await renderPdfPage(proxy, budget);
        const ocr = await recognizeCanvas(canvas, (percent) => {
          useIngestStore.getState().patch(id, {
            statusText: `${page.index}페이지 OCR ${percent}%`,
          });
        });
        const text = ocr.text;
        const updated = patchPage(id, page.index, {
          status: text ? "done" : "failed",
          text,
          chars: text.length,
          confidence: ocr.confidence,
          ...(text ? {} : { error: "이 페이지에서 글자를 인식하지 못했습니다." }),
        });
        if (updated) await savePageCheckpoint(signature, updated);
      } catch (error) {
        if (error instanceof IngestError && error.code === "aborted") throw error;
        if (error instanceof IngestError && error.code === "memory") throw error;
        const described = describeIngestError(error);
        const updated = patchPage(id, page.index, { status: "failed", error: described.message });
        if (updated) await savePageCheckpoint(signature, updated);
      } finally {
        releaseCanvas(canvas);
        proxy?.cleanup();
      }
      await yieldToUi();
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

async function runImage(id: string, file: File, signature: string, signal: AbortSignal): Promise<void> {
  await waitWhilePaused(id, signal);
  const budget = currentBudget();
  await ensureHeadroom(budget);
  const prepared = await prepareImageForOcr(file, budget);
  try {
    useIngestStore.getState().patch(id, {
      statusText: prepared.tiles.length ? `큰 이미지 ${prepared.tiles.length}조각으로 분할 인식` : "이미지 글자 인식 중",
    });
    const progress = (percent: number) => {
      useIngestStore.getState().patch(id, {
        statusText: `이미지 OCR ${percent}%`,
        progress: Math.max(5, Math.round(percent * 0.9)),
      });
    };
    const ocr = prepared.tiles.length
      ? await recognizeTiles(prepared.tiles, progress)
      : await recognizeCanvas(prepared.canvas, progress);
    const text = ocr.text;
    const updated = patchPage(id, 1, {
      status: text ? "done" : "failed",
      text,
      chars: text.length,
      confidence: ocr.confidence,
      ...(text ? {} : { error: "이미지에서 글자를 인식하지 못했습니다." }),
    });
    if (updated) await savePageCheckpoint(signature, updated);
    if (prepared.scale < 1) {
      useIngestStore.getState().note(
        id,
        `원본 ${prepared.info.width}×${prepared.info.height}px 이미지를 OCR용으로 ${Math.round(
          prepared.scale * 100,
        )}% 축소해 인식했습니다. 원본 파일은 변경되지 않았습니다.`,
      );
    }
  } finally {
    releaseImage(prepared);
  }
}

async function runText(id: string, file: File, signature: string, signal: AbortSignal): Promise<void> {
  const text = await readTextFile(file, id, signal);
  const badChars = (text.match(/\ufffd/g) ?? []).length;
  const updated = patchPage(id, 1, {
    status: text.trim() ? "done" : "failed",
    text,
    chars: text.length,
    ...(text.trim() ? {} : { error: "파일이 비어 있습니다." }),
  });
  if (updated) await savePageCheckpoint(signature, updated);
  if (badChars > 3) {
    useIngestStore.getState().note(
      id,
      "UTF-8로 해석되지 않는 문자(�)가 있습니다. EUC-KR 등 다른 인코딩으로 저장된 파일이면 UTF-8로 저장한 뒤 다시 첨부해 주세요.",
    );
  }
}

async function finalizeFile(id: string): Promise<void> {
  const store = useIngestStore.getState();
  const entry = store.files.find((item) => item.id === id);
  if (!entry) return;
  const pages = selectedPagesOf(entry);
  const text = pages
    .filter((page) => page.status === "done")
    .map((page) => page.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
  const failed = entry.pages.filter((page) => page.status === "failed").length;
  const notes = buildNotes(entry);
  const status = text ? "done" : failed ? "failed" : "done";

  store.patch(id, {
    text,
    status,
    notes,
    progress: status === "done" ? 100 : computeProgress(entry.pages, entry.selectedPages),
    statusText:
      status === "done"
        ? failed
          ? `완료 · 실패 ${failed}페이지`
          : "완료"
        : "실패",
    plan: entry.kind === "pdf" ? pdfPlan(entry.pages) : entry.plan,
  });

  await saveFileCheckpoint({
    signature: entry.signature,
    name: entry.name,
    size: entry.size,
    kind: entry.kind,
    pageCount: entry.pageCount,
    needsOcr: entry.needsOcr,
    plan: entry.kind === "pdf" ? pdfPlan(entry.pages) : entry.plan,
    pages: entry.pages,
    text,
    notes,
    selectedPages: entry.selectedPages,
    updatedAt: nowIso(),
  });
}

export interface IngestState {
  files: IngestFile[];
  resources: ResourceSnapshot;
  budget: IngestBudget;
  resourceText: string;
  addFiles: (files: File[]) => Promise<void>;
  restore: () => Promise<void>;
  start: (id: string) => Promise<void>;
  pause: (id: string) => void;
  resume: (id: string) => Promise<void>;
  cancel: (id: string) => void;
  retryFailed: (id: string) => Promise<void>;
  setSelection: (id: string, spec: string) => void;
  remove: (id: string) => void;
  clearAll: () => void;
  markInserted: (id: string) => void;
  refreshResources: () => void;
  patch: (id: string, partial: Partial<IngestFile>) => void;
  patchPage: (id: string, index: number, partial: Partial<IngestPage>) => void;
  note: (id: string, note: string) => void;
}

export const useIngestStore = create<IngestState>((set, get) => ({
  files: [],
  resources: readResources(),
  budget: currentBudget(),
  resourceText: describeResources(readResources()),

  patch: (id, partial) =>
    set((state) => ({
      files: state.files.map((file) =>
        file.id === id ? { ...file, ...partial, updatedAt: nowIso() } : file,
      ),
    })),

  patchPage: (id, index, partial) => {
    const entry = get().files.find((file) => file.id === id);
    if (!entry) return;
    const pages = entry.pages.map((page) =>
      page.index === index ? { ...page, ...partial } : page,
    );
    get().patch(id, { pages, progress: computeProgress(pages, entry.selectedPages) });
  },

  note: (id, note) => {
    const entry = get().files.find((file) => file.id === id);
    if (!entry || entry.notes.includes(note)) return;
    get().patch(id, { notes: [...entry.notes, note] });
  },

  refreshResources: () => {
    const resources = readResources();
    set({ resources, budget: currentBudget(), resourceText: describeResources(resources) });
  },

  addFiles: async (files) => {
    if (!files.length) return;
    const created: IngestFile[] = [];
    for (const file of files) {
      const kind = detectIngestKind(file);
      if (!kind) {
        const entry = makeEntry(file, "text");
        entry.status = "failed";
        entry.error = `지원하지 않는 파일 형식입니다: ${file.name}. PDF, TXT, PNG, JPG, JPEG, WEBP 파일을 첨부해 주세요.`;
        entry.statusText = "지원하지 않는 형식";
        created.push(entry);
        continue;
      }
      const signature = signatureOf(file);
      const existing = get().files.find((item) => item.signature === signature);
      if (existing && !existing.file) {
        // Same file re-attached after a reload: continue from the checkpoint.
        get().patch(existing.id, { file, status: "ready", statusText: "이전 작업 이어서 준비", error: null });
        created.push(existing);
        continue;
      }
      const entry = makeEntry(file, kind);
      created.push(entry);
    }
    set((state) => ({
      files: [...created.filter((entry) => !state.files.some((item) => item.id === entry.id)), ...state.files],
    }));

    for (const entry of created) {
      if (!entry.file || entry.status === "failed") continue;
      await prepareFile(entry.id);
      const fresh = get().files.find((item) => item.id === entry.id);
      if (fresh?.status === "ready") await get().start(entry.id);
    }
    get().refreshResources();
  },

  restore: async () => {
    if (restoredOnce) return;
    restoredOnce = true;
    const records = await listFileCheckpoints();
    if (!records.length) return;
    const existing = get().files;
    const restored = records
      .filter((record) => !existing.some((item) => item.signature === record.signature))
      .map<IngestFile>((record) => ({
        id: uid("ing"),
        signature: record.signature,
        name: record.name,
        kind: record.kind as IngestKind,
        mime: "",
        size: record.size,
        addedAt: record.updatedAt,
        updatedAt: record.updatedAt,
        status: computeProgress(record.pages, record.selectedPages) >= 100 ? "done" : "paused",
        pages: record.pages,
        pageCount: record.pageCount,
        needsOcr: record.needsOcr,
        plan: record.plan,
        statusText:
          computeProgress(record.pages, record.selectedPages) >= 100
            ? "이전 작업에서 복구됨"
            : "이전 작업 복구됨 · 파일을 다시 첨부하면 이어서 처리",
        text: record.text,
        notes: record.notes,
        error: null,
        progress: computeProgress(record.pages, record.selectedPages),
        selectedPages: record.selectedPages,
        recovered: true,
        // Never auto-fill a new project from a restored checkpoint; the
        // teacher decides explicitly whether to reuse it.
        inserted: true,
        elapsedMs: 0,
        file: null,
      }));
    if (restored.length) set((state) => ({ files: [...state.files, ...restored] }));
  },

  start: async (id) => {
    let entry = get().files.find((file) => file.id === id);
    if (!entry || runningIds.has(id)) return;
    if (!entry.file) {
      get().patch(id, {
        status: "paused",
        error:
          "이전 작업 기록은 남아 있지만 원본 파일이 필요합니다. 같은 파일을 다시 첨부하면 완료된 페이지는 건너뛰고 이어서 처리합니다.",
        statusText: "파일 다시 첨부 필요",
      });
      return;
    }

    // Pausing during PDF page classification leaves the page map incomplete;
    // finish classifying before extracting, reusing pages already inspected.
    if (entry.kind === "pdf" && (entry.pageCount === null || entry.pages.length < entry.pageCount)) {
      pausedIds.delete(id);
      await prepareFile(id);
      entry = get().files.find((file) => file.id === id);
      if (!entry || entry.status === "failed" || entry.status === "paused") return;
      if (!entry.file) return;
    }

    const controller = new AbortController();
    controllers.set(id, controller);
    runningIds.add(id);
    pausedIds.delete(id);
    const startedAt = Date.now() - entry.elapsedMs;
    get().patch(id, { status: "running", error: null, statusText: "처리 준비 중" });

    try {
      if (entry.kind === "text") await runText(id, entry.file, entry.signature, controller.signal);
      else if (entry.kind === "image") await runImage(id, entry.file, entry.signature, controller.signal);
      else await runPdf(id, entry.file, entry.signature, controller.signal);
      get().patch(id, { elapsedMs: Date.now() - startedAt });
      await finalizeFile(id);
    } catch (error) {
      const described = describeIngestError(error);
      const current = get().files.find((file) => file.id === id);
      if (described.code === "aborted") {
        get().patch(id, {
          status: pausedIds.has(id) ? "paused" : "canceled",
          error: null,
          statusText: pausedIds.has(id) ? "일시정지됨" : "중단됨",
          elapsedMs: Date.now() - startedAt,
        });
        if (current) {
          const text = selectedPagesOf(current)
            .filter((page) => page.status === "done")
            .map((page) => page.text.trim())
            .filter(Boolean)
            .join("\n\n")
            .trim();
          get().patch(id, { text, notes: buildNotes(current) });
        }
      } else {
        get().patch(id, {
          status: "failed",
          error: `${described.message} ${described.hint}`.trim(),
          statusText: "실패",
          elapsedMs: Date.now() - startedAt,
        });
      }
    } finally {
      runningIds.delete(id);
      controllers.delete(id);
    }
  },

  pause: (id) => {
    pausedIds.add(id);
    const controller = controllers.get(id);
    controller?.abort();
    get().patch(id, { status: "paused", statusText: "일시정지됨" });
  },

  resume: async (id) => {
    pausedIds.delete(id);
    await get().start(id);
  },

  cancel: (id) => {
    pausedIds.delete(id);
    controllers.get(id)?.abort();
    runningIds.delete(id);
    get().patch(id, { status: "canceled", statusText: "중단됨" });
  },

  retryFailed: async (id) => {
    const entry = get().files.find((file) => file.id === id);
    if (!entry) return;
    const pages = entry.pages.map((page) =>
      page.status === "failed" ? { ...page, status: "pending" as const, error: undefined, text: "" } : page,
    );
    get().patch(id, { pages, error: null, status: "ready", statusText: "실패 페이지 재시도 준비" });
    await get().start(id);
  },

  setSelection: (id, spec) => {
    const entry = get().files.find((file) => file.id === id);
    if (!entry || !entry.pageCount) return;
    try {
      const selected = parsePageSelection(spec, entry.pageCount);
      const pages = entry.pages.map((page) => {
        const inRange = !selected || selected.includes(page.index);
        if (!inRange) return { ...page, status: "skipped" as const };
        if (page.kind === "blank") return { ...page, status: "skipped" as const };
        return page.status === "skipped" ? { ...page, status: "pending" as const } : page;
      });
      const text = pages
        .filter((page) => (!selected || selected.includes(page.index)) && page.status === "done")
        .map((page) => page.text.trim())
        .filter(Boolean)
        .join("\n\n")
        .trim();
      get().patch(id, {
        selectedPages: selected,
        pages,
        text,
        error: null,
        progress: computeProgress(pages, selected),
      });
    } catch (error) {
      get().patch(id, { error: describeIngestError(error).message });
    }
  },

  remove: (id) => {
    pausedIds.delete(id);
    controllers.get(id)?.abort();
    runningIds.delete(id);
    const entry = get().files.find((file) => file.id === id);
    if (entry) void deleteFileCheckpoint(entry.signature);
    set((state) => ({ files: state.files.filter((file) => file.id !== id) }));
  },

  clearAll: () => {
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    pausedIds.clear();
    runningIds.clear();
    for (const entry of get().files) void deleteFileCheckpoint(entry.signature);
    set({ files: [] });
  },

  markInserted: (id) => get().patch(id, { inserted: true }),
}));
