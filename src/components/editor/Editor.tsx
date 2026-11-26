import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Download,
  Image as ImageIcon,
  Layers,
  MessageSquare,
  Minus,
  MoveHorizontal,
  Plus,
  Printer,
  Redo2,
  Square,
  Table as TableIcon,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button, IconButton, SegmentedControl } from "../ui";
import { PageView } from "./PageView";
import { ExportDialog } from "./ExportDialog";
import { activePage, useProjectStore } from "../../store/projectStore";
import {
  alignElements,
  createBubbleElement,
  createElement,
  createImageElement,
  createLineElement,
  createShapeElement,
  createTableElement,
  createTextElement,
  distributeElements,
  duplicateElement,
  expandSelection,
  groupElements,
  pageDimensions,
  ungroupElements,
} from "../../lib/document";
import { isTauri, pickBrowserFile, pickOpenFile, readBinaryFile } from "../../lib/tauri";
import { bytesToBase64, errorMessage, mmToPx, readFileAsDataUrl } from "../../lib/utils";
import { toast } from "../../store/uiStore";
import type { DocPage } from "../../lib/types";

async function pickImageDataUrl(): Promise<{ src: string; name: string } | null> {
  if (isTauri) {
    const path = await pickOpenFile([
      { name: "이미지", extensions: ["png", "jpg", "jpeg", "webp"] },
    ]);
    if (!path) return null;
    const bytes = await readBinaryFile(path);
    const name = path.split(/[\\/]/).pop() ?? "image.png";
    const lower = name.toLowerCase();
    const mime = lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";
    return { src: `data:${mime};base64,${bytesToBase64(bytes)}`, name };
  }
  const file = await pickBrowserFile(".png,.jpg,.jpeg,.webp,image/*");
  if (!file) return null;
  return { src: await readFileAsDataUrl(file), name: file.name };
}

