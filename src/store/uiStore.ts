import { create } from "zustand";
import { uid } from "../lib/utils";

export type ToastKind = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  detail?: string;
}

interface UiState {
  toasts: Toast[];
  push: (kind: ToastKind, title: string, detail?: string) => void;
  dismiss: (id: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  push: (kind, title, detail) => {
    const id = uid("toast");
    set((state) => ({ toasts: [...state.toasts, { id, kind, title, detail }] }));
    window.setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    }, kind === "error" ? 9000 : 4500);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

export const toast = {
  success: (title: string, detail?: string) => useUiStore.getState().push("success", title, detail),
  error: (title: string, detail?: string) => useUiStore.getState().push("error", title, detail),
  info: (title: string, detail?: string) => useUiStore.getState().push("info", title, detail),
  warning: (title: string, detail?: string) => useUiStore.getState().push("warning", title, detail),
};
