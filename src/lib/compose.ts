import type { DocElement, DocPage, QProject } from "./types";
import { PROBLEM_KIND_LABELS } from "./types";
import {
  contentArea,
  createPage,
  createShapeElement,
  createTableElement,
  createTextElement,
  estimateTextHeight,
  pageDimensions,
} from "./document";

interface FlowOptions {
  title: string;
  subtitle?: string;
  pageSize?: DocPage["size"];
  orientation?: DocPage["orientation"];
}

/**
 * Small flow layout engine: puts text blocks onto pages, creating new pages
 * when the content area is full. Elements stay fully editable afterwards.
 */
class Flow {
  pages: DocPage[] = [];
  page: DocPage;
  cursorY: number;
  area: { x: number; y: number; width: number; height: number };
  private options: FlowOptions;

  constructor(options: FlowOptions) {
    this.options = options;
    this.page = createPage(options.pageSize ?? "A4", options.orientation ?? "portrait", 0);
    this.area = contentArea(this.page);
    this.cursorY = this.area.y;
    this.pages.push(this.page);
    this.heading(options.title);
    if (options.subtitle) this.paragraph(options.subtitle, { fontSize: 10, color: "#64748b" });
  }

  private newPage() {
    this.page = createPage(
      this.options.pageSize ?? "A4",
      this.options.orientation ?? "portrait",
      this.pages.length,
    );
    this.area = contentArea(this.page);
    this.cursorY = this.area.y;
    this.pages.push(this.page);
  }

  private ensure(space: number) {
    if (this.cursorY + space > this.area.y + this.area.height) this.newPage();
  }

  heading(text: string) {
    if (!text.trim()) return;
    const height = 14;
    this.ensure(height);
    this.page.elements.push(
      createTextElement({
        x: this.area.x,
        y: this.cursorY,
        w: this.area.width,
        h: height,
        text,
        fontSize: 18,
        bold: true,
        color: "#1e3a8a",
        lineHeight: 1.2,
        padding: 0,
      }),
    );
    const rule = createShapeElement({
      x: this.area.x,
      y: this.cursorY + height - 2,
      w: this.area.width,
      h: 0.6,
      shape: "rect",
      fill: "#3b82f6",
      stroke: "transparent",
      strokeWidth: 0,
    });
    this.page.elements.push(rule);
    this.cursorY += height + 3;
  }

  subheading(text: string) {
    if (!text.trim()) return;
    const height = 9;
    this.ensure(height);
    this.page.elements.push(
      createTextElement({
        x: this.area.x,
        y: this.cursorY,
        w: this.area.width,
        h: height,
        text,
        fontSize: 12,
        bold: true,
        color: "#1d4ed8",
        padding: 0,
      }),
    );
    this.cursorY += height + 1.5;
  }

  paragraph(
    text: string,
    options: {
      fontSize?: number;
      color?: string;
      bold?: boolean;
      italic?: boolean;
      lineHeight?: number;
      background?: string;
      width?: number;
    } = {},
  ): DocElement {
    const fontSize = options.fontSize ?? 11;
    const lineHeight = options.lineHeight ?? 1.55;
    const width = options.width ?? this.area.width;
    const height = estimateTextHeight(text, width, fontSize, lineHeight);
    this.ensure(height + 1);
    const element = createTextElement({
      x: this.area.x,
      y: this.cursorY,
      w: width,
      h: Math.max(height, fontSize * 0.6),
      text,
      fontSize,
      lineHeight,
      bold: options.bold ?? false,
      italic: options.italic ?? false,
      color: options.color ?? "#0f172a",
      background: options.background ?? "transparent",
      padding: 0,
    });
    this.page.elements.push(element);
    this.cursorY += element.h + 2;
    return element;
  }

  gap(mm = 4) {
    this.cursorY += mm;
  }

  table(rows: string[][], headerRow = true, fontSize = 10) {
    const width = this.area.width;
    const rowHeight = fontSize * 0.62 * 1.6;
    const height = Math.max(rowHeight, rowHeight * rows.length);
    this.ensure(height + 3);
    this.page.elements.push(
      createTableElement({
        x: this.area.x,
        y: this.cursorY,
        w: width,
        h: height,
        rows: rows.length,
        cols: rows[0]?.length ?? 1,
        cells: rows,
        headerRow,
        fontSize,
      }),
    );
    this.cursorY += height + 3;
  }

  workspace(): { x: number; y: number; w: number } {
    return { x: this.area.x, y: this.cursorY, w: this.area.width };
  }

  reserve(height: number) {
    this.ensure(height);
    const y = this.cursorY;
    this.cursorY += height;
    return y;
  }
}

export type ComposeSource = "analysis" | "easy" | "vocab" | "vocabAnswers" | "workbook" | "answers";

const blankLines = (count: number) =>
  Array.from({ length: count }, () => "").join("\n");

