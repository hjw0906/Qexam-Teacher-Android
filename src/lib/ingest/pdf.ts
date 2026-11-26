import type { IngestBudget } from "./resources";
import { IngestError, type PageKind } from "./types";
import { errorMessage } from "../utils";

type PdfjsModule = typeof import("pdfjs-dist");

export interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

export interface PdfPageLike {
  getViewport(params: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  render(params: unknown): { promise: Promise<void> };
  cleanup(): void;
}

export interface PdfDocumentLike {
  numPages: number;
  getPage(index: number): Promise<PdfPageLike>;
  destroy(): Promise<void>;
}

let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function importPdfjs(): Promise<PdfjsModule> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const module = await import("pdfjs-dist");
      module.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return module;
    } catch (error) {
      // A dev server that has just re-optimised dependencies can answer the
      // first request with a stale chunk URL; one retry recovers.
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw new IngestError(
    "read",
    "PDF 엔진을 불러오지 못했습니다.",
    `앱을 새로고침한 뒤 다시 시도해 주세요. (${errorMessage(lastError)})`,
  );
}

export function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = importPdfjs().catch((error) => {
      // Do not cache a rejection: the next attachment retries the import.
      pdfjsPromise = null;
      throw error;
    });
  }
  return pdfjsPromise;
}

export async function openPdf(
  file: File,
): Promise<{ doc: PdfDocumentLike; pdfjs: PdfjsModule }> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    const doc = (await pdfjs.getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: true,
      // The whole file is already in memory; disable extra range requests.
      disableAutoFetch: true,
      disableStream: true,
    } as never).promise) as unknown as PdfDocumentLike;
    return { doc, pdfjs };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") {
      throw new IngestError(
        "crypto",
        "암호가 설정된 PDF는 열 수 없습니다.",
        "PDF 뷰어에서 암호를 해제한 사본을 저장한 뒤 다시 첨부해 주세요.",
      );
    }
    if (name === "InvalidPDFException") {
      throw new IngestError(
        "corrupt",
        "PDF 파일을 읽을 수 없습니다.",
        "파일이 손상되었거나 PDF가 아닐 수 있습니다. 다른 뷰어에서 열리는지 확인해 주세요.",
      );
    }
    throw new IngestError(
      "corrupt",
      `PDF를 여는 중 오류가 발생했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
      "파일을 다시 저장한 뒤 시도하거나, 텍스트를 직접 붙여넣어 주세요.",
    );
  }
}

/** Join pdf.js text items into readable lines. */
export function joinTextItems(items: PdfTextItem[]): string {
  let text = "";
  for (const item of items) {
    const value = typeof item.str === "string" ? item.str : "";
    text += value;
    if (item.hasEOL) text += "\n";
  }
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function imageOps(pdfjs: PdfjsModule): Set<number> {
  const ops = pdfjs.OPS as unknown as Record<string, number>;
  const names = [
    "paintImageXObject",
    "paintJpegXObject",
    "paintImageMaskXObject",
    "paintInlineImageXObject",
    "paintImageXObjectRepeat",
    "paintImageMaskXObjectRepeat",
  ];
  const values = new Set<number>();
  for (const name of names) {
    const value = ops[name];
    if (typeof value === "number") values.add(value);
  }
  return values;
}

export interface PageInspection {
  index: number;
  kind: PageKind;
  chars: number;
  hasImage: boolean;
  needsOcr: boolean;
  text: string;
}

/**
 * Classify one page without rendering it: text extraction is cheap, and the
 * operator list is only inspected when the page has little or no text.
 */
export async function inspectPdfPage(
  page: PdfPageLike,
  index: number,
  pdfjs: PdfjsModule,
): Promise<PageInspection> {
  let rawText = "";
  try {
    const content = await page.getTextContent();
    rawText = joinTextItems(content.items);
  } catch {
    rawText = "";
  }
  const chars = rawText.replace(/\s/g, "").length;
  let hasImage = false;
  if (chars < 600) {
    try {
      const ops = await page.getOperatorList();
      const targets = imageOps(pdfjs);
      hasImage = ops.fnArray.some((fn) => targets.has(fn));
    } catch {
      hasImage = false;
    }
  }

  let kind: PageKind = "text";
  let needsOcr = false;
  if (chars >= 200) {
    kind = "text";
    needsOcr = false;
  } else if (chars > 0 && hasImage) {
    kind = "mixed";
    needsOcr = chars < 120;
  } else if (chars > 0) {
    kind = "text";
    needsOcr = false;
  } else if (hasImage) {
    kind = "scan";
    needsOcr = true;
  } else {
    kind = "blank";
    needsOcr = false;
  }

  return { index, kind, chars, hasImage, needsOcr, text: rawText };
}

export async function extractPdfPageText(page: PdfPageLike): Promise<string> {
  try {
    const content = await page.getTextContent();
    return joinTextItems(content.items);
  } catch {
    return "";
  }
}

/** Render a page for OCR, downscaled to stay inside the memory budget. */
export async function renderPdfPage(
  page: PdfPageLike,
  budget: IngestBudget,
): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  const basePixels = Math.max(1, base.width * base.height);
  const fit = Math.sqrt(budget.maxCanvasPixels / basePixels);
  const scale = Math.max(0.75, Math.min(budget.ocrScale, fit));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new IngestError("memory", "페이지를 그릴 캔버스를 만들 수 없습니다.", "다른 탭을 닫고 다시 시도해 주세요.");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvasContext: context,
    viewport,
    canvas,
  } as never).promise;
  return canvas;
}

export function releaseCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Parse a page selection such as "1-5, 8, 10-12". Returns null when the user
 * left it empty (= all pages) and throws on malformed input so the UI can point
 * at the exact token that is wrong.
 */
export function parsePageSelection(spec: string, pageCount: number): number[] | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  const pages = new Set<number>();
  for (const token of trimmed.split(/[,\s]+/).filter(Boolean)) {
    const match = token.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) {
      throw new IngestError("unknown", `페이지 범위 형식을 확인해 주세요: “${token}”`, "예: 1-5, 8, 10-12");
    }
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < from) {
      throw new IngestError("unknown", `페이지 범위가 올바르지 않습니다: “${token}”`, "1부터 시작하는 페이지 번호를 사용하세요.");
    }
    for (let page = from; page <= to && page <= pageCount; page += 1) pages.add(page);
  }
  if (!pages.size) return null;
  return [...pages].sort((a, b) => a - b);
}
