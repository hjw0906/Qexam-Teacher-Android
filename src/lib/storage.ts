import type { AppPreferences, RecentProject } from "./types";
import { safeJsonParse } from "./utils";

const PREFIX = "qexam.";

export const DEFAULT_PREFERENCES: AppPreferences = {
  autosaveSeconds: 45,
  defaultPageSize: "A4",
  snapToGrid: true,
  gridMm: 2.5,
  showMarginGuides: true,
  exportScale: 2,
  confirmBeforeDelete: true,
};

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    return safeJsonParse<T>(raw, fallback);
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage may be full or blocked; the in-memory state still works.
  }
}

export function loadPreferences(): AppPreferences {
  return { ...DEFAULT_PREFERENCES, ...loadJson<Partial<AppPreferences>>("prefs", {}) };
}

export function savePreferences(preferences: AppPreferences): void {
  saveJson("prefs", preferences);
}

export function loadRecentProjects(): RecentProject[] {
  return loadJson<RecentProject[]>("recent", []);
}

export function saveRecentProjects(list: RecentProject[]): void {
  saveJson("recent", list.slice(0, 20));
}

export function upsertRecentProject(entry: RecentProject): RecentProject[] {
  const list = loadRecentProjects().filter((item) => item.id !== entry.id);
  const next = [entry, ...list].slice(0, 20);
  saveRecentProjects(next);
  return next;
}

export function removeRecentProject(id: string): RecentProject[] {
  const next = loadRecentProjects().filter((item) => item.id !== id);
  saveRecentProjects(next);
  return next;
}

const DRAFT_KEY = "draft.v1";

export interface DraftEnvelope {
  project: string;
  savedAt: string;
  path: string | null;
}

export function saveDraft(projectJson: string, path: string | null): void {
  saveJson(DRAFT_KEY, { project: projectJson, savedAt: new Date().toISOString(), path });
}

export function loadDraft(): DraftEnvelope | null {
  return loadJson<DraftEnvelope | null>(DRAFT_KEY, null);
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(PREFIX + DRAFT_KEY);
  } catch {
    // ignore
  }
}
