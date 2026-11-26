import type {
  AnswerKey,
  EasyExplanation,
  PassageAnalysis,
  ProblemCounts,
  ProblemKind,
  Difficulty,
  VocabDirection,
  VocabSet,
  VerificationReport,
  Workbook,
  WorkbookProblem,
  TaskKind,
  AttemptInfo,
  UsageErrorKind,
  GeminiModel,
} from "../types";
import { PROBLEM_KIND_LABELS } from "../types";
import { useAiStore } from "../../store/aiStore";
import {
  GeminiApiError,
  backoffDelay,
  generateContent,
  parseJsonResponse,
} from "./client";
import { rankModels } from "./router";
import { recordUsage, setCooldown } from "./usage";
import { nowIso, truncate, uid } from "../utils";
import { chunkBudgetFor, contextTail, estimateTokens, planChunks, splitTextSmart } from "../ingest/chunker";
import { estimateCostUsd } from "./pricing";
import { loadAiCheckpoint, pruneAiCheckpoints, saveAiCheckpoint } from "../ingest/checkpoint";

export class AiTaskError extends Error {
  code: "no-key" | "no-consent" | "no-model" | "all-failed" | "invalid" | "aborted";
  detail: string;
  attempts: AttemptInfo[];

  constructor(
    code: AiTaskError["code"],
    message: string,
    detail = "",
    attempts: AttemptInfo[] = [],
  ) {
    super(message);
    this.name = "AiTaskError";
    this.code = code;
    this.detail = detail;
    this.attempts = attempts;
  }
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export interface RunResult<T> {
  data: T;
  modelId: string;
  attempts: AttemptInfo[];
  switched: boolean;
}

const MAX_PASSAGE_CHARS = 14_000;

function preparePassage(text: string): { text: string; truncated: boolean } {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  return {
    text: truncate(cleaned, MAX_PASSAGE_CHARS),
    truncated: cleaned.length > MAX_PASSAGE_CHARS,
  };
}

async function ensureUsable(): Promise<{ key: string; models: ReturnType<typeof useAiStore.getState>["models"] }> {
  const state = useAiStore.getState();
  if (!state.keyPresent) {
    throw new AiTaskError(
      "no-key",
      "Gemini API 키가 등록되어 있지 않습니다.",
      "왼쪽 메뉴의 'AI 설정'에서 API 키를 저장하면 AI 기능을 사용할 수 있습니다.",
    );
  }
  const { readSecret } = await import("../tauri");
  const key = (await readSecret())?.trim();
  if (!key) {
    throw new AiTaskError("no-key", "저장된 API 키를 읽을 수 없습니다. 키를 다시 저장해 주세요.");
  }
  if (!state.models.length) {
    await useAiStore.getState().refreshModels();
  }
  const models = useAiStore.getState().models;
  if (!models.length) {
    throw new AiTaskError(
      "no-model",
      "사용 가능한 Gemini 모델 목록이 없습니다.",
      "인터넷 연결을 확인하고 AI 설정에서 '모델 목록 새로고침'을 실행해 주세요.",
    );
  }
  return { key, models };
}

function mapErrorKind(error: GeminiApiError): UsageErrorKind {
  return error.kind;
}

export async function runJsonTask<T>(args: {
  task: TaskKind;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
  options?: RunOptions;
}): Promise<RunResult<T>> {
  const { key, models } = await ensureUsable();
  const state = useAiStore.getState();
  const policy = state.policy;
  const promptTokens = estimateTokens(`${args.system}\n${args.prompt}`);
  const estimatedOutput = Math.max(256, Math.min(args.maxOutputTokens ?? 4096, 4096));
  const ranked = rankModels(models, args.task, {
    blockedModelIds: state.blockedModelIds,
    preferredModelId: state.preferredModelId,
    allowPaidModels: policy.allowPaidModels,
    mode: policy.mode,
    tier: state.tier,
    estimatedPromptTokens: promptTokens,
    estimatedOutputTokens: estimatedOutput,
    perRequestUsd: policy.budgets.perRequestUsd,
  });

  if (!ranked.length) {
    throw new AiTaskError(
      "no-model",
      policy.allowPaidModels
        ? "지금 설정에서 자동 호출할 수 있는 Gemini 모델이 없습니다."
        : "무료로 사용할 수 있는 Gemini 모델이 없습니다.",
      policy.allowPaidModels
        ? "모델 목록·차단 설정·예산을 확인해 주세요. 가격이 확인되지 않은 모델은 자동 호출하지 않습니다."
        : "AI 설정에서 ‘유료 모델 사용 허용’을 켜면 해당 티어에서 접근 가능한 유료 모델도 자동 선택에 포함됩니다. 무료 여부가 확인되지 않은 모델은 호출하지 않습니다.",
    );
  }

  const attempts: AttemptInfo[] = [];
  let switched = false;
  let paidApproved = false;
  let paidDeclined = false;
  let budgetBlocked = 0;
  let lastError: AiTaskError | null = null;

  for (const model of ranked.slice(0, 4)) {
    if (args.options?.signal?.aborted) {
      throw new AiTaskError("aborted", "사용자가 요청을 취소했습니다.", "", attempts);
    }
    if (model.cooldownMs > Date.now()) {
      attempts.push({
        modelId: model.id,
        ok: false,
        errorKind: "quota",
        message: "쿨다운 중이라 건너뜀",
      });
      continue;
    }

    if (paidDeclined && model.paid) continue;

    const decision = useAiStore.getState().evaluateCost(model, promptTokens, estimatedOutput);
    if (!decision.allowed) {
      budgetBlocked += 1;
      attempts.push({
        modelId: model.id,
        ok: false,
        message: decision.blockedReason ?? "비용/예산 확인 불가",
      });
      continue;
    }

    if (model.paid && decision.needsConfirmation && !paidApproved) {
      const approved = await useAiStore.getState().requestCostApproval({
        task: args.task,
        modelId: model.id,
        displayName: model.displayName || model.id,
        costUsd: decision.estimate.costUsd ?? 0,
        promptTokens: decision.estimate.promptTokens,
        outputTokens: decision.estimate.outputTokens,
        remainingDailyUsd: decision.remainingDailyUsd,
        remainingMonthlyUsd: decision.remainingMonthlyUsd,
      });
      if (!approved) {
        paidDeclined = true;
        attempts.push({
          modelId: model.id,
          ok: false,
          message: "사용자가 유료 요청을 승인하지 않아 무료 모델만 사용합니다.",
        });
        continue;
      }
      paidApproved = true;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      args.options?.onProgress?.(`${model.displayName || model.id} 호출 중…`);
      const started = Date.now();
      try {
        const response = await generateContent({
          apiKey: key,
          modelId: model.id,
          system: args.system,
          prompt: args.prompt,
          schema: args.schema,
          maxOutputTokens: args.maxOutputTokens,
          signal: args.options?.signal,
        });
        const actualCost =
          model.pricing !== null
            ? estimateCostUsd(
                model.pricing,
                response.promptTokens ?? promptTokens,
                response.outputTokens ?? estimatedOutput,
              ) ?? 0
            : 0;
        let parsed: T;
        try {
          parsed = parseJsonResponse<T>(response.text);
        } catch (parseError) {
          recordUsage({
            modelId: model.id,
            task: args.task,
            ok: false,
            errorKind: "invalid-request",
            errorCode: "INVALID_JSON",
            errorMessage: "AI 응답 JSON 해석 실패",
            promptTokens: response.promptTokens,
            outputTokens: response.outputTokens,
            totalTokens: response.totalTokens,
            latencyMs: Date.now() - started,
            switched,
            costUsd: actualCost,
            paid: model.paid,
          });
          attempts.push({
            modelId: model.id,
            ok: false,
            errorKind: "invalid-request",
            message: "JSON 응답 형식 오류",
          });
          lastError = new AiTaskError(
            "invalid",
            "AI가 올바른 JSON 형식으로 응답하지 않았습니다.",
            parseError instanceof Error ? parseError.message : "",
            attempts,
          );
          break;
        }
        recordUsage({
          modelId: model.id,
          task: args.task,
          ok: true,
          promptTokens: response.promptTokens,
          outputTokens: response.outputTokens,
          totalTokens: response.totalTokens,
          latencyMs: response.latencyMs,
          switched,
          costUsd: actualCost,
          paid: model.paid,
        });
        useAiStore.getState().refreshUsage();
        attempts.push({ modelId: model.id, ok: true });
        return { data: parsed, modelId: model.id, attempts, switched };
      } catch (error) {
        const apiError =
          error instanceof GeminiApiError
            ? error
            : new GeminiApiError({
                message: error instanceof Error ? error.message : "알 수 없는 오류",
                status: 0,
                kind: "unknown",
              });
        const limitHit = apiError.kind === "quota";
        recordUsage({
          modelId: model.id,
          task: args.task,
          ok: false,
          status: apiError.status,
          errorKind: mapErrorKind(apiError),
          errorCode: apiError.code,
          errorMessage: apiError.message,
          latencyMs: Date.now() - started,
          limitHit,
          switched,
        });
        useAiStore
          .getState()
          .noteServerQuotaEvidence(apiError, model.id, args.task);
        attempts.push({
          modelId: model.id,
          ok: false,
          errorKind: apiError.kind,
          message: apiError.message,
        });

        if (limitHit) {
          setCooldown(model.id, apiError.retryAfterMs ?? 60_000);
          lastError = new AiTaskError(
            "all-failed",
            "무료 사용 한도에 도달했습니다.",
            `${model.id} · ${apiError.message}`,
            attempts,
          );
          break; // quota errors move straight to the next model
        }

        if (apiError.kind === "invalid-key" || apiError.kind === "permission") {
          throw new AiTaskError(
            "invalid",
            apiError.kind === "invalid-key"
              ? "API 키가 유효하지 않습니다."
              : "API 키 권한이 부족합니다.",
            apiError.message,
            attempts,
          );
        }

        if (apiError.kind === "invalid-request") {
          throw new AiTaskError(
            "invalid",
            "요청 형식이 올바르지 않아 AI가 처리하지 못했습니다.",
            apiError.message,
            attempts,
          );
        }

        if (args.options?.signal?.aborted) {
          throw new AiTaskError("aborted", "사용자가 요청을 취소했습니다.", "", attempts);
        }

        lastError = new AiTaskError(
          "all-failed",
          "모델 호출에 실패했습니다.",
          `${model.id} · ${apiError.message}`,
          attempts,
        );

        if (attempt === 0) {
          await backoffDelay(attempt);
          continue;
        }
        break;
      }
    }

    switched = true;
    args.options?.onProgress?.(`${model.id} 실패 → 다음 무료 모델로 전환합니다.`);
  }

  throw (
    lastError ??
    new AiTaskError(
      "all-failed",
      "사용 가능한 Gemini 모델 호출에 실패했습니다.",
      budgetBlocked
        ? `예산·가격 조건으로 ${budgetBlocked}개 모델이 차단되었습니다. AI 설정의 예산/모델 정책을 확인해 주세요. 완료된 작업 내용은 저장되어 있습니다.`
        : "잠시 후 다시 시도해 주세요. 한도 초과인 경우 작업 내용은 저장되어 있습니다.",
      attempts,
    )
  );
}

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const str = { type: "string" } as const;
const strArray = { type: "array", items: { type: "string" } } as const;

const partialAnalysisSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    topic: str,
    gist: str,
    thesis: str,
    keyEvidence: strArray,
    keySentences: {
      type: "array",
      items: {
        type: "object",
        properties: { text: str, note: str },
        required: ["text", "note"],
      },
    },
    paragraphs: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, content: str, role: str },
        required: ["index", "content", "role"],
      },
    },
    structureLabel: str,
    structureSteps: strArray,
  },
  required: ["topic", "gist", "thesis", "keyEvidence", "keySentences", "paragraphs", "structureLabel", "structureSteps"],
};

const synthesisSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    topic: str,
    gist: str,
    title: str,
    oneLineSummary: str,
    thesis: str,
    structureLabel: str,
    structureSteps: strArray,
  },
  required: ["topic", "gist", "title", "oneLineSummary", "thesis", "structureLabel", "structureSteps"],
};

const analysisSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    topic: str,
    gist: str,
    title: str,
    oneLineSummary: str,
    thesis: str,
    keyEvidence: strArray,
    keySentences: {
      type: "array",
      items: {
        type: "object",
        properties: { text: str, note: str },
        required: ["text", "note"],
      },
    },
    paragraphs: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, content: str, role: str },
        required: ["index", "content", "role"],
      },
    },
    structureLabel: str,
    structureSteps: strArray,
  },
  required: [
    "topic",
    "gist",
    "title",
    "oneLineSummary",
    "thesis",
    "keyEvidence",
    "keySentences",
    "paragraphs",
    "structureLabel",
    "structureSteps",
  ],
};

const easySchema: Record<string, unknown> = {
  type: "object",
  properties: {
    background: str,
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: { term: str, explanation: str },
        required: ["term", "explanation"],
      },
    },
    examples: strArray,
    paragraphs: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, easy: str },
        required: ["index", "easy"],
      },
    },
    rewrittenSentences: {
      type: "array",
      items: {
        type: "object",
        properties: { original: str, easy: str },
        required: ["original", "easy"],
      },
    },
    summary: str,
    glossary: {
      type: "array",
      items: {
        type: "object",
        properties: { term: str, meaning: str, usage: str },
        required: ["term", "meaning", "usage"],
      },
    },
  },
  required: [
    "background",
    "concepts",
    "examples",
    "paragraphs",
    "rewrittenSentences",
    "summary",
    "glossary",
  ],
};

const vocabSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          word: str,
          meaning: str,
          partOfSpeech: str,
          context: str,
        },
        required: ["word", "meaning", "partOfSpeech", "context"],
      },
    },
  },
  required: ["items"],
};

const workbookSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    problems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: Object.keys(PROBLEM_KIND_LABELS) as string[],
          },
          prompt: str,
          segments: strArray,
          answer: str,
          alternatives: strArray,
          explanation: str,
          evidence: str,
          sourceSentence: str,
          needsReview: { type: "boolean" },
        },
        required: [
          "kind",
          "prompt",
          "segments",
          "answer",
          "alternatives",
          "explanation",
          "evidence",
          "sourceSentence",
          "needsReview",
        ],
      },
    },
  },
  required: ["problems"],
};

const answerSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          problemId: str,
          answer: str,
          explanation: str,
          evidence: str,
          alternatives: strArray,
        },
        required: ["problemId", "answer", "explanation", "evidence", "alternatives"],
      },
    },
    notes: strArray,
  },
  required: ["entries", "notes"],
};

const verifySchema: Record<string, unknown> = {
  type: "object",
  properties: {
    summary: str,
    overall: { type: "string", enum: ["pass", "warn", "fail"] },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: str,
          severity: { type: "string", enum: ["info", "warning", "error"] },
          target: str,
          message: str,
          suggestion: str,
        },
        required: ["category", "severity", "target", "message", "suggestion"],
      },
    },
  },
  required: ["summary", "overall", "issues"],
};

