export const APP_NAME = "Qexam Teacher";
export const APP_TAGLINE = "AI-Powered Educational Worksheet Studio";
export const PROJECT_FORMAT = "qexam-teacher" as const;
export const PROJECT_VERSION = 1 as const;
export const PROJECT_EXTENSION = "qws";

export type MainView = "home" | "new" | "projects" | "ai" | "prefs" | "workspace";
export type WorkspaceTab =
  | "passage"
  | "analysis"
  | "easy"
  | "vocab"
  | "workbook"
  | "answers"
  | "verify"
  | "editor";

export const WORKSPACE_TABS: { id: WorkspaceTab; label: string }[] = [
  { id: "passage", label: "지문" },
  { id: "analysis", label: "분석" },
  { id: "easy", label: "쉬운 설명" },
  { id: "vocab", label: "단어 시험" },
  { id: "workbook", label: "워크북" },
  { id: "answers", label: "답안지" },
  { id: "verify", label: "품질 검증" },
  { id: "editor", label: "문서 편집" },
];

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

export type TaskKind = "analysis" | "easy" | "vocab" | "workbook" | "answer" | "verify";
export type FreeStatus = "free" | "paid-only" | "unknown";

/** USD per 1M tokens, from Google's published price list. */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  note?: string;
}

export interface GeminiModel {
  /** e.g. "gemini-3.8-flash" */
  id: string;
  /** full resource name from the API, e.g. "models/gemini-3.8-flash" */
  name: string;
  displayName: string;
  description: string;
  version?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  methods: string[];
  freeTier: FreeStatus;
  freeSource: "catalog" | "server" | "none";
  textCapable: boolean;
  deprecated?: boolean;
  /** null = price not in the snapshot, so paid use is not automatic. */
  pricing: ModelPricing | null;
  /** Free tier documented for this model. */
  freeAvailable: boolean;
  /** Paid tier price is known for this model. */
  paidAvailable: boolean;
}

export type TierVerdict = "free" | "tier1" | "tier2" | "tier3" | "paid" | "unknown";

export type ModelMode = "auto" | "free-first" | "quality" | "cost" | "speed";

export interface AiBudgets {
  /** 0 = no limit. USD. */
  dailyUsd: number;
  monthlyUsd: number;
  perRequestUsd: number;
}

export interface AiPolicy {
  mode: ModelMode;
  allowPaidModels: boolean;
  budgets: AiBudgets;
  /** Ask before the first paid request of a task run. */
  confirmPaidRequests: boolean;
}

export interface DiagnosticsResult {
  keyValid: boolean;
  keyCheckedAt: string;
  tier: TierVerdict;
  tierEvidence: string;
  models: GeminiModel[];
  totalModels: number;
  freeModels: number;
  paidOnlyModels: number;
  unknownModels: number;
  /** Models with a known price that can be called when paid usage is allowed. */
  pricedModels: number;
  message?: string;
}

export type UsageErrorKind =
  | "invalid-key"
  | "permission"
  | "quota"
  | "transient"
  | "invalid-request"
  | "network"
  | "timeout"
  | "blocked"
  | "unknown";

export interface UsageRecord {
  id: string;
  modelId: string;
  task: TaskKind;
  at: string;
  ok: boolean;
  status?: number;
  errorKind?: UsageErrorKind;
  errorCode?: string;
  errorMessage?: string;
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  limitHit?: boolean;
  switched?: boolean;
  /** Estimated or actual USD cost of the request (0 for free models). */
  costUsd?: number;
  /** True when the request ran on a paid model. */
  paid?: boolean;
}

export interface ModelUsageStat {
  modelId: string;
  requests: number;
  success: number;
  failure: number;
  limitHits: number;
  promptTokens: number;
  outputTokens: number;
  costUsd: number;
  lastUsedAt: string | null;
  lastError: string | null;
}

export interface ServerLimitObservation {
  modelId: string;
  quotaId?: string;
  quotaMetric?: string;
  quotaValue?: string;
  retryAfterMs?: number;
  status: number;
  message: string;
  observedAt: string;
}

export interface CostEstimate {
  promptTokens: number;
  outputTokens: number;
  pricingKnown: boolean;
  costUsd: number | null;
}

