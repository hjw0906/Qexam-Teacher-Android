import { useMemo, useState } from "react";
import { Ban, CheckCircle2, CircleSlash, HelpCircle, Star, Wallet } from "lucide-react";
import { Badge, Button, SegmentedControl, Select } from "./ui";
import type { GeminiModel } from "../lib/types";
import { useAiStore } from "../store/aiStore";
import { latestLimitFor, usageStats } from "../lib/gemini/usage";
import { describePricing, estimateCostUsd, formatUsd, isPaidModel } from "../lib/gemini/pricing";
import { formatDateTime } from "../lib/utils";

type Filter = "all" | "free" | "paid" | "unknown" | "text";

export function FreeBadge({ model }: { model: GeminiModel }) {
  if (model.freeAvailable) {
    return (
      <Badge tone="green">
        <CheckCircle2 className="h-3 w-3" /> 무료 티어 지원
      </Badge>
    );
  }
  if (isPaidModel(model)) {
    return (
      <Badge tone="red">
        <Ban className="h-3 w-3" /> 유료 전용
      </Badge>
    );
  }
  return (
    <Badge tone="amber">
      <HelpCircle className="h-3 w-3" /> 무료 확인 불가
    </Badge>
  );
}

export function ModelTable({ models }: { models: GeminiModel[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const blocked = useAiStore((state) => state.blockedModelIds);
  const preferred = useAiStore((state) => state.preferredModelId);
  const toggleBlocked = useAiStore((state) => state.toggleBlockedModel);
  const setPreferred = useAiStore((state) => state.setPreferredModel);
  const usage = useAiStore((state) => state.usage);
  const allowPaid = useAiStore((state) => state.policy.allowPaidModels);

  const stats = useMemo(() => usageStats(usage), [usage]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return models
      .filter((model) => {
        if (filter === "free") return model.freeAvailable;
        if (filter === "paid") return model.paidAvailable && !model.freeAvailable;
        if (filter === "unknown") return !model.pricing;
        if (filter === "text") return model.textCapable;
        return true;
      })
      .filter(
        (model) =>
          !keyword ||
          model.id.toLowerCase().includes(keyword) ||
          model.displayName.toLowerCase().includes(keyword),
      )
      .sort((a, b) => {
        const rank = (model: GeminiModel) => (model.freeAvailable ? 0 : model.paidAvailable ? 1 : 2);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return b.id.localeCompare(a.id);
      });
  }, [models, filter, query]);

  if (!models.length) {
    return (
      <div className="rounded-lg bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
        모델 목록이 없습니다. AI 설정에서 키를 저장하거나 ‘모델 목록 새로고침’을 실행하세요.
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `전체 ${models.length}` },
            { value: "free", label: `무료 ${models.filter((m) => m.freeAvailable).length}` },
            { value: "paid", label: `유료 ${models.filter((m) => m.paidAvailable && !m.freeAvailable).length}` },
            { value: "unknown", label: `가격 미확인 ${models.filter((m) => !m.pricing).length}` },
            { value: "text", label: "텍스트" },
          ]}
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="모델 검색"
          className="input ml-auto h-8 w-44 py-1 text-xs"
        />
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[1080px] border-collapse text-left">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">모델</th>
              <th className="px-3 py-2 font-semibold">티어 지원</th>
              <th className="px-3 py-2 font-semibold">가격 (입력/출력)</th>
              <th className="px-3 py-2 font-semibold">예상 요청 비용</th>
              <th className="px-3 py-2 font-semibold">토큰 한도</th>
              <th className="px-3 py-2 font-semibold">자체 기록</th>
              <th className="px-3 py-2 font-semibold">라우팅</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {filtered.map((model) => {
              const stat = stats.byModel[model.id];
              const limit = latestLimitFor(model.id);
              const isBlocked = blocked.includes(model.id);
              const isPreferred = preferred === model.id;
              const estimate = estimateCostUsd(model.pricing, 4_000, 2_000);
              const callable = allowPaid ? model.paidAvailable : model.freeAvailable;
              return (
                <tr key={model.id} className="align-top hover:bg-slate-50/60">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-800">{model.displayName}</span>
                      {isPreferred ? (
                        <Badge tone="violet">
                          <Star className="h-3 w-3" /> 우선
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 font-mono text-[10.5px] text-slate-500">{model.id}</p>
                    {model.description ? (
                      <p className="mt-1 line-clamp-2 max-w-[320px] text-[11px] leading-relaxed text-slate-500">
                        {model.description}
                      </p>
                    ) : null}
                    {model.deprecated ? (
                      <p className="mt-1 text-[10px] font-semibold text-red-600">폐기 예정 · 라우팅 제외</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col items-start gap-1">
                      <FreeBadge model={model} />
                      <Badge tone={model.paidAvailable ? "blue" : "slate"}>
                        <Wallet className="h-3 w-3" /> {model.paidAvailable ? "유료 가격 확인" : "유료 가격 미확인"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">
                      {model.freeAvailable
                        ? "무료 모드에서 호출 가능"
                        : model.pricing
                          ? "유료 모델 허용 시 호출 가능"
                          : "자동 호출 제외 (가격 미확인)"}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] tabular-nums text-slate-600">
                    <div className={model.pricing ? "text-slate-700" : "text-amber-600"}>
                      {describePricing(model)}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-400">
                      {model.pricing?.note ?? "가격표 스냅샷 기준 (USD / 1M tokens)"}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] tabular-nums text-slate-700">
                    {estimate === null ? (
                      <span className="text-amber-600">비용 확인 불가</span>
                    ) : (
                      <>
                        <span className="font-semibold">{formatUsd(estimate)}</span>
                        <div className="text-[10px] text-slate-400">입력 4k · 출력 2k 기준</div>
                      </>
                    )}
                    <div className={`mt-1 text-[10px] ${callable ? "text-emerald-600" : "text-slate-400"}`}>
                      {callable ? "현재 정책에서 후보" : "현재 정책에서 제외"}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] tabular-nums text-slate-600">
                    <div>입력 {(model.inputTokenLimit ?? 0).toLocaleString()}</div>
                    <div>출력 {(model.outputTokenLimit ?? 0).toLocaleString()}</div>
                    <div className="mt-1 text-[10px] text-slate-400">
                      {model.methods.length}개 메서드 · {model.textCapable ? "텍스트 생성" : "텍스트 외"}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] tabular-nums text-slate-600">
                    {stat ? (
                      <>
                        <div>
                          요청 {stat.requests} · 성공 {stat.success}
                        </div>
                        <div>
                          실패 {stat.failure} · 한도 {stat.limitHits}
                        </div>
                        <div className="text-[10px] text-slate-500">비용 {formatUsd(stat.costUsd)}</div>
                        <div className="text-[10px] text-slate-400">마지막 {formatDateTime(stat.lastUsedAt)}</div>
                        {limit ? (
                          <div className="mt-1 text-[10px] text-amber-600">
                            서버 한도 응답 {limit.quotaId ?? limit.quotaMetric ?? `HTTP ${limit.status}`}
                          </div>
                        ) : null}
                        {stat.lastError ? (
                          <div className="mt-1 line-clamp-2 max-w-[220px] text-[10px] text-red-500">
                            {stat.lastError}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-slate-400">기록 없음</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-1">
                      <Button
                        size="sm"
                        variant={isBlocked ? "secondary" : "ghost"}
                        onClick={() => toggleBlocked(model.id)}
                        className="justify-start"
                      >
                        {isBlocked ? "차단 해제" : "라우팅 차단"}
                      </Button>
                      <Button
                        size="sm"
                        variant={isPreferred ? "subtle" : "ghost"}
                        onClick={() => setPreferred(isPreferred ? null : model.id)}
                        className="justify-start"
                      >
                        {isPreferred ? "우선 해제" : "우선 모델 지정"}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 ? (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-4 text-xs text-slate-500">
          <CircleSlash className="h-3.5 w-3.5" /> 조건에 맞는 모델이 없습니다.
        </div>
      ) : null}
      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
        ‘서버 한도 응답’은 Google이 429 응답으로 알려준 할당량 정보만 표시합니다. Google은 모델별
        RPM/RPD/TPM 잔여량과 실제 청구 금액을 조회하는 공식 API를 제공하지 않으므로 잔여량은 표시하지
        않습니다. 예상 요청 비용은 가격표 스냅샷과 토큰 추정치로 계산한 값입니다.
      </p>
    </div>
  );
}

export function ModelQuickSelect({
  value,
  onChange,
  models,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  models: GeminiModel[];
}) {
  const options = models.filter((model) => model.textCapable && (model.freeAvailable || model.paidAvailable));
  return (
    <Select
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value || null)}
      className="h-8 py-1 text-xs"
    >
      <option value="">자동 선택 (권장)</option>
      {options.map((model) => (
        <option key={model.id} value={model.id}>
          {model.displayName} ({model.id}) · {describePricing(model)}
        </option>
      ))}
    </Select>
  );
}
