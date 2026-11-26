import { errorMessage } from "../utils";
import { IngestError } from "./types";

interface TesseractWorkerLike {
  recognize: (image: string | Blob | HTMLCanvasElement) => Promise<{
    data: { text: string; confidence: number };
  }>;
  terminate: () => Promise<unknown>;
}

type ProgressCallback = (percent: number, message: string) => void;

let workerPromise: Promise<TesseractWorkerLike> | null = null;
let activeProgress: ProgressCallback | null = null;

function assetUrl(path: string): string {
  const base = new URL(import.meta.env.BASE_URL || "/", window.location.href);
  return new URL(path, base).href;
}

async function createOcrWorker(): Promise<TesseractWorkerLike> {
  const { createWorker } = await import("tesseract.js");
  const logger = (message: { status?: string; progress?: number }) => {
    if (!activeProgress) return;
    activeProgress(Math.round((message.progress ?? 0) * 100), message.status ?? "인식 중");
  };

  try {
    return (await createWorker("kor+eng", 1, {
      workerPath: assetUrl("tesseract/worker.min.js"),
      corePath: assetUrl("tesseract"),
      langPath: assetUrl("tessdata"),
      logger,
    })) as unknown as TesseractWorkerLike;
  } catch (localError) {
    // Bundled assets can be missing in a dev checkout; fall back to the CDN.
    try {
      return (await createWorker("kor+eng", 1, { logger })) as unknown as TesseractWorkerLike;
    } catch {
      throw new IngestError(
        "ocr",
        "OCR 엔진을 불러오지 못했습니다.",
        `이미지 속 글자를 읽으려면 OCR 엔진이 필요합니다. 잠시 후 다시 시도하거나 텍스트를 직접 입력해 주세요. (${errorMessage(
          localError,
        )})`,
      );
    }
  }
}

export async function getOcrWorker(): Promise<TesseractWorkerLike> {
  if (!workerPromise) {
    workerPromise = createOcrWorker().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise.catch(() => null);
  workerPromise = null;
  await worker?.terminate().catch(() => undefined);
}

export interface OcrText {
  text: string;
  confidence: number;
}

export async function recognizeCanvas(
  canvas: HTMLCanvasElement,
  onProgress?: ProgressCallback,
): Promise<OcrText> {
  activeProgress = onProgress ?? null;
  try {
    const worker = await getOcrWorker();
    const result = await worker.recognize(canvas);
    return {
      text: result.data.text.trim(),
      confidence: result.data.confidence ?? 0,
    };
  } catch (error) {
    if (error instanceof IngestError) throw error;
    throw new IngestError(
      "ocr",
      "이미지에서 글자를 인식하지 못했습니다.",
      errorMessage(error),
    );
  } finally {
    activeProgress = null;
  }
}

const OVERLAP_LINES = 2;

/**
 * OCR tiles of one oversized image, removing the lines duplicated by the tile
 * overlap so a paragraph split across two tiles is only kept once.
 */
export async function recognizeTiles(
  tiles: HTMLCanvasElement[],
  onProgress?: ProgressCallback,
): Promise<OcrText> {
  const parts: OcrText[] = [];
  for (let index = 0; index < tiles.length; index += 1) {
    onProgress?.(
      Math.round((index / tiles.length) * 100),
      `큰 이미지 분할 인식 ${index + 1}/${tiles.length}`,
    );
    const tile = tiles[index];
    if (!tile) continue;
    parts.push(await recognizeCanvas(tile));
    if (typeof tile.width === "number") {
      tile.width = 0;
      tile.height = 0;
    }
  }

  const lines: string[] = [];
  let previousTail: string[] = [];
  for (const part of parts) {
    const partLines = part.text.split("\n").filter((line) => line.trim());
    let start = 0;
    if (previousTail.length) {
      const probe = partLines.slice(0, OVERLAP_LINES + 2);
      for (let offset = 0; offset < probe.length; offset += 1) {
        const candidate = probe.slice(offset, offset + previousTail.length);
        if (candidate.length && candidate.join("\n") === previousTail.join("\n")) {
          start = offset + previousTail.length;
          break;
        }
      }
    }
    for (let index = start; index < partLines.length; index += 1) {
      const line = partLines[index];
      if (line) lines.push(line);
    }
    previousTail = partLines.slice(-OVERLAP_LINES);
  }

  const confidence =
    parts.length > 0 ? parts.reduce((sum, part) => sum + part.confidence, 0) / parts.length : 0;
  return { text: lines.join("\n").trim(), confidence };
}
