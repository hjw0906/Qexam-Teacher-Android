import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import type { DocPage } from "./types";
import { pageDimensions } from "./document";

export interface ExportOptions {
  scale: number;
  grayscale: boolean;
  onProgress?: (done: number, total: number) => void;
}

function toCanvasScale(canvas: HTMLCanvasElement, grayscale: boolean): HTMLCanvasElement {
  if (!grayscale) return canvas;
  const target = document.createElement("canvas");
  target.width = canvas.width;
  target.height = canvas.height;
  const context = target.getContext("2d");
  if (!context) return canvas;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, target.width, target.height);
  context.filter = "grayscale(1)";
  context.drawImage(canvas, 0, 0);
  return target;
}

export async function renderNode(
  node: HTMLElement,
  options: ExportOptions,
): Promise<HTMLCanvasElement> {
  const canvas = await html2canvas(node, {
    scale: options.scale,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
    windowWidth: node.scrollWidth,
    windowHeight: node.scrollHeight,
  });
  return toCanvasScale(canvas, options.grayscale);
}

export async function exportPagesToPdf(
  nodes: HTMLElement[],
  pages: DocPage[],
  options: ExportOptions,
): Promise<Blob> {
  if (!nodes.length) throw new Error("내보낼 페이지가 없습니다.");
  let document: jsPDF | null = null;

  for (let index = 0; index < nodes.length; index += 1) {
    const page = pages[index];
    const size = pageDimensions(page);
    const canvas = await renderNode(nodes[index], options);
    const imageData = canvas.toDataURL("image/jpeg", 0.94);

    if (!document) {
      document = new jsPDF({
        orientation: size.width > size.height ? "landscape" : "portrait",
        unit: "mm",
        format: [size.width, size.height],
        compress: true,
      });
    } else {
      document.addPage([size.width, size.height], size.width > size.height ? "landscape" : "portrait");
    }
    document.addImage(imageData, "JPEG", 0, 0, size.width, size.height, undefined, "FAST");
    options.onProgress?.(index + 1, nodes.length);
  }

  if (!document) throw new Error("PDF를 생성할 수 없습니다.");
  return document.output("blob");
}

export async function exportPagesToPng(
  nodes: HTMLElement[],
  options: ExportOptions,
): Promise<Blob[]> {
  const files: Blob[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const canvas = await renderNode(nodes[index], options);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) files.push(blob);
    options.onProgress?.(index + 1, nodes.length);
  }
  return files;
}

export function printPages(): void {
  window.print();
}