/* ------------------------------------------------------------------ */
/* Helpers for tolerant parsing                                        */
/* ------------------------------------------------------------------ */

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asString).filter((item) => item.trim()) : [];
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
}

const TEACHER_SYSTEM = `당신은 한국 학원의 영어/국어 수업 자료를 만드는 전문 교사입니다.
- 모든 설명은 자연스러운 한국어로 작성합니다.
- 원문의 의미를 바꾸거나 없는 내용을 추가하지 않습니다.
- 확실하지 않은 내용은 추측하지 말고 빈 문자열로 남깁니다.
- 요청된 JSON 스키마에 정확히 맞춰 응답하며, JSON 외의 텍스트를 출력하지 않습니다.`;

/* ------------------------------------------------------------------ */
/* Tasks                                                              */
/* ------------------------------------------------------------------ */

export async function analyzePassage(
  passageText: string,
  title: string,
  options: RunOptions = {},
): Promise<{ analysis: PassageAnalysis; modelId: string; attempts: AttemptInfo[] }> {
  const cleaned = passageText.replace(/\r\n/g, "\n").trim();
  if (!cleaned) throw new AiTaskError("invalid", "지문이 비어 있습니다.");
  const plan = analysisPlan(cleaned, useAiStore.getState().models);
  if (plan.needsChunking) {
    return analyzeLongPassage(cleaned, title, plan, options);
  }
  const prompt = `다음 지문을 분석해 주세요.
${title ? `지문 제목(참고): ${title}\n` : ""}
[지문]
${cleaned}

작성 지침:
- topic: 글의 주제 (한 문장)
- gist: 글의 요지 (2~3문장)
- title: 지문 내용에 어울리는 제목 (원문 제목이 있으면 유지)
- oneLineSummary: 한 줄 요약
- thesis: 필자의 핵심 주장
- keyEvidence: 핵심 근거 2~5개
- keySentences: 주요 문장 3~6개와 각 문장의 역할/의미
- paragraphs: 문단별 내용과 역할(예: 도입, 근거 제시, 반박, 결론). 지문의 실제 문단 구분을 따릅니다.
- structureLabel: 지문의 논리 구조를 가장 잘 설명하는 이름. 예: "문제 → 원인 → 해결", "통념 → 반박 → 새 주장", "주장 → 근거 → 사례 → 결론". 억지로 분류하지 말고 애매하면 빈 문자열로 두세요.
- structureSteps: 논리 구조의 단계 목록
- 모든 내용은 한국어로 작성하고, 영어 지문의 경우 필요한 부분만 영어 인용을 사용합니다.`;

  const result = await runJsonTask<Record<string, unknown>>({
    task: "analysis",
    system: TEACHER_SYSTEM,
    prompt,
    schema: analysisSchema,
    options,
  });

  const raw = result.data;
  const paragraphs = asRecordArray(raw.paragraphs).map((item, index) => ({
    index: typeof item.index === "number" ? item.index : index + 1,
    content: asString(item.content),
    role: asString(item.role),
  }));
  const analysis: PassageAnalysis = {
    topic: asString(raw.topic),
    gist: asString(raw.gist),
    title: asString(raw.title) || title || "제목 없음",
    oneLineSummary: asString(raw.oneLineSummary),
    thesis: asString(raw.thesis),
    keyEvidence: asStringArray(raw.keyEvidence),
    keySentences: asRecordArray(raw.keySentences).map((item) => ({
      text: asString(item.text),
      note: asString(item.note),
    })),
    paragraphs,
    structureLabel: asString(raw.structureLabel).trim() || null,
    structureSteps: asStringArray(raw.structureSteps),
    modelId: result.modelId,
    createdAt: nowIso(),
    chunkCount: 1,
  };
  return { analysis, modelId: result.modelId, attempts: result.attempts };
}

export interface AnalysisPlan {
  chunkCount: number;
  maxChars: number;
  estimatedTokens: number;
  modelInputLimit: number | null;
  needsChunking: boolean;
}

