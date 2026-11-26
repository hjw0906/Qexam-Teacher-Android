import { useEffect, useMemo, useState } from "react";

/**
 * Keeps panel edits local until the teacher saves, so typing does not clone the
 * whole project (and its page assets) on every keystroke.
 */
export function useLocalDraft<T>(value: T | null, resetKey: string | null) {
  const [draft, setDraft] = useState<T | null>(value);

  useEffect(() => {
    setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const dirty = useMemo(() => {
    try {
      return JSON.stringify(draft) !== JSON.stringify(value);
    } catch {
      return false;
    }
  }, [draft, value]);

  return { draft, setDraft, dirty };
}
