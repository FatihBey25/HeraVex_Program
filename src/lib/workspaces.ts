// Workspace registry — a thin frontend layer over the existing
// `set_workspace_path` / `get_workspace_path` Rust commands.
//
// Why no new backend commands?
//   Multi-workspace == "the data folder Tauri reads from". The Rust side
//   already supports pointing at any directory. We only need to remember a
//   list of named folders on the user's machine so the sidebar can offer
//   one-click switching. The registry itself lives in localStorage; the
//   active workspace is sourced from get_workspace_path so the backend
//   stays the single source of truth for "what's currently loaded".
//
// Safety:
//   • No delete operation here — removing a workspace from the registry
//     does NOT touch the underlying files. (Per user spec.)
//   • Switching simply calls setWorkspacePath; the existing toast + reload
//     path handles state reset for us.

import { setWorkspacePath, clearWorkspacePath } from "./storage";

export const DEFAULT_WORKSPACE_ID = "default";
const STORAGE_KEY = "heravex_workspaces";

export type Workspace = {
  id: string;
  name: string;
  /** Absolute path on disk. `null` represents the OS-default app-data location
   *  (managed via `clearWorkspacePath`). */
  path: string | null;
  createdAt: string;
};

function defaultWorkspace(): Workspace {
  return {
    id: DEFAULT_WORKSPACE_ID,
    name: "Default",
    path: null,
    createdAt: "2024-01-01T00:00:00.000Z",
  };
}

/** Read the registry from localStorage. Always returns at least one entry
 *  (the synthetic Default workspace that maps to the OS app-data folder). */
export function loadWorkspaces(): Workspace[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [defaultWorkspace()];
    const parsed = JSON.parse(raw) as Workspace[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [defaultWorkspace()];
    // Ensure the default sentinel is always present so the user can return
    // to OS-default storage even if the registry was hand-edited.
    if (!parsed.some((w) => w.id === DEFAULT_WORKSPACE_ID)) {
      return [defaultWorkspace(), ...parsed];
    }
    return parsed;
  } catch {
    return [defaultWorkspace()];
  }
}

function saveWorkspaces(list: Workspace[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
}

export function addWorkspace(name: string, path: string): Workspace {
  const id = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const ws: Workspace = {
    id,
    name: name.trim() || "Untitled",
    path,
    createdAt: new Date().toISOString(),
  };
  const list = loadWorkspaces();
  // Avoid duplicate path entries — same folder shouldn't be registered twice
  const without = list.filter((w) => w.path !== path);
  saveWorkspaces([...without, ws]);
  return ws;
}

/** Returns the workspace whose path matches the currently-active backend
 *  workspace_path. Falls back to the Default entry when no custom workspace
 *  is set. */
export function resolveActiveWorkspace(
  list: Workspace[],
  currentPath: string | null,
): Workspace {
  if (!currentPath) return list.find((w) => w.id === DEFAULT_WORKSPACE_ID) ?? defaultWorkspace();
  return (
    list.find((w) => w.path === currentPath) ??
    // If the backend is pointed at a folder we don't have registered (e.g.
    // user picked it via Profile > Cloud Sync), synthesise an entry so the
    // UI still shows something sensible.
    {
      id: "external",
      name: currentPath.split(/[\\/]/).pop() || "External",
      path: currentPath,
      createdAt: new Date().toISOString(),
    }
  );
}

/** Switch to a workspace. Returns once the backend has accepted the change;
 *  the caller is expected to trigger a full page reload (the existing
 *  Profile flow already does this after `set_workspace_path`). */
export async function switchToWorkspace(ws: Workspace): Promise<void> {
  if (ws.id === DEFAULT_WORKSPACE_ID || ws.path === null) {
    await clearWorkspacePath();
    return;
  }
  await setWorkspacePath(ws.path);
}
