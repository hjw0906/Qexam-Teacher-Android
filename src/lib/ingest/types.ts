export type IngestKind = "pdf" | "image" | "text";

/**
 * preparing  – metadata / page map is being read
 * ready      – plan is known, waiting to run
 * running    – pages are being extracted right now
 * paused     – user paused (or the app was closed) with pages still pending
 * done       – every selected page produced text
 * failed     – stopped because nothing could be processed
 * canceled   – user canceled; finished pages are kept
 */
export type IngestStatus =
  | "preparing"
  | "ready"
  | "running"
  | "paused"
  | "done"
  | "failed"
  | "canceled";

export type PageKind = "text" | "scan" | "mixed" | "blank";
export type PageStatus = "pending" | "done" | "failed" | "skipped";

export interface IngestPage {
  /** 1-based page number, matching what the user sees in a PDF viewer. */
  index: number;
  kind: PageKind;
  status: PageStatus;
  chars: number;
  needsOcr: boolean;
  text: string;
  confidence?: number;
  error?: string;
}

export interface IngestFile {
  id: string;
  /** name + size + lastModified, used to resume a checkpoint. */
  signature: string;
  name: string;
  kind: IngestKind;
  mime: string;
  size: number;
  addedAt: string;
  updatedAt: string;
  status: IngestStatus;
  pages: IngestPage[];
  pageCount: number | null;
  /** null until the file has been inspected. */
  needsOcr: boolean | null;
  plan: string;
  /** Live status line, e.g. the current page or OCR phase. */
  statusText: string;
  text: string;
  notes: string[];
  error: string | null;
  /** 0-100 for the whole file. */
  progress: number;
  /** null = every page; otherwise the 1-based pages the user selected. */
  selectedPages: number[] | null;
  /** True when page results were restored from a previous run. */
  recovered: boolean;
  /** True once the extracted text was copied into the passage editor. */
  inserted: boolean;
  elapsedMs: number;
  dimensions?: { width: number; height: number };
  /** Not persisted: needed to continue after a reload. */
  file: File | null;
}

export type IngestErrorCode =
  | "corrupt"
  | "unsupported"
  | "crypto"
  | "memory"
  | "storage"
  | "ocr"
  | "aborted"
  | "read"
  | "unknown";

export class IngestError extends Error {
  code: IngestErrorCode;
  hint: string;

  constructor(code: IngestErrorCode, message: string, hint = "") {
    super(message);
    this.name = "IngestError";
    this.code = code;
    this.hint = hint;
  }
}

const CODE_HINTS: Record<IngestErrorCode, string> = {
  corrupt: "파일이 손상되었거나 지원되지 않는 내부 구조일 수 있습니다. 다른 PDF 뷰어에서 열리는지 확인해 주세요.",
  unsupported: "지원하는 형식은 PDF, TXT, PNG, JPG, JPEG, WEBP입니다.",
  crypto: "암호가 설정된 PDF는 열 수 없습니다. 암호를 해제한 사본을 첨부해 주세요.",
  memory: "다른 프로그램을 닫고 다시 시도해 주세요. 완료된 페이지는 저장되어 있습니다.",
  storage: "디스크 여유 공간을 확인해 주세요. 완료된 페이지는 저장되어 있습니다.",
  ocr: "해당 페이지만 실패했습니다. ‘실패 페이지만 재시도’로 다시 실행할 수 있습니다.",
  aborted: "작업을 중단했습니다. 완료된 페이지만 저장되어 있습니다.",
  read: "파일을 다시 선택해 주세요.",
  unknown: "잠시 후 다시 시도해 주세요. 완료된 페이지는 저장되어 있습니다.",
};

export function describeIngestError(error: unknown): { message: string; hint: string; code: IngestErrorCode } {
  if (error instanceof IngestError) {
    return { message: error.message, hint: error.hint || CODE_HINTS[error.code], code: error.code };
  }
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const probe = raw.toLowerCase();
  let code: IngestErrorCode = "unknown";
  if (probe.includes("password") || probe.includes("encrypted")) code = "crypto";
  else if (probe.includes("invalid pdf") || probe.includes("corrupt") || probe.includes("format")) code = "corrupt";
  else if (probe.includes("memory") || probe.includes("allocation") || probe.includes("array buffer")) code = "memory";
  else if (probe.includes("quota") || probe.includes("disk") || probe.includes("space")) code = "storage";
  else if (probe.includes("abort") || probe.includes("cancel")) code = "aborted";
  return {
    message: raw || "파일을 처리하지 못했습니다.",
    hint: CODE_HINTS[code],
    code,
  };
}

export function isTerminal(status: IngestStatus): boolean {
  return status === "done" || status === "failed" || status === "canceled";
}
