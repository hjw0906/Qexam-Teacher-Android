import { create } from "zustand";
import type {
  AiBudgets,
  AiPolicy,
  CostApprovalRequest,
  CostDecision,
  DiagnosticsResult,
  GeminiModel,
  ModelMode,
  TierVerdict,
  UsageRecord,
} from "../lib/types";
import { GeminiApiError, listModels, toGeminiModel } from "../lib/gemini/client";
import { FREE_CATALOG } from "../lib/gemini/catalog";
import { estimateCostUsd, isPaidModel } from "../lib/gemini/pricing";
import {
  clearUsage,
  costTotals,
  loadUsage,
  recordLimitObservation,
  remainingBudget,
  tierEvidence,
} from "../lib/gemini/usage";
import { loadJson, saveJson } from "../lib/storage";
import { deleteSecret, readSecret, saveSecret, secretStatus } from "../lib/tauri";
import { errorMessage, nowIso } from "../lib/utils";

export const DEFAULT_POLICY: AiPolicy = {
  mode: "free-first",
  allowPaidModels: false,
  budgets: { dailyUsd: 1, monthlyUsd: 10, perRequestUsd: 0.2 },
  confirmPaidRequests: true,
};

interface AiPrefs {
  preferredModelId: string | null;
  blockedModelIds: string[];
  autoCheckedAt: string | null;
  policy: AiPolicy;
}

interface CachedDiagnostics {
  models: GeminiModel[];
  checkedAt: string | null;
  keyValid: boolean;
  message?: string;
}

interface AiState {
  initialized: boolean;
  keyPresent: boolean;
  keyMethod: string;
  keyPath: string;
  keyValid: boolean;
  status: "idle" | "checking" | "ready" | "error";
  models: GeminiModel[];
  lastCheckedAt: string | null;
  tier: TierVerdict;
  tierEvidence: string;
  policy: AiPolicy;
  preferredModelId: string | null;
  blockedModelIds: string[];
  usage: UsageRecord[];
  error: string | null;
  costPrompt: CostApprovalRequest | null;

  init: () => Promise<void>;
  saveKey: (key: string) => Promise<DiagnosticsResult>;
  removeKey: () => Promise<void>;
  testConnection: (key?: string) => Promise<DiagnosticsResult>;
  refreshModels: () => Promise<DiagnosticsResult | null>;
  setPolicy: (partial: Partial<AiPolicy>) => void;
  setBudgets: (partial: Partial<AiBudgets>) => void;
  setMode: (mode: ModelMode) => void;
  setAllowPaidModels: (value: boolean) => void;
  setPreferredModel: (modelId: string | null) => void;
  toggleBlockedModel: (modelId: string) => void;
  refreshUsage: () => void;
  evaluateCost: (model: GeminiModel, promptTokens: number, outputTokens: number) => CostDecision;
  requestCostApproval: (request: CostApprovalRequest) => Promise<boolean>;
  resolveCostApproval: (approved: boolean) => void;
  noteServerQuotaEvidence: (error: GeminiApiError, modelId: string, task: UsageRecord["task"]) => void;
  resetUsage: () => void;
}

const PREFS_KEY = "ai.prefs.v1";

function normalizePolicy(raw: unknown): AiPolicy {
  const data = (raw ?? {}) as Partial<AiPolicy> & { budgets?: Partial<AiBudgets> };
  const modes: ModelMode[] = ["auto", "free-first", "quality", "cost", "speed"];
  const mode = modes.includes(data.mode as ModelMode) ? (data.mode as ModelMode) : DEFAULT_POLICY.mode;
  const budgets: AiBudgets = {
    dailyUsd: Number.isFinite(data.budgets?.dailyUsd) ? Number(data.budgets?.dailyUsd) : DEFAULT_POLICY.budgets.dailyUsd,
    monthlyUsd: Number.isFinite(data.budgets?.monthlyUsd)
      ? Number(data.budgets?.monthlyUsd)
      : DEFAULT_POLICY.budgets.monthlyUsd,
    perRequestUsd: Number.isFinite(data.budgets?.perRequestUsd)
      ? Number(data.budgets?.perRequestUsd)
      : DEFAULT_POLICY.budgets.perRequestUsd,
  };
  return {
    mode,
    allowPaidModels: Boolean(data.allowPaidModels),
    budgets,
    confirmPaidRequests: data.confirmPaidRequests === undefined ? true : Boolean(data.confirmPaidRequests),
  };
}

