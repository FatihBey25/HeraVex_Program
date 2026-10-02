// Team-mode sync orchestrator (v0.9.7 rewrite).
//
// The previous loop polled a single global "workspace signature"
// hash. Any file change anywhere triggered a "remote changes
// detected, click to refresh" modal/toast — which interrupted the
// user mid-edit and required a full `refreshGames` reload.
//
// This module replaces that with per-file manifest diffing:
//   1. Every tick, fetch a `path → mtime_secs` map from Rust.
//   2. Diff against the last seen manifest.
//   3. Dispatch *targeted* window events so individual surfaces can
//      re-fetch just their own data:
//        • `heravex:notes-file-changed`   — for NoteCenter
//        • `heravex:game-file-changed`    — detail: gameId
//        • `heravex:members-file-changed` — for sidebar presence
//        • `heravex:activity-file-changed`— for activity log
//        • `heravex:games-list-changed`   — for the games array
//   4. Members heartbeat — every 30s we bump our own lastSeenAt so
//      other clients can colour our avatar "online" (last seen < 90s).
//
// The orchestrator is a singleton — call `startTeamSync()` once after
// init resolves; call `stopTeamSync()` on logout or workspace swap.

import { invoke } from "./invokeWrapper";
import { loadWorkspaces, type Workspace } from "./workspaces";
import { getWorkspacePath } from "./storage";

const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const FAIL_THRESHOLD = 3;
const STORAGE_KEY_LAST_CHECK = "heravex_last_sync_check";
const STORAGE_KEY_LAST_HEARTBEAT = "heravex_last_heartbeat_at";

type Manifest = Record<string, number>;

let pollTimer: number | null = null;
let heartbeatTimer: number | null = null;
let lastManifest: Manifest | null = null;
let failStreak = 0;
let notifiedDown = false;
// Overlap guard. The interval, the Rust file-watcher nudge and the
// "Check now" button can all ask for a poll at once; on a slow cloud
// drive the manifest walk can outlast the 2s interval. Overlapping
// polls raced on `lastManifest` and fired the same delta twice (double
// reloads while typing). Now: one poll at a time, and a request that
// arrives mid-poll schedules exactly one follow-up.
let pollInFlight: Promise<void> | null = null;
let pollQueued = false;

interface StartOpts {
  /** Called when the polling loop hits FAIL_THRESHOLD in a row, so the
   *  shell can surface a single toast instead of staying silent. */
  onSyncDown?: () => void;
  /** Cleared by the next successful tick. */
  onSyncBackUp?: () => void;
  /** Identity used for the heartbeat write. */
  getIdentity?: () => { displayName: string; avatarPath: string | null } | null;
  /** Fired when a teammate's DATA (games / notes / flows) changed on
   *  disk — the shell uses it to show a "synced from team" toast.
   *  Presence-only churn (the 30s heartbeat) does NOT trigger it. */
  onRemoteChange?: () => void;
}

let startOpts: StartOpts = {};

export function startTeamSync(opts: StartOpts = {}): void {
  startOpts = opts;
  stopTeamSync();
  pollTimer = window.setInterval(() => { void pollOnce(); }, POLL_INTERVAL_MS);
  heartbeatTimer = window.setInterval(() => { void heartbeatOnce(); }, HEARTBEAT_INTERVAL_MS);
  // Prime immediately so the first useful poll fires inside one
  // interval rather than after `POLL_INTERVAL_MS`.
  void pollOnce();
  void heartbeatOnce();
}

export function stopTeamSync(): void {
  if (pollTimer != null) { window.clearInterval(pollTimer); pollTimer = null; }
  if (heartbeatTimer != null) { window.clearInterval(heartbeatTimer); heartbeatTimer = null; }
  lastManifest = null;
  failStreak = 0;
  notifiedDown = false;
}

/** Called from the Team Mode settings page "Check now" button. */
export async function forceSyncCheck(): Promise<void> {
  await pollOnce();
}

/** Forces the orchestrator to forget the previous manifest and adopt
 *  the current on-disk state as the new baseline — no delta events
 *  fired even if the disk changed since the last poll. The
 *  ConflictDialog's "keepLocal" branch calls this so the user's
 *  override doesn't immediately re-trigger the same dialog on the
 *  next poll. Fixes review finding #6. */
