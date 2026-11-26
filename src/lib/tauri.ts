/**
 * Bridge to the Tauri backend. Every function has a browser fallback so the UI
 * can be developed and reviewed with `npm run dev`, while the packaged Windows
 * build uses DPAPI-encrypted secrets and native file dialogs.
 */
import { bytesToBase64 } from "./utils";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const api = await import("@tauri-apps/api/core");
  return (api.invoke as InvokeFn)<T>(cmd, args);
}

const DEV_KEY = "qexam.dev.api-key";

export async function saveSecret(key: string): Promise<void> {
  if (!isTauri) {
    window.localStorage.setItem(DEV_KEY, key);
    return;
  }
  await invoke("secret_save", { key });
}

export async function readSecret(): Promise<string | null> {
  if (!isTauri) return window.localStorage.getItem(DEV_KEY);
  return invoke<string | null>("secret_read");
}

export async function deleteSecret(): Promise<void> {
  if (!isTauri) {
    window.localStorage.removeItem(DEV_KEY);
    return;
  }
  await invoke("secret_delete");
}

export async function secretStatus(): Promise<{
  exists: boolean;
  method: string;
  path: string;
}> {
  if (!isTauri) {
    return {
      exists: Boolean(window.localStorage.getItem(DEV_KEY)),
      method: "브라우저 저장(localStorage, 개발용)",
      path: "localStorage",
    };
  }
  return invoke("secret_status");
}

export async function getWorkspaceDir(): Promise<string> {
  if (!isTauri) return "(브라우저 미리보기 - 파일 저장은 다운로드로 동작)";
  return invoke("workspace_dir");
}

export async function readTextFile(path: string): Promise<string> {
  return invoke("read_text_file", { path });
}

export async function writeTextFile(path: string, contents: string): Promise<void> {
  await invoke("write_text_file", { path, contents });
}

export async function readBinaryFile(path: string): Promise<Uint8Array> {
  const encoded = await invoke<string>("read_binary_file_base64", { path });
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function writeBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("write_binary_file_base64", { path, data: bytesToBase64(bytes) });
}

export async function pathExists(path: string): Promise<boolean> {
  if (!isTauri) return false;
  return invoke("path_exists", { path });
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export async function pickOpenFile(filters?: FileFilter[]): Promise<string | null> {
  if (!isTauri) return null;
  const dialog = await import("@tauri-apps/plugin-dialog");
  const result = await dialog.open({ multiple: false, filters, directory: false });
  return typeof result === "string" ? result : null;
}

export async function pickSaveFile(
  defaultPath: string,
  filters?: FileFilter[],
): Promise<string | null> {
  if (!isTauri) return null;
  const dialog = await import("@tauri-apps/plugin-dialog");
  const result = await dialog.save({ defaultPath, filters });
  return typeof result === "string" ? result : null;
}

export async function pickDirectory(): Promise<string | null> {
  if (!isTauri) return null;
  const dialog = await import("@tauri-apps/plugin-dialog");
  const result = await dialog.open({ directory: true, multiple: false });
  return typeof result === "string" ? result : null;
}

export function fitPath(dir: string, name: string): string {
  const separator = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[\\/]$/, "")}${separator}${name}`;
}

/** Browser file picker fallback used when not running inside Tauri. */
export function pickBrowserFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export async function openAnyTextFile(
  filters?: FileFilter[],
): Promise<{ name: string; text: string } | null> {
  if (isTauri) {
    const path = await pickOpenFile(filters);
    if (!path) return null;
    const text = await readTextFile(path);
    return { name: path.split(/[\\/]/).pop() ?? path, text };
  }
  const file = await pickBrowserFile(".qws,.json,application/json");
  if (!file) return null;
  return { name: file.name, text: await file.text() };
}

export async function saveProjectFile(
  contents: string,
  suggestedName: string,
  knownPath: string | null,
): Promise<string | null> {
  if (isTauri) {
    let path = knownPath;
    if (!path) {
      path = await pickSaveFile(suggestedName, [{ name: "Qexam 프로젝트", extensions: ["qws"] }]);
      if (!path) return null;
      if (!path.toLowerCase().endsWith(".qws")) path = `${path}.qws`;
    }
    await writeTextFile(path, contents);
    return path;
  }
  const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return `browser:${suggestedName}`;
}
