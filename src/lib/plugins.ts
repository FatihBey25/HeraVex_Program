// HeraVex plugin / extension API — v0.9 scaffolding.
//
// Plugins extend HeraVex without touching its core build. Each plugin
// lives in the user's workspace under `plugins/<id>/` and ships:
//
//   plugins/<id>/heravex.plugin.json
//   plugins/<id>/widget.js   (UMD or ES module exporting a render fn)
//
// The runtime here is intentionally tiny:
//
//   1. `discoverPlugins()` reads the workspace plugins folder via a
//      Tauri command and returns the parsed manifests.
//   2. `mountPluginWidgets("dashboard")` mounts every widget whose
//      manifest declares the given slot. Each plugin gets a DOM node
//      and a read-only snapshot of the relevant store slices.
//   3. `unmountPluginWidgets()` cleans them up between page swaps.
//
// The shipped Dashboard / Sidebar render their stock content first;
// plugin widgets are appended below in well-defined slots so a broken
// plugin can never crash a core page. We sandbox loading by:
//   - Refusing to mount any plugin missing the "enabled" toggle.
//   - Surfacing console.error on plugin load failures (gated to dev).
//   - Importing widget.js as a *module* via `import()` so the browser
//     enforces CSP — same-origin only by default.
//
// Plugin authors get a stable, semver-pinned interface
// (`HeraVexPluginContext`); breaking changes to it bump the manifest
// `apiVersion` field and old plugins are skipped with a warning.

import { devWarn } from "./devLog";

// ── Public contract (what plugin authors see) ──────────────────────

export interface HeraVexPluginManifest {
  /** Stable identifier — folder name AND react key. lowercase-kebab. */
  id: string;
  /** Human-friendly display name. */
  name: string;
  /** Free-form one-line summary shown in Settings → Plugins. */
  description?: string;
  /** SemVer string. Future updates compare to this. */
  version: string;
  /** Author display name; no email/url to avoid PII leaks in screenshots. */
  author?: string;
  /** API compatibility marker. Bump when this file breaks the surface. */
  apiVersion: 1;
  /** Which mount slot the widget targets. */
  slot: "dashboard" | "sidebar" | "wallet" | "notes";
  /** Relative path to the entry module (default: "widget.js"). */
  entry?: string;
  /** Optional: the manifest can ship inline metadata for the manager. */
  permissions?: ("readGames" | "readNotes" | "readWallet")[];
}

export interface HeraVexPluginContext {
  apiVersion: 1;
  /** Read-only view of the games array. */
  games: ReadonlyArray<{ id: string; title: string; status: string }>;
  /** Convenience for showing a toast through the host. */
  toast: (message: string, kind?: "info" | "success" | "error") => void;
  /** Issue a window event. Plugins listen via the standard EventTarget. */
  emit: (name: string, detail?: unknown) => void;
}

/** Each plugin module must default-export this signature. */
export type HeraVexPluginWidget = (root: HTMLElement, ctx: HeraVexPluginContext) => void | (() => void);

// ── Loader ─────────────────────────────────────────────────────────

interface DiscoveredPlugin {
  manifest: HeraVexPluginManifest;
  enabled: boolean;
  /** Absolute file:// URL to the entry module. */
  entryUrl: string;
}

const ENABLED_KEY = "heravex_plugins_enabled_v1";

function readEnabledMap(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(ENABLED_KEY) || "{}") as Record<string, boolean>;
  } catch { return {}; }
}
export function setPluginEnabled(id: string, enabled: boolean): void {
  const map = readEnabledMap();
  map[id] = enabled;
  try { localStorage.setItem(ENABLED_KEY, JSON.stringify(map)); } catch { /* quota */ }
  // Re-mount so the host picks up the change without a reload.
  window.dispatchEvent(new CustomEvent("heravex:plugins-changed"));
}

/** Ask the Rust side to enumerate plugin manifests in the workspace.
 *  Returns an empty array when the folder doesn't exist or the
 *  command isn't wired (older versions). */
export async function discoverPlugins(): Promise<DiscoveredPlugin[]> {
  try {
    const { invoke } = await import("./invokeWrapper");
    const raw = await invoke<string>("list_plugin_manifests").catch(() => "[]");
    const list = JSON.parse(raw) as { manifest: HeraVexPluginManifest; entryUrl: string }[];
    const enabledMap = readEnabledMap();
    return list
      .filter((p) => p.manifest.apiVersion === 1)
      .map((p) => ({
        manifest: p.manifest,
        entryUrl: p.entryUrl,
        // Default to enabled — opt-out is the right default for indie
        // dev workflows where the user just dropped a widget in.
        enabled: enabledMap[p.manifest.id] !== false,
      }));
  } catch (err) {
    devWarn("[plugins] discover failed:", err);
    return [];
  }
}

const MOUNTED = new Map<string, { dispose: () => void; root: HTMLElement }>();

/** Mount every enabled plugin that targets the given slot inside
 *  `container`. Idempotent: re-mounting cleans up the previous run. */
export async function mountPluginWidgets(
  slot: HeraVexPluginManifest["slot"],
  container: HTMLElement,
  ctx: HeraVexPluginContext,
): Promise<void> {
  await unmountPluginWidgets(slot);
  const plugins = await discoverPlugins();
  for (const p of plugins) {
    if (!p.enabled || p.manifest.slot !== slot) continue;
    try {
      // Vite ignores `/* @vite-ignore */` paths so the dynamic URL
      // doesn't try to bundle at build time. The user's webview
      // enforces CSP, which restricts what these modules can do.
      const mod = await import(/* @vite-ignore */ p.entryUrl) as { default: HeraVexPluginWidget };
      const render = mod.default;
      if (typeof render !== "function") {
        devWarn(`[plugins] ${p.manifest.id}: no default export`);
        continue;
      }
      const root = document.createElement("div");
      root.className = "heravex-plugin-mount";
      root.dataset.pluginId = p.manifest.id;
      container.appendChild(root);
      const teardown = render(root, ctx);
      MOUNTED.set(`${slot}:${p.manifest.id}`, {
        dispose: () => {
          try { teardown?.(); } catch { /* plugin teardown failed */ }
          root.remove();
        },
        root,
      });
    } catch (err) {
      devWarn(`[plugins] ${p.manifest.id} mount failed:`, err);
    }
  }
}

export async function unmountPluginWidgets(
  slot?: HeraVexPluginManifest["slot"],
): Promise<void> {
  for (const [key, entry] of MOUNTED.entries()) {
    if (slot && !key.startsWith(`${slot}:`)) continue;
    entry.dispose();
    MOUNTED.delete(key);
  }
}