/** How a passage would be split, using the best free model's input limit. */
export function analysisPlan(passageText: string, models: GeminiModel[] = []): AnalysisPlan {
  const ranked = models.length ? rankModels(models, "analysis") : [];
  const inputLimit = ranked[0]?.inputTokenLimit ?? null;
  const maxChars = chunkBudgetFor(inputLimit);
  const normalized = passageText.replace(/\r\n/g, "\n").trim();
  const chunks = planChunks(normalized, { maxChars }).chunks;
  return {
    chunkCount: Math.max(1, chunks.length),
    maxChars,
    estimatedTokens: estimateTokens(normalized),
    modelInputLimit: inputLimit,
    needsChunking: chunks.length > 1,
  };
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(36)}${text.length.toString(36)}`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

/**
 * Map-reduce analysis for documents that exceed one request. Each chunk is
 * analysed on its own (with the tail of the previous chunk as context), the
 * partial result is cached, and a final small request merges the parts.
 * Re-running after a failure or a quota hit reuses every cached chunk.
 */
async function analyzeLongPassage(
  cleaned: string,
  title: string,
  plan: AnalysisPlan,
  options: RunOptions,
): Promise<{ analysis: PassageAnalysis; modelId: string; attempts: AttemptInfo[] }> {
  const chunks = splitTextSmart(cleaned, plan.maxChars);
  const total = chunks.length;
  const documentKey = hashText(cleaned);
  const partials: Record<string, unknown>[] = [];
  const attempts: AttemptInfo[] = [];
  let reused = 0;

  for (let index = 0; index < total; index += 1) {
    if (options.signal?.aborted) {
      throw new AiTaskError("aborted", "사용자가 요청을 취소했습니다.", "", attempts);
    }
    const chunk = chunks[index];
    if (!chunk) continue;
    const cacheKey = `analysis:${documentKey}:${plan.maxChars}:${index}`;
    options.onProgress?.(`긴 지문 ${index + 1}/${total} 구간 분석 중…`);

    const cached = await loadAiCheckpoint<Record<string, unknown>>(cacheKey);
    if (cached) {
      partials.push(cached);
      reused += 1;
      continue;
    }

    const previous = index > 0 ? contextTail(chunks[index - 1]?.text ?? "", 600) : "";
    const prompt = `긴 지문을 ${total}개 구간으로 나누어 분석하고 있습니다. 아래는 ${index + 1}번째 구간입니다.
${
  previous
    ? `\n[앞 구간의 마지막 문맥 — 흐름 파악용이며 분석 대상이 아닙니다]\n${previous}\n`
    : ""
}
[지문 구간 ${index + 1}/${total}]
${chunk.text}

작성 지침(부분 분석):
- topic/gist/thesis: 이 구간의 내용을 기준으로 작성합니다.
- keyEvidence: 이 구간의 핵심 근거 1~3개
- keySentences: 이 구간의 주요 문장 1~3개와 각 문장의 역할
- paragraphs: 이 구간에 포함된 문단을 순서대로. index는 이 구간 안에서 1부터 시작합니다.
- structureLabel/structureSteps: 이 구간에서 보이는 논리 구조 (애매하면 빈 문자열)
- 모든 내용은 한국어로 작성합니다.`;

    const result = await runJsonTask<Record<string, unknown>>({
      task: "analysis",
      system: TEACHER_SYSTEM,
      prompt,
      schema: partialAnalysisSchema,
      options,
    });
    partials.push(result.data);
    attempts.push(...result.attempts);
    await saveAiCheckpoint(cacheKey, result.data);
  }

  if (reused) {
    options.onProgress?.(`저장된 구간 결과 ${reused}개를 재사용했습니다.`);
  }

  options.onProgress?.(`${total}개 구간을 하나의 분석으로 통합하는 중…`);
  const outline = partials.map((partial, index) => ({
    구간: index + 1,
    주제: asString(partial.topic),
    요지: asString(partial.gist),
    주장: asString(partial.thesis),
    구조: asString(partial.structureLabel),
    문단역할: asRecordArray(partial.paragraphs).map((item) => asString(item.role)),
  }));
  const synthesisPrompt = `아래는 하나의 긴 지문을 ${total}개 구간으로 나누어 분석한 결과입니다. 이 부분 결과를 종합해 글 전체에 대한 최종 분석을 작성해 주세요.
- topic: 글 전체의 주제
- gist: 글 전체의 요지 (2~3문장)
- title: 글 전체에 어울리는 제목${title ? ` (원문 제목 후보: ${title})` : ""}
- oneLineSummary: 한 줄 요약
- thesis: 필자의 핵심 주장
- structureLabel/structureSteps: 글 전체의 논리 구조
- 부분 결과에 없는 내용을 새로 만들지 말고, 구간별 흐름을 종합합니다.