export async function acceptCurrentAsBaseline(): Promise<void> {
  const { active } = await isTeamWorkspaceActive();
  if (!active) return;
  try {
    lastManifest = await invoke<Manifest>("workspace_manifest");
  } catch {
    // Best-effort — if the manifest call fails we leave lastManifest
    // alone; the next successful poll will re-baseline naturally.
  }
}

async function isTeamWorkspaceActive(): Promise<{ active: boolean; path: string | null; ws: Workspace | null }> {
  let path: string | null = null;
  try { path = await getWorkspacePath(); } catch { return { active: false, path: null, ws: null }; }
  if (!path) return { active: false, path: null, ws: null };
  const ws = loadWorkspaces().find((w) => w.path === path) ?? null;
  // v0.9.8: a custom (non-default) workspace path IS team mode — full
  // stop. The old "registry mode OR cloud heuristic" gate silently
  // disabled sync for any folder it failed to classify, which was the
  // #1 reason team mode "did nothing" (no heartbeat → no presence files
  // → no members; no poll → no propagation → no toasts). The poll is
  // cheap and a no-op when nothing changes, so running it whenever a
  // shared folder is active is the robust choice.
  return { active: true, path, ws };
}

function pollOnce(): Promise<void> {
  if (pollInFlight) {
    pollQueued = true;
    return pollInFlight;
  }
  pollInFlight = (async () => {
    try {
      do {
        pollQueued = false;
        await pollOnceInner();
      } while (pollQueued);
    } finally {
      pollInFlight = null;
    }
  })();
  return pollInFlight;
}

async function pollOnceInner(): Promise<void> {
  const { active, path } = await isTeamWorkspaceActive();
  if (!active || !path) return;
  try {
    // A stalled cloud drive can hang the walk; with the overlap guard
    // that would stop sync for good. Treat a slow walk as a failed tick.
    const manifest = await Promise.race([
      invoke<Manifest>("workspace_manifest"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("manifest timeout")), 30_000)),
    ]);
    try { localStorage.setItem(STORAGE_KEY_LAST_CHECK, String(Date.now())); } catch { /* quota */ }
    if (failStreak > 0) {
      failStreak = 0;
      if (notifiedDown) {
        notifiedDown = false;
        startOpts.onSyncBackUp?.();
      }
    }
    if (lastManifest == null) {
      lastManifest = manifest;
      return;
    }
    const dataChanged = dispatchDelta(lastManifest, manifest);
    lastManifest = manifest;
    if (dataChanged) startOpts.onRemoteChange?.();
  } catch (err) {
    failStreak++;
    if (import.meta.env.DEV) console.warn("[team-sync] poll failed:", err);
    if (failStreak >= FAIL_THRESHOLD && !notifiedDown) {
      notifiedDown = true;
      startOpts.onSyncDown?.();
    }
  }
}

/** Returns true when teammate DATA (games / notes / flows) changed — the
 *  caller shows a toast for those, but not for presence/activity churn. */
