import type { GeminiModel, ModelPricing } from "../types";

/**
 * Pricing snapshot for the Gemini Developer API (standard tier).
 *
 * Google does not expose prices through the API, so this table is the only
 * source the app can use. A model that is not listed here is treated as
 * "가격 확인 불가" and is never called automatically when paid usage is enabled.
 */
export const PRICING_SNAPSHOT = {
  checkedAt: "2026-11-24",
  sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
  sourceLabel: "Google Gemini Developer API 가격표(Standard tier) 기준",
  currency: "USD",
} as const;

const RULES: { pattern: RegExp; pricing: ModelPricing | null; note?: string }[] = [
  { pattern: /^gemini-2\.5-pro/, pricing: { inputPerMillion: 1.25, outputPerMillion: 10 }, note: "입력 200k 토큰 이하 기준" },
  { pattern: /^gemini-2\.5-flash-lite/, pricing: { inputPerMillion: 0.1, outputPerMillion: 0.4 } },
  { pattern: /^gemini-2\.5-flash/, pricing: { inputPerMillion: 0.3, outputPerMillion: 2.5 } },
  { pattern: /^gemini-2\.0-flash-lite/, pricing: { inputPerMillion: 0.075, outputPerMillion: 0.3 } },
  { pattern: /^gemini-2\.0-flash/, pricing: { inputPerMillion: 0.1, outputPerMillion: 0.4 } },
  { pattern: /^gemini-1\.5-pro/, pricing: { inputPerMillion: 1.25, outputPerMillion: 5 } },
  { pattern: /^gemini-1\.5-flash-8b/, pricing: { inputPerMillion: 0.0375, outputPerMillion: 0.15 } },
  { pattern: /^gemini-1\.5-flash/, pricing: { inputPerMillion: 0.075, outputPerMillion: 0.3 } },
  { pattern: /^gemma-/, pricing: { inputPerMillion: 0, outputPerMillion: 0 }, note: "무료 공개 모델" },
];

export function lookupPricing(modelId: string): ModelPricing | null {
  for (const rule of RULES) {
    if (!rule.pattern.test(modelId)) continue;
    if (!rule.pricing) return null;
    return rule.note ? { ...rule.pricing, note: rule.note } : rule.pricing;
  }
  return null;
}

export function estimateCostUsd(
  pricing: ModelPricing | null | undefined,
  promptTokens: number,
  outputTokens: number,
): number | null {
  if (!pricing) return null;
  const cost =
    (Math.max(0, promptTokens) / 1_000_000) * pricing.inputPerMillion +
    (Math.max(0, outputTokens) / 1_000_000) * pricing.outputPerMillion;
  // Round to 1e-6 dollars so tiny requests do not accumulate float noise.
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function isPaidModel(model: GeminiModel): boolean {
  const pricing = model.pricing;
  if (!pricing) return false;
  return pricing.inputPerMillion > 0 || pricing.outputPerMillion > 0;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

export function formatUsdPrecise(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value === 0) return "$0.000000";
  return `$${value.toFixed(6)}`;
}

/** Price per 1M tokens shown in the model table. */
export function describePricing(model: GeminiModel): string {
  if (!model.pricing) return "가격 확인 불가";
  if (!isPaidModel(model)) return "무료";
  return `$${model.pricing.inputPerMillion} / $${model.pricing.outputPerMillion}`;
}
