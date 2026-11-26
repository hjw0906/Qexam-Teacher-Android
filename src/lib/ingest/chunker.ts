/**
 * Sentence paragraph aware text splitting.
 *
 * Chunks are exact slices of the normalised source (`text === chunks.map(c => c.text).join("")`),
 * so concatenating them reproduces the original document without duplicated or
 * lost characters. Splits prefer a paragraph break, then a sentence break, and
 * only fall back to a hard cut when a single sentence is longer than the budget.
 */

export interface TextChunk {
  text: string;
  start: number;
  end: number;
}

const SENTENCE_END = /[.!?。！？…](?:["'”’)\]]*)\s+|\n+/g;

function lastSentenceBreak(window: string): number {
  SENTENCE_END.lastIndex = 0;
  let match = SENTENCE_END.exec(window);
  let last = -1;
  while (match) {
    last = match.index + match[0].length;
    match = SENTENCE_END.exec(window);
  }
  return last;
}

export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function splitTextSmart(raw: string, maxChars: number): TextChunk[] {
  const text = normalizeText(raw);
  const limit = Math.max(500, Math.floor(maxChars));
  if (!text) return [];
  if (text.length <= limit) return [{ text, start: 0, end: text.length }];

  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(text.length, start + limit);
    if (end < text.length) {
      const window = text.slice(start, end);
      const paragraph = window.lastIndexOf("\n\n");
      if (paragraph > limit * 0.45) {
        end = start + paragraph + 2;
      } else {
        const sentence = lastSentenceBreak(window);
        if (sentence > limit * 0.35) end = start + sentence;
      }
      if (end <= start) end = Math.min(text.length, start + limit);
      if (end > text.length) end = text.length;
    }
    chunks.push({ text: text.slice(start, end), start, end });
    start = end;
  }

  return chunks;
}

/** Rough token estimate: CJK characters are close to one token each, Latin ~4 chars. */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let latin = 0;
  let other = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 0xac00 && code <= 0xd7af) || (code >= 0x4e00 && code <= 0x9fff)) cjk += 1;
    else if (/[A-Za-z0-9]/.test(char)) latin += 1;
    else other += 1;
  }
  return Math.ceil(cjk * 1.05 + latin / 3.8 + other / 2.5);
}

/**
 * Characters that fit in one request for a model, keeping a wide safety margin
 * for the system prompt, JSON schema and the generated answer.
 */
export function chunkBudgetFor(inputTokenLimit: number | null | undefined, floor = 4_000): number {
  if (!inputTokenLimit || inputTokenLimit <= 0) return 12_000;
  const reserve = Math.min(8_000, Math.max(2_000, Math.floor(inputTokenLimit * 0.15)));
  const usableTokens = inputTokenLimit - reserve;
  // 2 tokens per character is a conservative ceiling for mixed Korean/English.
  const chars = Math.floor(usableTokens / 2);
  return Math.max(floor, Math.min(chars, 16_000));
}

export interface PlanOptions {
  maxChars: number;
  /** Tail of the previous chunk, prepended as context for the next request. */
  contextChars?: number;
}

export interface ChunkPlan {
  chunks: TextChunk[];
  maxChars: number;
  usesBoundaries: boolean;
  totalChars: number;
}

export function planChunks(text: string, options: PlanOptions): ChunkPlan {
  const chunks = splitTextSmart(text, options.maxChars);
  const usesBoundaries = chunks.every((chunk) => {
    if (chunk.end >= text.length) return true;
    return /[.!?。！？…"'\u201d\u2019)\]]\s*$/.test(chunk.text);
  });
  return {
    chunks,
    maxChars: options.maxChars,
    usesBoundaries,
    totalChars: normalizeText(text).length,
  };
}

/** Load only the first `contextChars` characters of the previous chunk tail. */
export function contextTail(previous: string, contextChars: number): string {
  if (!previous || contextChars <= 0) return "";
  const slice = previous.slice(-contextChars);
  const boundary = slice.lastIndexOf("\n\n");
  if (boundary >= 0 && slice.length - (boundary + 2) >= 10) return slice.slice(boundary + 2);
  return slice;
}
