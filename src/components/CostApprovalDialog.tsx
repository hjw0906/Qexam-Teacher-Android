import { useAiStore } from "../store/aiStore";
import { formatUsd } from "../lib/gemini/pricing";
import { Badge, Button, Card } from "./ui";

/**
 * Shown before the first paid request of a task run (when confirmation is on).
 * Declining does not fail the task: the run continues with free models only.
 */
export function CostApprovalDialog() {
  const request = useAiStore((state) => state.costPrompt);
  const resolve = useAiStore((state) => state.resolveCostApproval);
  if (!request) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <Card className="w-full max-w-md p-5">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-slate-900">유료 모델 사용 확인</p>
          <Badge tone="amber">비용 발생</Badge>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          이 작업은 무료 모델로 처리할 수 없어 유료 모델을 호출하려 합니다. 예상 비용을 확인하고
          승인해 주세요.
        </p>

        <div className="mt-4 space-y-1.5 rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600">
          <div className="flex justify-between">
            <span>모델</span>
            <span className="font-mono text-slate-800">{request.modelId}</span>
          </div>
          <div className="flex justify-between">
            <span>작업</span>
            <span className="text-slate-800">{request.task}</span>
          </div>
          <div className="flex justify-between">
            <span>예상 토큰</span>
            <span className="tabular-nums text-slate-800">
              입력 {request.promptTokens.toLocaleString()} · 출력 {request.outputTokens.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between">
            <span>예상 비용</span>
            <span className="font-semibold text-amber-700">{formatUsd(request.costUsd)}</span>
          </div>
          <div className="flex justify-between">
            <span>남은 일일 예산</span>
            <span className="tabular-nums text-slate-800">
              {request.remainingDailyUsd === null ? "제한 없음" : formatUsd(request.remainingDailyUsd)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>남은 월간 예산</span>
            <span className="tabular-nums text-slate-800">
              {request.remainingMonthlyUsd === null ? "제한 없음" : formatUsd(request.remainingMonthlyUsd)}
            </span>
          </div>
        </div>

        <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
          실제 비용은 Google이 반환한 토큰 사용량으로 다시 계산해 기록됩니다. 거절하면 무료 모델만으로
          계속 진행합니다.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => resolve(false)}>
            무료 모델만 사용
          </Button>
          <Button size="sm" variant="primary" onClick={() => resolve(true)}>
            이 요청 승인
          </Button>
        </div>
      </Card>
    </div>
  );
}
