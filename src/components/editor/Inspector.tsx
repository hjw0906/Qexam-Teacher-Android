import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Circle,
  Copy,
  Lock,
  MoveDown,
  MoveUp,
  Plus,
  Trash2,
  Unlock,
} from "lucide-react";
import { useMemo } from "react";
import {
  Button,
  Card,
  Field,
  Input,
  SectionHeader,
  SegmentedControl,
  Select,
  Textarea,
  Toggle,
} from "../ui";
import { activePage, useProjectStore } from "../../store/projectStore";
import {
  PAGE_SIZES,
  pageDimensions,
  reorderElements,
} from "../../lib/document";
import type {
  BubbleElement,
  DocElement,
  ImageElement,
  LineElement,
  PageSizeId,
  ShapeElement,
  TableElement,
  TextElement,
} from "../../lib/types";
import { mmToPx } from "../../lib/utils";

const FONT_OPTIONS = [
  "Malgun Gothic, Pretendard, sans-serif",
  "Pretendard, Malgun Gothic, sans-serif",
  "Batang, serif",
  "Georgia, serif",
  "Arial, sans-serif",
  "Consolas, monospace",
];

function NumberField({
  label,
  value,
  onChange,
  step = 0.5,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="relative">
        <Input
          type="number"
          value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
          step={step}
          min={min}
          max={max}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-8 py-1 pr-7 text-xs"
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">
            {suffix}
          </span>
        ) : null}
      </div>
    </label>
  );
}

