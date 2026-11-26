import type { ReactNode } from "react";
import { KeyRound, ShieldAlert } from "lucide-react";
import { Button, Card } from "./ui";
import { useAiStore } from "../store/aiStore";
import { useProjectStore } from "../store/projectStore";

export function AiGate({ children }: { children: ReactNode }) {
  const keyPresent = useAiStore((state) => state.keyPresent);
  const keyValid = useAiStore((state) => state.keyValid);
  const policy = useAiStore((state) => state.policy);
  const setView = useProjectStore((state) => state.setView);

  if (!keyPresent || !keyValid) {
    return (
      <Card className="m-6 flex max-w-xl items-start gap-3 border-amber-200 bg-amber-50 p-5">
        <ShieldAlert className="mt-0.5 h-5 w-5 flex-none text-amber-600" />
        <div>
          <p className="text-sm font-bold text-amber-900">AI 기능을 사용하려면 설정이 필요합니다</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-700">
            {!keyPresent
              ? "Gemini API 키가 저장되어 있지 않습니다. AI 설정에서 키를 저장해 주세요."
              : "API 키 상태를 확인하지 못했습니다. AI 설정에서 ‘연결 확인’을 실행해 주세요."}
          {keyPresent && keyValid ? (
            <p className="mt-1 text-[11px] leading-relaxed text-amber-700/80">
              현재 정책: {policy.mode} · {policy.allowPaidModels ? "유료 모델 허용" : "무료 모델만 사용"}
            </p>
          ) : null}
          </p>
          <Button
            size="sm"
            variant="primary"
            className="mt-3"
            icon={<KeyRound className="h-3.5 w-3.5" />}
            onClick={() => setView("ai")}
          >
            AI 설정으로 이동
          </Button>
        </div>
      </Card>
    );
  }
  return <>{children}</>;
}
