import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  Sparkles,
  Trash2,
  Wallet,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  KeyValue,
  SectionHeader,
  SegmentedControl,
  Toggle,
} from "../components/ui";
import { DailyUsageChart, ShareBar } from "../components/Charts";
import { ModelQuickSelect, ModelTable } from "../components/ModelTable";
import { useAiStore, catalogMeta } from "../store/aiStore";
import { toast } from "../store/uiStore";
import {
  cooldownRemaining,
  costTotals,
  loadLimitObservations,
  remainingBudget,
  tierLabel,
  usageStats,
} from "../lib/gemini/usage";
import { PRICING_SNAPSHOT, formatUsd, formatUsdPrecise } from "../lib/gemini/pricing";
import { errorMessage, formatDateTime, relativeTime } from "../lib/utils";
import type { ModelMode } from "../lib/types";

const MODES: { value: ModelMode; label: string }[] = [
  { value: "free-first", label: "무료 우선" },
  { value: "auto", label: "자동" },
  { value: "quality", label: "품질 우선" },
  { value: "cost", label: "비용 절약" },
  { value: "speed", label: "속도 우선" },
];

function budgetInput(value: number): string {
  return value > 0 ? String(value) : "0";
}

export function AISettingsPage() {
  const {
    keyPresent,
    keyValid,
    keyMethod,
    keyPath,
    models,
    lastCheckedAt,
    tier,
    tierEvidence,
    policy,
    preferredModelId,
    usage,
    status,
    error,
    saveKey,
    removeKey,
    testConnection,
    refreshModels,
    setPolicy,
    setBudgets,
    setMode,
    setAllowPaidModels,
    setPreferredModel,
    refreshUsage,
    resetUsage,
  } = useAiStore();

  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const stats = useMemo(() => usageStats(usage), [usage]);
  const limits = useMemo(() => loadLimitObservations(), [usage]);
  const totals = useMemo(() => costTotals(usage), [usage]);
  const remaining = useMemo(() => remainingBudget(policy.budgets, totals), [policy.budgets, totals]);
  const textModels = models.filter((model) => model.textCapable);
  const freeModels = textModels.filter((model) => model.freeAvailable);
  const pricedModels = textModels.filter((model) => model.paidAvailable);
  const unpricedModels = textModels.filter((model) => !model.pricing);
  const currentModelId = usage[0]?.modelId ?? null;
  const dailyUsedPercent =
    policy.budgets.dailyUsd > 0 ? Math.min(100, Math.round((totals.todayUsd / policy.budgets.dailyUsd) * 100)) : 0;

  async function handleSaveKey() {
    const trimmed = keyInput.trim();
    if (!trimmed) {
      toast.warning("API 키를 입력해 주세요.");
      return;
    }
    setBusy("save");
    try {
      const diagnostics = await saveKey(trimmed);
      setKeyInput("");
      toast.success(
        "API 키를 저장했습니다.",
        `모델 ${diagnostics.totalModels}개 확인 · 키는 Windows DPAPI로 암호화됩니다.`,
      );
    } catch (failure) {
      toast.error("API 키를 저장하지 못했습니다.", errorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  async function handleTest() {
    setBusy("test");
    try {
      const diagnostics = await testConnection();
      toast.success(
        "연결 테스트 성공",
        `사용 가능 모델 ${diagnostics.totalModels}개 · 무료 ${diagnostics.freeModels}개 · 가격 확인 ${diagnostics.pricedModels}개`,
      );
    } catch (failure) {
      toast.error("연결 테스트 실패", errorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  async function handleRefresh() {
    setBusy("refresh");
    try {
      const diagnostics = await refreshModels();
      if (diagnostics) {
        toast.success("모델 목록을 새로고침했습니다.", `총 ${diagnostics.totalModels}개 텍스트 모델`);
      } else {
        toast.error("모델 목록을 가져오지 못했습니다.", "API 키와 네트워크를 확인하세요.");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="scroll-area h-full">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <SectionHeader
          title="AI 설정"
          description="Gemini API 키를 저장하고, 티어·모델·가격을 진단한 뒤 작업별 모델 선택 정책과 비용 예산을 설정합니다."
          actions={
            <>
              <Button
                size="sm"
                variant="secondary"
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                loading={busy === "refresh"}
                onClick={() => void handleRefresh()}
              >
                모델 목록 새로고침
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={<Activity className="h-3.5 w-3.5" />}
                loading={busy === "test"}
                onClick={() => void handleTest()}
                disabled={!keyPresent}
              >
                연결 테스트
              </Button>
            </>
          }
        />

        {error ? (
          <Card className="mt-4 flex items-start gap-2 border-red-200 bg-red-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-red-600" />
            <p className="whitespace-pre-line text-xs leading-relaxed text-red-700">{error}</p>
          </Card>
        ) : null}

        <div className="mt-5 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
          <Card className="p-5">
            <SectionHeader
              title="Gemini API 키"
              description="키는 EXE에 포함되지 않으며, Windows DPAPI로 암호화되어 현재 Windows 사용자만 복호화할 수 있습니다."
              actions={
                <Badge tone={keyPresent ? (keyValid ? "green" : "amber") : "slate"}>
                  <KeyRound className="h-3 w-3" />
                  {keyPresent ? (keyValid ? "저장됨 · 유효" : "저장됨 · 확인 필요") : "미등록"}
                </Badge>
              }
            />
            <div className="mt-4">
              <Field
                label={keyPresent ? "새 API 키로 교체" : "API 키 입력"}
                hint="Google AI Studio(https://aistudio.google.com/apikey)에서 발급한 키를 붙여넣으세요. 키는 화면·로그·오류 메시지에 표시되지 않습니다."
              >
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showKey ? "text" : "password"}
                      value={keyInput}
                      onChange={(event) => setKeyInput(event.target.value)}
                      placeholder={keyPresent ? "•••••••• (저장된 키를 교체하려면 입력)" : "AIza..."}
                      autoComplete="off"
                      spellCheck={false}
                      className="pr-10 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((value) => !value)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
                      aria-label={showKey ? "키 숨기기" : "키 표시"}
                      title={showKey ? "키 숨기기" : "키 표시"}
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Button
                    variant="primary"
                    loading={busy === "save"}
                    onClick={() => void handleSaveKey()}
                    disabled={!keyInput.trim()}
                  >
                    {keyPresent ? "키 교체" : "키 저장"}
                  </Button>
                </div>
              </Field>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={status === "checking" && busy === null}
                  onClick={() => void handleTest()}
                  disabled={!keyPresent}
                >
                  연결 확인
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => setConfirmDelete(true)}
                  disabled={!keyPresent}
                >
                  키 삭제
                </Button>
              </div>
              <div className="mt-4 rounded-lg bg-slate-50 p-3">
                <KeyValue label="저장 방식" value={keyMethod} />
                <KeyValue
                  label="저장 위치"
                  value={<span className="break-all font-mono text-[10px]">{keyPath}</span>}
                />
                <KeyValue label="마지막 진단" value={formatDateTime(lastCheckedAt)} />
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader
              title="API 환경 진단"
              description="models.list 결과와 Google의 오류 응답만 근거로 표시합니다. 추정하지 않습니다."
            />
            <div className="mt-3">
              <KeyValue label="API 키 유효성" value={keyPresent ? (keyValid ? "유효" : "확인 필요") : "미등록"} />
              <KeyValue label="티어 판별" value={<span className="font-semibold">{tierLabel(tier)}</span>} />
              <KeyValue label="접근 가능 모델" value={`${textModels.length}개 (텍스트)`} />
              <KeyValue label="무료 티어 지원" value={`${freeModels.length}개`} />
              <KeyValue label="유료 가격 확인" value={`${pricedModels.length}개`} />
              <KeyValue label="가격 확인 불가" value={`${unpricedModels.length}개 (자동 호출 제외)`} />
              <KeyValue label="현재 사용 모델" value={currentModelId ?? "-"} />
              <KeyValue label="마지막 점검" value={lastCheckedAt ? relativeTime(lastCheckedAt) : "-"} />
            </div>
            <p className="mt-3 rounded-lg bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-500">
              {tierEvidence}
            </p>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
              결제 계정 연결 여부와 티어는 다른 정보입니다. Google은 API 키의 결제 상태를 조회하는 공식
              엔드포인트를 제공하지 않으므로, 확인되지 않은 값은 ‘확인 불가’로 표시합니다.
            </p>
          </Card>
        </div>

        <Card className="mt-5 p-5">
          <SectionHeader
            title="모델 선택 정책 · 비용 예산"
            description="작업별로 품질과 비용을 함께 고려해 모델을 고릅니다. 유료 모델은 사용자가 허용한 경우에만 후보가 됩니다."
            actions={
              <Badge tone={policy.allowPaidModels ? "amber" : "green"}>
                {policy.allowPaidModels ? "유료 모델 허용" : "무료 모델만"}
              </Badge>
            }
          />

          <div className="mt-4 grid gap-5 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <p className="text-[11px] font-semibold text-slate-600">선택 모드</p>
              <div className="mt-1.5">
                <SegmentedControl value={policy.mode} onChange={(value) => setMode(value as ModelMode)} options={MODES} />
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                {policy.mode === "free-first"
                  ? "무료 티어 모델을 먼저 사용하고, 없을 때만 허용된 유료 모델을 사용합니다."
                  : policy.mode === "quality"
                    ? "작업 적합도(품질)를 우선합니다. 예산·요청당 한도는 그대로 적용됩니다."
                    : policy.mode === "cost"
                      ? "품질 하한을 유지하면서 상대 비용이 낮은 모델을 우선합니다."
                      : policy.mode === "speed"
                        ? "Flash·Lite 계열처럼 빠른 모델을 우선합니다."
                        : "품질과 비용을 함께 점수화해 고릅니다."}
              </p>

              <div className="mt-4">
                <Toggle
                  checked={policy.allowPaidModels}
                  onChange={(value) => {
                    setAllowPaidModels(value);
                    toast.info(
                      value ? "유료 모델 사용을 허용했습니다." : "무료 모델만 사용합니다.",
                      value
                        ? "결제가 연결된 키에서만 실제 과금이 발생합니다. 예산 한도가 함께 적용됩니다."
                        : "유료 모델은 자동 선택에서 제외됩니다.",
                    );
                  }}
                  label="유료 모델 사용 허용"
                  description="결제(빌링)가 연결된 계정에서 유료 모델까지 자동 선택에 포함합니다. 가격이 확인되지 않은 모델은 허용해도 호출하지 않습니다."
                />
              </div>

              <div className="mt-3">
                <Toggle
                  checked={policy.confirmPaidRequests}
                  onChange={(value) => setPolicy({ confirmPaidRequests: value })}
                  label="유료 요청 전 예상 비용 확인"
                  description="작업 실행 중 처음 유료 모델을 호출하기 전에 예상 비용을 보여주고 승인을 받습니다. 거절하면 무료 모델만으로 계속합니다."
                />
              </div>

              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800">
                <p className="font-semibold">무료 모드의 전제</p>
                <p className="mt-1 text-amber-700">
                  ‘무료 모델만’ 모드에서는 무료 티어 전제로 호출하며 예상 비용을 $0으로 기록합니다. 실제로
                  결제가 연결된 프로젝트라면 Google이 과금할 수 있으므로, 결제가 연결된 키는 유료 모델
                  허용을 켜고 예산을 설정해 사용하세요.
                </p>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-slate-600">예산 (USD, 0 = 제한 없음)</p>
              <div className="mt-1.5 grid gap-3 sm:grid-cols-3">
                <Field label="일일 예산">
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={budgetInput(policy.budgets.dailyUsd)}
                    onChange={(event) => setBudgets({ dailyUsd: Math.max(0, Number(event.target.value) || 0) })}
                  />
                </Field>
                <Field label="월간 예산">
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={budgetInput(policy.budgets.monthlyUsd)}
                    onChange={(event) => setBudgets({ monthlyUsd: Math.max(0, Number(event.target.value) || 0) })}
                  />
                </Field>
                <Field label="요청당 최대">
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={budgetInput(policy.budgets.perRequestUsd)}
                    onChange={(event) => setBudgets({ perRequestUsd: Math.max(0, Number(event.target.value) || 0) })}
                  />
                </Field>
              </div>

              <div className="mt-3 rounded-lg bg-slate-50 p-3">
                <div className="flex items-center justify-between text-[11px] text-slate-600">
                  <span className="inline-flex items-center gap-1">
                    <Wallet className="h-3 w-3" /> 오늘 사용 {formatUsd(totals.todayUsd)}
                  </span>
                  <span>
                    {policy.budgets.dailyUsd > 0
                      ? `잔여 ${formatUsd(remaining.dailyUsd ?? 0)} / 예산 ${formatUsd(policy.budgets.dailyUsd)}`
                      : "일일 제한 없음"}
                  </span>
                </div>
                {policy.budgets.dailyUsd > 0 ? (
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full ${dailyUsedPercent >= 100 ? "bg-red-500" : dailyUsedPercent > 70 ? "bg-amber-500" : "bg-brand-500"}`}
                      style={{ width: `${dailyUsedPercent}%` }}
                    />
                  </div>
                ) : null}
                <div className="mt-2 space-y-1 text-[10px] text-slate-500">
                  <p>이번 달 예상 비용 {formatUsd(totals.monthUsd)}</p>
                  <p>
                    월간 잔여{" "}
                    {policy.budgets.monthlyUsd > 0 ? formatUsd(remaining.monthlyUsd ?? 0) : "제한 없음"} · 전체{" "}
                    {formatUsdPrecise(totals.totalUsd)}
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <p className="text-[11px] font-semibold text-slate-600">우선 사용 모델</p>
                <div className="mt-1.5">
                  <ModelQuickSelect value={preferredModelId} onChange={setPreferredModel} models={models} />
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                  지정하면 정책·예산 조건을 통과하는 한 항상 먼저 시도합니다.
                </p>
              </div>
            </div>
          </div>
        </Card>

        <Card className="mt-5 p-5">
          <SectionHeader
            title="Gemini 모델"
            description={`models.list에서 실제로 조회된 모델입니다. 무료 여부는 ${catalogMeta.sourceLabel} (${catalogMeta.checkedAt}), 가격은 ${PRICING_SNAPSHOT.sourceLabel} (${PRICING_SNAPSHOT.checkedAt}) 기준입니다.`}
            actions={
              <Button size="sm" variant="ghost" onClick={() => void handleRefresh()} loading={busy === "refresh"}>
                새로고침
              </Button>
            }
          />
          <div className="mt-4">
            <ModelTable models={models} />
          </div>
        </Card>

        <Card className="mt-5 p-5">
          <SectionHeader
            title="사용량 · 비용 대시보드"
            description="프로그램이 로컬에 기록한 요청과 비용 추정입니다. 외부로 전송되지 않으며 Google 서버의 실제 청구서와 다를 수 있습니다."
            actions={
              <>
                <Button size="sm" variant="ghost" onClick={refreshUsage}>
                  새로고침
                </Button>
                <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirmReset(true)}>
                  기록 지우기
                </Button>
              </>
            }
          />

          <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "총 요청", value: stats.totalRequests.toLocaleString(), tone: "text-slate-900" },
              { label: "성공", value: stats.totalSuccess.toLocaleString(), tone: "text-emerald-600" },
              { label: "실패", value: stats.totalFailure.toLocaleString(), tone: "text-red-600" },
              {
                label: "한도 발생",
                value: usage.filter((record) => record.limitHit).length.toLocaleString(),
                tone: "text-amber-600",
              },
              { label: "오늘 예상 비용", value: formatUsd(totals.todayUsd), tone: "text-slate-900" },
              { label: "누적 예상 비용", value: formatUsd(totals.totalUsd), tone: "text-brand-700" },
            ].map((metric) => (
              <div key={metric.label} className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5">
                <p className="text-[11px] text-slate-500">{metric.label}</p>
                <p className={`mt-0.5 text-lg font-bold tabular-nums ${metric.tone}`}>{metric.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 px-3 py-2 text-[11px] text-slate-600">
              <p className="text-slate-500">현재 티어</p>
              <p className="mt-0.5 font-semibold text-slate-800">{tierLabel(tier)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 px-3 py-2 text-[11px] text-slate-600">
              <p className="text-slate-500">무료 / 유료 모델</p>
              <p className="mt-0.5 font-semibold text-slate-800">
                {freeModels.length}개 / {pricedModels.length}개
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 px-3 py-2 text-[11px] text-slate-600">
              <p className="text-slate-500">예산 잔여 (일 / 월)</p>
              <p className="mt-0.5 font-semibold text-slate-800">
                {policy.budgets.dailyUsd > 0 ? formatUsd(remaining.dailyUsd ?? 0) : "제한 없음"} /{" "}
                {policy.budgets.monthlyUsd > 0 ? formatUsd(remaining.monthlyUsd ?? 0) : "제한 없음"}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-700">일별 요청 (자체 기록)</p>
              <DailyUsageChart data={stats.daily} />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-700">모델별 사용 비중</p>
              <div className="space-y-1.5">
                {Object.values(stats.byModel).length ? (
                  Object.values(stats.byModel)
                    .sort((a, b) => b.requests - a.requests)
                    .slice(0, 8)
                    .map((stat) => (
                      <ShareBar
                        key={stat.modelId}
                        label={stat.modelId}
                        value={stat.requests}
                        total={stats.totalRequests}
                        suffix="회"
                      />
                    ))
                ) : (
                  <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
                    기록이 없습니다.
                  </p>
                )}
              </div>
              <div className="mt-3 rounded-lg bg-slate-50 p-2.5 text-[10px] leading-relaxed text-slate-500">
                <p className="font-semibold text-slate-600">조회 가능 범위</p>
                <p>1. Google 서버 직접 확인: 모델 목록·토큰 한도 (가격·티어·잔여량은 미제공).</p>
                <p>2. Google 응답 기반 제한: 429 오류의 quotaId·재시도 시간 ({limits.length}건).</p>
                <p>3. 프로그램 자체 기록: 요청·성공·실패·토큰·예상 비용 (아래 표).</p>
                <p>4. 조회 불가: 모델별 남은 RPM/RPD/TPM, 실제 청구 금액.</p>
              </div>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[880px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">모델</th>
                  <th className="px-3 py-2 font-semibold">요청</th>
                  <th className="px-3 py-2 font-semibold">성공/실패</th>
                  <th className="px-3 py-2 font-semibold">토큰</th>
                  <th className="px-3 py-2 font-semibold">예상 비용</th>
                  <th className="px-3 py-2 font-semibold">한도</th>
                  <th className="px-3 py-2 font-semibold">마지막 사용</th>
                  <th className="px-3 py-2 font-semibold">쿨다운</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.values(stats.byModel).map((stat) => {
                  const remainingCooldown = cooldownRemaining(stat.modelId);
                  return (
                    <tr key={stat.modelId}>
                      <td className="px-3 py-2 font-mono text-[10.5px] text-slate-700">{stat.modelId}</td>
                      <td className="px-3 py-2 tabular-nums">{stat.requests}</td>
                      <td className="px-3 py-2 tabular-nums">
                        <span className="text-emerald-600">{stat.success}</span> /{" "}
                        <span className="text-red-500">{stat.failure}</span>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-600">
                        {stat.promptTokens.toLocaleString()} / {stat.outputTokens.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-700">{formatUsdPrecise(stat.costUsd)}</td>
                      <td className="px-3 py-2 tabular-nums">{stat.limitHits}</td>
                      <td className="px-3 py-2 text-slate-500">{formatDateTime(stat.lastUsedAt)}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {remainingCooldown > 0 ? `${Math.ceil(remainingCooldown / 1000)}초` : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!Object.keys(stats.byModel).length ? (
              <p className="px-3 py-5 text-center text-xs text-slate-400">아직 기록된 요청이 없습니다.</p>
            ) : null}
          </div>

          <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50/60 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-800">
              <Sparkles className="h-3.5 w-3.5" /> 자동 모델 전환
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-brand-700/80">
              요청 한도·일일 사용량 초과, 모델 장애, 시간 초과, 접근 불가 시 다음 후보 모델로 자동
              전환합니다. 유료 모델 허용 시 무료·유료 모델을 함께 후보로 쓰지만, 가격·권한·예산 확인을
              통과하지 못한 모델은 호출하지 않습니다. 이미 생성된 결과는 재사용합니다.
            </p>
          </div>
        </Card>

        <p className="mt-5 text-[10px] leading-relaxed text-slate-400">
          무료 모델 카탈로그 출처: {catalogMeta.sourceUrl} · 기준일 {catalogMeta.checkedAt}. 가격 출처:{" "}
          {PRICING_SNAPSHOT.sourceUrl} · 기준일 {PRICING_SNAPSHOT.checkedAt}. Google이 가격/무료 정책을
          변경하면 모델 목록을 새로고침하고 이 기준일을 함께 확인하세요. 실제 청구 금액은 Google Cloud
          결제 콘솔에서 확인해야 합니다.
        </p>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="API 키 삭제"
        message="저장된 Gemini API 키를 삭제할까요? 삭제 후에는 AI 기능을 사용할 수 없으며, 다시 입력해야 합니다."
        confirmLabel="삭제"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          void removeKey()
            .then(() => toast.success("API 키를 삭제했습니다."))
            .catch((failure) => toast.error("삭제 실패", errorMessage(failure)));
          setConfirmDelete(false);
        }}
      />

      <ConfirmDialog
        open={confirmReset}
        title="사용 기록 초기화"
        message="로컬에 저장된 API 사용 기록과 서버 한도 관측치, 쿨다운을 모두 삭제할까요? 비용 추정치도 함께 초기화됩니다."
        confirmLabel="초기화"
        danger
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          resetUsage();
          setConfirmReset(false);
          toast.success("사용 기록을 초기화했습니다.");
        }}
      />
    </div>
  );
}
