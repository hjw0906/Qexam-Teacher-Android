import { describe, expect, it } from "vitest";
import {
  alignElements,
  clonePage,
  createPage,
  createTextElement,
  distributeElements,
  duplicateElement,
  pageDimensions,
} from "../src/lib/document";
import { lookupCatalog } from "../src/lib/gemini/catalog";
import { rankModels } from "../src/lib/gemini/router";
import { lookupPricing } from "../src/lib/gemini/pricing";
import { usageStats } from "../src/lib/gemini/usage";
import { normalizeProject, createProject } from "../src/store/projectStore";
import { composeDocument } from "../src/lib/compose";
import type { GeminiModel, PassageAnalysis, UsageRecord } from "../src/lib/types";
import { PROJECT_FORMAT } from "../src/lib/types";

const model = (id: string, free: GeminiModel["freeTier"], outputTokenLimit = 8192): GeminiModel => ({
  id,
  name: `models/${id}`,
  displayName: id,
  description: "",
  methods: ["generateContent", "countTokens"],
  freeTier: free,
  freeSource: free === "unknown" ? "none" : "catalog",
  textCapable: true,
  inputTokenLimit: 1_000_000,
  outputTokenLimit,
  pricing: lookupPricing(id),
  freeAvailable: free === "free",
  paidAvailable: lookupPricing(id) !== null,
});

describe("free tier catalog", () => {
  it("marks documented free models as free", () => {
    expect(lookupCatalog("gemini-3.8-flash").freeTier).toBe("free");
    expect(lookupCatalog("gemini-3.5-flash-lite").freeTier).toBe("free");
    expect(lookupCatalog("gemini-4-hydrogen").freeTier).toBe("free");
  });

  it("marks paid-only models and unknown models correctly", () => {
    expect(lookupCatalog("gemini-4-argon").freeTier).toBe("paid-only");
    expect(lookupCatalog("gemini-3.1-pro-preview").freeTier).toBe("paid-only");
    expect(lookupCatalog("some-future-model").freeTier).toBe("unknown");
  });
});

describe("automatic model routing", () => {
  const models = [
    model("gemini-4-argon", "paid-only"),
    model("gemini-3.1-flash-lite", "free"),
    model("gemini-unknown-preview", "unknown"),
    model("gemini-3.8-flash", "free"),
    model("gemini-4-hydrogen", "free"),
  ];

  it("never routes to paid-only or unknown-free models", () => {
    const ranked = rankModels(models, "analysis");
    const ids = ranked.map((item) => item.id);
    expect(ids).not.toContain("gemini-4-argon");
    expect(ids).not.toContain("gemini-unknown-preview");
    expect(ids).toContain("gemini-3.8-flash");
    expect(ids).toContain("gemini-3.1-flash-lite");
  });

  it("respects the manual block list", () => {
    const ranked = rankModels(models, "workbook", { blockedModelIds: ["gemini-3.8-flash"] });
    expect(ranked.map((item) => item.id)).not.toContain("gemini-3.8-flash");
  });

  it("puts the preferred model first", () => {
    const ranked = rankModels(models, "vocab", { preferredModelId: "gemini-3.1-flash-lite" });
    expect(ranked[0].id).toBe("gemini-3.1-flash-lite");
  });
});

describe("document geometry", () => {
  it("knows page dimensions and orientation", () => {
    expect(pageDimensions({ size: "A4", orientation: "portrait" })).toEqual({
      width: 210,
      height: 297,
    });
    expect(pageDimensions({ size: "A4", orientation: "landscape" })).toEqual({
      width: 297,
      height: 210,
    });
  });

  it("aligns and distributes elements without changing ids", () => {
    const a = createTextElement({ x: 10, y: 10, w: 20, h: 10 });
    const b = createTextElement({ x: 50, y: 30, w: 20, h: 10 });
    const c = createTextElement({ x: 120, y: 60, w: 20, h: 10 });

    const aligned = alignElements([a, b, c], "left");
    expect(aligned.every((element) => element.x === 10)).toBe(true);

    const distributed = distributeElements([a, b, c], "vertical");
    const ys = distributed.map((element) => element.y).sort((left, right) => left - right);
    expect(ys[0]).toBe(10);
    expect(ys[1]).toBeGreaterThan(10);
    expect(ys[1]).toBeLessThan(60);
  });

  it("clones pages and elements with new ids", () => {
    const page = createPage("A4");
    page.elements.push(createTextElement());
    const copy = clonePage(page);
    expect(copy.id).not.toBe(page.id);
    expect(copy.elements[0].id).not.toBe(page.elements[0].id);

    const duplicate = duplicateElement(page.elements[0]);
    expect(duplicate.id).not.toBe(page.elements[0].id);
    expect(duplicate.x).toBeGreaterThan(page.elements[0].x);
  });
});

