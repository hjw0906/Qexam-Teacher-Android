import { useCallback, useEffect, useRef, useState } from "react";
import type { DocElement, DocPage } from "../../lib/types";
import { expandSelection, pageDimensions, snap } from "../../lib/document";
import { mmToPx } from "../../lib/utils";
import { ElementRenderer } from "./ElementRenderer";

type HandleDir = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface PreviewPatch {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotation?: number;
}

interface DragState {
  mode: "move" | "resize" | "rotate";
  dir?: HandleDir;
  startX: number;
  startY: number;
  originals: DocElement[];
  center?: { x: number; y: number };
  startAngle?: number;
}

export interface PageViewProps {
  page: DocPage;
  zoom: number;
  interactive?: boolean;
  active?: boolean;
  selectedIds?: string[];
  showMargins?: boolean;
  editingId?: string | null;
  onActivate?: () => void;
  onSelect?: (ids: string[]) => void;
  onChange?: (elements: DocElement[]) => void;
  onStartEdit?: (id: string | null) => void;
  gridMm?: number;
  className?: string;
}

const HANDLES: { dir: HandleDir; className: string; cursor: string }[] = [
  { dir: "nw", className: "-left-1 -top-1", cursor: "nwse-resize" },
  { dir: "n", className: "left-1/2 -top-1 -translate-x-1/2", cursor: "ns-resize" },
  { dir: "ne", className: "-right-1 -top-1", cursor: "nesw-resize" },
  { dir: "e", className: "-right-1 top-1/2 -translate-y-1/2", cursor: "ew-resize" },
  { dir: "se", className: "-right-1 -bottom-1", cursor: "nwse-resize" },
  { dir: "s", className: "left-1/2 -bottom-1 -translate-x-1/2", cursor: "ns-resize" },
  { dir: "sw", className: "-left-1 -bottom-1", cursor: "nesw-resize" },
  { dir: "w", className: "-left-1 top-1/2 -translate-y-1/2", cursor: "ew-resize" },
];