export function Editor({ exportSignal }: { exportSignal: number }) {
  const project = useProjectStore((state) => state.project);
  const page = useProjectStore((state) => activePage(state));
  const selectedIds = useProjectStore((state) => state.selectedIds);
  const zoom = useProjectStore((state) => state.zoom);
  const setZoom = useProjectStore((state) => state.setZoom);
  const setActivePage = useProjectStore((state) => state.setActivePage);
  const selectElements = useProjectStore((state) => state.selectElements);
  const addElement = useProjectStore((state) => state.addElement);
  const updateElements = useProjectStore((state) => state.updateElements);
  const undo = useProjectStore((state) => state.undo);
  const redo = useProjectStore((state) => state.redo);
  const addPage = useProjectStore((state) => state.addPage);
  const deletePage = useProjectStore((state) => state.deletePage);
  const duplicatePage = useProjectStore((state) => state.duplicatePage);
  const canUndo = useProjectStore((state) => state.history.length > 0);
  const canRedo = useProjectStore((state) => state.future.length > 0);
  const selected = useMemo(
    () => (page ? page.elements.filter((element) => selectedIds.includes(element.id)) : []),
    [page, selectedIds],
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const pageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (exportSignal > 0) setExportOpen(true);
  }, [exportSignal]);

  const insert = useCallback(
    (element: ReturnType<typeof createElement>) => {
      if (!project) return;
      const current = project.pages.find((item) => item.id === (page?.id ?? "")) ?? project.pages[0];
      if (current) {
        const size = pageDimensions(current);
        addElement({
          ...element,
          x: Math.min(element.x, size.width - element.w - 5),
          y: Math.min(element.y, size.height - element.h - 5),
        });
      } else {
        addElement(element);
      }
    },
    [addElement, page?.id, project],
  );

  const addImage = useCallback(async () => {
    try {
      const picked = await pickImageDataUrl();
      if (!picked) return;
      insert(createImageElement(picked.src, { alt: picked.name }));
      toast.success("이미지를 추가했습니다.", picked.name);
    } catch (error) {
      toast.error("이미지를 불러오지 못했습니다.", errorMessage(error));
    }
  }, [insert]);

  useEffect(() => {
    if (!project || !page) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (mod && event.key.toLowerCase() === "d" && selected.length) {
        event.preventDefault();
        const copies = selected.map((element) => duplicateElement(element));
        updateElements([...page.elements, ...copies]);
        selectElements(copies.map((element) => element.id));
        return;
      }
      if (mod && event.key.toLowerCase() === "g") {
        event.preventDefault();
        if (event.shiftKey) {
          updateElements(ungroupElements(page.elements, selectedIds));
        } else {
          updateElements(groupElements(page.elements, selectedIds));
        }
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selected.length) {
        event.preventDefault();
        useProjectStore.getState().deleteElements(selected.map((element) => element.id));
        return;
      }
      if (event.key === "Escape") {
        selectElements([]);
        setEditingId(null);
        return;
      }
      if (event.key.startsWith("Arrow") && selected.length) {
        event.preventDefault();
        const step = event.shiftKey ? 5 : 0.5;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        updateElements(
          page.elements.map((element) =>
            selectedIds.includes(element.id)
              ? { ...element, x: element.x + dx, y: element.y + dy }
              : element,
          ),
        );
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [project, page, selected, selectedIds, selectElements, updateElements, undo, redo]);

  if (!project || !page) return null;

  const applyToSelection = (transform: (elements: DocPage["elements"]) => DocPage["elements"]) => {
    const expanded = expandSelection(page.elements, selectedIds);
    const targets = page.elements.filter((element) => expanded.includes(element.id));
    const updated = transform(targets);
    updateElements(
      page.elements.map((element) => updated.find((item) => item.id === element.id) ?? element),
    );
  };

  const fitZoom = () => {
    const container = canvasRef.current;
    if (!container) return;
    const size = pageDimensions(page);
    const available = container.clientWidth - 80;
    setZoom(Math.min(2, Math.max(0.25, available / mmToPx(size.width))));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-3 py-1.5">
        <div className="flex items-center gap-0.5 rounded-lg bg-slate-50 p-0.5">
          <IconButton label="텍스트 상자" onClick={() => insert(createTextElement())}>
            <Type className="h-4 w-4" />
          </IconButton>
          <IconButton label="이미지" onClick={() => void addImage()}>
            <ImageIcon className="h-4 w-4" />
          </IconButton>
          <IconButton label="도형" onClick={() => insert(createShapeElement())}>
            <Square className="h-4 w-4" />
          </IconButton>
          <IconButton label="표" onClick={() => insert(createTableElement())}>
            <TableIcon className="h-4 w-4" />
          </IconButton>
          <IconButton label="말풍선" onClick={() => insert(createBubbleElement())}>
            <MessageSquare className="h-4 w-4" />
          </IconButton>
          <IconButton label="선" onClick={() => insert(createLineElement())}>
            <Minus className="h-4 w-4" />
          </IconButton>
        </div>

        <Divider />
        <IconButton label="실행 취소 (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
          <Undo2 className="h-4 w-4" />
        </IconButton>
        <IconButton label="다시 실행 (Ctrl+Y)" onClick={redo} disabled={!canRedo}>
          <Redo2 className="h-4 w-4" />
        </IconButton>

        <Divider />
        <IconButton
          label="왼쪽 정렬"
          disabled={!selected.length}
          onClick={() => applyToSelection((elements) => alignElements(elements, "left"))}
        >
          <ArrowUpToLine className="h-4 w-4 rotate-[-90deg]" />
        </IconButton>
        <IconButton
          label="가로 가운데"
          disabled={!selected.length}
          onClick={() => applyToSelection((elements) => alignElements(elements, "hcenter"))}
        >
          <MoveHorizontal className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="오른쪽 정렬"
          disabled={!selected.length}
          onClick={() => applyToSelection((elements) => alignElements(elements, "right"))}
        >
          <ArrowDownToLine className="h-4 w-4 rotate-[-90deg]" />
        </IconButton>
        <IconButton
          label="위 정렬"
          disabled={!selected.length}
          onClick={() => applyToSelection((elements) => alignElements(elements, "top"))}
        >
          <ArrowUpToLine className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="아래 정렬"
          disabled={!selected.length}
          onClick={() => applyToSelection((elements) => alignElements(elements, "bottom"))}
        >
          <ArrowDownToLine className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="가로 간격 균등"
          disabled={selected.length < 3}
          onClick={() => applyToSelection((elements) => distributeElements(elements, "horizontal"))}
        >
          <span className="text-[10px] font-bold">↔</span>
        </IconButton>
        <IconButton
          label="세로 간격 균등"
          disabled={selected.length < 3}
          onClick={() => applyToSelection((elements) => distributeElements(elements, "vertical"))}
        >
          <span className="text-[10px] font-bold">↕</span>
        </IconButton>

        <Divider />
        <IconButton
          label="그룹 (Ctrl+G)"
          disabled={selected.length < 2}
          onClick={() => updateElements(groupElements(page.elements, selectedIds))}
        >
          <Layers className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="그룹 해제 (Ctrl+Shift+G)"
          disabled={!selected.some((element) => element.groupId)}
          onClick={() => updateElements(ungroupElements(page.elements, selectedIds))}
        >
          <span className="text-[10px] font-bold">해제</span>
        </IconButton>
        <IconButton
          label="복제 (Ctrl+D)"
          disabled={!selected.length}
          onClick={() => {
            const copies = selected.map((element) => duplicateElement(element));
            updateElements([...page.elements, ...copies]);
            selectElements(copies.map((element) => element.id));
          }}
        >
          <Copy className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="삭제 (Del)"
          disabled={!selected.length}
          onClick={() => useProjectStore.getState().deleteElements(selectedIds)}
        >
          <Trash2 className="h-4 w-4" />
        </IconButton>

        <div className="ml-auto flex items-center gap-1">
          <IconButton label="축소" onClick={() => setZoom(zoom - 0.1)}>
            <ZoomOut className="h-4 w-4" />
          </IconButton>
          <SegmentedControl
            size="sm"
            value={String(Math.round(zoom * 100))}
            onChange={(value) => setZoom(Number(value) / 100)}
            options={[
              { value: "50", label: "50%" },
              { value: "75", label: "75%" },
              { value: "100", label: "100%" },
              { value: "125", label: "125%" },
            ]}
          />
          <IconButton label="확대" onClick={() => setZoom(zoom + 0.1)}>
            <ZoomIn className="h-4 w-4" />
          </IconButton>
          <IconButton label="화면에 맞추기" onClick={fitZoom}>
            <span className="text-[10px] font-bold">맞춤</span>
          </IconButton>
          <Divider />
          <Button
            size="sm"
            variant="secondary"
            icon={<Printer className="h-3.5 w-3.5" />}
            onClick={() => setExportOpen(true)}
          >
            인쇄/미리보기
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<Download className="h-3.5 w-3.5" />}
            onClick={() => setExportOpen(true)}
          >
            PDF/PNG
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[104px] flex-none flex-col gap-1 overflow-y-auto border-r border-slate-200 bg-white p-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-semibold text-slate-500">페이지</span>
            <button
              type="button"
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600"
              title="페이지 추가"
              onClick={() => addPage(page.id)}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {project.pages.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActivePage(item.id);
                pageRefs.current[item.id]?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className={`rounded-lg border px-1.5 py-1.5 text-left transition ${
                item.id === page.id
                  ? "border-brand-400 bg-brand-50"
                  : "border-slate-200 bg-white hover:border-brand-200"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-600">{index + 1}</span>
                <span className="text-[9px] text-slate-400">{item.elements.length}개</span>
              </div>
              <p className="mt-0.5 truncate text-[9px] text-slate-500">{item.name}</p>
            </button>
          ))}
          <div className="mt-1 flex flex-col gap-1">
            <Button size="sm" variant="ghost" onClick={() => duplicatePage(page.id)}>
              복제
            </Button>
            <Button size="sm" variant="ghost" onClick={() => deletePage(page.id)}>
              삭제
            </Button>
          </div>
        </div>

        <div ref={canvasRef} className="scroll-area relative flex-1 p-8" onPointerDown={() => setEditingId(null)}>
          <div className="mx-auto flex w-fit flex-col items-center gap-8">
            {project.pages.map((item) => {
              const size = pageDimensions(item);
              return (
                <div
                  key={item.id}
                  ref={(node) => {
                    pageRefs.current[item.id] = node;
                  }}
                  style={{
                    width: mmToPx(size.width) * zoom,
                    height: mmToPx(size.height) * zoom,
                  }}
                >
                  <div
                    style={{
                      transform: `scale(${zoom})`,
                      transformOrigin: "top left",
                      width: mmToPx(size.width),
                      height: mmToPx(size.height),
                    }}
                  >
                    <PageView
                      page={item}
                      zoom={zoom}
                      interactive
                      active={item.id === page.id}
                      selectedIds={item.id === page.id ? selectedIds : []}
                      showMargins={project.settings.showMarginGuides}
                      editingId={item.id === page.id ? editingId : null}
                      onActivate={() => setActivePage(item.id)}
                      onSelect={(ids) => {
                        setActivePage(item.id);
                        selectElements(ids);
                      }}
                      onChange={(elements) => {
                        setActivePage(item.id);
                        updateElements(elements);
                      }}
                      onStartEdit={setEditingId}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-slate-200" />;
}
