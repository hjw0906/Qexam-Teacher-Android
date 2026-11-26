import type { CSSProperties } from "react";
import type { DocElement } from "../../lib/types";
import { mmToPx } from "../../lib/utils";

const ptToPx = (pt: number) => pt * (96 / 72);

function shapeMarkup(element: Extract<DocElement, { type: "shape" }>) {
  const { w, h, shape, fill, stroke, strokeWidth, radius } = element;
  const strokeValue = strokeWidth > 0 ? stroke : "none";
  const inset = strokeWidth / 2;
  const common = {
    fill,
    stroke: strokeValue,
    strokeWidth,
    vectorEffect: "non-scaling-stroke" as const,
  };
  if (shape === "ellipse") {
    return (
      <ellipse
        cx={w / 2}
        cy={h / 2}
        rx={Math.max(0, w / 2 - inset)}
        ry={Math.max(0, h / 2 - inset)}
        {...common}
      />
    );
  }
  if (shape === "triangle") {
    return (
      <polygon
        points={`${w / 2},${inset} ${w - inset},${h - inset} ${inset},${h - inset}`}
        {...common}
      />
    );
  }
  if (shape === "star") {
    const points: string[] = [];
    const cx = w / 2;
    const cy = h / 2;
    const outerX = w / 2 - inset;
    const outerY = h / 2 - inset;
    for (let index = 0; index < 10; index += 1) {
      const angle = (Math.PI / 5) * index - Math.PI / 2;
      const factor = index % 2 === 0 ? 1 : 0.45;
      points.push(`${cx + Math.cos(angle) * outerX * factor},${cy + Math.sin(angle) * outerY * factor}`);
    }
    return <polygon points={points.join(" ")} {...common} />;
  }
  if (shape === "arrowRight") {
    const body = h * 0.5;
    const points = [
      `${inset},${h / 2 - body / 2}`,
      `${w * 0.65},${h / 2 - body / 2}`,
      `${w * 0.65},${inset}`,
      `${w - inset},${h / 2}`,
      `${w * 0.65},${h - inset}`,
      `${w * 0.65},${h / 2 + body / 2}`,
      `${inset},${h / 2 + body / 2}`,
    ].join(" ");
    return <polygon points={points} {...common} />;
  }
  return (
    <rect
      x={inset}
      y={inset}
      width={Math.max(0, w - strokeWidth)}
      height={Math.max(0, h - strokeWidth)}
      rx={shape === "roundRect" ? radius : 0}
      ry={shape === "roundRect" ? radius : 0}
      {...common}
    />
  );
}

function LineShape({ element }: { element: Extract<DocElement, { type: "line" }> }) {
  const w = Math.max(element.w, 0.1);
  const h = Math.max(element.h, 0.1);
  const stroke = element.strokeWidth;
  const markerSize = Math.max(stroke * 3.2, 1.4);
  const start = { x: stroke / 2, y: stroke / 2 };
  const end = { x: w - stroke / 2, y: h - stroke / 2 };
  const dash =
    element.dash === "dashed" ? `${stroke * 4} ${stroke * 3}` : element.dash === "dotted" ? `${stroke} ${stroke * 2}` : undefined;
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ overflow: "visible" }}>
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke={element.stroke}
        strokeWidth={stroke}
        strokeDasharray={dash}
        strokeLinecap="round"
      />
      {element.arrowEnd ? (
        <polygon
          points={`${end.x},${end.y} ${end.x - markerSize * 2},${end.y - markerSize} ${end.x - markerSize * 2},${end.y + markerSize}`}
          fill={element.stroke}
          transform={`rotate(${(Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI} ${end.x} ${end.y})`}
        />
      ) : null}
      {element.arrowStart ? (
        <polygon
          points={`${start.x},${start.y} ${start.x + markerSize * 2},${start.y - markerSize} ${start.x + markerSize * 2},${start.y + markerSize}`}
          fill={element.stroke}
          transform={`rotate(${(Math.atan2(start.y - end.y, start.x - end.x) * 180) / Math.PI} ${start.x} ${start.y})`}
        />
      ) : null}
    </svg>
  );
}

