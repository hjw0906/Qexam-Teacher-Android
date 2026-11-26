import type { IngestBudget } from "./resources";
import { IngestError } from "./types";

export interface ImageInfo {
  width: number;
  height: number;
  pixels: number;
}

export interface PreparedImage {
  canvas: HTMLCanvasElement;
  /** Non-empty only when the image is too tall to OCR in one pass. */
  tiles: HTMLCanvasElement[];
  scale: number;
  info: ImageInfo;
}

const TILE_HEIGHT = 2_800;
const TILE_OVERLAP = 140;

async function decode(file: File): Promise<ImageBitmap> {
  try {
    // Chromium applies EXIF orientation with "from-image".
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try {
      return await createImageBitmap(file);
    } catch {
      throw new IngestError(
        "corrupt",
        "이미지를 열 수 없습니다.",
        "JPG·PNG·WEBP 파일인지 확인해 주세요. 일부 손상된 이미지는 다시 저장하면 열립니다.",
      );
    }
  }
}

export async function readImageInfo(file: File): Promise<ImageInfo> {
  const bitmap = await decode(file);
  const info = { width: bitmap.width, height: bitmap.height, pixels: bitmap.width * bitmap.height };
  bitmap.close();
  return info;
}

/**
 * Produce the working copy used for OCR. The original file is never modified;
 * downscaling only happens when the decoded bitmap would exceed the memory
 * budget for one canvas.
 */
export async function prepareImageForOcr(file: File, budget: IngestBudget): Promise<PreparedImage> {
  const bitmap = await decode(file);
  const info = { width: bitmap.width, height: bitmap.height, pixels: bitmap.width * bitmap.height };
  const fit = Math.sqrt(budget.maxCanvasPixels / Math.max(1, info.pixels));
  // Do not shrink below half size: OCR accuracy on small text drops quickly.
  const scale = Math.min(1, Math.max(0.5, fit));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    bitmap.close();
    throw new IngestError("memory", "이미지를 처리할 캔버스를 만들 수 없습니다.", "다른 탭을 닫고 다시 시도해 주세요.");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const tiles: HTMLCanvasElement[] = [];
  if (canvas.height > TILE_HEIGHT * 1.4 && canvas.width * canvas.height > 3_000_000) {
    for (let top = 0; top < canvas.height; top += TILE_HEIGHT - TILE_OVERLAP) {
      const height = Math.min(TILE_HEIGHT, canvas.height - top);
      if (height < 80) break;
      const tile = document.createElement("canvas");
      tile.width = canvas.width;
      tile.height = height;
      const tileContext = tile.getContext("2d", { alpha: false });
      if (!tileContext) break;
      tileContext.drawImage(canvas, 0, top, canvas.width, height, 0, 0, canvas.width, height);
      tiles.push(tile);
      if (top + height >= canvas.height) break;
    }
  }

  return { canvas, tiles, scale, info };
}

export function releaseImage(prepared: PreparedImage | null | undefined): void {
  if (!prepared) return;
  prepared.canvas.width = 0;
  prepared.canvas.height = 0;
  for (const tile of prepared.tiles) {
    tile.width = 0;
    tile.height = 0;
  }
  prepared.tiles.length = 0;
}