describe("project file handling", () => {
  const passage = {
    title: "Test",
    text: "Choice overload makes consumers hesitate.",
    language: "en" as const,
    sources: [],
    ocrNotes: [],
  };

  it("creates a project with one page and the required format", () => {
    const project = createProject("테스트", passage);
    expect(project.format).toBe(PROJECT_FORMAT);
    expect(project.pages).toHaveLength(1);
    expect(project.pages[0].elements).toHaveLength(0);
  });

  it("rejects files from other applications", () => {
    expect(() => normalizeProject({ format: "other" })).toThrow();
  });

  it("normalizes a saved project and keeps pages", () => {
    const project = createProject("저장 테스트", passage);
    const normalized = normalizeProject(JSON.parse(JSON.stringify(project)));
    expect(normalized.name).toBe("저장 테스트");
    expect(normalized.pages.length).toBe(1);
    expect(normalized.settings.defaultPageSize).toBeTruthy();
  });
});

describe("AI content composition", () => {
  const passage = {
    title: "Choice",
    text: "Choice overload makes consumers hesitate. More options can reduce satisfaction.",
    language: "en" as const,
    sources: [],
    ocrNotes: [],
  };

  const analysis: PassageAnalysis = {
    topic: "선택 과부하",
    gist: "선택지가 많으면 오히려 결정을 어렵게 만든다.",
    title: "The Paradox of Choice",
    oneLineSummary: "선택지가 많다고 항상 좋은 것은 아니다.",
    thesis: "선택지의 수가 만족도를 낮출 수 있다.",
    keyEvidence: ["실험 결과", "소비자 인터뷰"],
    keySentences: [{ text: "More options can reduce satisfaction.", note: "핵심 주장" }],
    paragraphs: [{ index: 1, content: "도입", role: "문제 제기" }],
    structureLabel: "문제 → 원인 → 해결",
    structureSteps: ["문제", "원인", "해결"],
    modelId: "gemini-3.8-flash",
    createdAt: new Date().toISOString(),
  };

  it("turns the analysis into editable pages", () => {
    const project = { ...createProject("문서", passage), analysis };
    const pages = composeDocument(project, "analysis");
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0].elements.length).toBeGreaterThan(3);
    expect(pages.every((page) => page.size === "A4")).toBe(true);
  });

  it("creates blank workbook sheets with one box per problem", () => {
    const project = {
      ...createProject("워크북", passage),
      workbook: {
        id: "wb",
        difficulty: "medium" as const,
        counts: {
          lineTranslation: 1,
          sentenceOrder: 0,
          paragraphOrder: 0,
          koreanBlank: 0,
          englishBlank: 0,
          vocabBlank: 0,
          sentenceCompletion: 0,
        },
        problems: [
          {
            id: "p1",
            kind: "lineTranslation" as const,
            number: 1,
            prompt: "다음 문장을 해석하세요.",
            segments: [],
            answer: "선택 과부하는 소비자를 망설이게 한다.",
            alternatives: [],
            explanation: "",
            evidence: "",
            needsReview: false,
            sourceSentence: "Choice overload makes consumers hesitate.",
          },
        ],
        modelId: "gemini-3.8-flash",
        createdAt: new Date().toISOString(),
      },
    };
    const pages = composeDocument(project, "workbook");
    expect(pages[0].elements.some((element) => element.type === "text")).toBe(true);
  });
});

describe("usage statistics", () => {
  const records: UsageRecord[] = [
    {
      id: "1",
      modelId: "gemini-3.8-flash",
      task: "analysis",
      at: "2026-11-24T01:00:00.000Z",
      ok: true,
      promptTokens: 100,
      outputTokens: 50,
    },
    {
      id: "2",
      modelId: "gemini-3.8-flash",
      task: "workbook",
      at: "2026-11-24T02:00:00.000Z",
      ok: false,
      limitHit: true,
      errorKind: "quota",
      errorMessage: "quota exceeded",
    },
  ];

  it("separates success, failure and quota hits per model", () => {
    const stats = usageStats(records);
    expect(stats.totalRequests).toBe(2);
    expect(stats.totalSuccess).toBe(1);
    expect(stats.totalFailure).toBe(1);
    expect(stats.byModel["gemini-3.8-flash"].limitHits).toBe(1);
    expect(stats.byModel["gemini-3.8-flash"].promptTokens).toBe(100);
    expect(stats.daily.at(-1)?.date).toBe("2026-11-24");
  });
});