[구간별 부분 분석]
${JSON.stringify(outline, null, 2)}`;

  const synthesisKey = `analysis:${documentKey}:${plan.maxChars}:synthesis`;
  const cachedSynthesis = await loadAiCheckpoint<Record<string, unknown>>(synthesisKey);
  let synthesisData: Record<string, unknown>;
  let synthesisModel: string;
  if (cachedSynthesis) {
    synthesisData = cachedSynthesis;
    synthesisModel = asString(cachedSynthesis.modelId) || "cache";
  } else {
    const synthesis = await runJsonTask<Record<string, unknown>>({
      task: "analysis",
      system: TEACHER_SYSTEM,
      prompt: synthesisPrompt,
      schema: synthesisSchema,
      options,
    });
    synthesisData = synthesis.data;
    synthesisModel = synthesis.modelId;
    attempts.push(...synthesis.attempts);
    await saveAiCheckpoint(synthesisKey, { ...synthesis.data, modelId: synthesis.modelId });
    await pruneAiCheckpoints();
  }

  const paragraphs = partials
    .flatMap((partial) => asRecordArray(partial.paragraphs))
    .map((item) => ({ content: asString(item.content), role: asString(item.role) }))
    .filter((item) => item.content.trim())
    .map((item, index) => ({ index: index + 1, content: item.content, role: item.role }));

  const sentenceMap = new Map<string, { text: string; note: string }>();
  for (const partial of partials) {
    for (const item of asRecordArray(partial.keySentences)) {
      const text = asString(item.text).trim();
      if (text && !sentenceMap.has(text)) sentenceMap.set(text, { text, note: asString(item.note) });
    }
  }

  const analysis: PassageAnalysis = {
    topic: asString(synthesisData.topic),
    gist: asString(synthesisData.gist),
    title: asString(synthesisData.title) || title || "제목 없음",
    oneLineSummary: asString(synthesisData.oneLineSummary),
    thesis: asString(synthesisData.thesis),
    keyEvidence: uniqueStrings(partials.flatMap((partial) => asStringArray(partial.keyEvidence))).slice(0, 8),
    keySentences: [...sentenceMap.values()].slice(0, 8),
    paragraphs,
    structureLabel: asString(synthesisData.structureLabel).trim() || null,
    structureSteps: asStringArray(synthesisData.structureSteps),
    modelId: synthesisModel,
    createdAt: nowIso(),
    chunkCount: total,
  };

  return { analysis, modelId: synthesisModel, attempts };
}

export async function createEasyExplanation(
  passageText: string,
  analysis: PassageAnalysis | null,
  options: RunOptions = {},
): Promise<{ easy: EasyExplanation; modelId: string; attempts: AttemptInfo[] }> {
  const prepared = preparePassage(passageText);
  const prompt = `다음 지문을 문해력이 약한 학생이 이해할 수 있도록 설명해 주세요.
${analysis ? `\n[이미 분석된 요지]\n${analysis.gist}\n` : ""}
[지문]
${prepared.text}

작성 지침:
- background: 이해에 필요한 배경지식
- concepts: 어려운 개념 3~6개와 쉬운 설명
- examples: 일상생활 속 사례 2~4개
- paragraphs: 문단별 쉬운 해설 (문단 번호와 함께)
- rewrittenSentences: 어려운 문장 3~5개를 쉽게 바꾼 문장 (원문 유지, 의미 왜곡 금지)
- summary: 핵심 내용 한 줄 정리
- glossary: 주요 용어 풀이 (term, meaning, usage)
- 학생에게 말하듯 친근하지만 과장하지 말고, 각 설명은 2~4문장으로 간결하게 작성합니다.`;

  const result = await runJsonTask<Record<string, unknown>>({
    task: "easy",
    system: TEACHER_SYSTEM,
    prompt,
    schema: easySchema,
    options,
  });
  const raw = result.data;
  const easy: EasyExplanation = {
    background: asString(raw.background),
    concepts: asRecordArray(raw.concepts).map((item) => ({
      term: asString(item.term),
      explanation: asString(item.explanation),
    })),
    examples: asStringArray(raw.examples),
    paragraphs: asRecordArray(raw.paragraphs).map((item, index) => ({
      index: typeof item.index === "number" ? item.index : index + 1,
      easy: asString(item.easy),
    })),
    rewrittenSentences: asRecordArray(raw.rewrittenSentences).map((item) => ({
      original: asString(item.original),
      easy: asString(item.easy),
    })),
    summary: asString(raw.summary),
    glossary: asRecordArray(raw.glossary).map((item) => ({
      term: asString(item.term),
      meaning: asString(item.meaning),
      usage: asString(item.usage),
    })),
    modelId: result.modelId,
    createdAt: nowIso(),
  };
  return { easy, modelId: result.modelId, attempts: result.attempts };
}

export async function createVocabSet(
  passageText: string,
  config: {
    count: number;
    direction: VocabDirection;
    difficulty: Difficulty;
    shuffle: boolean;
  },
  options: RunOptions = {},
): Promise<{ vocab: VocabSet; modelId: string }> {
  const prepared = preparePassage(passageText);
  const difficultyLabel =
    config.difficulty === "easy" ? "쉬움" : config.difficulty === "medium" ? "보통" : "어려움";
  const prompt = `다음 지문에서 시험에 낼 핵심 어휘 ${config.count}개를 선정해 주세요.
[지문]
${prepared.text}

