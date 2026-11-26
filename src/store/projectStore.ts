import { create } from "zustand";
import type {
  DocPage,
  DocElement,
  MainView,
  Passage,
  ProjectSettings,
  QProject,
  RecentProject,
  WorkspaceTab,
} from "../lib/types";
import { PROJECT_FORMAT, PROJECT_VERSION } from "../lib/types";
import { createPage, createTextElement, pageDimensions } from "../lib/document";
import {
  clearDraft,
  loadDraft,
  loadPreferences,
  loadRecentProjects,
  removeRecentProject,
  saveDraft,
  saveRecentProjects,
  upsertRecentProject,
} from "../lib/storage";
import {
  openAnyTextFile,
  readTextFile,
  saveProjectFile,
  writeTextFile,
} from "../lib/tauri";
import { detectLanguage, errorMessage, nowIso, sanitizeFileName, uid } from "../lib/utils";
import { toast } from "./uiStore";

interface ProjectState {
  project: QProject | null;
  filePath: string | null;
  dirty: boolean;
  saving: boolean;
  lastSavedAt: string | null;
  view: MainView;
  tab: WorkspaceTab;
  activePageId: string | null;
  selectedIds: string[];
  zoom: number;
  recents: RecentProject[];
  pendingOpen: boolean;
  history: DocPage[][];
  future: DocPage[][];

  init: () => void;
  setView: (view: MainView) => void;
  setTab: (tab: WorkspaceTab) => void;
  setActivePage: (pageId: string) => void;
  selectElements: (ids: string[]) => void;
  setZoom: (zoom: number) => void;

  newProject: (name: string, passage: Passage) => void;
  closeProject: () => void;
  openFromFile: () => Promise<void>;
  openRecent: (entry: RecentProject) => Promise<void>;
  save: (options?: { saveAs?: boolean; silent?: boolean }) => Promise<boolean>;
  autosave: () => Promise<void>;
  restoreDraft: () => Promise<boolean>;
  refreshRecents: () => void;
  removeRecent: (id: string) => void;

  update: (mutator: (draft: QProject) => void) => void;
  applyPages: (pages: DocPage[], options?: { history?: boolean }) => void;
  updatePage: (pageId: string, patch: Partial<DocPage>) => void;
  addPage: (afterPageId?: string) => void;
  duplicatePage: (pageId: string) => void;
  deletePage: (pageId: string) => void;
  movePage: (from: number, to: number) => void;
  addElement: (element: DocElement) => void;
  updateElements: (elements: DocElement[]) => void;
  deleteElements: (ids: string[]) => void;
  undo: () => void;
  redo: () => void;
}

function defaultSettings(): ProjectSettings {
  const prefs = loadPreferences();
  return {
    defaultPageSize: prefs.defaultPageSize,
    snapToGrid: prefs.snapToGrid,
    gridMm: prefs.gridMm,
    showMarginGuides: prefs.showMarginGuides,
    exportScale: prefs.exportScale,
  };
}

export function createProject(name: string, passage: Passage): QProject {
  const page = createPage(defaultSettings().defaultPageSize, "portrait", 0);
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: uid("proj"),
    name: name.trim() || "새 프로젝트",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    passage,
    analysis: null,
    easy: null,
    vocab: null,
    workbook: null,
    answerKey: null,
    verification: null,
    pages: [page],
    settings: defaultSettings(),
  };
}

export function serializeProject(project: QProject): string {
  return JSON.stringify({ ...project, updatedAt: nowIso() }, null, 2);
}

export function normalizeProject(raw: unknown): QProject {
  if (!raw || typeof raw !== "object") throw new Error("프로젝트 파일을 해석할 수 없습니다.");
  const data = raw as Partial<QProject> & Record<string, unknown>;
  if (data.format !== PROJECT_FORMAT) {
    throw new Error("Qexam Teacher 프로젝트(.qws) 파일이 아닙니다.");
  }
  if (!data.passage || typeof data.passage !== "object") {
    throw new Error("프로젝트에 지문 정보가 없습니다.");
  }
  const pages = Array.isArray(data.pages) && data.pages.length
    ? (data.pages as DocPage[]).map((page, index) => ({
        ...createPage(page.size ?? "A4", page.orientation ?? "portrait", index),
        ...page,
        elements: Array.isArray(page.elements) ? page.elements : [],
      }))
    : [createPage()];

  const rawPassage = data.passage as Partial<QProject["passage"]>;
  const passage: QProject["passage"] = {
    title: typeof rawPassage.title === "string" ? rawPassage.title : "",
    text: typeof rawPassage.text === "string" ? rawPassage.text : "",
    language: rawPassage.language === "ko" || rawPassage.language === "en" ? rawPassage.language : "auto",
    sources: Array.isArray(rawPassage.sources) ? rawPassage.sources : [],
    ocrNotes: Array.isArray(rawPassage.ocrNotes) ? rawPassage.ocrNotes : [],
  };

  return {
    ...createProject(String(data.name ?? "불러온 프로젝트"), passage),
    ...(data as QProject),
    passage,
    pages,
    settings: { ...defaultSettings(), ...(data.settings ?? {}) },
    updatedAt: data.updatedAt ?? nowIso(),
  };
}

