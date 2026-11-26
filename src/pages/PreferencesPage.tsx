import { useEffect, useState } from "react";
import { FolderOpen, Info, Save } from "lucide-react";
import {
  Button,
  Card,
  Field,
  Input,
  KeyValue,
  SectionHeader,
  Select,
  Toggle,
} from "../components/ui";
import { loadPreferences, savePreferences } from "../lib/storage";
import type { AppPreferences, PageSizeId } from "../lib/types";
import { getWorkspaceDir } from "../lib/tauri";
import { toast } from "../store/uiStore";
import { terminateOcr } from "../lib/ingest/recognize";

export function PreferencesPage() {
  const [prefs, setPrefs] = useState<AppPreferences>(() => loadPreferences());
  const [workspace, setWorkspace] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getWorkspaceDir().then(setWorkspace).catch(() => setWorkspace("(경로를 확인할 수 없음)"));
  }, []);

  function patch(partial: Partial<AppPreferences>) {
    setPrefs((previous) => ({ ...previous, ...partial }));
  }

  function persist() {
    setSaving(true);
    savePreferences(prefs);
    setSaving(false);
    toast.success("환경 설정을 저장했습니다.", "새 프로젝트와 편집기에 즉시 적용됩니다.");
  }

  return (
    <div className="scroll-area h-full">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <SectionHeader
          title="환경 설정"
          description="저장 주기, 기본 용지, 편집 보조 옵션을 설정합니다. 모든 설정은 이 PC에만 저장됩니다."
        />

        <Card className="mt-5 p-5">
          <SectionHeader title="저장 및 자동 저장" description="작업 손실을 줄이는 자동 저장 주기입니다." />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="자동 저장 주기 (초)"
              hint="0으로 설정하면 자동 저장을 사용하지 않습니다. 파일 경로가 있는 프로젝트는 자동 저장 시 파일에 바로 기록됩니다."
            >
              <Input
                type="number"
                min={0}
                max={600}
                value={prefs.autosaveSeconds}
                onChange={(event) => patch({ autosaveSeconds: Math.max(0, Number(event.target.value) || 0) })}
              />
            </Field>
            <Field label="삭제 전 확인" hint="페이지/요소 삭제 시 확인 대화상자를 표시합니다.">
              <div className="pt-2">
                <Toggle
                  checked={prefs.confirmBeforeDelete}
                  onChange={(value) => patch({ confirmBeforeDelete: value })}
                  label="확인 대화상자 사용"
                />
              </div>
            </Field>
          </div>
        </Card>

        <Card className="mt-5 p-5">
          <SectionHeader title="문서 기본값" description="새 페이지와 편집기에서 사용하는 기본값입니다." />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="기본 용지">
              <Select
                value={prefs.defaultPageSize}
                onChange={(event) => patch({ defaultPageSize: event.target.value as PageSizeId })}
              >
                <option value="A4">A4 (210 × 297 mm)</option>
                <option value="A3">A3 (297 × 420 mm)</option>
                <option value="Letter">Letter (215.9 × 279.4 mm)</option>
              </Select>
            </Field>
            <Field label="내보내기 배율" hint="높을수록 선명하지만 PDF/PNG 파일이 커집니다. 저사양 PC에서는 1.5~2를 권장합니다.">
              <Select
                value={String(prefs.exportScale)}
                onChange={(event) => patch({ exportScale: Number(event.target.value) })}
              >
                <option value="1">1× (빠름)</option>
                <option value="1.5">1.5×</option>
                <option value="2">2× (권장)</option>
                <option value="3">3× (고품질)</option>
              </Select>
            </Field>
            <Field label="격자 간격 (mm)" hint="요소 이동 시 스냅 기준입니다.">
              <Input
                type="number"
                min={0.5}
                max={20}
                step={0.5}
                value={prefs.gridMm}
                onChange={(event) => patch({ gridMm: Number(event.target.value) || 2.5 })}
              />
            </Field>
            <div className="space-y-3 pt-1">
              <Toggle
                checked={prefs.snapToGrid}
                onChange={(value) => patch({ snapToGrid: value })}
                label="격자에 맞추기"
                description="이동/크기 조절 시 격자 간격에 스냅합니다."
              />
              <Toggle
                checked={prefs.showMarginGuides}
                onChange={(value) => patch({ showMarginGuides: value })}
                label="여백 가이드 표시"
                description="편집 화면에 인쇄 여백을 점선으로 표시합니다."
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} onClick={persist}>
              설정 저장
            </Button>
          </div>
        </Card>

        <Card className="mt-5 p-5">
          <SectionHeader title="로컬 저장 위치" description="프로젝트와 API 키가 저장되는 위치입니다." />
          <div className="mt-3">
            <KeyValue
              label="프로젝트 폴더"
              value={<span className="break-all font-mono text-[10px]">{workspace || "-"}</span>}
            />
            <KeyValue label="프로젝트 형식" value=".qws (JSON, 이미지 자산 포함)" />
            <KeyValue label="API 키" value="Windows DPAPI 암호화 파일 (gemini-api-key.bin)" />
            <KeyValue label="사용량 기록" value="로컬 앱 저장소 · 외부 전송 없음" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<FolderOpen className="h-3.5 w-3.5" />}
              disabled={!workspace || workspace.startsWith("(")}
              onClick={() => {
                if (workspace) void navigator.clipboard?.writeText(workspace);
                toast.info("경로를 복사했습니다.", workspace);
              }}
            >
              경로 복사
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void terminateOcr()}>
              OCR 엔진 메모리 해제
            </Button>
          </div>
        </Card>

        <Card className="mt-5 border-brand-100 bg-brand-50/40 p-5">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 flex-none text-brand-600" />
            <div className="text-[11px] leading-relaxed text-brand-900/80">
              <p className="text-sm font-semibold text-brand-900">개인정보 및 성능 안내</p>
              <p className="mt-1">
                지문·생성 자료는 이 PC에만 저장되며 Qexam Teacher의 별도 서버로 전송되지 않습니다. AI
                생성 시에만 Google Gemini API로 지문이 전송됩니다.
              </p>
              <p className="mt-1">
                저사양 PC를 위해 대형 로컬 모델을 사용하지 않고, OCR 엔진은 필요할 때만 메모리에
                올립니다. 오래 사용하지 않을 때는 위의 ‘OCR 엔진 메모리 해제’를 눌러 메모리를
                반환할 수 있습니다.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