export function composeDocument(project: QProject, source: ComposeSource): DocPage[] {
  switch (source) {
    case "analysis":
      return composeAnalysis(project);
    case "easy":
      return composeEasy(project);
    case "vocab":
      return composeVocab(project, false);
    case "vocabAnswers":
      return composeVocab(project, true);
    case "workbook":
      return composeWorkbook(project, false);
    case "answers":
      return composeWorkbook(project, true);
    default:
      return [createPage(project.settings.defaultPageSize)];
  }
}

function composeAnalysis(project: QProject): DocPage[] {
  const analysis = project.analysis;
  if (!analysis) return [createPage()];
  const flow = new Flow({
    title: `${project.name} · 지문 분석`,
    subtitle: `${analysis.title} · 생성 모델 ${analysis.modelId}`,
  });
  flow.subheading("주제");
  flow.paragraph(analysis.topic);
  flow.subheading("요지");
  flow.paragraph(analysis.gist);
  flow.subheading("한 줄 요약");
  flow.paragraph(analysis.oneLineSummary);
  flow.subheading("핵심 주장");
  flow.paragraph(analysis.thesis);
  if (analysis.keyEvidence.length) {
    flow.subheading("핵심 근거");
    analysis.keyEvidence.forEach((evidence, index) => flow.paragraph(`${index + 1}. ${evidence}`));
  }
  if (analysis.keySentences.length) {
    flow.subheading("주요 문장");
    analysis.keySentences.forEach((sentence, index) => {
      flow.paragraph(`${index + 1}. ${sentence.text}`, { italic: true });
      flow.paragraph(`→ ${sentence.note}`, { fontSize: 10, color: "#475569" });
    });
  }
  if (analysis.paragraphs.length) {
    flow.subheading("문단별 정리");
    analysis.paragraphs.forEach((paragraph) => {
      flow.paragraph(`${paragraph.index}문단 (${paragraph.role || "역할 미지정"})`, {
        bold: true,
        fontSize: 10.5,
      });
      flow.paragraph(paragraph.content, { fontSize: 10.5 });
    });
  }
  if (analysis.structureLabel) {
    flow.subheading("논리 구조");
    flow.paragraph(analysis.structureLabel, { bold: true });
    analysis.structureSteps.forEach((step, index) => flow.paragraph(`${index + 1}) ${step}`));
  }
  return flow.pages;
}

function composeEasy(project: QProject): DocPage[] {
  const easy = project.easy;
  if (!easy) return [createPage()];
  const flow = new Flow({
    title: `${project.name} · 쉬운 설명`,
    subtitle: "문해력이 약한 학생을 위한 해설 자료",
  });
  flow.subheading("배경지식");
  flow.paragraph(easy.background);
  if (easy.concepts.length) {
    flow.subheading("어려운 개념");
    easy.concepts.forEach((concept) => {
      flow.paragraph(concept.term, { bold: true, fontSize: 11 });
      flow.paragraph(concept.explanation, { fontSize: 10.5 });
    });
  }
  if (easy.examples.length) {
    flow.subheading("일상 속 사례");
    easy.examples.forEach((example, index) => flow.paragraph(`${index + 1}. ${example}`));
  }
  if (easy.paragraphs.length) {
    flow.subheading("문단별 쉬운 해설");
    easy.paragraphs.forEach((paragraph) => {
      flow.paragraph(`${paragraph.index}문단`, { bold: true, fontSize: 10.5 });
      flow.paragraph(paragraph.easy, { fontSize: 10.5 });
    });
  }
  if (easy.rewrittenSentences.length) {
    flow.subheading("어려운 문장 바꾸기");
    easy.rewrittenSentences.forEach((sentence) => {
      flow.paragraph(sentence.original, { italic: true, fontSize: 10 });
      flow.paragraph(`→ ${sentence.easy}`, { fontSize: 10.5, color: "#1d4ed8" });
    });
  }
  if (easy.glossary.length) {
    flow.subheading("주요 용어");
    flow.table(
      [["용어", "뜻", "쓰임"], ...easy.glossary.map((term) => [term.term, term.meaning, term.usage])],
      true,
      10,
    );
  }
  flow.subheading("핵심 정리");
  flow.paragraph(easy.summary, { bold: true, background: "#eff6ff" });
  return flow.pages;
}

