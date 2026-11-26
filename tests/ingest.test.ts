import { describe, expect, it } from "vitest";
import {
  chunkBudgetFor,
  contextTail,
  estimateTokens,
  planChunks,
  splitTextSmart,
} from "../src/lib/ingest/chunker";
import { computeBudget, mapPool, type ResourceSnapshot } from "../src/lib/ingest/resources";
import { parsePageSelection } from "../src/lib/ingest/pdf";
import { detectIngestKind, computeProgress } from "../src/store/ingestStore";
import { analysisPlan } from "../src/lib/gemini/tasks";
import type { IngestPage } from "../src/lib/ingest/types";
import type { GeminiModel } from "../src/lib/types";

function snapshot(partial: Partial<ResourceSnapshot>): ResourceSnapshot {
  return {
    deviceMemoryGb: null,
    hardwareConcurrency: 8,
    heapUsedMb: null,
    heapLimitMb: null,
    heapRatio: null,
    tier: "standard",
    ...partial,
  };
}

function page(index: number, overrides: Partial<IngestPage> = {}): IngestPage {
  return {
    index,
    kind: "text",
    status: "pending",
    chars: 0,
    needsOcr: false,
    text: "",
    ...overrides,
  };
}

describe("splitTextSmart", () => {
  const paragraph = "Choice overload makes shoppers hesitate. When there are too many options, people buy less. ";

  it("keeps short text in one chunk", () => {
    const text = "짧은 지문입니다.\n\n두 번째 문단입니다.";
    const chunks = splitTextSmart(text, 5_000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe(text);
  });

  it("never loses or duplicates characters", () => {
    const text = Array.from({ length: 60 }, (_, index) => `${paragraph}(${index})`).join("\n\n");
    const chunks = splitTextSmart(text, 1_200);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(text);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(1_200);
  });

  it("prefers a paragraph or sentence boundary", () => {
    const text = Array.from({ length: 80 }, () => paragraph).join("");
    const chunks = splitTextSmart(text, 900);
    // Every chunk except the last should end on sentence punctuation.
    for (const chunk of chunks.slice(0, -1)) {
      expect(/[.!?。！？…]\s*$/.test(chunk.text)).toBe(true);
    }
  });

  it("hard-splits a single oversized sentence instead of failing", () => {
    const text = "가".repeat(5_000);
    const chunks = splitTextSmart(text, 1_000);
    expect(chunks).toHaveLength(5);
    expect(chunks.every((chunk) => chunk.text.length <= 1_000)).toBe(true);
  });

  it("reports a plan with boundaries", () => {
    const text = Array.from({ length: 40 }, () => paragraph).join("");
    const plan = planChunks(text, { maxChars: 1_000 });
    expect(plan.totalChars).toBe(text.length);
    expect(plan.usesBoundaries).toBe(true);
  });

  it("keeps a short context tail", () => {
    expect(contextTail("앞 문단입니다.\n\n마지막 문단입니다.", 20)).toBe("마지막 문단입니다.");
    expect(contextTail("", 20)).toBe("");
  });
});

describe("token budgeting", () => {
  it("estimates Korean text as roughly one token per character", () => {
    expect(estimateTokens("안녕하세요")).toBeGreaterThanOrEqual(4);
    expect(estimateTokens("hello world")).toBeGreaterThan(1);
  });

  it("derives a chunk size from the model input limit with a floor and cap", () => {
    expect(chunkBudgetFor(1_000_000)).toBe(16_000);
    expect(chunkBudgetFor(null)).toBe(12_000);
    expect(chunkBudgetFor(30_000)).toBeGreaterThanOrEqual(4_000);
    expect(chunkBudgetFor(12_000)).toBe(5_000);
  });
});

describe("page selection", () => {
  it("parses ranges, lists and mixed input", () => {
    expect(parsePageSelection("1-3, 5", 10)).toEqual([1, 2, 3, 5]);
    expect(parsePageSelection("4,4,2-4", 10)).toEqual([2, 3, 4]);
  });

  it("treats empty input as all pages", () => {
    expect(parsePageSelection("   ", 10)).toBeNull();
  });

  it("clamps to the document length", () => {
    expect(parsePageSelection("8-20", 10)).toEqual([8, 9, 10]);
  });

  it("rejects malformed tokens", () => {
    expect(() => parsePageSelection("abc", 10)).toThrow();
    expect(() => parsePageSelection("5-2", 10)).toThrow();
  });
});

describe("resource budget", () => {
  it("uses a conservative plan on a 4GB dual core laptop", () => {
    const budget = computeBudget(
      snapshot({ tier: "constrained", deviceMemoryGb: 4, hardwareConcurrency: 2 }),
    );
    expect(budget.concurrency).toBe(1);
    expect(budget.ocrScale).toBeLessThanOrEqual(1.5);
    expect(budget.maxCanvasPixels).toBeLessThanOrEqual(4_000_000);
  });

  it("scales up on a large machine", () => {
    const budget = computeBudget(
      snapshot({ tier: "ample", deviceMemoryGb: 16, hardwareConcurrency: 16 }),
    );
    expect(budget.concurrency).toBe(3);
    expect(budget.maxChunkChars).toBe(16_000);
  });

  it("degrades automatically when the heap is nearly full", () => {
    const budget = computeBudget(
      snapshot({ tier: "ample", deviceMemoryGb: 16, hardwareConcurrency: 16, heapRatio: 0.93 }),
    );
    expect(budget.concurrency).toBe(1);
    expect(budget.maxCanvasPixels).toBeLessThanOrEqual(3_000_000);
    expect(budget.maxChunkChars).toBeLessThanOrEqual(8_000);
  });
});

describe("mapPool", () => {
  it("runs at most the requested number of tasks at once", async () => {
    let active = 0;
    let peak = 0;
    await mapPool([1, 2, 3, 4, 5, 6], 2, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("waits for every task before surfacing the first error", async () => {
    const finished: number[] = [];
    await expect(
      mapPool([1, 2, 3], 2, async (item) => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        finished.push(item);
        if (item === 1) throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(finished).toHaveLength(3);
  });
});

describe("analysis planning for long passages", () => {
  const model: GeminiModel = {
    id: "gemini-3.8-flash",
    name: "models/gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash",
    description: "",
    methods: ["generateContent"],
    freeTier: "free",
    freeSource: "catalog",
    textCapable: true,
    inputTokenLimit: 1_000_000,
    pricing: null,
    freeAvailable: true,
    paidAvailable: false,
  };

  it("keeps a short passage in a single request", () => {
    const plan = analysisPlan("짧은 지문입니다.", [model]);
    expect(plan.chunkCount).toBe(1);
    expect(plan.needsChunking).toBe(false);
    expect(plan.modelInputLimit).toBe(1_000_000);
  });

  it("splits a long passage into multiple cacheable chunks", () => {
    const plan = analysisPlan("가나다라마바사. ".repeat(3_000), [model]);
    expect(plan.chunkCount).toBeGreaterThan(1);
    expect(plan.needsChunking).toBe(true);
    expect(plan.maxChars).toBeLessThanOrEqual(16_000);
  });
});

describe("file detection and progress", () => {
  it("detects supported attachment kinds", () => {
    const make = (name: string, type: string) => new File([new Uint8Array([1])], name, { type });
    expect(detectIngestKind(make("a.PDF", "application/pdf"))).toBe("pdf");
    expect(detectIngestKind(make("b.jpeg", "image/jpeg"))).toBe("image");
    expect(detectIngestKind(make("c.txt", "text/plain"))).toBe("text");
    expect(detectIngestKind(make("d.docx", "application/vnd.openxmlformats"))).toBeNull();
  });

  it("counts finished pages, ignoring blank and unselected ones", () => {
    const pages = [
      page(1, { status: "done" }),
      page(2, { status: "failed" }),
      page(3, { status: "pending" }),
      page(4, { kind: "blank", status: "skipped" }),
      page(5, { status: "done" }),
    ];
    expect(computeProgress(pages, null)).toBe(75);
    expect(computeProgress(pages, [1, 2, 3])).toBe(67);
  });
});