export function PageSettingsPanel() {
  const project = useProjectStore((state) => state.project);
  const page = useProjectStore((state) => activePage(state));
  const updatePage = useProjectStore((state) => state.updatePage);
  const update = useProjectStore((state) => state.update);
  const addPage = useProjectStore((state) => state.addPage);
  const duplicatePage = useProjectStore((state) => state.duplicatePage);
  const deletePage = useProjectStore((state) => state.deletePage);
  const movePage = useProjectStore((state) => state.movePage);

  if (!project || !page) return null;
  const index = project.pages.findIndex((item) => item.id === page.id);
  const size = pageDimensions(page);

  return (
    <Card className="p-4">
      <SectionHeader title="페이지 설정" description={page.name} />
      <div className="mt-3 space-y-3">
        <Field label="페이지 이름">
          <Input
            value={page.name}
            onChange={(event) => updatePage(page.id, { name: event.target.value })}
            className="h-8 py-1 text-xs"
          />
        </Field>
        <Field label="용지 크기">
          <Select
            value={page.size}
            onChange={(event) => updatePage(page.id, { size: event.target.value as PageSizeId })}
            className="h-8 py-1 text-xs"
          >
            {(Object.keys(PAGE_SIZES) as PageSizeId[]).map((key) => (
              <option key={key} value={key}>
                {PAGE_SIZES[key].label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-center justify-between">
          <span className="label mb-0">방향</span>
          <SegmentedControl
            size="sm"
            value={page.orientation}
            onChange={(value) => updatePage(page.id, { orientation: value })}
            options={[
              { value: "portrait", label: "세로" },
              { value: "landscape", label: "가로" },
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="위 여백"
            value={page.margins.top}
            onChange={(value) => updatePage(page.id, { margins: { ...page.margins, top: Math.max(0, value) } })}
            suffix="mm"
          />
          <NumberField
            label="아래 여백"
            value={page.margins.bottom}
            onChange={(value) => updatePage(page.id, { margins: { ...page.margins, bottom: Math.max(0, value) } })}
            suffix="mm"
          />
          <NumberField
            label="왼쪽 여백"
            value={page.margins.left}
            onChange={(value) => updatePage(page.id, { margins: { ...page.margins, left: Math.max(0, value) } })}
            suffix="mm"
          />
          <NumberField
            label="오른쪽 여백"
            value={page.margins.right}
            onChange={(value) => updatePage(page.id, { margins: { ...page.margins, right: Math.max(0, value) } })}
            suffix="mm"
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="label mb-0">배경색</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={page.background === "transparent" ? "#ffffff" : page.background}
              onChange={(event) => updatePage(page.id, { background: event.target.value })}
              className="h-7 w-9"
            />
            <Input
              value={page.background}
              onChange={(event) => updatePage(page.id, { background: event.target.value })}
              className="h-7 w-24 py-0.5 font-mono text-[11px]"
            />
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 p-2 text-[10px] text-slate-500">
          {Math.round(size.width)} × {Math.round(size.height)} mm ·{" "}
          {page.elements.length}개 요소 · {index + 1}/{project.pages.length} 페이지
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => addPage(page.id)}>
            페이지 추가
          </Button>
          <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => duplicatePage(page.id)}>
            페이지 복제
          </Button>
          <Button size="sm" variant="ghost" icon={<MoveUp className="h-3.5 w-3.5" />} onClick={() => movePage(index, index - 1)} disabled={index <= 0}>
            위로 이동
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<MoveDown className="h-3.5 w-3.5" />}
            onClick={() => movePage(index, index + 1)}
            disabled={index >= project.pages.length - 1}
          >
            아래로 이동
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="col-span-2 text-red-600 hover:bg-red-50"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={() => deletePage(page.id)}
          >
            현재 페이지 삭제
          </Button>
        </div>

        <div className="space-y-2 border-t border-slate-100 pt-3">
          <Toggle
            checked={project.settings.snapToGrid}
            onChange={(value) =>
              update((draft) => {
                draft.settings.snapToGrid = value;
              })
            }
            label="격자에 맞추기"
          />
          <Toggle
            checked={project.settings.showMarginGuides}
            onChange={(value) =>
              update((draft) => {
                draft.settings.showMarginGuides = value;
              })
            }
            label="여백 가이드"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-500">격자 간격</span>
            <Input
              type="number"
              min={0.5}
              step={0.5}
              value={project.settings.gridMm}
              onChange={(event) =>
                update((draft) => {
                  draft.settings.gridMm = Math.max(0.5, Number(event.target.value) || 2.5);
                })
              }
              className="h-7 w-20 py-0.5 text-xs"
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

export function ElementInspector() {
  const page = useProjectStore((state) => activePage(state));
  const selectedIds = useProjectStore((state) => state.selectedIds);
  const updateElements = useProjectStore((state) => state.updateElements);
  const elements = useMemo(
    () => (page ? page.elements.filter((item) => selectedIds.includes(item.id)) : []),
    [page, selectedIds],
  );
  const hasSelection = elements.length > 0;
  const element = elements[0];

  if (!hasSelection || !element) {
    return (
      <Card className="p-4">
        <SectionHeader title="선택 요소" description="캔버스에서 요소를 선택하면 세부 설정을 편집할 수 있습니다." />
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          단축키: Del 삭제 · Ctrl+D 복제 · Ctrl+Z/Y 실행 취소/다시 실행 · 방향키 미세 이동 · Shift+클릭 다중 선택
        </p>
      </Card>
    );
  }

  function patch(partial: Partial<DocElement>) {
    const ids = new Set(elements.map((item) => item.id));
    const page = useProjectStore
      .getState()
      .project?.pages.find((item) => item.id === useProjectStore.getState().activePageId);
    if (!page) return;
    updateElements(
      page.elements.map((item) => (ids.has(item.id) ? ({ ...item, ...partial } as DocElement) : item)),
    );
  }

  function patchTyped(partial: Record<string, unknown>) {
    const ids = new Set(elements.map((item) => item.id));
    const page = useProjectStore
      .getState()
      .project?.pages.find((item) => item.id === useProjectStore.getState().activePageId);
    if (!page) return;
    updateElements(
      page.elements.map((item) => (ids.has(item.id) ? ({ ...item, ...partial } as DocElement) : item)),
    );
  }

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <SectionHeader
          title={elements.length > 1 ? `선택 요소 ${elements.length}개` : "선택 요소"}
          description={element.type === "text" ? "텍스트" : element.type}
        />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <NumberField label="X" value={element.x} onChange={(value) => patch({ x: value })} suffix="mm" />
          <NumberField label="Y" value={element.y} onChange={(value) => patch({ y: value })} suffix="mm" />
          <NumberField label="너비" value={element.w} onChange={(value) => patch({ w: Math.max(2, value) })} suffix="mm" />
          <NumberField label="높이" value={element.h} onChange={(value) => patch({ h: Math.max(2, value) })} suffix="mm" />
          <NumberField label="회전" value={element.rotation} onChange={(value) => patch({ rotation: value })} step={1} suffix="°" />
          <NumberField
            label="투명도"
            value={Math.round(element.opacity * 100)}
            onChange={(value) => patch({ opacity: Math.min(100, Math.max(0, value)) / 100 })}
            step={5}
            min={0}
            max={100}
            suffix="%"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            icon={element.locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            onClick={() => patch({ locked: !element.locked })}
          >
            {element.locked ? "잠금 해제" : "잠금"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<AlignLeft className="h-3.5 w-3.5" />}
            onClick={() => patch({ x: useProjectStore.getState().project?.pages.find((p) => p.id === useProjectStore.getState().activePageId)?.margins.left ?? 16 })}
          >
            왼쪽 정렬
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<AlignCenter className="h-3.5 w-3.5" />}
            onClick={() => {
              const page = useProjectStore.getState().project?.pages.find((p) => p.id === useProjectStore.getState().activePageId);
              if (!page) return;
              const size = pageDimensions(page);
              patch({ x: (size.width - element.w) / 2 });
            }}
          >
            가운데
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<AlignRight className="h-3.5 w-3.5" />}
            onClick={() => {
              const page = useProjectStore.getState().project?.pages.find((p) => p.id === useProjectStore.getState().activePageId);
              if (!page) return;
              const size = pageDimensions(page);
              patch({ x: size.width - page.margins.right - element.w });
            }}
          >
            오른쪽
          </Button>
        </div>
      </Card>

      {element.type === "text" ? (
        <TextProperties element={element as TextElement} patch={patchTyped} />
      ) : null}
      {element.type === "image" ? (
        <ImageProperties element={element as ImageElement} patch={patchTyped} />
      ) : null}
      {element.type === "shape" ? (
        <ShapeProperties element={element as ShapeElement} patch={patchTyped} />
      ) : null}
      {element.type === "table" ? (
        <TableProperties element={element as TableElement} patch={patchTyped} />
      ) : null}
      {element.type === "bubble" ? (
        <BubbleProperties element={element as BubbleElement} patch={patchTyped} />
      ) : null}
      {element.type === "line" ? (
        <LineProperties element={element as LineElement} patch={patchTyped} />
      ) : null}

      <Card className="p-4">
        <SectionHeader title="레이어 순서" />
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {(["front", "forward", "backward", "back"] as const).map((action) => (
            <Button
              key={action}
              size="sm"
              variant="ghost"
              onClick={() => {
                const page = useProjectStore.getState().project?.pages.find((p) => p.id === useProjectStore.getState().activePageId);
                if (!page) return;
                updateElements(
                  reorderElements(
                    page.elements,
                    elements.map((item) => item.id),
                    action,
                  ),
                );
              }}
            >
              {action === "front" ? "맨 앞으로" : action === "forward" ? "앞으로" : action === "backward" ? "뒤로" : "맨 뒤로"}
            </Button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-slate-600">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={value === "transparent" ? "#ffffff" : value}
          onChange={(event) => onChange(event.target.value)}
          className="h-6 w-8"
        />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 w-24 py-0.5 font-mono text-[10px]"
        />
      </div>
    </div>
  );
}

function TextProperties({
  element,
  patch,
}: {
  element: TextElement;
  patch: (partial: Record<string, unknown>) => void;
}) {
  return (
    <Card className="p-4">
      <SectionHeader title="텍스트" />
      <div className="mt-3 space-y-3">
        <Textarea rows={4} value={element.text} onChange={(event) => patch({ text: event.target.value })} />
        <Field label="글꼴">
          <Select value={element.fontFamily} onChange={(event) => patch({ fontFamily: event.target.value })} className="h-8 py-1 text-xs">
            {FONT_OPTIONS.map((font) => (
              <option key={font} value={font}>
                {font.split(",")[0]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="크기" value={element.fontSize} onChange={(value) => patch({ fontSize: Math.max(4, value) })} step={0.5} suffix="pt" />
          <NumberField label="줄 간격" value={element.lineHeight} onChange={(value) => patch({ lineHeight: Math.max(0.8, value) })} step={0.05} />
          <NumberField label="자간" value={element.letterSpacing} onChange={(value) => patch({ letterSpacing: value })} step={0.1} suffix="pt" />
          <NumberField label="여백" value={element.padding} onChange={(value) => patch({ padding: Math.max(0, value) })} suffix="mm" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={element.bold ? "subtle" : "ghost"} onClick={() => patch({ bold: !element.bold })}>
            <strong>B</strong>
          </Button>
          <Button size="sm" variant={element.italic ? "subtle" : "ghost"} onClick={() => patch({ italic: !element.italic })}>
            <em>I</em>
          </Button>
          <Button size="sm" variant={element.underline ? "subtle" : "ghost"} onClick={() => patch({ underline: !element.underline })}>
            <u>U</u>
          </Button>
          <div className="ml-auto">
            <SegmentedControl
              size="sm"
              value={element.align}
              onChange={(value) => patch({ align: value })}
              options={[
                { value: "left", label: "왼쪽" },
                { value: "center", label: "가운데" },
                { value: "right", label: "오른쪽" },
                { value: "justify", label: "양쪽" },
              ]}
            />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate-600">세로 정렬</span>
          <SegmentedControl
            size="sm"
            value={element.verticalAlign}
            onChange={(value) => patch({ verticalAlign: value })}
            options={[
              { value: "top", label: "위" },
              { value: "middle", label: "중앙" },
              { value: "bottom", label: "아래" },
            ]}
          />
        </div>
        <ColorRow label="글자 색" value={element.color} onChange={(value) => patch({ color: value })} />
        <ColorRow label="배경 색" value={element.background} onChange={(value) => patch({ background: value })} />
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="테두리" value={element.borderWidth} onChange={(value) => patch({ borderWidth: Math.max(0, value) })} step={0.1} suffix="mm" />
          <NumberField label="둥근 모서리" value={element.radius} onChange={(value) => patch({ radius: Math.max(0, value) })} suffix="mm" />
        </div>
        <ColorRow label="테두리 색" value={element.borderColor} onChange={(value) => patch({ borderColor: value })} />
      </div>
    </Card>
  );
}

function ImageProperties({
  element,
  patch,
}: {
  element: ImageElement;
  patch: (partial: Record<string, unknown>) => void;
}) {
  return (
    <Card className="p-4">
      <SectionHeader title="이미지" />
      <div className="mt-3 space-y-3">
        {element.src ? (
          <img src={element.src} alt={element.alt} className="max-h-32 w-full rounded border border-slate-200 object-contain" />
        ) : null}
        <Field label="대체 텍스트">
          <Input value={element.alt} onChange={(event) => patch({ alt: event.target.value })} className="h-8 py-1 text-xs" />
        </Field>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate-600">채우기</span>
          <SegmentedControl
            size="sm"
            value={element.fit}
            onChange={(value) => patch({ fit: value })}
            options={[
              { value: "contain", label: "맞춤" },
              { value: "cover", label: "채움" },
              { value: "fill", label: "늘이기" },
            ]}
          />
        </div>
        <NumberField label="둥근 모서리" value={element.radius} onChange={(value) => patch({ radius: Math.max(0, value) })} suffix="mm" />
      </div>
    </Card>
  );
}

function ShapeProperties({
  element,
  patch,
}: {
  element: ShapeElement;
  patch: (partial: Record<string, unknown>) => void;
}) {
  return (
    <Card className="p-4">
      <SectionHeader title="도형" />
      <div className="mt-3 space-y-3">
        <Field label="모양">
          <Select value={element.shape} onChange={(event) => patch({ shape: event.target.value })} className="h-8 py-1 text-xs">
            <option value="rect">사각형</option>
            <option value="roundRect">둥근 사각형</option>
            <option value="ellipse">타원</option>
            <option value="triangle">삼각형</option>
            <option value="star">별</option>
            <option value="arrowRight">화살표</option>
          </Select>
        </Field>
        <ColorRow label="채우기" value={element.fill} onChange={(value) => patch({ fill: value })} />
        <ColorRow label="선 색" value={element.stroke} onChange={(value) => patch({ stroke: value })} />
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="선 두께" value={element.strokeWidth} onChange={(value) => patch({ strokeWidth: Math.max(0, value) })} step={0.1} suffix="mm" />
          <NumberField label="둥근 모서리" value={element.radius} onChange={(value) => patch({ radius: Math.max(0, value) })} suffix="mm" />
        </div>
      </div>
    </Card>
  );
}

function TableProperties({
  element,
  patch,
}: {
  element: TableElement;
  patch: (partial: Record<string, unknown>) => void;
}) {
  function setCell(row: number, col: number, value: string) {
    const cells = element.cells.map((line, rowIndex) =>
      rowIndex === row ? line.map((cell, colIndex) => (colIndex === col ? value : cell)) : line,
    );
    patch({ cells });
  }

  function resize(nextRows: number, nextCols: number) {
    const cells = Array.from({ length: nextRows }, (_, row) =>
      Array.from({ length: nextCols }, (_, col) => element.cells[row]?.[col] ?? ""),
    );
    patch({ cells, rows: nextRows, cols: nextCols });
  }

  return (
    <Card className="p-4">
      <SectionHeader title="표" />
      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="행" value={element.rows} onChange={(value) => resize(Math.max(1, Math.min(20, Math.round(value))), element.cols)} step={1} min={1} />
          <NumberField label="열" value={element.cols} onChange={(value) => resize(element.rows, Math.max(1, Math.min(12, Math.round(value))))} step={1} min={1} />
        </div>
        <NumberField label="글자 크기" value={element.fontSize} onChange={(value) => patch({ fontSize: Math.max(5, value) })} step={0.5} suffix="pt" />
        <NumberField label="셀 여백" value={element.cellPadding} onChange={(value) => patch({ cellPadding: Math.max(0, value) })} suffix="mm" />
        <ColorRow label="테두리" value={element.borderColor} onChange={(value) => patch({ borderColor: value })} />
        <ColorRow label="글자" value={element.textColor} onChange={(value) => patch({ textColor: value })} />
        <Toggle checked={element.headerRow} onChange={(value) => patch({ headerRow: value })} label="첫 행을 머리글로" />
        <ColorRow label="머리글 배경" value={element.headerBg} onChange={(value) => patch({ headerBg: value })} />
        <div>
          <p className="label">셀 내용</p>
          <div className="max-h-56 overflow-auto rounded border border-slate-200 p-1.5">
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${element.cols}, minmax(0, 1fr))` }}>
              {element.cells.map((row, rowIndex) =>
                row.map((cell, colIndex) => (
                  <input
                    key={`${rowIndex}-${colIndex}`}
                    value={cell}
                    onChange={(event) => setCell(rowIndex, colIndex, event.target.value)}
                    className="w-full rounded border border-slate-200 px-1 py-0.5 text-[10px] focus:border-brand-400 focus:outline-none"
                  />
                )),
              )}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function BubbleProperties({
  element,
  patch,
}: {
  element: BubbleElement;
  patch: (partial: Record<string, unknown>) => void;
}) {
  return (
    <Card className="p-4">
      <SectionHeader title="말풍선" />
      <div className="mt-3 space-y-3">
        <Textarea rows={3} value={element.text} onChange={(event) => patch({ text: event.target.value })} />
        <NumberField label="글자 크기" value={element.fontSize} onChange={(value) => patch({ fontSize: Math.max(5, value) })} step={0.5} suffix="pt" />
        <ColorRow label="배경" value={element.fill} onChange={(value) => patch({ fill: value })} />
        <ColorRow label="선" value={element.stroke} onChange={(value) => patch({ stroke: value })} />
        <ColorRow label="글자" value={element.textColor} onChange={(value) => patch({ textColor: value })} />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate-600">꼬리 위치</span>
          <SegmentedControl
            size="sm"
            value={element.tail}
            onChange={(value) => patch({ tail: value })}
            options={[
              { value: "left", label: "왼쪽" },
              { value: "none", label: "없음" },
              { value: "right", label: "오른쪽" },
            ]}
          />
        </div>
      </div>
    </Card>
  );
}

function LineProperties({
  element,
  patch,
}: {
  element: LineElement;
  patch: (partial: Record<string, unknown>) => void;
}) {
  return (
    <Card className="p-4">
      <SectionHeader title="선 / 연결선" />
      <div className="mt-3 space-y-3">
        <ColorRow label="색" value={element.stroke} onChange={(value) => patch({ stroke: value })} />
        <NumberField label="두께" value={element.strokeWidth} onChange={(value) => patch({ strokeWidth: Math.max(0.1, value) })} step={0.1} suffix="mm" />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate-600">선 모양</span>
          <SegmentedControl
            size="sm"
            value={element.dash}
            onChange={(value) => patch({ dash: value })}
            options={[
              { value: "solid", label: "실선" },
              { value: "dashed", label: "파선" },
              { value: "dotted", label: "점선" },
            ]}
          />
        </div>
        <Toggle checked={element.arrowEnd} onChange={(value) => patch({ arrowEnd: value })} label="끝 화살표" />
        <Toggle checked={element.arrowStart} onChange={(value) => patch({ arrowStart: value })} label="시작 화살표" />
        <Toggle checked={element.connector} onChange={(value) => patch({ connector: value })} label="연결선으로 표시" />
        <p className="text-[10px] leading-relaxed text-slate-400">
          선은 선택 후 회전 손잡이로 각도를 바꿀 수 있습니다. 길이는 너비/높이로 조절합니다.
        </p>
        <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 text-[10px] text-slate-500">
          <Circle className="h-2 w-2" />
          {`${mmToPx(element.w).toFixed(0)}px 길이`}
        </div>
      </div>
    </Card>
  );
}