export interface CostDecision {
  allowed: boolean;
  blockedReason: string | null;
  estimate: CostEstimate;
  remainingDailyUsd: number | null;
  remainingMonthlyUsd: number | null;
  needsConfirmation: boolean;
}

export interface CostApprovalRequest {
  task: TaskKind;
  modelId: string;
  displayName: string;
  costUsd: number;
  promptTokens: number;
  outputTokens: number;
  remainingDailyUsd: number | null;
  remainingMonthlyUsd: number | null;
}

export interface AttemptInfo {
  modelId: string;
  ok: boolean;
  errorKind?: UsageErrorKind;
  message?: string;
}

/* ------------------------------------------------------------------ */
/* Passage & analysis                                                  */
/* ------------------------------------------------------------------ */

export interface PassageSource {
  name: string;
  kind: "text" | "txt" | "pdf" | "image";
  addedAt: string;
  /** Optional attachment metadata; older projects simply omit it. */
  size?: number;
  pages?: number;
  method?: string;
  chars?: number;
}

export interface Passage {
  title: string;
  text: string;
  language: "auto" | "ko" | "en";
  sources: PassageSource[];
  /** Notes about uncertain OCR text, shown to the teacher. */
  ocrNotes: string[];
}

export interface ParagraphInfo {
  index: number;
  content: string;
  role: string;
}

export interface KeySentence {
  text: string;
  note: string;
}

export interface PassageAnalysis {
  topic: string;
  gist: string;
  title: string;
  oneLineSummary: string;
  thesis: string;
  keyEvidence: string[];
  keySentences: KeySentence[];
  paragraphs: ParagraphInfo[];
  structureLabel: string | null;
  structureSteps: string[];
  modelId: string;
  createdAt: string;
  editedAt?: string;
  /** Number of chunks the passage was split into (>1 for long documents). */
  chunkCount?: number;
}

export interface ConceptExplanation {
  term: string;
  explanation: string;
}

export interface GlossedTerm {
  term: string;
  meaning: string;
  usage: string;
}

export interface EasyExplanation {
  background: string;
  concepts: ConceptExplanation[];
  examples: string[];
  paragraphs: { index: number; easy: string }[];
  rewrittenSentences: { original: string; easy: string }[];
  summary: string;
  glossary: GlossedTerm[];
  modelId: string;
  createdAt: string;
  editedAt?: string;
}

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

export type VocabDirection = "en-ko" | "ko-en";
export type Difficulty = "easy" | "medium" | "hard";

export interface VocabItem {
  id: string;
  word: string;
  meaning: string;
  partOfSpeech: string;
  context: string;
  selected: boolean;
  note?: string;
}

export interface VocabSet {
  direction: VocabDirection;
  difficulty: Difficulty;
  count: number;
  shuffle: boolean;
  items: VocabItem[];
  modelId: string;
  createdAt: string;
  editedAt?: string;
}

/* ------------------------------------------------------------------ */
/* Workbook & answer key                                               */
/* ------------------------------------------------------------------ */

export type ProblemKind =
  | "lineTranslation"
  | "sentenceOrder"
  | "paragraphOrder"
  | "koreanBlank"
  | "englishBlank"
  | "vocabBlank"
  | "sentenceCompletion";

export const PROBLEM_KIND_LABELS: Record<ProblemKind, string> = {
  lineTranslation: "영어 지문 한 줄 해석",
  sentenceOrder: "문장 순서 배열",
  paragraphOrder: "문단 순서 배열",
  koreanBlank: "우리말 빈칸",
  englishBlank: "영어 빈칸",
  vocabBlank: "핵심 어휘 빈칸",
  sentenceCompletion: "문장 완성",
};

export interface WorkbookProblem {
  id: string;
  kind: ProblemKind;
  number: number;
  prompt: string;
  segments: string[];
  answer: string;
  alternatives: string[];
  explanation: string;
  evidence: string;
  needsReview: boolean;
  sourceSentence: string;
}

export type ProblemCounts = Record<ProblemKind, number>;