function loadPrefs(): AiPrefs {
  const stored = loadJson<Partial<AiPrefs>>(PREFS_KEY, {});
  return {
    preferredModelId: stored.preferredModelId ?? null,
    blockedModelIds: Array.isArray(stored.blockedModelIds) ? stored.blockedModelIds : [],
    autoCheckedAt: stored.autoCheckedAt ?? null,
    policy: normalizePolicy(stored.policy),
  };
}

function savePrefs(state: AiState): void {
  saveJson(PREFS_KEY, {
    preferredModelId: state.preferredModelId,
    blockedModelIds: state.blockedModelIds,
    autoCheckedAt: state.lastCheckedAt,
    policy: state.policy,
  } satisfies AiPrefs);
}

function computeDiagnostics(models: GeminiModel[], keyValid: boolean): DiagnosticsResult {
  const textModels = models.filter((model) => model.textCapable);
  const evidence = tierEvidence();
  return {
    keyValid,
    keyCheckedAt: nowIso(),
    tier: evidence.tier,
    tierEvidence: evidence.evidence,
    models,
    totalModels: textModels.length,
    freeModels: textModels.filter((model) => model.freeAvailable).length,
    paidOnlyModels: textModels.filter((model) => !model.freeAvailable && isPaidModel(model)).length,
    unknownModels: textModels.filter((model) => !model.pricing).length,
    pricedModels: textModels.filter((model) => model.paidAvailable).length,
  };
}

function describeFailure(error: unknown): string {
  if (error instanceof GeminiApiError) {
    switch (error.kind) {
      case "invalid-key":
        return "API 키가 유효하지 않습니다. Google AI Studio에서 발급한 키를 다시 확인해 주세요.";
      case "permission":
        return "이 API 키에는 Generative Language API 접근 권한이 없습니다.";
      case "network":
        return "네트워크에 연결할 수 없습니다.";
      case "timeout":
        return "요청 시간이 초과되었습니다.";
      case "quota":
        return "요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.";
      default:
        return error.message;
    }
  }
  return errorMessage(error);
}

function cacheDiagnostics(models: GeminiModel[], checkedAt: string | null): void {
  saveJson("ai.diagnostics.v1", {
    models,
    checkedAt,
    keyValid: true,
  } satisfies CachedDiagnostics);
}

function loadCache(): CachedDiagnostics {
  return {
    models: [],
    checkedAt: null,
    keyValid: false,
    ...loadJson<Partial<CachedDiagnostics>>("ai.diagnostics.v1", {}),
  };
}

let approvalResolver: ((value: boolean) => void) | null = null;