export function ElementRenderer({
  element,
  fitToBox = true,
}: {
  element: DocElement;
  fitToBox?: boolean;
}) {
  const box: CSSProperties = fitToBox ? { width: "100%", height: "100%" } : {};

  if (element.type === "text") {
    const style: CSSProperties = {
      ...box,
      fontSize: ptToPx(element.fontSize),
      fontFamily: element.fontFamily,
      fontWeight: element.bold ? 700 : 400,
      fontStyle: element.italic ? "italic" : "normal",
      textDecoration: element.underline ? "underline" : "none",
      color: element.color,
      background: element.background === "transparent" ? "transparent" : element.background,
      textAlign: element.align,
      lineHeight: element.lineHeight,
      letterSpacing: `${element.letterSpacing}pt`,
      padding: mmToPx(element.padding),
      borderColor: element.borderColor,
      borderWidth: mmToPx(element.borderWidth),
      borderStyle: element.borderWidth > 0 ? "solid" : "none",
      borderRadius: mmToPx(element.radius),
      display: "flex",
      flexDirection: "column",
      justifyContent:
        element.verticalAlign === "middle" ? "center" : element.verticalAlign === "bottom" ? "flex-end" : "flex-start",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      overflow: "hidden",
    };
    return (
      <div style={style}>
        <div className="doc-text">{element.text}</div>
      </div>
    );
  }

  if (element.type === "image") {
    if (!element.src) {
      return (
        <div
          style={box}
          className="flex items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-[10px] text-slate-400"
        >
          이미지
        </div>
      );
    }
    return (
      <img
        src={element.src}
        alt={element.alt}
        draggable={false}
        style={{ ...box, objectFit: element.fit, borderRadius: mmToPx(element.radius) }}
      />
    );
  }

  if (element.type === "shape") {
    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${Math.max(element.w, 0.1)} ${Math.max(element.h, 0.1)}`} preserveAspectRatio="none">
        {shapeMarkup(element)}
      </svg>
    );
  }

  if (element.type === "table") {
    return (
      <table
        style={{
          ...box,
          borderCollapse: "collapse",
          tableLayout: "fixed",
          fontSize: ptToPx(element.fontSize),
          color: element.textColor,
        }}
      >
        <tbody>
          {element.cells.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, colIndex) => (
                <td
                  key={colIndex}
                  style={{
                    border: `1px solid ${element.borderColor}`,
                    padding: mmToPx(element.cellPadding),
                    background: element.headerRow && rowIndex === 0 ? element.headerBg : "transparent",
                    fontWeight: element.headerRow && rowIndex === 0 ? 600 : 400,
                    verticalAlign: "middle",
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (element.type === "bubble") {
    return (
      <div style={{ ...box, position: "relative" }}>
        <div
          style={{
            width: "100%",
            height: "100%",
            background: element.fill,
            border: `${mmToPx(0.3)}px solid ${element.stroke}`,
            borderRadius: mmToPx(3),
            padding: mmToPx(2.5),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            fontSize: ptToPx(element.fontSize),
            color: element.textColor,
            fontWeight: 500,
            whiteSpace: "pre-wrap",
            overflow: "hidden",
          }}
        >
          {element.text}
        </div>
        {element.tail !== "none" ? (
          <div
            style={{
              position: "absolute",
              bottom: mmToPx(-2.4),
              left: element.tail === "left" ? mmToPx(6) : undefined,
              right: element.tail === "right" ? mmToPx(6) : undefined,
              width: 0,
              height: 0,
              borderLeft: `${mmToPx(2.4)}px solid transparent`,
              borderRight: `${mmToPx(2.4)}px solid transparent`,
              borderTop: `${mmToPx(2.6)}px solid ${element.fill}`,
            }}
          />
        ) : null}
      </div>
    );
  }

  return <LineShape element={element} />;
}