export function PageView({
  page,
  zoom,
  interactive = false,
  active = true,
  selectedIds = [],
  showMargins = false,
  editingId = null,
  onActivate,
  onSelect,
  onChange,
  onStartEdit,
  gridMm = 0.5,
  className,
}: PageViewProps) {
  const [preview, setPreview] = useState<Record<string, PreviewPatch>>({});
  const [editingText, setEditingText] = useState("");
  const dragRef = useRef<DragState | null>(null);
  const dimension = pageDimensions(page);
  const widthPx = mmToPx(dimension.width);
  const heightPx = mmToPx(dimension.height);

  const selected = expandSelection(page.elements, selectedIds);

  const beginDrag = useCallback(
    (event: React.PointerEvent, mode: DragState["mode"], dir?: HandleDir, element?: DocElement) => {
      if (!interactive) return;
      event.stopPropagation();
      event.preventDefault();
      onActivate?.();
      let ids = selected;
      if (element) {
        if (event.shiftKey && selectedIds.length) {
          ids = selectedIds.includes(element.id)
            ? selectedIds.filter((id) => id !== element.id)
            : [...selectedIds, element.id];
        } else if (!selectedIds.includes(element.id)) {
          ids = [element.id];
        }
        onSelect?.(expandSelection(page.elements, ids));
      }
      const originals = page.elements
        .filter((item) => (element ? ids.includes(item.id) : selected.includes(item.id)))
        .filter((item) => !item.locked);
      if (!originals.length) return;

      const state: DragState = {
        mode,
        dir,
        startX: event.clientX,
        startY: event.clientY,
        originals: structuredClone(originals),
      };
      if (mode === "rotate" && element) {
        const pageRect = (event.currentTarget as HTMLElement)
          .closest(".doc-page")
          ?.getBoundingClientRect();
        if (pageRect) {
          const center = {
            x: pageRect.left + mmToPx(element.x + element.w / 2) * zoom,
            y: pageRect.top + mmToPx(element.y + element.h / 2) * zoom,
          };
          state.center = center;
          state.startAngle = Math.atan2(event.clientY - center.y, event.clientX - center.x);
        }
      }
      dragRef.current = state;
      document.body.style.userSelect = "none";
    },
    [interactive, onActivate, onSelect, page.elements, selected, selectedIds, zoom],
  );

  useEffect(() => {
    if (!interactive) return;
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const scale = zoom * mmToPx(1);
      const dx = (event.clientX - drag.startX) / scale;
      const dy = (event.clientY - drag.startY) / scale;
      const grid = gridMm;
      const patches: Record<string, PreviewPatch> = {};

      if (drag.mode === "move") {
        for (const original of drag.originals) {
          patches[original.id] = {
            x: snap(original.x + dx, grid, true),
            y: snap(original.y + dy, grid, true),
          };
        }
      } else if (drag.mode === "resize" && drag.dir) {
        const dir = drag.dir;
        for (const original of drag.originals) {
          let { x, y, w, h } = original;
          if (dir.includes("e")) w = Math.max(3, original.w + dx);
          if (dir.includes("s")) h = Math.max(2, original.h + dy);
          if (dir.includes("w")) {
            const nextW = Math.max(3, original.w - dx);
            x = original.x + (original.w - nextW);
            w = nextW;
          }
          if (dir.includes("n")) {
            const nextH = Math.max(2, original.h - dy);
            y = original.y + (original.h - nextH);
            h = nextH;
          }
          patches[original.id] = {
            x: snap(x, grid, true),
            y: snap(y, grid, true),
            w: snap(w, grid, true),
            h: snap(h, grid, true),
          };
        }
      } else if (drag.mode === "rotate" && drag.center && drag.startAngle !== undefined) {
        const angle =
          (Math.atan2(event.clientY - drag.center.y, event.clientX - drag.center.x) -
            drag.startAngle) *
          (180 / Math.PI);
        for (const original of drag.originals) {
          let rotation = original.rotation + angle;
          if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
          patches[original.id] = { rotation: Math.round(rotation * 10) / 10 };
        }
      }
      setPreview(patches);
    };

    const onUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      document.body.style.userSelect = "";
      if (!drag) return;
      setPreview((current) => {
        if (!Object.keys(current).length) return {};
        const elements = page.elements.map((element) => {
          const patch = current[element.id];
          if (!patch) return element;
          return { ...element, ...patch } as DocElement;
        });
        onChange?.(elements);
        return {};
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [interactive, onChange, page.elements, zoom, gridMm]);

  const renderElement = (element: DocElement) => {
    const patch = preview[element.id];
    const effective = patch ? { ...element, ...patch } : element;
    const isSelected = selected.includes(element.id);
    const style: React.CSSProperties = {
      left: mmToPx(effective.x),
      top: mmToPx(effective.y),
      width: mmToPx(Math.max(effective.w, 0.1)),
      height: mmToPx(Math.max(effective.h, 0.1)),
      transform: `rotate(${effective.rotation}deg)`,
      transformOrigin: "center center",
      opacity: effective.opacity,
    };

    const editing = editingId === element.id && element.type === "text";

    return (
      <div
        key={element.id}
        className={`doc-element ${isSelected && interactive ? "doc-selected" : ""}`}
        style={style}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          beginDrag(event, "move", undefined, element);
        }}
        onDoubleClick={(event) => {
          if (!interactive || element.locked) return;
          event.stopPropagation();
          if (element.type === "text") {
            setEditingText(element.text);
            onStartEdit?.(element.id);
          }
        }}
      >
        {editing ? (
          <textarea
            autoFocus
            value={editingText}
            onChange={(event) => setEditingText(event.target.value)}
            onPointerDown={(event) => event.stopPropagation()}
            onBlur={() => {
              const elements = page.elements.map((item) =>
                item.id === element.id && item.type === "text" ? { ...item, text: editingText } : item,
              );
              onChange?.(elements);
              onStartEdit?.(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onStartEdit?.(null);
              }
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                (event.target as HTMLTextAreaElement).blur();
              }
            }}
            style={{
              width: "100%",
              height: "100%",
              resize: "none",
              border: "1px dashed #2563eb",
              outline: "none",
              padding: 2,
              fontSize: "inherit",
              fontFamily: "inherit",
              lineHeight: "inherit",
              background: "rgba(255,255,255,0.95)",
            }}
          />
        ) : (
          <ElementRenderer element={effective} />
        )}

        {isSelected && interactive && !element.locked ? (
          <>
            {HANDLES.map((handle) => (
              <div
                key={handle.dir}
                role="presentation"
                className={`absolute h-2 w-2 rounded-sm border border-brand-600 bg-white ${handle.className}`}
                style={{ cursor: handle.cursor }}
                onPointerDown={(event) => beginDrag(event, "resize", handle.dir, element)}
              />
            ))}
            <div
              role="presentation"
              className="absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full border border-brand-600 bg-white"
              style={{ top: -18, cursor: "grab" }}
              onPointerDown={(event) => beginDrag(event, "rotate", undefined, element)}
              title="회전"
            />
          </>
        ) : null}
        {element.locked && interactive ? (
          <div className="pointer-events-none absolute right-0 top-0 rounded-bl bg-slate-700/70 px-1 text-[8px] text-white">
            잠김
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div
      className={`doc-page ${className ?? ""} ${
        interactive ? (active ? "ring-2 ring-brand-400" : "ring-1 ring-slate-200") : ""
      }`}
      style={{ width: widthPx, height: heightPx, background: page.background }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onActivate?.();
          if (interactive) onSelect?.([]);
        }
      }}
    >
      {showMargins ? (
        <div
          className="pointer-events-none absolute border border-dashed border-brand-300/70"
          style={{
            left: mmToPx(page.margins.left),
            top: mmToPx(page.margins.top),
            width: widthPx - mmToPx(page.margins.left + page.margins.right),
            height: heightPx - mmToPx(page.margins.top + page.margins.bottom),
          }}
        />
      ) : null}
      {page.elements.map(renderElement)}
      {interactive ? (
        <div className="pointer-events-none absolute bottom-1 right-2 text-[9px] text-slate-300">
          {page.name}
        </div>
      ) : null}
    </div>
  );
}