export const useAiStore = create<AiState>((set, get) => ({
  initialized: false,
  keyPresent: false,
  keyMethod: "-",
  keyPath: "-",
  keyValid: false,
  status: "idle",
  models: [],
  lastCheckedAt: null,
  tier: "unknown",
  tierEvidence: "아직 진단하지 않았습니다.",
  policy: DEFAULT_POLICY,
  preferredModelId: null,
  blockedModelIds: [],
  usage: [],
  error: null,
  costPrompt: null,

  init: async () => {
    if (get().initialized) return;
    const prefs = loadPrefs();
    const cache = loadCache();
    const evidence = tierEvidence();
    set({
      initialized: true,
      policy: prefs.policy,
      preferredModelId: prefs.preferredModelId,
      blockedModelIds: prefs.blockedModelIds,
      models: cache.models ?? [],
      lastCheckedAt: cache.checkedAt,
      keyValid: cache.keyValid,
      tier: evidence.tier,
      tierEvidence: evidence.evidence,
      usage: loadUsage(),
    });
    try {
      const status = await secretStatus();
      set({ keyPresent: status.exists, keyMethod: status.method, keyPath: status.path });
      if (status.exists) await get().refreshModels();
    } catch (error) {
      set({ error: describeFailure(error) });
    }
  },

  saveKey: async (key: string) => {
    set({ status: "checking", error: null });
    try {
      const models = await listModels(key.trim());
      await saveSecret(key.trim());
      const diagnostics = computeDiagnostics(models, true);
      const status = await secretStatus();
      set({
        keyPresent: true,
        keyValid: true,
        models,
        lastCheckedAt: diagnostics.keyCheckedAt,
        status: "ready",
        tier: diagnostics.tier,
        tierEvidence: diagnostics.tierEvidence,
        keyMethod: status.method,
        keyPath: status.path,
        error: null,
      });
      cacheDiagnostics(models, diagnostics.keyCheckedAt);
      savePrefs(get());
      return diagnostics;
    } catch (error) {
      set({ status: "error", keyValid: false, error: describeFailure(error) });
      throw error;
    }
  },

  removeKey: async () => {
    await deleteSecret();
    saveJson("ai.diagnostics.v1", { models: [], checkedAt: null, keyValid: false });
    set({
      keyPresent: false,
      keyValid: false,
      models: [],
      lastCheckedAt: null,
      status: "idle",
      error: null,
      tier: "unknown",
      tierEvidence: "API 키가 삭제되어 진단 정보가 없습니다.",
    });
  },

  testConnection: async (key?: string) => {
    set({ status: "checking", error: null });
    const effectiveKey = (key ?? (await readSecret()) ?? "").trim();
    if (!effectiveKey) {
      set({ status: "error", keyValid: false, error: "저장된 API 키가 없습니다." });
      throw new Error("저장된 API 키가 없습니다.");
    }
    try {
      const models = await listModels(effectiveKey);
      const diagnostics = computeDiagnostics(models, true);
      set({
        keyValid: true,
        models,
        lastCheckedAt: diagnostics.keyCheckedAt,
        status: "ready",
        tier: diagnostics.tier,
        tierEvidence: diagnostics.tierEvidence,
        error: null,
      });
      cacheDiagnostics(models, diagnostics.keyCheckedAt);
      return diagnostics;
    } catch (error) {
      set({ status: "error", keyValid: false, error: describeFailure(error) });
      throw error;
    }
  },

  refreshModels: async () => {
    const key = (await readSecret())?.trim();
    if (!key) return null;
    set({ status: "checking" });
    try {
      const models = await listModels(key);
      const diagnostics = computeDiagnostics(models, true);
      const previous = get().models;
      const previousIds = new Set(previous.map((model) => model.id));
      const added = models.filter((model) => !previousIds.has(model.id));
      const removed = previous.filter((model) => !models.some((candidate) => candidate.id === model.id));
      set({
        models,
        keyValid: true,
        lastCheckedAt: diagnostics.keyCheckedAt,
        status: "ready",
        tier: diagnostics.tier,
        tierEvidence: diagnostics.tierEvidence,
        error:
          previous.length && (added.length || removed.length)
            ? `모델 목록이 갱신되었습니다. 추가 ${added.length}개 · 제외 ${removed.length}개`
            : null,
      });
      cacheDiagnostics(models, diagnostics.keyCheckedAt);
      savePrefs(get());
      return diagnostics;
    } catch (error) {
      set({ status: "error", error: describeFailure(error) });
      return null;
    }
  },

  setPolicy: (partial) => {
    set({ policy: { ...get().policy, ...partial } });
    savePrefs(get());
  },

  setBudgets: (partial) => {
    const policy = get().policy;
    set({ policy: { ...policy, budgets: { ...policy.budgets, ...partial } } });
    savePrefs(get());
  },

  setMode: (mode) => {
    set({ policy: { ...get().policy, mode } });
    savePrefs(get());
  },

  setAllowPaidModels: (value) => {
    set({ policy: { ...get().policy, allowPaidModels: value } });
    savePrefs(get());
  },

  setPreferredModel: (modelId: string | null) => {
    set({ preferredModelId: modelId });
    savePrefs(get());
  },

  toggleBlockedModel: (modelId: string) => {
    const blocked = get().blockedModelIds;
    const next = blocked.includes(modelId) ? blocked.filter((id) => id !== modelId) : [...blocked, modelId];
    set({ blockedModelIds: next });
    savePrefs(get());
  },

  refreshUsage: () => set({ usage: loadUsage() }),

  evaluateCost: (model, promptTokens, outputTokens) => {
    const { policy, tier, usage } = get();
    const totals = costTotals(usage);
    const remaining = remainingBudget(policy.budgets, totals);
    const pricingKnown = model.pricing !== null;
    const estimate = {
      promptTokens,
      outputTokens,
      pricingKnown,
      costUsd: estimateCostUsd(model.pricing, promptTokens, outputTokens),
    };

    if (!policy.allowPaidModels) {
      if (!model.freeAvailable) {
        return {
          allowed: false,
          blockedReason: "무료 모델 우선 모드입니다. AI 설정에서 ‘유료 모델 사용 허용’을 켜야 이 모델을 쓸 수 있습니다.",
          estimate: { ...estimate, costUsd: 0 },
          remainingDailyUsd: remaining.dailyUsd,
          remainingMonthlyUsd: remaining.monthlyUsd,
          needsConfirmation: false,
        };
      }
      return {
        allowed: true,
        blockedReason: null,
        estimate: { ...estimate, costUsd: 0 },
        remainingDailyUsd: remaining.dailyUsd,
        remainingMonthlyUsd: remaining.monthlyUsd,
        needsConfirmation: false,
      };
    }

    if (!pricingKnown) {
      return {
        allowed: false,
        blockedReason: "이 모델의 가격이 가격표 스냅샷에 없어 비용을 확인할 수 없습니다. 자동 호출하지 않습니다.",
        estimate,
        remainingDailyUsd: remaining.dailyUsd,
        remainingMonthlyUsd: remaining.monthlyUsd,
        needsConfirmation: false,
      };
    }
    if (tier === "free") {
      return {
        allowed: false,
        blockedReason:
          "Google 응답으로 무료 티어가 확인된 키입니다. 유료 모델을 호출하면 권한 오류가 발생하므로 자동 호출하지 않습니다.",
        estimate,
        remainingDailyUsd: remaining.dailyUsd,
        remainingMonthlyUsd: remaining.monthlyUsd,
        needsConfirmation: false,
      };
    }
    const cost = estimate.costUsd ?? 0;
    if (policy.budgets.perRequestUsd > 0 && cost > policy.budgets.perRequestUsd) {
      return {
        allowed: false,
        blockedReason: `요청당 최대 비용($${policy.budgets.perRequestUsd})을 초과하는 예상 비용($${cost.toFixed(4)})입니다.`,
        estimate,
        remainingDailyUsd: remaining.dailyUsd,
        remainingMonthlyUsd: remaining.monthlyUsd,
        needsConfirmation: false,
      };
    }
    if (remaining.dailyUsd !== null && cost > remaining.dailyUsd) {
      return {
        allowed: false,
        blockedReason: `일일 예산이 부족합니다. 남은 예산 $${remaining.dailyUsd.toFixed(4)} < 예상 비용 $${cost.toFixed(4)}.`,
        estimate,
        remainingDailyUsd: remaining.dailyUsd,
        remainingMonthlyUsd: remaining.monthlyUsd,
        needsConfirmation: false,
      };
    }
    if (remaining.monthlyUsd !== null && cost > remaining.monthlyUsd) {
      return {
        allowed: false,
        blockedReason: `월간 예산이 부족합니다. 남은 예산 $${remaining.monthlyUsd.toFixed(4)} < 예상 비용 $${cost.toFixed(4)}.`,
        estimate,
        remainingDailyUsd: remaining.dailyUsd,
        remainingMonthlyUsd: remaining.monthlyUsd,
        needsConfirmation: false,
      };
    }

    return {
      allowed: true,
      blockedReason: null,
      estimate,
      remainingDailyUsd: remaining.dailyUsd,
      remainingMonthlyUsd: remaining.monthlyUsd,
      needsConfirmation: policy.confirmPaidRequests && cost > 0,
    };
  },

  requestCostApproval: (request) =>
    new Promise<boolean>((resolve) => {
      approvalResolver = resolve;
      set({ costPrompt: request });
    }),

  resolveCostApproval: (approved) => {
    const resolve = approvalResolver;
    approvalResolver = null;
    set({ costPrompt: null });
    resolve?.(approved);
  },

  noteServerQuotaEvidence: (error, modelId, task) => {
    if (!error.freeTierEvidence && !error.paidEvidence) return;
    recordLimitObservation({
      modelId,
      quotaId: error.quotaId,
      quotaMetric: error.quotaMetric,
      quotaValue: error.quotaValue,
      retryAfterMs: error.retryAfterMs,
      status: error.status,
      message: `${error.message} (${task})`,
      observedAt: nowIso(),
    });
    const evidence = tierEvidence();
    set({ tier: evidence.tier, tierEvidence: evidence.evidence });
  },

  resetUsage: () => {
    clearUsage();
    set({ usage: [] });
  },
}));

export const catalogMeta = FREE_CATALOG;

export function refreshModelFromRaw(raw: unknown): GeminiModel | null {
  if (!raw || typeof raw !== "object") return null;
  return toGeminiModel(raw as Record<string, unknown>);
}
