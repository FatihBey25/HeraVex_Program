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

/** Where the workspace lives, from HeraVex's perspective.
 *
 *  - `"local"`: standard on-disk folder. The workspace watcher still
 *     fires on local filesystem events, but no team-mode UI surfaces
 *     and `heravex-members.json` is never written.
 *  - `"team"`: the folder is on a cloud-synced provider (OneDrive,
 *     Dropbox, iCloud, Google Drive, etc.). HeraVex enables the
 *     members panel, runs leader/role checks, and bumps the polling
 *     fallback because OS notify events don't fire on placeholder
 *     files cloud agents lay down. */
export type WorkspaceMode = "local" | "team";

/** Coarse identifier for the cloud provider whose folder this workspace
 *  lives in. Used purely for UI affordances (icon, badge). `"other"`
 *  is when we detect a generic sync hint we can't categorise. */
export type CloudProvider = "onedrive" | "dropbox" | "gdrive" | "icloud" | "other";

export type Workspace = {
  id: string;
  name: string;
  /** Absolute path on disk. `null` represents the OS-default app-data location
   *  (managed via `clearWorkspacePath`). */
  path: string | null;
  createdAt: string;
  /** New in v0.9.7. Older registry entries default to `"local"` on read
   *  so the migration is a no-op for existing users. */
  mode?: WorkspaceMode;
  /** Set only when `mode === "team"`. Detected via path heuristic at
   *  creation time and never re-evaluated, so a folder that gets moved
   *  outside its sync root keeps its original label until manually
   *  unlinked. */
  cloudProvider?: CloudProvider;
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

export function addWorkspace(
  name: string,
  path: string,
  opts?: { mode?: WorkspaceMode; cloudProvider?: CloudProvider },
): Workspace {
  const id = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const ws: Workspace = {
    id,
    name: name.trim() || "Untitled",
    path,
    createdAt: new Date().toISOString(),
    mode: opts?.mode ?? "local",
    cloudProvider: opts?.cloudProvider,
  };
  const list = loadWorkspaces();
  // Avoid duplicate path entries — same folder shouldn't be registered twice
  const without = list.filter((w) => w.path !== path);
  saveWorkspaces([...without, ws]);
  return ws;
}

/** Best-effort detection of a cloud-sync provider from a workspace path.
 *
 *  We intentionally use only stable hint strings present in the default
 *  install locations of each provider, and avoid hitting the
 *  filesystem (no symlink-resolution, no stat calls). This means a
 *  user who renamed their sync root, or uses a non-standard symlink
 *  setup, will see `null` — and the UI then asks them explicitly
 *  whether the folder is a team folder. That fallback is correct for
 *  any case heuristics can't catch, so the heuristic stays loose
 *  rather than guessing wrong.
 *
 *  All matchers are case-insensitive (Windows paths are case-insensitive
 *  in practice, and macOS users sometimes lower-case their volumes).
 *  The Mac iCloud Drive folder is special: its on-disk form is
 *  `~/Library/Mobile Documents/com~apple~CloudDocs` which never
 *  contains the literal string "icloud", so we match that path. */
export function detectCloudProvider(path: string): CloudProvider | null {
  const p = path.toLowerCase().replace(/\\/g, "/");
  if (p.includes("/onedrive")) return "onedrive";
  if (p.includes("/dropbox")) return "dropbox";
  if (p.includes("/google drive") || p.includes("/googledrive")
    || p.includes("/google_drive") || p.includes("/gdrive")) return "gdrive";
  if (p.includes("/mobile documents/com~apple~clouddocs") || p.includes("/icloud")
    || p.includes("/icloud drive") || p.includes("/icloud~drive")) return "icloud";
  // Generic hints — folders nested under explicit sync clients.
  if (p.includes("/syncthing") || p.includes("/pcloud")
    || p.includes("/mega") || p.includes("/box")) return "other";
  return null;
}

/** Convenience for the modal: pretty label per provider in the
 *  user's language. Unknown / null falls back to "Cloud folder". */
export function cloudProviderLabel(provider: CloudProvider | null | undefined, language: string): string {
  const pretty: Record<CloudProvider, string> = {
    onedrive: "OneDrive",
    dropbox:  "Dropbox",
    gdrive:   "Google Drive",
    icloud:   "iCloud Drive",
    other:    language === "tr" ? "Bulut klasör" : language === "fr" ? "Dossier cloud"
              : language === "es" ? "Carpeta en la nube" : "Cloud folder",
  };
  if (!provider) {
    return language === "tr" ? "Bulut klasör" : language === "fr" ? "Dossier cloud"
         : language === "es" ? "Carpeta en la nube" : "Cloud folder";
  }
  return pretty[provider];
}

/** Convert a registry list to the active team workspaces — these get
 *  rendered under a "Team folder" group in the sidebar. */
export function listTeamWorkspaces(list: Workspace[]): Workspace[] {
  return list.filter((w) => w.mode === "team");
}
export function listLocalWorkspaces(list: Workspace[]): Workspace[] {
  return list.filter((w) => w.id === DEFAULT_WORKSPACE_ID || (w.mode ?? "local") === "local");
}

/** Re-classify an existing workspace. Used when the user opts a folder
 *  in/out of team mode after creation — keeps registry the single
 *  source of truth and avoids stale UI labels. */
export function updateWorkspaceMode(
  id: string,
  mode: WorkspaceMode,
  cloudProvider?: CloudProvider | null,
): Workspace | null {
  const list = loadWorkspaces();
  const idx = list.findIndex((w) => w.id === id);
  if (idx < 0) return null;
  const next: Workspace = {
    ...list[idx],
    mode,
    cloudProvider: mode === "team" ? (cloudProvider ?? list[idx].cloudProvider ?? "other") : undefined,
  };
  const out = [...list];
  out[idx] = next;
  saveWorkspaces(out);
  return next;
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
