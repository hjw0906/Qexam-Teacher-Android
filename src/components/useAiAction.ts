import { useCallback, useRef, useState } from "react";
import { AiTaskError, describeAiError } from "../lib/gemini/tasks";
import { toast } from "../store/uiStore";

export interface AiActionApi {
  busy: string | null;
  progress: string;
  run: (
    label: string,
    task: (signal: AbortSignal, onProgress: (message: string) => void) => Promise<void>,
  ) => Promise<void>;
  cancel: () => void;
}

/**
 * Runs one AI action at a time, shows progress, and prevents duplicate requests.
 * Cancelling aborts the HTTP request without discarding previously saved results.
 */
export function useAiAction(): AiActionApi {
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const run = useCallback<AiActionApi["run"]>(async (label, task) => {
    if (controllerRef.current) {
      toast.info("이미 실행 중인 작업이 있습니다.", "완료되거나 취소된 뒤 다시 시도해 주세요.");
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(label);
    setProgress("");
    try {
      await task(controller.signal, setProgress);
    } catch (error) {
      if (error instanceof AiTaskError && error.code === "aborted") {
        toast.info("작업을 취소했습니다.", "이미 생성된 결과는 그대로 유지됩니다.");
      } else {
        toast.error(`${label} 실패`, describeAiError(error));
      }
    } finally {
      controllerRef.current = null;
      setBusy(null);
      setProgress("");
    }
  }, []);

  return { busy, progress, run, cancel };
}
