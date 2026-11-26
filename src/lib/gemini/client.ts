import type { GeminiModel, UsageErrorKind } from "../types";
import { isTextModel, lookupCatalog } from "./catalog";
import { lookupPricing } from "./pricing";
import { sleep, stripCodeFence } from "../utils";

export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface ApiErrorPayload {
  message: string;
  status?: string;
  details?: unknown[];
}

function readDetails(details: unknown[] | undefined) {
  const result = {
    code: undefined as string | undefined,
    quotaId: undefined as string | undefined,
    quotaMetric: undefined as string | undefined,
    quotaValue: undefined as string | undefined,
    retryAfterMs: undefined as number | undefined,
    freeTierEvidence: false as boolean,
    paidEvidence: false as boolean,
  };
  for (const detail of details ?? []) {
    if (!detail || typeof detail !== "object") continue;
    const record = detail as Record<string, unknown>;
    const type = String(record["@type"] ?? "");
    if (type.includes("QuotaFailure")) {
      const violations = Array.isArray(record.violations) ? record.violations : [];
      for (const violation of violations) {
        if (!violation || typeof violation !== "object") continue;
        const v = violation as Record<string, unknown>;
        result.quotaId ??= typeof v.quotaId === "string" ? v.quotaId : undefined;
        result.quotaMetric ??= typeof v.quotaMetric === "string" ? v.quotaMetric : undefined;
        result.quotaValue ??=
          v.quotaValue !== undefined ? String(v.quotaValue) : undefined;
        const probe = `${v.quotaId ?? ""} ${v.quotaMetric ?? ""}`.toLowerCase();
        if (probe.includes("free")) result.freeTierEvidence = true;
        if (probe.includes("paid")) result.paidEvidence = true;
      }
    }
    if (type.includes("RetryInfo")) {
      const delay = String(record.retryDelay ?? "");
      const match = delay.match(/^([\d.]+)s$/);
      if (match) result.retryAfterMs = Math.round(Number(match[1]) * 1000);
    }
    if (type.includes("ErrorInfo")) {
      result.code ??= typeof record.reason === "string" ? record.reason : undefined;
      const metadata = record.metadata;
      if (metadata && typeof metadata === "object") {
        const probe = JSON.stringify(metadata).toLowerCase();
        if (probe.includes("free")) result.freeTierEvidence = true;
        if (probe.includes("paid")) result.paidEvidence = true;
      }
    }
  }
  return result;
}

export class GeminiApiError extends Error {
  status: number;
  kind: UsageErrorKind;
  code?: string;
  quotaId?: string;
  quotaMetric?: string;
  quotaValue?: string;
  retryAfterMs?: number;
  freeTierEvidence: boolean;
  paidEvidence: boolean;

  constructor(init: {
    message: string;
    status: number;
    kind: UsageErrorKind;
    code?: string;
    quotaId?: string;
    quotaMetric?: string;
    quotaValue?: string;
    retryAfterMs?: number;
    freeTierEvidence?: boolean;
    paidEvidence?: boolean;
  }) {
    super(init.message);
    this.name = "GeminiApiError";
    this.status = init.status;
    this.kind = init.kind;
    this.code = init.code;
    this.quotaId = init.quotaId;
    this.quotaMetric = init.quotaMetric;
    this.quotaValue = init.quotaValue;
    this.retryAfterMs = init.retryAfterMs;
    this.freeTierEvidence = init.freeTierEvidence ?? false;
    this.paidEvidence = init.paidEvidence ?? false;
  }
}

function classifyStatus(status: number, code: string | undefined, message: string): UsageErrorKind {
  const probe = `${code ?? ""} ${message}`.toLowerCase();
  if (status === 400 && (probe.includes("api_key_invalid") || probe.includes("api key not valid"))) {
    return "invalid-key";
  }
  if (status === 401 || status === 403) return "permission";
  if (status === 429) return "quota";
  if (status === 408 || status === 409 || status >= 500) return "transient";
  if (status === 400) return "invalid-request";
  return "unknown";
}

async function toApiError(response: Response): Promise<GeminiApiError> {
  let payload: ApiErrorPayload | null = null;
  const raw = await response.text().catch(() => "");
  try {
    payload = raw ? (JSON.parse(raw) as ApiErrorPayload) : null;
  } catch {
    payload = null;
  }
  const message = payload?.message ?? (raw ? raw.slice(0, 400) : `HTTP ${response.status}`);
  const parsed = readDetails(payload?.details);
  const kind = classifyStatus(response.status, parsed.code, message);
  return new GeminiApiError({
    message,
    status: response.status,
    kind,
    ...parsed,
  });
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
    wasTimeout: () => timedOut,
  };
}

/* ------------------------------------------------------------------ */
/* Model discovery                                                     */
/* ------------------------------------------------------------------ */

interface RawModel {
  name?: string;
  baseModelId?: string;
  version?: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}

