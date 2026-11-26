import type {
  BubbleElement,
  DocElement,
  DocElementType,
  DocPage,
  ImageElement,
  LineElement,
  Orientation,
  PageSizeId,
  ShapeElement,
  TableElement,
  TextElement,
} from "./types";
import { clamp, uid } from "./utils";

export const PAGE_SIZES: Record<PageSizeId, { label: string; width: number; height: number }> = {
  A4: { label: "A4 (210 × 297 mm)", width: 210, height: 297 },
  A3: { label: "A3 (297 × 420 mm)", width: 297, height: 420 },
  Letter: { label: "Letter (215.9 × 279.4 mm)", width: 215.9, height: 279.4 },
};

export const DEFAULT_MARGINS = { top: 18, right: 16, bottom: 18, left: 16 };

export function pageDimensions(page: Pick<DocPage, "size" | "orientation">): {
  width: number;
  height: number;
} {
  const base = PAGE_SIZES[page.size] ?? PAGE_SIZES.A4;
  return page.orientation === "landscape"
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height };
}

export function contentArea(page: DocPage): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const { width, height } = pageDimensions(page);
  return {
    x: page.margins.left,
    y: page.margins.top,
    width: width - page.margins.left - page.margins.right,
    height: height - page.margins.top - page.margins.bottom,
  };
}

export function createPage(
  size: PageSizeId = "A4",
  orientation: Orientation = "portrait",
  index = 0,
): DocPage {
  return {
    id: uid("page"),
    name: `페이지 ${index + 1}`,
    size,
    orientation,
    margins: { ...DEFAULT_MARGINS },
    background: "#ffffff",
    elements: [],
  };
}

export function clonePage(page: DocPage, index?: number): DocPage {
  return {
    ...structuredClone(page),
    id: uid("page"),
    name: index === undefined ? `${page.name} 복사` : `페이지 ${index + 1}`,
    elements: page.elements.map((element) => ({
      ...structuredClone(element),
      id: uid(element.type),
      groupId: null,
    })),
  };
}

const baseDefaults = {
  rotation: 0,
  opacity: 1,
  groupId: null as string | null,
  locked: false,
};

export function createTextElement(partial: Partial<TextElement> = {}): TextElement {
  return {
    ...baseDefaults,
    id: uid("text"),
    type: "text",
    x: 20,
    y: 20,
    w: 90,
    h: 18,
    text: "텍스트를 입력하세요",
    fontSize: 12,
    fontFamily: "Malgun Gothic, Pretendard, sans-serif",
    bold: false,
    italic: false,
    underline: false,
    color: "#0f172a",
    background: "transparent",
    align: "left",
    verticalAlign: "top",
    lineHeight: 1.45,
    letterSpacing: 0,
    padding: 1.5,
    borderColor: "transparent",
    borderWidth: 0,
    radius: 0,
    ...partial,
  };
}

export function createImageElement(src: string, partial: Partial<ImageElement> = {}): ImageElement {
  return {
    ...baseDefaults,
    id: uid("img"),
    type: "image",
    x: 25,
    y: 25,
    w: 90,
    h: 65,
    src,
    fit: "contain",
    radius: 0,
    alt: "이미지",
    ...partial,
  };
}

export function createShapeElement(partial: Partial<ShapeElement> = {}): ShapeElement {
  return {
    ...baseDefaults,
    id: uid("shape"),
    type: "shape",
    x: 30,
    y: 30,
    w: 45,
    h: 30,
    shape: "roundRect",
    fill: "#dbeafe",
    stroke: "#2563eb",
    strokeWidth: 0.4,
    radius: 3,
    ...partial,
  };
}