function dispatchDelta(prev: Manifest, next: Manifest): boolean {
  const changed: string[] = [];
  // Files added or modified
  for (const [path, mtime] of Object.entries(next)) {
    if (prev[path] !== mtime) changed.push(path);
  }
  // Files removed
  for (const path of Object.keys(prev)) {
    if (!(path in next)) changed.push(path);
  }
  if (changed.length === 0) return false;

  // Categorise: notes vs members vs activity vs game files.
  const changedGameIds: string[] = [];
  const changedNoteIds: string[] = [];
  const removedNoteIds: string[] = [];
  let legacyNotesChanged = false;
  let assetsChanged = false;
  let notesChanged = false;
  let membersChanged = false;
  let activityChanged = false;
  let settingsChanged = false;
  let flowsChanged = false;
  let walletChanged = false;
  for (const path of changed) {
    // Notes are per-id files under notes/<id>.json (the single notes.json
    // is legacy). Matching only "notes.json" meant teammate note edits
    // never propagated — fixed here.
    if (path === "notes.json") { notesChanged = true; legacyNotesChanged = true; continue; }
    const nm = /^notes\/(.+?)\.json$/.exec(path);
    if (nm) {
      notesChanged = true;
      if (path in next) changedNoteIds.push(nm[1]); else removedNoteIds.push(nm[1]);
      continue;
    }
    if (path.startsWith("notes/")) { notesChanged = true; legacyNotesChanged = true; continue; }
    // Cover / moodboard images landing from the cloud client. They are
    // tracked separately from the game JSON because they arrive on
    // their own schedule — see lib/images.ts broken-image recovery.
    if (path.startsWith("library/") && /\.(png|jpe?g|webp|gif|bmp)$/i.test(path)) { assetsChanged = true; continue; }
    // v0.9.8 — presence-per-user lives under heravex-members/<id>.json.
    // The legacy single-file path is kept for back-compat.
    if (path === "heravex-members.json" || path.startsWith("heravex-members/")) { membersChanged = true; continue; }
    if (path === "activity.json") { activityChanged = true; continue; }
    if (path === "settings.json") { settingsChanged = true; continue; }
    // v0.9.9 — general expenses + currency list, per workspace.
    if (path === "wallet.json") { walletChanged = true; continue; }
    const m = /^games\/(.+?)\.json$/.exec(path);
    if (m) { changedGameIds.push(m[1]); continue; }
    // v0.9.8 — Flow Center files live under flows/{id}.json. We don't
    // need the specific id here: the store's syncExternal re-reads the
    // whole dir but keeps the flow being edited intact.
    if (/^flows\/(.+?)\.json$/.test(path)) { flowsChanged = true; continue; }
  }

  if (notesChanged) {
    // With ids, NoteCenter re-reads just those files and skips the ones
    // whose content it already has (our own save echoing back). Without
    // ids (legacy single-file layout) it falls back to a full reload.
    window.dispatchEvent(new CustomEvent("heravex:notes-file-changed", {
      detail: legacyNotesChanged ? undefined : { noteIds: changedNoteIds, removedNoteIds },
    }));
  }
  if (assetsChanged) {
    window.dispatchEvent(new CustomEvent("heravex:assets-changed"));
  }
  if (membersChanged) {
    // Fire both: `members-file-changed` for the sidebar presence dots and
    // `team-members-changed` for the Settings members panel (it listens
    // to the latter for self-heartbeats; now remote changes reach it too).
    window.dispatchEvent(new CustomEvent("heravex:members-file-changed"));
    window.dispatchEvent(new CustomEvent("heravex:team-members-changed"));
  }
  if (activityChanged) {
    window.dispatchEvent(new CustomEvent("heravex:activity-file-changed"));
  }
  if (settingsChanged) {
    window.dispatchEvent(new CustomEvent("heravex:settings-file-changed"));
  }
  if (flowsChanged) {
    window.dispatchEvent(new CustomEvent("heravex:flow-file-changed"));
  }
  if (walletChanged) {
    window.dispatchEvent(new CustomEvent("heravex:wallet-file-changed"));
  }
  if (changedGameIds.length > 0) {
    window.dispatchEvent(new CustomEvent("heravex:games-list-changed", {
      detail: { gameIds: changedGameIds },
    }));
  }

  // Toast only for user-visible data — not presence heartbeats (every
  // 30s) or activity-log appends, which would spam.
  return notesChanged || flowsChanged || changedGameIds.length > 0;
}

async function heartbeatOnce(): Promise<void> {
  const { active, path } = await isTeamWorkspaceActive();
  if (!active || !path) return;
  const id = startOpts.getIdentity?.();
  if (!id) return;
  try {
    // The members module owns its schema — we call its self-register
    // path because that's the same code that handles the leader-vs-
    // member assignment and the dedupe-leader race.
    const { joinTeamWorkspace } = await import("./teamMembers");
    await joinTeamWorkspace(path, {
      displayName: id.displayName,
      avatarPath: id.avatarPath,
    });
    try { localStorage.setItem(STORAGE_KEY_LAST_HEARTBEAT, String(Date.now())); } catch { /* quota */ }
    // The write changes members.json mtime; the next poll will
    // detect it for everyone else. We also self-notify so the local
    // members panel refreshes immediately.
    window.dispatchEvent(new CustomEvent("heravex:team-members-changed"));
  } catch (err) {
    if (import.meta.env.DEV) console.warn("[team-sync] heartbeat failed:", err);
  }
}
