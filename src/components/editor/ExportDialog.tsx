import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileImage, Printer } from "lucide-react";
import {
  Button,
  Field,
  Input,
  Modal,
  ProgressBar,
  SegmentedControl,
  Select,
} from "../ui";
import { PageView } from "./PageView";
import { useProjectStore } from "../../store/projectStore";
import { exportPagesToPdf, exportPagesToPng } from "../../lib/export";
import { pageDimensions } from "../../lib/document";
import { isTauri, fitPath, pickDirectory, pickSaveFile, writeBinaryFile } from "../../lib/tauri";
import { toast } from "../../store/uiStore";
import { downloadBlob, errorMessage, mmToPx, sanitizeFileName } from "../../lib/utils";
import type { DocPage } from "../../lib/types";

type RangeMode = "all" | "current" | "custom";

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useProjectStore((state) => state.project);
  const activePageId = useProjectStore((state) => state.activePageId);
  const [range, setRange] = useState<RangeMode>("all");
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [colorMode, setColorMode] = useState<"color" | "bw">("color");
  const [scale, setScale] = useState(2);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const captureRefs = useRef<(HTMLDivElement | null)[]>([]);

  const projectId = project?.id;
  const pageCount = project?.pages.length ?? 0;
  const exportScale = project?.settings.exportScale ?? 2;
  useEffect(() => {
    setFrom(1);
    setTo(pageCount);
    setScale(exportScale || 2);
  }, [projectId, pageCount, exportScale]);

  const selectedPages: DocPage[] = useMemo(() => {
    if (!project) return [];
    if (range === "current") {
      const current = project.pages.find((page) => page.id === activePageId);
      return current ? [current] : project.pages.slice(0, 1);
    }
    if (range === "custom") {
      const start = Math.max(1, Math.min(from, to));
      const end = Math.min(project.pages.length, Math.max(from, to));
      return project.pages.slice(start - 1, end);
    }
    return project.pages;
  }, [project, range, activePageId, from, to]);

  if (!project) return null;

  const baseName = sanitizeFileName(project.name);

  async function captureNodes(): Promise<HTMLElement[]> {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (document.fonts?.ready) await document.fonts.ready.catch(() => undefined);
    return selectedPages
      .map((_, index) => captureRefs.current[index])
      .filter((node): node is HTMLDivElement => Boolean(node));
  }

  async function handlePdf() {
    setBusy("pdf");
    setProgress({ done: 0, total: selectedPages.length });
    try {
      const nodes = await captureNodes();
      if (nodes.length !== selectedPages.length) throw new Error("페이지를 준비하지 못했습니다. 다시 시도해 주세요.");
      const blob = await exportPagesToPdf(nodes, selectedPages, {
        scale,
        grayscale: colorMode === "bw",
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (isTauri) {
        const path = await pickSaveFile(`${baseName}.pdf`, [{ name: "PDF", extensions: ["pdf"] }]);
        if (!path) return;
        const target = path.toLowerCase().endsWith(".pdf") ? path : `${path}.pdf`;
        await writeBinaryFile(target, new Uint8Array(await blob.arrayBuffer()));
        toast.success("PDF로 저장했습니다.", target);
      } else {
        downloadBlob(blob, `${baseName}.pdf`);
        toast.success("PDF를 다운로드했습니다.", `${selectedPages.length}페이지`);
      }
    } catch (error) {
      toast.error("PDF 내보내기 실패", errorMessage(error));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function handlePng() {
    setBusy("png");
    setProgress({ done: 0, total: selectedPages.length });
    try {
      const nodes = await captureNodes();
      const blobs = await exportPagesToPng(nodes, {
        scale,
        grayscale: colorMode === "bw",
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (isTauri) {
        const dir = await pickDirectory();
        if (!dir) return;
        for (let index = 0; index < blobs.length; index += 1) {
          const pageNo = String(index + 1).padStart(2, "0");
          await writeBinaryFile(
            fitPath(dir, `${baseName}-p${pageNo}.png`),
            new Uint8Array(await blobs[index].arrayBuffer()),
          );
        }
        toast.success("PNG로 저장했습니다.", `${dir} · ${blobs.length}개 파일`);
      } else {
        blobs.forEach((blob, index) => downloadBlob(blob, `${baseName}-p${index + 1}.png`));
        toast.success("PNG를 다운로드했습니다.", `${blobs.length}개 파일`);
      }
    } catch (error) {
      toast.error("PNG 내보내기 실패", errorMessage(error));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  function handlePrint() {
    const first = selectedPages[0];
    if (!first) return;
    const size = pageDimensions(first);
    const style = document.createElement("style");
    style.textContent = `@page { size: ${size.width}mm ${size.height}mm; margin: 0; }`;
    document.head.appendChild(style);
    window.setTimeout(() => {
      window.print();
      window.setTimeout(() => style.remove(), 3000);
    }, 200);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="내보내기 및 인쇄"
      description="편집 화면과 동일한 결과를 PDF/PNG로 저장하거나 인쇄합니다."
      width="max-w-5xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
          <Button
            variant="secondary"
            icon={<Printer className="h-4 w-4" />}
            onClick={handlePrint}
            disabled={Boolean(busy)}
          >
            인쇄
          </Button>
          <Button
            variant="secondary"
            icon={<FileImage className="h-4 w-4" />}
            loading={busy === "png"}
            onClick={() => void handlePng()}
          >
            PNG 저장
          </Button>
          <Button
            variant="primary"
            icon={<Download className="h-4 w-4" />}
            loading={busy === "pdf"}
            onClick={() => void handlePdf()}
          >
            PDF 저장
          </Button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Field label="페이지 범위">
            <SegmentedControl
              value={range}
              onChange={setRange}
              options={[
                { value: "all", label: "전체" },
                { value: "current", label: "현재" },
                { value: "custom", label: "지정" },
              ]}
            />
          </Field>
          {range === "custom" ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="시작">
                <Input
                  type="number"
                  min={1}
                  max={project.pages.length}
                  value={from}
                  onChange={(event) => setFrom(Number(event.target.value) || 1)}
                />
              </Field>
              <Field label="끝">
                <Input
                  type="number"
                  min={1}
                  max={project.pages.length}
                  value={to}
                  onChange={(event) => setTo(Number(event.target.value) || 1)}
                />
              </Field>
            </div>
          ) : null}
          <Field label="색상">
            <SegmentedControl
              value={colorMode}
              onChange={setColorMode}
              options={[
                { value: "color", label: "컬러" },
                { value: "bw", label: "흑백" },
              ]}
            />
          </Field>
          <Field label="해상도" hint="PDF는 이미지 기반으로 생성되어 화면과 동일하게 출력됩니다.">
            <Select value={String(scale)} onChange={(event) => setScale(Number(event.target.value))}>
              <option value="1">1× (빠름)</option>
              <option value="1.5">1.5×</option>
              <option value="2">2× (권장)</option>
              <option value="3">3× (고품질)</option>
            </Select>
          </Field>
          <div className="rounded-lg bg-slate-50 p-2.5 text-[10px] leading-relaxed text-slate-500">
            <p>· 총 {selectedPages.length}페이지를 내보냅니다.</p>
            <p>· A4 최적화, 페이지 잘림 방지를 위해 여백을 확인하세요.</p>
            <p>· PDF/PNG는 화면 렌더링을 그대로 캡처합니다.</p>
            {progress ? (
              <div className="mt-2">
                <ProgressBar value={(progress.done / Math.max(1, progress.total)) * 100} />
                <p className="mt-1">
                  {progress.done}/{progress.total} 페이지
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="scroll-area max-h-[52vh] rounded-lg bg-slate-100 p-4">
          <div className="flex flex-wrap justify-center gap-3">
            {selectedPages.map((page, index) => {
              const size = pageDimensions(page);
              return (
                <div key={page.id} className="text-center">
                  <div
                    style={{
                      width: mmToPx(size.width) * 0.32,
                      height: mmToPx(size.height) * 0.32,
                      overflow: "hidden",
                      margin: "0 auto",
                      boxShadow: "0 2px 8px rgba(15,23,42,0.16)",
                      background: "#fff",
                    }}
                  >
                    <div
                      style={{
                        transform: "scale(0.32)",
                        transformOrigin: "top left",
                        width: mmToPx(size.width),
                        height: mmToPx(size.height),
                      }}
                    >
                      <PageView page={page} zoom={1} interactive={false} active={false} showMargins={false} />
                    </div>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {index + 1}. {page.name}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Hidden natural-size nodes used for capture (identical to the editor). */}
      <div className="pointer-events-none fixed left-[-12000px] top-0 opacity-100">
        {selectedPages.map((page, index) => {
          const size = pageDimensions(page);
          return (
            <div
              key={page.id}
              ref={(node) => {
                captureRefs.current[index] = node;
              }}
              style={{ width: mmToPx(size.width), height: mmToPx(size.height), background: "#fff" }}
            >
              <PageView page={page} zoom={1} interactive={false} active={false} showMargins={false} className="export-page" />
            </div>
          );
        })}
      </div>

      <div className="print-root">
        {selectedPages.map((page) => {
          const size = pageDimensions(page);
          return (
            <div
              key={page.id}
              className="print-page"
              style={{ width: mmToPx(size.width), height: mmToPx(size.height), background: "#fff" }}
            >
              <PageView page={page} zoom={1} interactive={false} active={false} showMargins={false} className="export-page" />
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