export function createTableElement(partial: Partial<TableElement> = {}): TableElement {
  const rows = partial.rows ?? 3;
  const cols = partial.cols ?? 3;
  const cells =
    partial.cells ??
    Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => (r === 0 ? `항목 ${c + 1}` : "")),
    );
  return {
    ...baseDefaults,
    id: uid("table"),
    type: "table",
    x: 25,
    y: 40,
    w: 140,
    h: 15 * rows,
    headerRow: true,
    headerBg: "#eff6ff",
    borderColor: "#94a3b8",
    textColor: "#0f172a",
    fontSize: 10,
    cellPadding: 1.5,
    ...partial,
    rows: cells.length,
    cols: cells[0]?.length ?? cols,
    cells,
  };
}

export function createBubbleElement(partial: Partial<BubbleElement> = {}): BubbleElement {
  return {
    ...baseDefaults,
    id: uid("bubble"),
    type: "bubble",
    x: 30,
    y: 30,
    w: 70,
    h: 26,
    text: "설명을 입력하세요",
    fill: "#fef9c3",
    stroke: "#eab308",
    textColor: "#713f12",
    fontSize: 11,
    tail: "left",
    ...partial,
  };
}

export function createLineElement(partial: Partial<LineElement> = {}): LineElement {
  return {
    ...baseDefaults,
    id: uid("line"),
    type: "line",
    x: 30,
    y: 50,
    w: 60,
    h: 0,
    stroke: "#334155",
    strokeWidth: 0.4,
    dash: "solid",
    arrowStart: false,
    arrowEnd: true,
    connector: false,
    ...partial,
  };
}

export function createElement(type: DocElementType, partial: Partial<DocElement> = {}): DocElement {
  switch (type) {
    case "text":
      return createTextElement(partial as Partial<TextElement>);
    case "image":
      return createImageElement("", partial as Partial<ImageElement>);
    case "shape":
      return createShapeElement(partial as Partial<ShapeElement>);
    case "table":
      return createTableElement(partial as Partial<TableElement>);
    case "bubble":
      return createBubbleElement(partial as Partial<BubbleElement>);
    case "line":
      return createLineElement(partial as Partial<LineElement>);
    default:
      return createTextElement(partial as Partial<TextElement>);
  }
}