export function toGeminiModel(raw: RawModel): GeminiModel {
  const fullName = raw.name ?? "";
  const id = (raw.baseModelId ?? fullName.replace(/^models\//, "")) || fullName;
  const methods = raw.supportedGenerationMethods ?? [];
  const lookup = lookupCatalog(id);
  const pricing = lookupPricing(id);
  return {
    id,
    name: fullName,
    displayName: raw.displayName || id,
    description: raw.description || "",
    version: raw.version,
    inputTokenLimit: raw.inputTokenLimit,
    outputTokenLimit: raw.outputTokenLimit,
    methods,
    freeTier: lookup.freeTier,
    freeSource: lookup.freeTier === "unknown" ? "none" : "catalog",
    textCapable: isTextModel(id, methods),
    deprecated: /deprecated|retired/i.test(`${raw.description ?? ""} ${raw.displayName ?? ""}`),
    pricing,
    freeAvailable: lookup.freeTier === "free",
    paidAvailable: pricing !== null,
  };
}

/** Zero-token diagnostic call: lists models available to the key. */
export async function listModels(
  apiKey: string,
  signal?: AbortSignal,
  timeoutMs = 25_000,
): Promise<GeminiModel[]> {
  const models: GeminiModel[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const url = new URL(`${GEMINI_API_BASE}/models`);
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("key", apiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const gate = combineSignals(signal, timeoutMs);
    let response: Response;
    try {
      response = await fetch(url.toString(), { method: "GET", signal: gate.signal });
    } catch (error) {
      gate.cleanup();
      if (gate.wasTimeout()) {
        throw new GeminiApiError({
          message: "모델 목록 요청 시간이 초과되었습니다.",
          status: 0,
          kind: "timeout",
        });
      }
      throw new GeminiApiError({
        message: "네트워크에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.",
        status: 0,
        kind: "network",
      });
    }
    gate.cleanup();

    if (!response.ok) throw await toApiError(response);

    const payload = (await response.json()) as {
      models?: RawModel[];
      nextPageToken?: string;
    };
    for (const raw of payload.models ?? []) models.push(toGeminiModel(raw));
    pageToken = payload.nextPageToken;
    if (!pageToken) break;
  }
  const seen = new Set<string>();
  return models.filter((model) => {
    if (!model.id || seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Content generation                                                  */
/* ------------------------------------------------------------------ */

export interface GenerateRequest {
  apiKey: string;
  modelId: string;
  system: string;
  prompt: string;
  schema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface GenerateResponse {
  text: string;
  modelId: string;
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs: number;
}

interface RawCandidateResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export async function generateContent(request: GenerateRequest): Promise<GenerateResponse> {
  const modelPath = request.modelId.startsWith("models/")
    ? request.modelId
    : `models/${request.modelId}`;
  const url = `${GEMINI_API_BASE}/${modelPath}:generateContent?key=${encodeURIComponent(
    request.apiKey,
  )}`;

  const generationConfig: Record<string, unknown> = {
    temperature: request.temperature ?? 0.35,
    maxOutputTokens: request.maxOutputTokens ?? 8192,
  };
  if (request.schema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = request.schema;
  }

  const body = {
    systemInstruction: { parts: [{ text: request.system }] },
    contents: [{ role: "user", parts: [{ text: request.prompt }] }],
    generationConfig,
    safetySettings: [] as unknown[],
  };

  const gate = combineSignals(request.signal, request.timeoutMs ?? 120_000);
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: gate.signal,
    });
  } catch (error) {
    gate.cleanup();
    if (request.signal?.aborted) {
      throw new GeminiApiError({
        message: "사용자가 요청을 취소했습니다.",
        status: 0,
        kind: "timeout",
      });
    }
    if (gate.wasTimeout()) {
      throw new GeminiApiError({
        message: "응답 시간이 초과되었습니다. (120초)",
        status: 0,
        kind: "timeout",
      });
    }
    throw new GeminiApiError({
      message: "네트워크 오류로 요청을 보낼 수 없습니다.",
      status: 0,
      kind: "network",
    });
  }
  gate.cleanup();
  const latencyMs = Date.now() - started;

  if (!response.ok) throw await toApiError(response);

  const payload = (await response.json()) as RawCandidateResponse;
  const blockReason = payload.promptFeedback?.blockReason;
  if (blockReason) {
    throw new GeminiApiError({
      message: `요청이 안전 정책으로 차단되었습니다 (${blockReason}). 지문 내용을 확인해 주세요.`,
      status: 200,
      kind: "invalid-request",
      code: blockReason,
    });
  }
  const text = (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) {
    throw new GeminiApiError({
      message: "모델이 빈 응답을 반환했습니다. 잠시 후 다시 시도해 주세요.",
      status: 200,
      kind: "transient",
    });
  }
  return {
    text,
    modelId: request.modelId,
    promptTokens: payload.usageMetadata?.promptTokenCount,
    outputTokens: payload.usageMetadata?.candidatesTokenCount,
    totalTokens: payload.usageMetadata?.totalTokenCount,
    latencyMs,
  };
}

export function parseJsonResponse<T>(text: string): T {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    throw new GeminiApiError({
      message: "AI 응답을 JSON으로 해석하지 못했습니다. 다시 시도해 주세요.",
      status: 200,
      kind: "invalid-request",
      code: "INVALID_JSON",
    });
  }
}

/** Exponential-ish backoff used between transient retries. */
export async function backoffDelay(attempt: number): Promise<void> {
  await sleep(Math.min(4000, 700 * 2 ** attempt));
}