function draftEnvelope() {
  return loadDraft();
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  filePath: null,
  dirty: false,
  saving: false,
  lastSavedAt: null,
  view: "home",
  tab: "passage",
  activePageId: null,
  selectedIds: [],
  zoom: 1,
  recents: loadRecentProjects(),
  pendingOpen: false,
  history: [],
  future: [],

  init: () => {
    const recents = loadRecentProjects();
    set({ recents });
  },

  setView: (view) => set({ view }),
  setTab: (tab) => set({ tab }),
  setActivePage: (pageId) => set({ activePageId: pageId, selectedIds: [] }),
  selectElements: (ids) => set({ selectedIds: ids }),
  setZoom: (zoom) => set({ zoom: Math.min(3, Math.max(0.25, zoom)) }),

  newProject: (name, passage) => {
    const project = createProject(name, passage);
    set({
      project,
      filePath: null,
      dirty: true,
      lastSavedAt: null,
      view: "workspace",
      tab: "passage",
      activePageId: project.pages[0]?.id ?? null,
      selectedIds: [],
      zoom: 1,
      history: [],
      future: [],
    });
    toast.success("새 프로젝트가 생성되었습니다.", "지문을 확인한 뒤 AI 분석을 실행하세요.");
  },

  closeProject: () => {
    set({
      project: null,
      filePath: null,
      dirty: false,
      view: "home",
      selectedIds: [],
      history: [],
      future: [],
      activePageId: null,
    });
  },

  openFromFile: async () => {
    set({ pendingOpen: true });
    try {
      const file = await openAnyTextFile([{ name: "Qexam 프로젝트", extensions: ["qws", "json"] }]);
      if (!file) return;
      const project = normalizeProject(JSON.parse(file.text));
      set({
        project,
        filePath: file.name || null,
        dirty: false,
        lastSavedAt: project.updatedAt,
        view: "workspace",
        tab: "passage",
        activePageId: project.pages[0]?.id ?? null,
        selectedIds: [],
        zoom: 1,
        history: [],
        future: [],
        recents: upsertRecentProject({
          id: project.id,
          name: project.name,
          path: null,
          updatedAt: project.updatedAt,
          storage: "local",
        }),
      });
      try {
        window.localStorage.setItem(`qexam.local.${project.id}`, JSON.stringify(project));
      } catch {
        // project may be too large for localStorage; the .qws file remains the source
      }
      clearDraft();
      toast.success("프로젝트를 불러왔습니다.", project.name);
    } catch (error) {
      toast.error("프로젝트를 열 수 없습니다.", errorMessage(error));
    } finally {
      set({ pendingOpen: false });
    }
  },

  openRecent: async (entry) => {
    set({ pendingOpen: true });
    try {
      if (entry.storage === "file" && entry.path) {
        const text = await readTextFile(entry.path);
        const project = normalizeProject(JSON.parse(text));
        set({
          project,
          filePath: entry.path,
          dirty: false,
          lastSavedAt: project.updatedAt,
          view: "workspace",
          tab: "passage",
          activePageId: project.pages[0]?.id ?? null,
          selectedIds: [],
          zoom: 1,
          history: [],
          future: [],
        });
        toast.success("프로젝트를 열었습니다.", entry.name);
        return;
      }
      const raw = window.localStorage.getItem(`qexam.local.${entry.id}`);
      if (!raw) {
        toast.error("프로젝트를 찾을 수 없습니다.", "다른 PC로 옮겼다면 .qws 파일을 직접 불러와 주세요.");
        return;
      }
      const project = normalizeProject(JSON.parse(raw));
      set({
        project,
        filePath: null,
        dirty: false,
        lastSavedAt: project.updatedAt,
        view: "workspace",
        tab: "passage",
        activePageId: project.pages[0]?.id ?? null,
        selectedIds: [],
        zoom: 1,
        history: [],
        future: [],
      });
      toast.success("최근 프로젝트를 열었습니다.", project.name);
    } catch (error) {
      toast.error("프로젝트를 열 수 없습니다.", errorMessage(error));
    } finally {
      set({ pendingOpen: false });
    }
  },

  save: async (options) => {
    const { project, filePath } = get();
    if (!project) return false;
    set({ saving: true });
    try {
      const contents = serializeProject(project);
      const suggested = `${sanitizeFileName(project.name)}.qws`;
      const path = await saveProjectFile(
        contents,
        suggested,
        options?.saveAs ? null : filePath,
      );
      if (!path) {
        set({ saving: false });
        return false;
      }
      const isBrowser = path.startsWith("browser:");
      const savedAt = nowIso();
      set({
        filePath: isBrowser ? null : path,
        dirty: false,
        saving: false,
        lastSavedAt: savedAt,
        recents: upsertRecentProject({
          id: project.id,
          name: project.name,
          path: isBrowser ? null : path,
          updatedAt: savedAt,
          storage: isBrowser ? "local" : "file",
        }),
      });
      try {
        window.localStorage.setItem(`qexam.local.${project.id}`, contents);
      } catch {
        // ignore quota errors
      }
      clearDraft();
      if (!options?.silent) {
        toast.success("프로젝트를 저장했습니다.", isBrowser ? "다운로드 폴더를 확인하세요." : path);
      }
      return true;
    } catch (error) {
      set({ saving: false });
      toast.error("저장에 실패했습니다.", errorMessage(error));
      return false;
    }
  },

  autosave: async () => {
    const { project, dirty, filePath } = get();
    if (!project || !dirty) return;
    const contents = serializeProject(project);
    if (contents.length < 4_500_000) saveDraft(contents, filePath);
    if (filePath && !filePath.startsWith("browser:")) {
      try {
        await writeTextFile(filePath, contents);
        set({ lastSavedAt: nowIso(), dirty: false });
      } catch {
        // keep the draft; the user can save manually
      }
    }
  },

  restoreDraft: async () => {
    const draft = draftEnvelope();
    if (!draft) return false;
    try {
      const project = normalizeProject(JSON.parse(draft.project));
      set({
        project,
        filePath: draft.path,
        dirty: true,
        lastSavedAt: draft.savedAt,
        view: "workspace",
        tab: "passage",
        activePageId: project.pages[0]?.id ?? null,
        selectedIds: [],
        zoom: 1,
        history: [],
        future: [],
      });
      toast.info("자동 저장된 작업을 복구했습니다.", `${project.name} · ${draft.savedAt}`);
      return true;
    } catch (error) {
      toast.error("자동 저장 복구에 실패했습니다.", errorMessage(error));
      return false;
    }
  },

  refreshRecents: () => set({ recents: loadRecentProjects() }),

  removeRecent: (id) => {
    window.localStorage.removeItem(`qexam.local.${id}`);
    set({ recents: removeRecentProject(id) });
    const current = get().project;
    if (current?.id === id) get().closeProject();
  },

  update: (mutator) => {
    const current = get().project;
    if (!current) return;
    const draft = structuredClone(current);
    mutator(draft);
    draft.updatedAt = nowIso();
    set({ project: draft, dirty: true });
  },

  applyPages: (pages, options) => {
    const { project, history } = get();
    if (!project) return;
    const nextHistory =
      options?.history === false ? history : [...history, structuredClone(project.pages)].slice(-60);
    set({
      project: { ...project, pages, updatedAt: nowIso() },
      dirty: true,
      history: nextHistory,
      future: options?.history === false ? get().future : [],
    });
  },

  updatePage: (pageId, patch) => {
    const { project } = get();
    if (!project) return;
    get().applyPages(
      project.pages.map((page) => (page.id === pageId ? { ...page, ...patch } : page)),
    );
  },

  addPage: (afterPageId) => {
    const { project } = get();
    if (!project) return;
    const index = afterPageId ? project.pages.findIndex((page) => page.id === afterPageId) + 1 : project.pages.length;
    const page = createPage(project.settings.defaultPageSize, "portrait", index);
    const pages = [...project.pages];
    pages.splice(index, 0, page);
    get().applyPages(pages.map((item, i) => ({ ...item, name: item.name || `페이지 ${i + 1}` })));
    set({ activePageId: page.id, selectedIds: [] });
  },

  duplicatePage: (pageId) => {
    const { project } = get();
    if (!project) return;
    const index = project.pages.findIndex((page) => page.id === pageId);
    if (index < 0) return;
    const source = project.pages[index];
    const copy: DocPage = {
      ...structuredClone(source),
      id: uid("page"),
      name: `${source.name} 복사`,
      elements: source.elements.map((element) => ({ ...structuredClone(element), id: uid(element.type) })),
    };
    const pages = [...project.pages];
    pages.splice(index + 1, 0, copy);
    get().applyPages(pages);
    set({ activePageId: copy.id, selectedIds: [] });
  },

  deletePage: (pageId) => {
    const { project } = get();
    if (!project) return;
    if (project.pages.length <= 1) {
      toast.warning("마지막 페이지는 삭제할 수 없습니다.");
      return;
    }
    const pages = project.pages.filter((page) => page.id !== pageId);
    get().applyPages(pages);
    set({ activePageId: pages[0]?.id ?? null, selectedIds: [] });
  },

  movePage: (from, to) => {
    const { project } = get();
    if (!project) return;
    if (to < 0 || to >= project.pages.length || from === to) return;
    const pages = [...project.pages];
    const [moved] = pages.splice(from, 1);
    pages.splice(to, 0, moved);
    get().applyPages(pages);
  },

  addElement: (element) => {
    const { project, activePageId } = get();
    if (!project) return;
    const pageId = activePageId ?? project.pages[0]?.id;
    const pages = project.pages.map((page) =>
      page.id === pageId ? { ...page, elements: [...page.elements, element] } : page,
    );
    get().applyPages(pages);
    set({ selectedIds: [element.id] });
  },

  updateElements: (elements) => {
    const { project, activePageId } = get();
    if (!project) return;
    const pageId = activePageId ?? project.pages[0]?.id;
    const pages = project.pages.map((page) =>
      page.id === pageId ? { ...page, elements } : page,
    );
    get().applyPages(pages);
  },

  deleteElements: (ids) => {
    const { project, activePageId } = get();
    if (!project || !ids.length) return;
    const pageId = activePageId ?? project.pages[0]?.id;
    const pages = project.pages.map((page) =>
      page.id === pageId
        ? { ...page, elements: page.elements.filter((element) => !ids.includes(element.id)) }
        : page,
    );
    get().applyPages(pages);
    set({ selectedIds: [] });
  },

  undo: () => {
    const { project, history, future } = get();
    if (!project || !history.length) return;
    const previous = history[history.length - 1];
    set({
      project: { ...project, pages: previous },
      history: history.slice(0, -1),
      future: [structuredClone(project.pages), ...future].slice(0, 60),
      dirty: true,
      selectedIds: [],
    });
  },

  redo: () => {
    const { project, history, future } = get();
    if (!project || !future.length) return;
    const next = future[0];
    set({
      project: { ...project, pages: next },
      history: [...history, structuredClone(project.pages)].slice(-60),
      future: future.slice(1),
      dirty: true,
      selectedIds: [],
    });
  },
}));

