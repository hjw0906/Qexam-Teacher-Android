import { describe, expect, it } from "vitest";
import { rankModels } from "../src/lib/gemini/router";
import {
  estimateCostUsd,
  formatUsd,
  lookupPricing,
} from "../src/lib/gemini/pricing";
import { costTotals, remainingBudget } from "../src/lib/gemini/usage";
import type { GeminiModel, ModelPricing, UsageRecord } from "../src/lib/types";

function makeModel(
  id: string,
  options: { free: boolean; pricing?: ModelPricing | null } = { free: true },
): GeminiModel {
  const pricing = options.pricing === undefined ? lookupPricing(id) : options.pricing;
  return {
    id,
    name: `models/${id}`,
    displayName: id,
    description: "",
    methods: ["generateContent"],
    freeTier: options.free ? "free" : "paid-only",
    freeSource: "catalog",
    textCapable: true,
    inputTokenLimit: 1_000_000,
    outputTokenLimit: 8192,
    pricing,
    freeAvailable: options.free,
    paidAvailable: pricing !== null,
  };
}

const flash = makeModel("gemini-2.5-flash", { free: true });
const pro = makeModel("gemini-2.5-pro", { free: true });
const proOnly = makeModel("paid-pro", { free: false, pricing: { inputPerMillion: 1.25, outputPerMillion: 10 } });
const unpriced = makeModel("gemini-3.1-pro-preview", { free: false, pricing: null });

describe("pricing", () => {
  it("knows published prices and reports unknown models as unverified", () => {
    expect(lookupPricing("gemini-2.5-flash")).toEqual({ inputPerMillion: 0.3, outputPerMillion: 2.5 });
    expect(lookupPricing("gemini-2.5-pro")?.outputPerMillion).toBe(10);
    expect(lookupPricing("gemini-4-hydrogen")).toBeNull();
    expect(lookupPricing("gemini-3.1-pro-preview")).toBeNull();
  });

  it("computes USD cost from token counts", () => {
    const pricing = { inputPerMillion: 0.3, outputPerMillion: 2.5 };
    expect(estimateCostUsd(pricing, 1_000_000, 1_000_000)).toBeCloseTo(2.8, 6);
    expect(estimateCostUsd(pricing, 10_000, 2_000)).toBeCloseTo(0.008, 6);
    expect(estimateCostUsd(null, 10_000, 2_000)).toBeNull();
  });

  it("formats small amounts without losing precision", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.00042)).toBe("$0.0004");
    expect(formatUsd(1.5)).toBe("$1.50");
  });
});

describe("model routing policy", () => {
  const all = [flash, pro, proOnly, unpriced];

  it("keeps the free-only default", () => {
    const ranked = rankModels(all, "analysis");
    expect(ranked.every((model) => model.freeAvailable)).toBe(true);
    expect(ranked.some((model) => model.id === "paid-pro")).toBe(false);
    expect(ranked.every((model) => model.paid === false && model.estimatedCostUsd === 0)).toBe(true);
  });

  it("includes priced paid models when paid usage is allowed", () => {
    const ranked = rankModels(all, "analysis", { allowPaidModels: true });
    expect(ranked.some((model) => model.id === "paid-pro")).toBe(true);
    // Price is not in the snapshot → never auto-called.
    expect(ranked.some((model) => model.id === "gemini-3.1-pro-preview")).toBe(false);
  });

  it("does not route paid models when Google reported a free-tier key", () => {
    const ranked = rankModels(all, "analysis", { allowPaidModels: true, tier: "free" });
    expect(ranked.some((model) => model.id === "paid-pro")).toBe(false);
    expect(ranked.every((model) => model.freeAvailable)).toBe(true);
  });

  it("prefers free models in free-first mode", () => {
    const ranked = rankModels([proOnly, flash], "analysis", { allowPaidModels: true, mode: "free-first" });
    expect(ranked[0]?.id).toBe("gemini-2.5-flash");
  });

  it("quality mode prefers the stronger model, cost mode the cheaper one", () => {
    const quality = rankModels([pro, flash], "analysis", {
      allowPaidModels: true,
      mode: "quality",
    });
    expect(quality[0]?.id).toBe("gemini-2.5-pro");

    const cost = rankModels([pro, flash], "analysis", {
      allowPaidModels: true,
      mode: "cost",
    });
    expect(cost[0]?.id).toBe("gemini-2.5-flash");
  });

  it("excludes models whose estimate exceeds the per-request cap", () => {
    const ranked = rankModels([pro, flash], "analysis", {
      allowPaidModels: true,
      mode: "quality",
      estimatedPromptTokens: 100_000,
      estimatedOutputTokens: 8_000,
      perRequestUsd: 0.1,
    });
    expect(ranked.map((model) => model.id)).toEqual(["gemini-2.5-flash"]);
  });

  it("honours user-blocked models and the preferred model", () => {
    const blocked = rankModels([flash, pro], "analysis", { blockedModelIds: ["gemini-2.5-pro"] });
    expect(blocked.map((model) => model.id)).toEqual(["gemini-2.5-flash"]);

    const preferred = rankModels([flash, pro], "analysis", { preferredModelId: "gemini-2.5-flash" });
    expect(preferred[0]?.id).toBe("gemini-2.5-flash");
  });
});

describe("budget tracking", () => {
  const record = (at: string, costUsd: number): UsageRecord => ({
    id: at + costUsd,
    modelId: flash.id,
    task: "analysis",
    at,
    ok: true,
    costUsd,
  });

  it("sums today, this month and all time", () => {
    const now = new Date();
    const todayIso = now.toISOString();
    const earlierIso = new Date(now.getTime() - 40 * 86_400_000).toISOString();
    const totals = costTotals([record(todayIso, 0.02), record(earlierIso, 0.5)]);
    expect(totals.todayUsd).toBeCloseTo(0.02, 6);
    expect(totals.totalUsd).toBeCloseTo(0.52, 6);
    expect(totals.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("reports remaining budget and treats 0 as unlimited", () => {
    const totals = { todayUsd: 0.4, monthUsd: 2, totalUsd: 2, today: "2026-01-01", month: "2026-01" };
    const remaining = remainingBudget({ dailyUsd: 1, monthlyUsd: 10, perRequestUsd: 0.2 }, totals);
    expect(remaining.dailyUsd).toBeCloseTo(0.6, 6);
    expect(remaining.monthlyUsd).toBeCloseTo(8, 6);
    const unlimited = remainingBudget({ dailyUsd: 0, monthlyUsd: 0, perRequestUsd: 0 }, totals);
    expect(unlimited.dailyUsd).toBeNull();
    expect(unlimited.monthlyUsd).toBeNull();
  });
});
