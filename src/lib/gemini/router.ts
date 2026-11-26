import type { GeminiModel, ModelMode, TaskKind, TierVerdict } from "../types";
import { lookupCatalog } from "./catalog";
import { estimateCostUsd, isPaidModel } from "./pricing";
import { cooldownRemaining } from "./usage";

export interface RouteOptions {
  blockedModelIds?: string[];
  /** Force a specific model first (user selected it in settings). */
  preferredModelId?: string | null;
  /** When false (default) only documented free-tier models are eligible. */
  allowPaidModels?: boolean;
  mode?: ModelMode;
  /** Server evidence about the key's tier; must not be guessed. */
  tier?: TierVerdict;
  estimatedPromptTokens?: number;
  estimatedOutputTokens?: number;
  /** 0 = no per-request limit. */
  perRequestUsd?: number;
  now?: number;
}

export interface RankedModel extends GeminiModel {
  score: number;
  cooldownMs: number;
  reason: string;
  /** True when this attempt is expected to be billed. */
  paid: boolean;
  estimatedCostUsd: number | null;
}

function speedFactor(id: string): number {
  if (/flash-lite|lite|8b/.test(id)) return 3;
  if (/flash/.test(id)) return 2;
  if (/pro/.test(id)) return 0.5;
  return 1;
}

function priceFactor(pricing: GeminiModel["pricing"]): number {
  if (!pricing) return Number.POSITIVE_INFINITY;
  // Output tokens dominate the price of these tasks, so weight them higher.
  return pricing.inputPerMillion * 0.3 + pricing.outputPerMillion * 0.7;
}

/**
 * Ranks models for a task under the current policy.
 *
 * - Default (no `allowPaidModels`): only models documented as free-tier are
 *   eligible, which keeps the zero-cost behaviour of earlier versions.
 * - Paid allowed: models with a known price are eligible; a model whose price
 *   is not in the snapshot is never auto-called because its cost cannot be
 *   verified. Free-tier evidence from Google blocks paid models entirely.
 */
export function rankModels(
  models: GeminiModel[],
  task: TaskKind,
  options: RouteOptions = {},
): RankedModel[] {
  const now = options.now ?? Date.now();
  const blocked = new Set(options.blockedModelIds ?? []);
  const allowPaid = Boolean(options.allowPaidModels);
  const mode: ModelMode = options.mode ?? "free-first";
  const perRequest = options.perRequestUsd ?? 0;
  const promptTokens = Math.max(0, options.estimatedPromptTokens ?? 4_000);
  const outputTokens = Math.max(0, options.estimatedOutputTokens ?? 4_000);

  // Google telling us the project is on the free tier is direct evidence that
  // paid models are not reachable, even if the user enabled paid usage.
  const paidBlockedByTier = options.tier === "free";

  const base = models
    .filter((model) => model.textCapable)
    .filter((model) => model.methods.includes("generateContent"))
    .filter((model) => !model.deprecated)
    .filter((model) => !blocked.has(model.id))
    .filter((model) => (allowPaid ? model.paidAvailable : model.freeAvailable));

  // A key that Google reports as free-tier cannot reach paid-only models, but
  // its free models still work (at no charge).
  const eligible = paidBlockedByTier ? base.filter((model) => model.freeAvailable) : base;

  const priced = eligible.map((model) => priceFactor(model.pricing)).filter((value) => Number.isFinite(value));
  const maxPrice = priced.length ? Math.max(...priced) : 0;

  const ranked = eligible
    .map<RankedModel>((model) => {
      const weights = lookupCatalog(model.id).weights;
      const quality = weights[task] ?? 1;
      const cooldownMs = cooldownRemaining(model.id);
      const preferred = options.preferredModelId === model.id;
      const paid = allowPaid && isPaidModel(model) && !paidBlockedByTier;
      const cost = paid ? estimateCostUsd(model.pricing, promptTokens, outputTokens) : 0;
      const costFactor =
        maxPrice > 0 && Number.isFinite(priceFactor(model.pricing))
          ? 1 - Math.min(1, priceFactor(model.pricing) / maxPrice)
          : 1;
      const outputBonus = (model.outputTokenLimit ?? 0) >= 8192 ? 0.4 : 0;

      let score = quality + outputBonus;
      let reason = `작업 적합도 ${quality}/10`;
      if (mode === "quality") {
        score = quality * 1.2 + outputBonus;
        reason = `품질 우선 · 적합도 ${quality}/10`;
      } else if (mode === "cost") {
        score = quality * 0.45 + costFactor * 6;
        reason = `비용 절약 우선 · 적합도 ${quality}/10 · 상대 비용 ${Math.round((1 - costFactor) * 100)}%`;
      } else if (mode === "speed") {
        score = quality * 0.55 + speedFactor(model.id) * 1.8;
        reason = `속도 우선 · 적합도 ${quality}/10`;
      } else if (mode === "free-first") {
        score = (model.freeAvailable ? 500 : 0) + quality;
        reason = model.freeAvailable
          ? `무료 티어 모델 우선 · 적합도 ${quality}/10`
          : `무료 후보 다음 → 유료 모델 · 적합도 ${quality}/10`;
      } else {
        score = quality + costFactor * 3;
        reason = `자동 선택 · 적합도 ${quality}/10 · 상대 비용 ${Math.round((1 - costFactor) * 100)}%`;
      }

      if (preferred) {
        score += 1000;
        reason = "사용자가 지정한 모델";
      }

      return {
        ...model,
        score,
        cooldownMs,
        reason,
        paid,
        estimatedCostUsd: cost,
      };
    })
    .filter((model) => model.score > 0)
    .filter((model) => {
      // Never exceed the per-request cap; the task re-checks with exact tokens.
      if (!allowPaid || perRequest <= 0) return true;
      return model.estimatedCostUsd === null || model.estimatedCostUsd <= perRequest;
    });

  const available = ranked.filter((model) => model.cooldownMs <= now || model.cooldownMs === 0);
  const cooling = ranked.filter((model) => model.cooldownMs > 0);

  const sortByScore = (list: RankedModel[]) =>
    list.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.outputTokenLimit ?? 0) - (a.outputTokenLimit ?? 0);
    });

  return [...sortByScore(available), ...sortByScore(cooling)];
}

export function isRoutable(model: GeminiModel, options: RouteOptions = {}): boolean {
  return rankModels([model], "analysis", options).length > 0;
}
