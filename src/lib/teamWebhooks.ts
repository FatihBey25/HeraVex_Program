// Team Mode + Webhook preferences. Two related slices kept in one
// file because both are connection-layer config that doesn't have a
// natural home elsewhere.
//
// Team Mode preferences here are LOCAL — they tune how the existing
// Rust workspace watcher behaves (delay, log visibility) on top of
// the workspace path itself (which still lives on
// `storage.getWorkspacePath` / `setWorkspacePath`). Conflict
// strategy is reserved: the watcher currently always uses
// last-writer-wins; this preference will gate alternate behaviour
// in a future Rust milestone.
//
// Webhooks are pure outbound: a URL + a set of event triggers, fired
// from the relevant flow (e.g. "press kit generated"). M6 ships the
// preferences + Settings UI; the actual dispatch hooks land
// per-event-source as those flows mature.

import type { ShortcutAction } from "./shortcutConfig";

// Keep linter quiet — re-export anchors the shortcut module without
// adding noise to the slice declarations below.
export type _ShortcutMarker = ShortcutAction;

// ── Team Mode ───────────────────────────────────────────────────────

export type ConflictStrategy = "lastWriterWins" | "manualMerge" | "autoMerge";
export type WatcherDelay = "instant" | "5s" | "30s" | "2m";

export interface TeamModeSlice {
  conflictStrategy: ConflictStrategy;
  watcherDelay: WatcherDelay;
  showWatcherLogs: boolean;
  /** Reserved — presence indicator is experimental for the team mode. */
  showPresence: boolean;
}

export const DEFAULT_TEAM_MODE: TeamModeSlice = {
  // v0.9.7 rewrite: autoMerge is the new default because the new
  // team-sync orchestrator does per-file granular reloads instead of
  // the old "anything changed → modal" pattern. The conflict dialog
  // is only useful when two users edit the SAME file at the same
  // time; everything else can merge silently.
  conflictStrategy: "autoMerge",
  // Polling tightened from 5s → "instant" (3s underlying). The
  // manifest call is cheap and tighter intervals make remote edits
  // feel real-time.
  watcherDelay: "instant",
  showWatcherLogs: false,
  showPresence: true,
};

// ── Webhooks ────────────────────────────────────────────────────────

export type WebhookEvent =
  | "versionPublished"
  | "taskCompleted"
  | "pressKitGenerated"
  | "buildReady";

export interface DiscordWebhookCfg {
  webhookUrl: string;
  events: WebhookEvent[];
  /** Message template with `{game}`, `{version}`, `{user}` placeholders. */
  messageTemplate: string;
}

export interface GithubWebhookCfg {
  personalAccessToken: string;
  pullReleaseCommits: boolean;
  autoCreateRelease: boolean;
  defaultRepo: string;
}

export interface WebhooksSlice {
  discord: DiscordWebhookCfg;
  github: GithubWebhookCfg;
}

export const DEFAULT_WEBHOOKS: WebhooksSlice = {
  discord: {
    webhookUrl: "",
    events: [],
    messageTemplate: "🎮 {game} v{version} just shipped by {user}",
  },
  github: {
    personalAccessToken: "",
    pullReleaseCommits: false,
    autoCreateRelease: false,
    defaultRepo: "",
  },
};

// ── localStorage ─────────────────────────────────────────────────────

const KEY_TEAM     = "heravex_team_mode_v1";
const KEY_WEBHOOKS = "heravex_webhooks_v1";

export function loadTeamMode(): TeamModeSlice {
  return safeRead(KEY_TEAM, DEFAULT_TEAM_MODE);
}
export function loadWebhooks(): WebhooksSlice {
  return safeRead(KEY_WEBHOOKS, DEFAULT_WEBHOOKS);
}
export function saveTeamMode(s: TeamModeSlice) { safeWrite(KEY_TEAM, s); }
export function saveWebhooks(s: WebhooksSlice) { safeWrite(KEY_WEBHOOKS, s); }

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<T>;
    return { ...fallback, ...parsed } as T;
  } catch {
    return fallback;
  }
}
function safeWrite<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

/** Send a one-off webhook payload. Used by the Discord page's "Test"
 *  button to confirm the URL works. Errors bubble up so the caller
 *  can surface them as a toast. */
export async function postDiscordWebhook(url: string, content: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Discord webhook returned ${res.status}`);
  }
}
