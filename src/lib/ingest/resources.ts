/**
 * Runtime resource planner.
 *
 * The app never rejects a file because of a fixed byte or page number. Instead
 * it measures the machine (cores, device memory, JS heap headroom) and derives a
 * processing budget: how many pages to keep in flight, how large a canvas may
 * be, and how big a text chunk sent to Gemini can get.
 */
import { IngestError } from "./types";

export interface ResourceSnapshot {
  deviceMemoryGb: number | null;
  hardwareConcurrency: number;
  heapUsedMb: number | null;
  heapLimitMb: number | null;
  heapRatio: number | null;
  tier: "constrained" | "standard" | "ample";
}

export interface IngestBudget {
  tier: ResourceSnapshot["tier"];
  /** Pages of cheap text extraction to run in parallel. */
  concurrency: number;
  /** Rasterising scale for OCR (1 = 72dpi-ish, 2 = ~144dpi). */
  ocrScale: number;
  /** Upper bound for one rendered canvas before downscaling. */
  maxCanvasPixels: number;
  /** Characters per Gemini request when a document has to be split. */
  maxChunkChars: number;
  /** Heap ratio above which the pipeline pauses to let the GC catch up. */
  softHeapLimit: number;
}

type PerformanceMemory = {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
};

function performanceMemory(): PerformanceMemory | null {
  if (typeof performance === "undefined") return null;
  const memory = (performance as unknown as { memory?: PerformanceMemory }).memory;
  return memory && memory.jsHeapSizeLimit ? memory : null;
}

export function readResources(): ResourceSnapshot {
  const cores =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 2;
  const deviceMemory =
    typeof navigator !== "undefined"
      ? ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null)
      : null;
  const memory = performanceMemory();
  const heapUsedMb = memory ? Math.round(memory.usedJSHeapSize / 1048576) : null;
  const heapLimitMb = memory ? Math.round(memory.jsHeapSizeLimit / 1048576) : null;
  const heapRatio = memory ? memory.usedJSHeapSize / memory.jsHeapSizeLimit : null;

  let tier: ResourceSnapshot["tier"] = "standard";
  if ((deviceMemory !== null && deviceMemory <= 4) || cores <= 4) tier = "constrained";
  else if ((deviceMemory === null || deviceMemory >= 8) && cores >= 8) tier = "ample";

  return { deviceMemoryGb: deviceMemory, hardwareConcurrency: cores, heapUsedMb, heapLimitMb, heapRatio, tier };
}

/**
 * Derive the effective budget, degrading when the heap is already under
 * pressure. Pure function so it can be unit tested.
 */
export function computeBudget(snapshot: ResourceSnapshot): IngestBudget {
  const base: IngestBudget =
    snapshot.tier === "constrained"
      ? {
          tier: snapshot.tier,
          concurrency: 1,
          ocrScale: 1.5,
          maxCanvasPixels: 4_000_000,
          maxChunkChars: 8_000,
          softHeapLimit: 0.78,
        }
      : snapshot.tier === "ample"
        ? {
            tier: snapshot.tier,
            concurrency: 3,
            ocrScale: 2,
            maxCanvasPixels: 12_000_000,
            maxChunkChars: 16_000,
            softHeapLimit: 0.86,
          }
        : {
            tier: snapshot.tier,
            concurrency: 2,
            ocrScale: 1.8,
            maxCanvasPixels: 8_000_000,
            maxChunkChars: 12_000,
            softHeapLimit: 0.82,
          };

  const ratio = snapshot.heapRatio;
  if (ratio !== null && ratio > 0.88) {
    return {
      ...base,
      concurrency: 1,
      ocrScale: Math.min(base.ocrScale, 1.3),
      maxCanvasPixels: Math.min(base.maxCanvasPixels, 3_000_000),
      maxChunkChars: Math.min(base.maxChunkChars, 8_000),
    };
  }
  if (ratio !== null && ratio > 0.75 && base.concurrency > 1) {
    return { ...base, concurrency: base.concurrency - 1 };
  }
  return base;
}

export function currentBudget(): IngestBudget {
  return computeBudget(readResources());
}

export function yieldToUi(ms = 0): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Wait (briefly) for the JS heap to come back down before a heavy step.
 * We cannot force GC, so this yields to the event loop and re-measures.
 */
export async function ensureHeadroom(budget: IngestBudget, yieldMs = 220): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { heapRatio } = readResources();
    if (heapRatio === null || heapRatio < budget.softHeapLimit) return;
    await yieldToUi(yieldMs);
  }
  throw new IngestError(
    "memory",
    "메모리가 부족해 대용량 페이지 처리를 잠시 멈췄습니다.",
    "완료된 페이지는 저장되어 있습니다. 다른 프로그램을 닫은 뒤 ‘이어서 처리’를 눌러 주세요.",
  );
}

/** Run `worker` over `items` with a bounded number of in-flight tasks. */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const size = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;
  let firstError: unknown = null;

  async function runner(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await worker(items[index] as T, index);
      } catch (error) {
        // Keep the other runners alive so no work is left touching released
        // resources; the first error is rethrown once every task settled.
        if (firstError === null) firstError = error;
      }
    }
  }

  await Promise.all(Array.from({ length: size }, () => runner()));
  if (firstError !== null) throw firstError;
  return results;
}

/** Best-effort free-space check used to warn before writing large checkpoints. */
export async function storageHeadroomMb(): Promise<number | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate || estimate.quota === undefined || estimate.usage === undefined) return null;
    return Math.round((estimate.quota - estimate.usage) / 1048576);
  } catch {
    return null;
  }
}

export function describeResources(snapshot: ResourceSnapshot): string {
  const parts: string[] = [];
  if (snapshot.deviceMemoryGb) parts.push(`RAM ${snapshot.deviceMemoryGb}GB`);
  parts.push(`${snapshot.hardwareConcurrency}코어`);
  if (snapshot.heapUsedMb && snapshot.heapLimitMb) {
    parts.push(`힙 ${snapshot.heapUsedMb}/${snapshot.heapLimitMb}MB`);
  }
  return parts.join(" · ");
}
