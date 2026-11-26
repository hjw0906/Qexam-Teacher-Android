import type { TaskKind } from "../types";

export interface CatalogEntry {
  pattern: RegExp;
  freeTier: "free" | "paid-only" | "unknown";
  /** Capability weight per task (0-10). Higher is preferred by the router. */
  weights: Partial<Record<TaskKind, number>>;
  note?: string;
}

/**
 * Snapshot of Google's published Free tier column for the Gemini Developer API.
 * Only models listed as "Free of charge" are eligible for automatic routing.
 * Source: https://ai.google.dev/gemini-api/docs/pricing (checked 2026-11-24)
 * Google changes this list often; the UI always shows the check date and the
 * live model list from models.list is treated as the source of truth for
 * availability.
 */
export const FREE_CATALOG = {
  checkedAt: "2026-11-24",
  sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
  sourceLabel: "Google Gemini Developer API 가격표(Free tier 열) 기준",
};

const W = {
  strong: { analysis: 10, easy: 9, vocab: 8, workbook: 9, answer: 9, verify: 9 },
  balanced: { analysis: 9, easy: 9, vocab: 10, workbook: 10, answer: 10, verify: 9 },
  fast: { analysis: 7, easy: 8, vocab: 9, workbook: 9, answer: 9, verify: 7 },
  light: { analysis: 5, easy: 6, vocab: 7, workbook: 6, answer: 6, verify: 5 },
  legacy: { analysis: 4, easy: 5, vocab: 6, workbook: 5, answer: 5, verify: 4 },
};

export const CATALOG: CatalogEntry[] = [
  { pattern: /^gemini-4-hydrogen/, freeTier: "free", weights: W.strong, note: "Gemini 4 계열 중 유일한 무료 티어 모델" },
  { pattern: /^gemini-3\.8-flash/, freeTier: "free", weights: W.strong },
  { pattern: /^gemini-3\.6-flash/, freeTier: "free", weights: W.strong },
  { pattern: /^gemini-3-flash/, freeTier: "free", weights: W.balanced, note: "preview 포함" },
  { pattern: /^gemini-3\.5-flash-lite/, freeTier: "free", weights: W.fast },
  { pattern: /^gemini-3\.1-flash-lite/, freeTier: "free", weights: W.fast },
  { pattern: /^gemini-2\.5-flash-lite/, freeTier: "free", weights: W.legacy },
  { pattern: /^gemini-2\.5-flash/, freeTier: "free", weights: W.legacy },
  { pattern: /^gemini-2\.5-pro/, freeTier: "free", weights: { ...W.strong, analysis: 8 }, note: "무료 티어 제공되나 일일 한도가 낮은 편" },
  { pattern: /^gemma-/, freeTier: "free", weights: W.light },

  { pattern: /^gemini-4-(carbon|neon|argon)/, freeTier: "paid-only", weights: {} },
  { pattern: /^gemini-3\.1-pro/, freeTier: "paid-only", weights: {} },
  { pattern: /(image|imagen|nano-banana|veo|lyria|omni|tts|audio|live|embedding)/, freeTier: "paid-only", weights: {} },
  { pattern: /^gemini-2\.0-/, freeTier: "unknown", weights: {} },
];

export interface FreeLookup {
  freeTier: "free" | "paid-only" | "unknown";
  weights: Partial<Record<TaskKind, number>>;
  note?: string;
}

export function lookupCatalog(modelId: string): FreeLookup {
  for (const entry of CATALOG) {
    if (entry.pattern.test(modelId)) {
      return { freeTier: entry.freeTier, weights: entry.weights, note: entry.note };
    }
  }
  return { freeTier: "unknown", weights: {} };
}

const NON_TEXT = /(embedding|imagen|veo|lyria|tts|audio|live|omni|aqa|image)/;

export function isTextModel(modelId: string, methods: string[]): boolean {
  if (!methods.includes("generateContent")) return false;
  return !NON_TEXT.test(modelId);
}