작성 지침:
- 지문에서 실제로 사용된 의미를 우선합니다. 여러 뜻이 가능한 단어는 문맥에 맞는 뜻을 적습니다.
- 난이도: ${difficultyLabel}
- partOfSpeech: 품사 (명사, 동사, 형용사 등)
- context: 해당 단어가 쓰인 지문 속 문장(짧게)
- meaning: 한국어 뜻 (문맥에 맞는 뜻 하나)
- 서로 다른 단어 ${config.count}개를 선정하고 중복을 피합니다.`;

  const result = await runJsonTask<Record<string, unknown>>({
    task: "vocab",
    system: TEACHER_SYSTEM,
    prompt,
    schema: vocabSchema,
    options,
  });
  let items = asRecordArray(result.data.items)
    .map((item) => ({
      id: uid("voc"),
      word: asString(item.word).trim(),
      meaning: asString(item.meaning).trim(),
      partOfSpeech: asString(item.partOfSpeech).trim(),
      context: asString(item.context).trim(),
      selected: true,
    }))
    .filter((item) => item.word && item.meaning)
    .slice(0, config.count);
  if (config.shuffle) items = shuffle(items);

  const vocab: VocabSet = {
    direction: config.direction,
    difficulty: config.difficulty,
    count: config.count,
    shuffle: config.shuffle,
    items,
    modelId: result.modelId,
    createdAt: nowIso(),
  };
  return { vocab, modelId: result.modelId };
}

export async function createWorkbook(
  passageText: string,
  analysis: PassageAnalysis | null,
  counts: ProblemCounts,
  difficulty: Difficulty,
  options: RunOptions = {},
): Promise<{ workbook: Workbook; modelId: string }> {
  const prepared = preparePassage(passageText);
  const requested = (Object.entries(counts) as [ProblemKind, number][]).filter(
    ([, count]) => count > 0,
  );
  if (!requested.length) {
    throw new AiTaskError("invalid", "문제 개수를 하나 이상 선택해 주세요.");
  }
  const difficultyLabel =
    difficulty === "easy" ? "쉬움" : difficulty === "medium" ? "보통" : "어려움";
  const spec = requested
    .map(([kind, count]) => `- ${kind} (${PROBLEM_KIND_LABELS[kind]}): ${count}문제`)
    .join("\n");

  const prompt = `다음 지문으로 학생용 워크북 문제를 만들어 주세요.
${analysis ? `\n[지문 요지]\n${analysis.gist}\n` : ""}
[지문]
${prepared.text}

문제 구성 (정확히 이 개수를 지킬 것):
${spec}

난이도: ${difficultyLabel}

작성 지침:
- kind 값은 위에 지정된 영문 코드를 그대로 사용합니다.
- prompt: 학생에게 보여줄 문제 지시문과 내용. 빈칸은 ______ 로 표시합니다.
- segments: 순서 배열 문제(sentenceOrder, paragraphOrder)에서 학생에게 섞어 제시할 조각들입니다. 다른 유형은 빈 배열로 둡니다.
- answer: 정답. 순서 배열은 정답 순서를 "1-3-2-4"처럼 표시합니다.
- alternatives: 허용 가능한 다른 정답(없으면 빈 배열)
- explanation: 왜 그 답인지 쉬운 해설
- evidence: 지문에서 근거가 되는 부분 인용
- sourceSentence: 문제의 바탕이 된 원문 문장
- 정답이 불명확하거나 복수 정답이 가능하면 needsReview를 true로 설정합니다.
- 각 문제는 번호 없이 작성하고, 문제 순서는 유형 순서대로 정리합니다.`;

  const result = await runJsonTask<Record<string, unknown>>({
    task: "workbook",
    system: TEACHER_SYSTEM,
    prompt,
    schema: workbookSchema,
    maxOutputTokens: 16384,
    options,
  });

  const validKinds = new Set(Object.keys(PROBLEM_KIND_LABELS));
  const problems: WorkbookProblem[] = asRecordArray(result.data.problems)
    .filter((item) => validKinds.has(asString(item.kind)))
    .map((item, index) => ({
      id: uid("prob"),
      kind: asString(item.kind) as ProblemKind,
      number: index + 1,
      prompt: asString(item.prompt),
      segments: asStringArray(item.segments),
      answer: asString(item.answer),
      alternatives: asStringArray(item.alternatives),
      explanation: asString(item.explanation),
      evidence: asString(item.evidence),
      needsReview: Boolean(item.needsReview) || !asString(item.answer).trim(),
      sourceSentence: asString(item.sourceSentence),
    }))
    .filter((problem) => problem.prompt.trim().length > 0)
    .map((problem, index) => ({ ...problem, number: index + 1 }));

  if (!problems.length) {
    throw new AiTaskError(
      "invalid",
      "AI가 유효한 문제를 만들지 못했습니다.",
      "문제 개수와 지문 길이를 조정해 다시 시도해 주세요.",
    );
  }

  const workbook: Workbook = {
    id: uid("wb"),
    difficulty,
    counts,
    problems,
    modelId: result.modelId,
    createdAt: nowIso(),
  };
  return { workbook, modelId: result.modelId };
}

export async function createAnswerKey(
  passageText: string,
  workbook: Workbook,
  options: RunOptions = {},
): Promise<{ answerKey: AnswerKey; modelId: string }> {
  const prepared = preparePassage(passageText);
  const problemLines = workbook.problems
    .map(
      (problem) =>
        `- id=${problem.id} | 유형=${PROBLEM_KIND_LABELS[problem.kind]} | 문제=${problem.prompt} | 조각=${
          problem.segments.join(" / ") || "없음"
        } | 기존정답=${problem.answer || "미정"}`,
    )
    .join("\n");

  const prompt = `다음 문제들의 교사용 답안지를 작성해 주세요.
[지문]
${prepared.text}

[문제 목록]
${problemLines}