export function activePage(state: ProjectState): DocPage | null {
  if (!state.project) return null;
  return (
    state.project.pages.find((page) => page.id === state.activePageId) ??
    state.project.pages[0] ??
    null
  );
}

export function selectedElements(state: ProjectState): DocElement[] {
  const page = activePage(state);
  if (!page) return [];
  return page.elements.filter((element) => state.selectedIds.includes(element.id));
}

export function pageSizeLabel(page: DocPage): string {
  const size = pageDimensions(page);
  return `${page.size} ${page.orientation === "portrait" ? "세로" : "가로"} · ${Math.round(
    size.width,
  )}×${Math.round(size.height)}mm`;
}

export function ensureTextElement(page: DocPage): DocElement {
  const width = pageDimensions(page).width;
  return createTextElement({ x: 20, y: 20, w: Math.min(120, width - 40) });
}

export function newTitlePage(name: string, title: string): DocPage {
  const page = createPage("A4", "portrait", 0);
  page.elements.push(
    createTextElement({
      x: 25,
      y: 30,
      w: 160,
      h: 20,
      text: name,
      fontSize: 24,
      bold: true,
      color: "#1e3a8a",
    }),
    createTextElement({ x: 25, y: 52, w: 160, h: 12, text: title, fontSize: 13, color: "#475569" }),
  );
  return page;
}

export function detectLanguageFor(text: string): "ko" | "en" {
  return detectLanguage(text);
}

export function recentStorageSummary(recents: RecentProject[]): string {
  if (!recents.length) return "저장된 프로젝트가 없습니다.";
  return `${recents.length}개의 프로젝트`;
}

export function saveRecentList(list: RecentProject[]): void {
  saveRecentProjects(list);
}