export interface Workbook {
  id: string;
  difficulty: Difficulty;
  counts: ProblemCounts;
  problems: WorkbookProblem[];
  modelId: string;
  createdAt: string;
  editedAt?: string;
}

export interface AnswerEntry {
  problemId: string;
  answer: string;
  explanation: string;
  evidence: string;
  alternatives: string[];
}

export interface AnswerKey {
  sourceWorkbookId: string;
  entries: AnswerEntry[];
  modelId: string;
  createdAt: string;
  /** Problem IDs that exist in the workbook but have no answer entry. */
  missingProblemIds: string[];
  /** Entry problem IDs that no longer exist in the workbook. */
  orphanProblemIds: string[];
  notes: string[];
}

/* ------------------------------------------------------------------ */
/* Quality verification                                                */
/* ------------------------------------------------------------------ */

export type VerifySeverity = "info" | "warning" | "error";

export interface VerifyIssue {
  category: string;
  severity: VerifySeverity;
  target: string;
  message: string;
  suggestion: string;
}

export interface VerificationReport {
  summary: string;
  overall: "pass" | "warn" | "fail";
  issues: VerifyIssue[];
  modelId: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Document / editor                                                   */
/* ------------------------------------------------------------------ */

export type PageSizeId = "A4" | "A3" | "Letter";
export type Orientation = "portrait" | "landscape";

export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ElementBase {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  groupId: string | null;
  locked: boolean;
}

export interface TextElement extends ElementBase {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  background: string;
  align: "left" | "center" | "right" | "justify";
  verticalAlign: "top" | "middle" | "bottom";
  lineHeight: number;
  letterSpacing: number;
  padding: number;
  borderColor: string;
  borderWidth: number;
  radius: number;
}

export interface ImageElement extends ElementBase {
  type: "image";
  src: string;
  fit: "contain" | "cover" | "fill";
  radius: number;
  alt: string;
}

export type ShapeKind = "rect" | "roundRect" | "ellipse" | "triangle" | "star" | "arrowRight";

export interface ShapeElement extends ElementBase {
  type: "shape";
  shape: ShapeKind;
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
}

export interface TableElement extends ElementBase {
  type: "table";
  rows: number;
  cols: number;
  cells: string[][];
  headerRow: boolean;
  headerBg: string;
  borderColor: string;
  textColor: string;
  fontSize: number;
  cellPadding: number;
}

export interface BubbleElement extends ElementBase {
  type: "bubble";
  text: string;
  fill: string;
  stroke: string;
  textColor: string;
  fontSize: number;
  tail: "left" | "right" | "none";
}

export interface LineElement extends ElementBase {
  type: "line";
  stroke: string;
  strokeWidth: number;
  dash: "solid" | "dashed" | "dotted";
  arrowStart: boolean;
  arrowEnd: boolean;
  connector: boolean;
}

export type DocElement =
  | TextElement
  | ImageElement
  | ShapeElement
  | TableElement
  | BubbleElement
  | LineElement;

export type DocElementType = DocElement["type"];

export interface DocPage {
  id: string;
  name: string;
  size: PageSizeId;
  orientation: Orientation;
  margins: PageMargins;
  background: string;
  elements: DocElement[];
}

export interface ProjectSettings {
  defaultPageSize: PageSizeId;
  snapToGrid: boolean;
  gridMm: number;
  showMarginGuides: boolean;
  exportScale: number;
}

/* ------------------------------------------------------------------ */
/* Project                                                             */
/* ------------------------------------------------------------------ */

export interface QProject {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  passage: Passage;
  analysis: PassageAnalysis | null;
  easy: EasyExplanation | null;
  vocab: VocabSet | null;
  workbook: Workbook | null;
  answerKey: AnswerKey | null;
  verification: VerificationReport | null;
  pages: DocPage[];
  settings: ProjectSettings;
}

export interface RecentProject {
  id: string;
  name: string;
  path: string | null;
  updatedAt: string;
  storage: "file" | "local";
}

export interface AppPreferences {
  autosaveSeconds: number;
  defaultPageSize: PageSizeId;
  snapToGrid: boolean;
  gridMm: number;
  showMarginGuides: boolean;
  exportScale: number;
  confirmBeforeDelete: boolean;
}