export function duplicateElement(element: DocElement, offset = 4): DocElement {
  const copy = structuredClone(element) as DocElement;
  copy.id = uid(element.type);
  copy.groupId = null;
  copy.x += offset;
  copy.y += offset;
  return copy;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function boundsOf(elements: DocElement[]): Bounds | null {
  if (!elements.length) return null;
  const left = Math.min(...elements.map((element) => element.x));
  const top = Math.min(...elements.map((element) => element.y));
  const right = Math.max(...elements.map((element) => element.x + element.w));
  const bottom = Math.max(...elements.map((element) => element.y + element.h));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/** Aligns elements relative to their combined bounding box (or page when one element). */
export function alignElements(
  elements: DocElement[],
  mode: AlignMode,
  reference?: Bounds,
): DocElement[] {
  if (elements.length < 1) return elements;
  const box = reference ?? boundsOf(elements);
  if (!box) return elements;
  return elements.map((element) => {
    const next = { ...element };
    switch (mode) {
      case "left":
        next.x = box.x;
        break;
      case "hcenter":
        next.x = box.x + (box.width - element.w) / 2;
        break;
      case "right":
        next.x = box.x + box.width - element.w;
        break;
      case "top":
        next.y = box.y;
        break;
      case "vcenter":
        next.y = box.y + (box.height - element.h) / 2;
        break;
      case "bottom":
        next.y = box.y + box.height - element.h;
        break;
    }
    return next;
  });
}

export function distributeElements(elements: DocElement[], axis: "horizontal" | "vertical"): DocElement[] {
  if (elements.length < 3) return elements;
  const sorted = [...elements].sort((a, b) => (axis === "horizontal" ? a.x - b.x : a.y - b.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const totalSize = sorted.reduce((sum, element) => sum + (axis === "horizontal" ? element.w : element.h), 0);
  const span =
    axis === "horizontal"
      ? last.x + last.w - first.x
      : last.y + last.h - first.y;
  const gap = (span - totalSize) / (sorted.length - 1);
  let cursor = axis === "horizontal" ? first.x : first.y;
  const positions = new Map<string, number>();
  for (const element of sorted) {
    positions.set(element.id, cursor);
    cursor += (axis === "horizontal" ? element.w : element.h) + gap;
  }
  return elements.map((element) =>
    axis === "horizontal"
      ? { ...element, x: positions.get(element.id) ?? element.x }
      : { ...element, y: positions.get(element.id) ?? element.y },
  );
}

export function snap(value: number, gridMm: number, enabled: boolean): number {
  if (!enabled || gridMm <= 0) return Math.round(value * 10) / 10;
  return Math.round(value / gridMm) * gridMm;
}

export function clampToPage(
  element: DocElement,
  page: DocPage,
): DocElement {
  const { width, height } = pageDimensions(page);
  return {
    ...element,
    x: clamp(element.x, -element.w + 5, width - 5),
    y: clamp(element.y, -element.h + 5, height - 5),
  };
}

export function reorderElements(
  elements: DocElement[],
  selectedIds: string[],
  action: "front" | "back" | "forward" | "backward",
): DocElement[] {
  if (!selectedIds.length) return elements;
  const selected = new Set(selectedIds);
  if (action === "front") {
    return [...elements.filter((el) => !selected.has(el.id)), ...elements.filter((el) => selected.has(el.id))];
  }
  if (action === "back") {
    return [...elements.filter((el) => selected.has(el.id)), ...elements.filter((el) => !selected.has(el.id))];
  }
  const next = [...elements];
  if (action === "forward") {
    for (let i = next.length - 2; i >= 0; i -= 1) {
      if (selected.has(next[i].id) && !selected.has(next[i + 1].id)) {
        [next[i], next[i + 1]] = [next[i + 1], next[i]];
      }
    }
  } else {
    for (let i = 1; i < next.length; i += 1) {
      if (selected.has(next[i].id) && !selected.has(next[i - 1].id)) {
        [next[i], next[i - 1]] = [next[i - 1], next[i]];
      }
    }
  }
  return next;
}

export function groupElements(elements: DocElement[], selectedIds: string[]): DocElement[] {
  if (selectedIds.length < 2) return elements;
  const groupId = uid("group");
  return elements.map((element) =>
    selectedIds.includes(element.id) ? { ...element, groupId } : element,
  );
}

export function ungroupElements(elements: DocElement[], selectedIds: string[]): DocElement[] {
  const groups = new Set(
    elements.filter((element) => selectedIds.includes(element.id) && element.groupId).map((element) => element.groupId),
  );
  return elements.map((element) =>
    element.groupId && groups.has(element.groupId) ? { ...element, groupId: null } : element,
  );
}

export function expandSelection(elements: DocElement[], selectedIds: string[]): string[] {
  const groups = new Set(
    elements.filter((element) => selectedIds.includes(element.id) && element.groupId).map((element) => element.groupId),
  );
  if (!groups.size) return selectedIds;
  return elements
    .filter((element) => selectedIds.includes(element.id) || (element.groupId && groups.has(element.groupId)))
    .map((element) => element.id);
}

/** Rough text height estimate used when laying AI content onto pages. */
export function estimateTextHeight(
  text: string,
  widthMm: number,
  fontSizePt: number,
  lineHeight: number,
): number {
  const charWidthMm = 0.176 * fontSizePt * 0.55;
  const charsPerLine = Math.max(8, Math.floor(widthMm / charWidthMm));
  const paragraphs = text.split("\n");
  const lines = paragraphs.reduce(
    (sum, paragraph) => sum + Math.max(1, Math.ceil(paragraph.length / charsPerLine)),
    0,
  );
  const lineHeightMm = fontSizePt * 0.3528 * lineHeight;
  return lines * lineHeightMm + 2;
}