작성 지침:
- entries의 problemId는 위 문제의 id를 그대로 사용합니다. 문제를 새로 만들지 않습니다.
- answer: 정답
- explanation: 문제별 해설
- evidence: 정답의 근거 (지문 인용 또는 문법 설명)
- alternatives: 허용 가능한 대체 답안 (없으면 빈 배열)
- notes: 교사에게 필요한 전체 참고 사항 (없으면 빈 배열)`;

  const result = await runJsonTask<Record<string, unknown>>({
    task: "answer",
    system: TEACHER_SYSTEM,
    prompt,
    schema: answerSchema,
    maxOutputTokens: 16384,
    options,
  });

  const known = new Set(workbook.problems.map((problem) => problem.id));
  const entries = asRecordArray(result.data.entries)
    .map((item) => ({
      problemId: asString(item.problemId),
      answer: asString(item.answer),
      explanation: asString(item.explanation),
      evidence: asString(item.evidence),
      alternatives: asStringArray(item.alternatives),
    }))
    .filter((entry) => known.has(entry.problemId));

  const answered = new Set(entries.map((entry) => entry.problemId));
  const answerKey: AnswerKey = {
    sourceWorkbookId: workbook.id,
    entries,
    modelId: result.modelId,
    createdAt: nowIso(),
    missingProblemIds: workbook.problems
      .filter((problem) => !answered.has(problem.id))
      .map((problem) => problem.id),
    orphanProblemIds: entries.filter((entry) => !known.has(entry.problemId)).map((e) => e.problemId),
    notes: asStringArray(result.data.notes),
  };
  return { answerKey, modelId: result.modelId };
}

export async function verifyQuality(args: {
  passageText: string;
  analysis: PassageAnalysis | null;
  easy: EasyExplanation | null;
  vocab: VocabSet | null;
  workbook: Workbook | null;
  answerKey: AnswerKey | null;
  options?: RunOptions;
}): Promise<{ report: VerificationReport; modelId: string }> {
  const prepared = preparePassage(args.passageText);
  const parts: string[] = [`[지문]\n${prepared.text}`];
  if (args.analysis) {
    parts.push(
      `[분석]\n요지: ${args.analysis.gist}\n한줄요약: ${args.analysis.oneLineSummary}\n주장: ${args.analysis.thesis}`,
    );
  }
  if (args.easy) {
    parts.push(
      `[쉬운 설명]\n${args.easy.paragraphs
        .map((item) => `${item.index}문단: ${item.easy}`)
        .join("\n")}\n요약: ${args.easy.summary}`,
    );
  }
  if (args.vocab) {
    parts.push(
      `[단어]\n${args.vocab.items
        .map((item) => `${item.word} = ${item.meaning} (${item.partOfSpeech})`)
        .join("\n")}`,
    );
  }
  if (args.workbook) {
    parts.push(
      `[문제]\n${args.workbook.problems
        .map(
          (problem) =>
            `#${problem.number} (${problem.kind}) ${problem.prompt} / 정답: ${problem.answer}`,
        )
        .join("\n")}`,
    );
  }
  if (args.answerKey) {
    parts.push(
      `[답안지]\n${args.answerKey.entries
        .map((entry) => `${entry.problemId}: ${entry.answer}`)
        .join("\n")}\n누락: ${args.answerKey.missingProblemIds.length}건`,
    );
  }

  const prompt = `${parts.join("\n\n")}

위 자료를 검증해 주세요. 다음 항목을 확인합니다:
1. 원문과 요약/해설의 의미 일치
2. 해석 누락
3. 영어 문맥 오류
4. 문법 오류
5. 단어 뜻의 적절성
6. 빈칸 정답의 명확성 (복수 정답 가능성)
7. 순서 배열의 논리적 타당성
8. 답안지와 문제의 일치 여부

overall은 문제가 없으면 pass, 경미한 개선점은 warn, 명확한 오류는 fail로 설정합니다.
issues의 target에는 문제 번호나 단어 등 위치를 적습니다.`;

  const result = await runJsonTask<Record<string, unknown>>({
    task: "verify",
    system: TEACHER_SYSTEM,
    prompt,
    schema: verifySchema,
    maxOutputTokens: 8192,
    options: args.options,
  });

  const overallRaw = asString(result.data.overall);
  const report: VerificationReport = {
    summary: asString(result.data.summary),
    overall: overallRaw === "pass" || overallRaw === "fail" ? overallRaw : "warn",
    issues: asRecordArray(result.data.issues).map((item) => {
      const severity = asString(item.severity);
      return {
        category: asString(item.category),
        severity: severity === "error" || severity === "info" ? severity : "warning",
        target: asString(item.target),
        message: asString(item.message),
        suggestion: asString(item.suggestion),
      };
    }),
    modelId: result.modelId,
    createdAt: nowIso(),
  };
  return { report, modelId: result.modelId };
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function describeAiError(error: unknown): string {
  if (error instanceof AiTaskError) {
    return error.detail ? `${error.message}\n${error.detail}` : error.message;
  }
  if (error instanceof Error) return error.message;
  return "알 수 없는 오류가 발생했습니다.";
}