function composeVocab(project: QProject, answers: boolean): DocPage[] {
  const vocab = project.vocab;
  if (!vocab) return [createPage()];
  const selected = vocab.items.filter((item) => item.selected);
  const title = answers ? `${project.name} · 단어 시험 정답` : `${project.name} · 단어 시험`;
  const directionLabel = vocab.direction === "en-ko" ? "영어 → 한글" : "한글 → 영어";
  const flow = new Flow({
    title,
    subtitle: `${directionLabel} · ${selected.length}문항 · 난이도 ${difficultyLabel(vocab.difficulty)}`,
  });

  if (answers) {
    flow.table(
      [
        ["번호", "문제", "정답", "품사"],
        ...selected.map((item, index) => [
          String(index + 1),
          vocab.direction === "en-ko" ? item.word : item.meaning,
          vocab.direction === "en-ko" ? item.meaning : item.word,
          item.partOfSpeech,
        ]),
      ],
      true,
      10,
    );
  } else {
    const rows = selected.map((item, index) => [
      String(index + 1),
      vocab.direction === "en-ko" ? item.word : item.meaning,
      "",
    ]);
    flow.table([["번호", "문제", "답"], ...rows], true, 11);
    flow.gap(2);
    flow.paragraph("※ 답안 작성란", { fontSize: 10, color: "#64748b" });
    flow.paragraph(" ".repeat(40) + "\n" + " ".repeat(40), {
      fontSize: 11,
      background: "#f8fafc",
    });
  }
  return flow.pages;
}

function composeWorkbook(project: QProject, answers: boolean): DocPage[] {
  const workbook = project.workbook;
  if (!workbook) return [createPage()];
  const title = answers ? `${project.name} · 교사용 답안지` : `${project.name} · 워크북`;
  const flow = new Flow({
    title,
    subtitle: `${workbook.problems.length}문항 · 난이도 ${difficultyLabel(workbook.difficulty)}`,
  });

  if (!answers) {
    flow.paragraph("이름: ______________________   반: ________   점수: ________", {
      fontSize: 11,
      color: "#334155",
    });
    flow.gap(2);
  }

  const answerMap = new Map(project.answerKey?.entries.map((entry) => [entry.problemId, entry]) ?? []);

  for (const problem of workbook.problems) {
    const blockHeight = answers ? 22 : 18;
    flow.reserve(0);
    flow.subheading(
      `${problem.number}. ${PROBLEM_KIND_LABELS[problem.kind]}${problem.needsReview ? "  (검토 필요)" : ""}`,
    );
    flow.paragraph(problem.prompt, { fontSize: 10.5 });
    if (problem.kind === "sentenceOrder" || problem.kind === "paragraphOrder") {
      if (problem.segments.length) {
        flow.paragraph(
          problem.segments.map((segment, index) => `(${index + 1}) ${segment}`).join("\n"),
          { fontSize: 10, background: "#f8fafc" },
        );
      }
    }
    if (answers) {
      const entry = answerMap.get(problem.id);
      flow.paragraph(`정답: ${entry?.answer || problem.answer || "(없음)"}`, {
        fontSize: 10.5,
        bold: true,
        color: "#1d4ed8",
      });
      if (problem.segments.length && problem.answer) {
        flow.paragraph(`순서: ${problem.answer}`, { fontSize: 10 });
      }
      const explanation = entry?.explanation || problem.explanation;
      if (explanation) flow.paragraph(`해설: ${explanation}`, { fontSize: 10 });
      const evidence = entry?.evidence || problem.evidence;
      if (evidence) flow.paragraph(`근거: ${evidence}`, { fontSize: 9.5, color: "#475569" });
      const alternatives = entry?.alternatives?.length ? entry.alternatives : problem.alternatives;
      if (alternatives.length) {
        flow.paragraph(`허용 답안: ${alternatives.join(", ")}`, { fontSize: 9.5, color: "#475569" });
      }
    } else {
      const areaHeight = problem.kind === "lineTranslation" ? 12 : 9;
      const workspace = flow.workspace();
      flow.page.elements.push(
        createShapeElement({
          x: workspace.x,
          y: workspace.y,
          w: workspace.w,
          h: areaHeight,
          shape: "rect",
          fill: "#ffffff",
          stroke: "#cbd5e1",
          strokeWidth: 0.25,
        }),
      );
      flow.reserve(areaHeight + 3);
    }
    flow.gap(1.5);
    if (answers && project.answerKey) {
      const entry = answerMap.get(problem.id);
      if (!entry) {
        flow.paragraph("※ 이 문제의 답안이 답안지에 없습니다.", {
          fontSize: 9.5,
          color: "#b91c1c",
        });
      }
    }
    void blockHeight;
  }

  if (!answers) {
    flow.gap(2);
    flow.paragraph(blankLines(4), { fontSize: 10, background: "#f8fafc" });
  }
  return flow.pages;
}

function difficultyLabel(difficulty: string): string {
  return difficulty === "easy" ? "쉬움" : difficulty === "hard" ? "어려움" : "보통";
}

/** Ensures the page is wide enough for tables produced by the composer. */
export function ensurePageFits(page: DocPage): DocPage {
  const { width } = pageDimensions(page);
  return {
    ...page,
    elements: page.elements.map((element) => ({
      ...element,
      x: Math.min(element.x, Math.max(0, width - 10)),
    })),
  };
}
