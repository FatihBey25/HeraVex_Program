// HeraVex plugin runtime — v0.9.9 (full system).
//
// Design decisions (locked with the user):
//   • In-process, full-privilege execution. Plugins are code the user
//     knowingly installed; a consent screen lists the manifest's
//     permissions before anything is extracted.
//   • Plugins live in the INSTALLATION-GLOBAL dir (<app-data>/plugins),
//     never in the (team-shared) workspace — a teammate must not be able
//     to push executable code onto your machine.
//   • Loading is Blob-based: Rust hands us the entry file's source, we
//     `import()` it via a Blob URL (CSP: `script-src 'self' blob:`).
//     Deterministic on every platform — no asset-protocol CORS quirks.
//     The contract is therefore "one bundled ES module per plugin".
//
// Plugin contract (apiVersion 1):
//   export default function activate(hv) {
//     hv.registerPage("board", (root) => { ...; return () => cleanup; });
//     hv.registerWidget("w1", (root) => {...});
//     hv.registerCommand("run", () => hv.toast("ok"));
//     hv.registerSettings("s1", (root) => {...});
//   }
//   export function deactivate() {}   // optional
//
// Legacy v0.9 widgets (manifest has `slot`, no `contributes`) still
// work: their default export is treated as a dashboard-style widget
// render function.

import { devWarn } from "./devLog";
import { invoke } from "./invokeWrapper";
import { useAppStore, type WorkspaceTab } from "../store";
import { getAllNotes, saveNote } from "./storage";
import {
  addHookFilter, addHookListener, removePluginHooks,
  type HookName, type HookPayloads,
} from "./pluginHooks";
import type { GameRecord, NoteRecord, TaskItem, ExpenseItem } from "../types";

// ── Manifest (what plugin authors write) ────────────────────────────

export type PluginPermission =
  | "readGames" | "readTasks" | "readNotes" | "writeNotes"
  | "readWallet" | "network" | "storage"
  // ── "unlimited power" tier (v0.9.9) — each one is consent-listed ──
  | "dom"     // inject CSS, observe/decorate any existing UI element
  | "hooks"   // intercept core save/delete operations + raw state watch
  | "editor"  // extend the note editor (custom syntax, slash commands)
  | "input";  // global hotkeys + context-menu items

export interface PluginPageContribution { id: string; title: string; icon?: string }
export interface PluginWidgetContribution { id: string; slot: "dashboard" | "sidebar" | "wallet" | "notes" }
export interface PluginCommandContribution { id: string; title: string }
export interface PluginSettingsContribution { id: string; title: string }

export interface HeraVexPluginManifest {
  /** Stable identifier — folder name. lowercase-kebab, 2–64 chars. */
  id: string;
  name: string;
  description?: string;
  version: string;
  author?: string;
  apiVersion: 1;
  /** Entry module relative to the plugin dir. Default "index.js". */
  entry?: string;
  permissions?: PluginPermission[];
  contributes?: {
    pages?: PluginPageContribution[];
    widgets?: PluginWidgetContribution[];
    commands?: PluginCommandContribution[];
    settings?: PluginSettingsContribution[];
  };
  /** Legacy v0.9 single-widget manifest. */
  slot?: "dashboard" | "sidebar" | "wallet" | "notes";
}

// ── Host API handed to `activate` ───────────────────────────────────

/** Render into `root`; return a cleanup fn if you attached listeners. */
export type PluginRender = (root: HTMLElement) => void | (() => void);

export interface PluginTaskView extends TaskItem { gameId: string; gameTitle: string }

export interface PluginSlashCommand {
  id: string;
  label: string;
  hint?: string;
  /** Called when the user picks the entry; `insert` writes HTML at the caret. */
  onSelect: (insert: (html: string) => void) => void;
}

export interface PluginMenuItem {
  id: string;
  title: string;
  /** Show only when the right-click target is inside a match. Omit = everywhere. */
  selector?: string;
  onClick: (ctx: { target: HTMLElement; x: number; y: number }) => void;
}

export interface PluginFetchResponse {
  status: number;
  body: string;
  contentType: string | null;
}

export interface HeraVexAPI {
  readonly apiVersion: 1;
  readonly manifest: HeraVexPluginManifest;
  /** Language code the app currently runs in ("en" | "tr" | "fr" | "es"). */
  readonly language: string;

  registerPage(id: string, render: PluginRender): void;
  registerWidget(id: string, render: PluginRender): void;
  registerCommand(id: string, run: () => void | Promise<void>): void;
  registerSettings(id: string, render: PluginRender): void;

  /** Data access — each getter throws unless the manifest declares the
   *  matching permission. Returned objects are the live store values:
   *  treat them as READ-ONLY. */
  getGames(): ReadonlyArray<GameRecord>;
  getTasks(): ReadonlyArray<PluginTaskView>;
  getNotes(): Promise<ReadonlyArray<NoteRecord>>;
  saveNote(note: NoteRecord): Promise<NoteRecord>;
  getExpenses(): ReadonlyArray<ExpenseItem>;

  toast(message: string, kind?: "info" | "success" | "error" | "warning"): void;
  /** Navigate to a core tab ("dashboard", "tasks", …) or one of THIS
   *  plugin's page ids. */
  navigate(target: string): void;
  /** Re-runs `cb` whenever the app store changes. Returns unsubscribe. */
  subscribe(cb: () => void): () => void;
  /** Listen to a host window event (e.g. "heravex:games-list-changed"). */
  on(event: string, cb: (detail: unknown) => void): () => void;
  /** Emit an event namespaced to this plugin: `heravex:plugin:<id>:<name>`. */
  emit(name: string, detail?: unknown): void;
  /** Per-plugin persistent key-value store (localStorage-backed). */
  storage: {
    get<T = unknown>(key: string): T | null;
    set(key: string, value: unknown): void;
    remove(key: string): void;
  };

  // ── "unlimited power" tier (v0.9.9) ─────────────────────────────

  /** HTTP through the Rust backend — bypasses the webview CSP that
   *  blocks plugin fetch(). Requires "network". */
  fetch(url: string, opts?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<PluginFetchResponse>;

  /** Visual interception. Requires "dom". Every handle is auto-disposed
   *  when the plugin is disabled/uninstalled. */
  dom: {
    /** Inject a stylesheet — full-theme power. Returns dispose. */
    injectStyle(css: string): () => void;
    /** Run `cb` for every current AND future element matching
     *  `selector` (MutationObserver-backed). Decorate, rewire, replace —
     *  the element is yours. Returns dispose. */
    onElement(selector: string, cb: (el: HTMLElement) => void): () => void;
  };

  /** Core-operation interception. Requires "hooks". */
  hooks: {
    /** Transform or block a core operation. Return the (modified)
     *  payload, or null to BLOCK it. */
    filter<K extends HookName>(hook: K, fn: (payload: HookPayloads[K]) => HookPayloads[K] | null | Promise<HookPayloads[K] | null>): () => void;
    /** Notified after the operation completed. */
    on<K extends HookName>(hook: K, fn: (payload: HookPayloads[K]) => void): () => void;
  };

  /** Fine-grained live state observation. Requires "hooks". */
  store: {
    watch<T>(selector: (state: unknown) => T, cb: (next: T, prev: T) => void): () => void;
  };

  /** Note-editor extension. Requires "editor".
   *  NOTE: live-content transforms (custom syntax → widgets) were removed
   *  in the v0.9.9 hardening pass — mutating the contentEditable fought
   *  the save round-trip and could corrupt content. Slash commands are
   *  the safe surface: they insert editable content at the caret. A
   *  proper non-persistent decoration engine may return later. */
  editor: {
    addSlashCommand(cmd: PluginSlashCommand): () => void;
  };

  /** Input channels. Requires "input". */
  menu: {
    /** Add an item to the app-wide right-click menu. */
    register(item: PluginMenuItem): () => void;
  };
  hotkeys: {
    /** e.g. "Ctrl+Shift+K". Skips editable targets unless allowInEditable. */
    register(combo: string, handler: () => void, opts?: { allowInEditable?: boolean }): () => void;
  };
}

// ── Runtime state ───────────────────────────────────────────────────

interface RuntimePlugin {
  manifest: HeraVexPluginManifest;
  dir: string;
  entryPath: string;
  enabled: boolean;
  status: "active" | "disabled" | "error";
  error?: string;
  pages: Map<string, PluginRender>;
  widgets: Map<string, { slot: string; render: PluginRender }>;
  commands: Map<string, { title: string; run: () => void | Promise<void> }>;
  settings: Map<string, { title: string; render: PluginRender }>;
  // ── power-tier registries ──
  /** Every observer/style/listener handle the plugin acquired — run on
   *  teardown so disable/uninstall always leaves the app clean. */
  disposers: Set<() => void>;
  menuItems: PluginMenuItem[];
  slashCommands: PluginSlashCommand[];
  deactivate?: () => void;
  blobUrl?: string;
}

const runtime = new Map<string, RuntimePlugin>();

const ENABLED_KEY = "heravex_plugins_enabled_v1";

function readEnabledMap(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(ENABLED_KEY) || "{}") as Record<string, boolean>;
  } catch { return {}; }
}
function writeEnabledMap(map: Record<string, boolean>) {
  try { localStorage.setItem(ENABLED_KEY, JSON.stringify(map)); } catch { /* quota */ }
}

function notifyChanged() {
  window.dispatchEvent(new CustomEvent("heravex:plugins-changed"));
}

// ── hv factory ──────────────────────────────────────────────────────

const CORE_TABS = new Set([
  "dashboard", "library", "storehub", "tasks", "notes", "flow",
  "calendar", "wallet", "analytics", "profile",
]);

function makeHv(p: RuntimePlugin): HeraVexAPI {
  const perms = new Set(p.manifest.permissions ?? []);
  const need = (perm: PluginPermission) => {
    if (!perms.has(perm)) {
      throw new Error(`[${p.manifest.id}] manifest'te '${perm}' izni tanımlı değil.`);
    }
  };
  const storagePrefix = `heravex_plugin_${p.manifest.id}_`;
  /** Register a cleanup handle on the plugin; the returned disposer is
   *  idempotent and also runs automatically on deactivate. */
  const track = (dispose: () => void): (() => void) => {
    p.disposers.add(dispose);
    return () => {
      if (!p.disposers.has(dispose)) return;
      p.disposers.delete(dispose);
      try { dispose(); } catch { /* plugin */ }
    };
  };

  return {
    apiVersion: 1,
    manifest: p.manifest,
    get language() { return useAppStore.getState().language; },

    registerPage(id, render) {
      p.pages.set(id, render);
    },
    registerWidget(id, render) {
      const decl = p.manifest.contributes?.widgets?.find((w) => w.id === id);
      p.widgets.set(id, { slot: decl?.slot ?? "dashboard", render });
    },
    registerCommand(id, run) {
      const decl = p.manifest.contributes?.commands?.find((c) => c.id === id);
      p.commands.set(id, { title: decl?.title ?? id, run });
    },
    registerSettings(id, render) {
      const decl = p.manifest.contributes?.settings?.find((s) => s.id === id);
      p.settings.set(id, { title: decl?.title ?? p.manifest.name, render });
    },

    getGames() { need("readGames"); return useAppStore.getState().games; },
    getTasks() {
      need("readTasks");
      return useAppStore.getState().games.flatMap((g) =>
        (g.tasks ?? []).map((t) => ({ ...t, gameId: g.id, gameTitle: g.title })),
      );
    },
    async getNotes() { need("readNotes"); return getAllNotes(); },
    async saveNote(note) { need("writeNotes"); return saveNote(note); },
    getExpenses() {
      need("readWallet");
      const s = useAppStore.getState();
      return [...s.games.flatMap((g) => g.expenses ?? []), ...s.globalExpenses];
    },

    toast(message, kind = "info") {
      useAppStore.getState().showToast(String(message), kind);
    },
    navigate(target) {
      const t = String(target);
      if (CORE_TABS.has(t)) {
        useAppStore.getState().setWorkspaceTab(t as WorkspaceTab);
      } else if (p.pages.has(t)) {
        useAppStore.getState().setWorkspaceTab(`plugin:${p.manifest.id}/${t}` as WorkspaceTab);
      } else {
        devWarn(`[plugins] ${p.manifest.id}: navigate hedefi bilinmiyor: ${t}`);
      }
    },
    subscribe(cb) { return useAppStore.subscribe(() => { try { cb(); } catch { /* plugin */ } }); },
    on(event, cb) {
      const handler = (e: Event) => { try { cb((e as CustomEvent).detail); } catch { /* plugin */ } };
      window.addEventListener(event, handler);
      return () => window.removeEventListener(event, handler);
    },
    emit(name, detail) {
      // Namespaced so a plugin can never spoof a core `heravex:*` event.
      window.dispatchEvent(new CustomEvent(`heravex:plugin:${p.manifest.id}:${name}`, { detail }));
    },
    storage: {
      get(key) {
        try {
          const raw = localStorage.getItem(storagePrefix + key);
          return raw == null ? null : JSON.parse(raw);
        } catch { return null; }
      },
      set(key, value) {
        try { localStorage.setItem(storagePrefix + key, JSON.stringify(value)); } catch { /* quota */ }
      },
      remove(key) {
        try { localStorage.removeItem(storagePrefix + key); } catch { /* no-op */ }
      },
    },

    // ── "unlimited power" tier (v0.9.9) ─────────────────────────────

    async fetch(url, opts = {}) {
      need("network");
      return invoke<PluginFetchResponse>("plugin_http_fetch", {
        url: String(url),
        method: opts.method ?? "GET",
        body: opts.body ?? null,
        headers: opts.headers ?? null,
      });
    },

    dom: {
      injectStyle(css) {
        need("dom");
        const el = document.createElement("style");
        el.dataset.hvPlugin = p.manifest.id;
        el.textContent = String(css);
        document.head.appendChild(el);
        return track(() => el.remove());
      },
      onElement(selector, cb) {
        need("dom");
        const seen = new WeakSet<Element>();
        const handle = (el: Element) => {
          if (seen.has(el)) return;
          seen.add(el);
          try { cb(el as HTMLElement); } catch (err) { devWarn(`[plugins] ${p.manifest.id} onElement:`, err); }
        };
        const scan = (root: Element) => {
          if (root.matches?.(selector)) handle(root);
          root.querySelectorAll?.(selector).forEach(handle);
        };
        scan(document.body);
        const obs = new MutationObserver((muts) => {
          for (const m of muts) {
            m.addedNodes.forEach((n) => { if (n.nodeType === Node.ELEMENT_NODE) scan(n as Element); });
          }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        return track(() => obs.disconnect());
      },
    },

    hooks: {
      filter(hook, fn) {
        need("hooks");
        return track(addHookFilter(p.manifest.id, hook, fn));
      },
      on(hook, fn) {
        need("hooks");
        return track(addHookListener(p.manifest.id, hook, fn));
      },
    },

    store: {
      watch(selector, cb) {
        need("hooks"); // raw state access → same consent tier as interception
        let prev = selector(useAppStore.getState());
        const unsub = useAppStore.subscribe((state) => {
          let next;
          try { next = selector(state); } catch { return; }
          if (Object.is(next, prev)) return;
          const old = prev;
          prev = next;
          try { cb(next, old); } catch (err) { devWarn(`[plugins] ${p.manifest.id} watch:`, err); }
        });
        return track(unsub);
      },
    },

    editor: {
      addSlashCommand(cmd) {
        need("editor");
        p.slashCommands.push(cmd);
        return track(() => {
          const i = p.slashCommands.indexOf(cmd);
          if (i >= 0) p.slashCommands.splice(i, 1);
        });
      },
    },

    menu: {
      register(item) {
        need("input");
        p.menuItems.push(item);
        return track(() => {
          const i = p.menuItems.indexOf(item);
          if (i >= 0) p.menuItems.splice(i, 1);
        });
      },
    },

    hotkeys: {
      register(combo, handler, opts = {}) {
        need("input");
        const parts = String(combo).toLowerCase().split("+").map((s) => s.trim()).filter(Boolean);
        const key = parts[parts.length - 1];
        const wantCtrl = parts.includes("ctrl") || parts.includes("mod") || parts.includes("cmd");
        const wantShift = parts.includes("shift");
        const wantAlt = parts.includes("alt");
        const listener = (e: KeyboardEvent) => {
          if ((e.ctrlKey || e.metaKey) !== wantCtrl) return;
          if (e.shiftKey !== wantShift) return;
          if (e.altKey !== wantAlt) return;
          if (e.key.toLowerCase() !== key) return;
          if (!opts.allowInEditable) {
            const t = e.target as HTMLElement | null;
            if (t?.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')) return;
          }
          e.preventDefault();
          try { handler(); } catch (err) { devWarn(`[plugins] ${p.manifest.id} hotkey:`, err); }
        };
        window.addEventListener("keydown", listener);
        return track(() => window.removeEventListener("keydown", listener));
      },
    },
  };
}

// ── Loader ──────────────────────────────────────────────────────────

interface ListedPlugin { manifest: HeraVexPluginManifest; entryPath: string; dir: string }

async function activatePlugin(p: RuntimePlugin): Promise<void> {
  const code = await invoke<string>("read_text_file", { path: p.entryPath });
  const blob = new Blob([code], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  p.blobUrl = url;
  const mod = await import(/* @vite-ignore */ url) as {
    default?: unknown;
    activate?: unknown;
    deactivate?: () => void;
  };

  const isLegacyWidget = !p.manifest.contributes && !!p.manifest.slot;
  if (isLegacyWidget) {
    const render = mod.default;
    if (typeof render !== "function") throw new Error("varsayılan export bir fonksiyon değil");
    p.widgets.set("legacy", { slot: p.manifest.slot!, render: render as PluginRender });
  } else {
    const activate = (typeof mod.default === "function" ? mod.default : mod.activate) as
      | ((hv: HeraVexAPI) => void | (() => void))
      | undefined;
    if (typeof activate !== "function") {
      throw new Error("eklenti bir activate(hv) fonksiyonu export etmiyor");
    }
    const ret = activate(makeHv(p));
    if (typeof ret === "function") p.deactivate = ret;
    else if (typeof mod.deactivate === "function") p.deactivate = mod.deactivate;
  }
  p.status = "active";
}

function teardownPlugin(p: RuntimePlugin) {
  try { p.deactivate?.(); } catch { /* plugin teardown failed */ }
  // Run every tracked handle (observers, styles, hotkeys, watchers…) so
  // a disabled plugin leaves zero residue in the DOM or event system.
  for (const dispose of p.disposers) { try { dispose(); } catch { /* plugin */ } }
  p.disposers.clear();
  removePluginHooks(p.manifest.id);
  p.menuItems.length = 0;
  p.slashCommands.length = 0;
  if (p.blobUrl) { try { URL.revokeObjectURL(p.blobUrl); } catch { /* no-op */ } }
  p.pages.clear(); p.widgets.clear(); p.commands.clear(); p.settings.clear();
  p.deactivate = undefined;
  p.blobUrl = undefined;
}

let initPromise: Promise<void> | null = null;

/** Discover + activate every enabled plugin. Idempotent; call again to
 *  refresh after install/uninstall/toggle. */
export async function initPlugins(): Promise<void> {
  // Serialise concurrent callers onto one pass.
  if (initPromise) return initPromise;
  initPromise = (async () => {
    let listed: ListedPlugin[] = [];
    try {
      listed = await invoke<ListedPlugin[]>("plugins_list");
    } catch (err) {
      devWarn("[plugins] discovery failed:", err);
    }
    const enabledMap = readEnabledMap();
    const seen = new Set<string>();

    for (const item of listed) {
      const id = item.manifest?.id;
      if (!id || item.manifest.apiVersion !== 1) continue;
      seen.add(id);
      const enabled = enabledMap[id] !== false; // opt-out default
      let p = runtime.get(id);
      if (!p) {
        p = {
          manifest: item.manifest, dir: item.dir, entryPath: item.entryPath,
          enabled, status: "disabled",
          pages: new Map(), widgets: new Map(), commands: new Map(), settings: new Map(),
          disposers: new Set(), menuItems: [], slashCommands: [],
        };
        runtime.set(id, p);
      } else {
        teardownPlugin(p);
        p.manifest = item.manifest;
        p.dir = item.dir;
        p.entryPath = item.entryPath;
        p.enabled = enabled;
        p.error = undefined;
      }
      if (!enabled) { p.status = "disabled"; continue; }
      try {
        await activatePlugin(p);
      } catch (err) {
        p.status = "error";
        p.error = String(err instanceof Error ? err.message : err);
        devWarn(`[plugins] ${id} yüklenemedi:`, err);
        window.dispatchEvent(new CustomEvent("heravex:plugin-failed", {
          detail: { id, name: p.manifest.name, error: p.error },
        }));
      }
    }
    // Drop runtimes for plugins that were uninstalled on disk.
    for (const [id, p] of runtime) {
      if (!seen.has(id)) { teardownPlugin(p); runtime.delete(id); }
    }
    notifyChanged();
  })();
  try { await initPromise; } finally { initPromise = null; }
}

export function setPluginEnabled(id: string, enabled: boolean): void {
  const map = readEnabledMap();
  map[id] = enabled;
  writeEnabledMap(map);
  void initPlugins();
}

// ── Queries for the host UI ─────────────────────────────────────────

export interface PluginListItem {
  manifest: HeraVexPluginManifest;
  enabled: boolean;
  status: RuntimePlugin["status"];
  error?: string;
}

export function getPluginList(): PluginListItem[] {
  return Array.from(runtime.values()).map((p) => ({
    manifest: p.manifest, enabled: p.enabled, status: p.status, error: p.error,
  }));
}

export interface PluginPageItem {
  /** WorkspaceTab key: `plugin:<pluginId>/<pageId>` */
  key: string;
  title: string;
  icon?: string;
  pluginId: string;
  pluginName: string;
}

export function getPluginPages(): PluginPageItem[] {
  const out: PluginPageItem[] = [];
  for (const p of runtime.values()) {
    if (p.status !== "active") continue;
    for (const [pageId] of p.pages) {
      const decl = p.manifest.contributes?.pages?.find((x) => x.id === pageId);
      out.push({
        key: `plugin:${p.manifest.id}/${pageId}`,
        title: decl?.title ?? pageId,
        icon: decl?.icon,
        pluginId: p.manifest.id,
        pluginName: p.manifest.name,
      });
    }
  }
  return out;
}

export function getPluginPageRender(key: string): PluginRender | null {
  const m = /^plugin:([^/]+)\/(.+)$/.exec(key);
  if (!m) return null;
  const p = runtime.get(m[1]);
  if (!p || p.status !== "active") return null;
  return p.pages.get(m[2]) ?? null;
}

export interface PluginCommandItem { id: string; label: string; run: () => void | Promise<void> }

export function getPluginCommands(): PluginCommandItem[] {
  const out: PluginCommandItem[] = [];
  for (const p of runtime.values()) {
    if (p.status !== "active") continue;
    for (const [cmdId, cmd] of p.commands) {
      out.push({ id: `${p.manifest.id}:${cmdId}`, label: `${p.manifest.name}: ${cmd.title}`, run: cmd.run });
    }
  }
  return out;
}

export interface PluginSettingsItem { key: string; title: string; pluginName: string; render: PluginRender }

export function getPluginSettingsPanels(): PluginSettingsItem[] {
  const out: PluginSettingsItem[] = [];
  for (const p of runtime.values()) {
    if (p.status !== "active") continue;
    for (const [sid, s] of p.settings) {
      out.push({ key: `${p.manifest.id}:${sid}`, title: s.title, pluginName: p.manifest.name, render: s.render });
    }
  }
  return out;
}

// ── Widget mounting (Dashboard-compatible surface) ──────────────────

const MOUNTED = new Map<string, { dispose: () => void }>();

export async function mountPluginWidgets(
  slot: "dashboard" | "sidebar" | "wallet" | "notes",
  container: HTMLElement,
  _legacyCtx?: unknown,
): Promise<void> {
  await unmountPluginWidgets(slot);
  for (const p of runtime.values()) {
    if (p.status !== "active") continue;
    for (const [wid, w] of p.widgets) {
      if (w.slot !== slot) continue;
      const root = document.createElement("div");
      root.className = "heravex-plugin-mount";
      root.dataset.pluginId = p.manifest.id;
      container.appendChild(root);
      try {
        const teardown = w.render(root);
        MOUNTED.set(`${slot}:${p.manifest.id}:${wid}`, {
          dispose: () => {
            try { (teardown as (() => void) | undefined)?.(); } catch { /* plugin */ }
            root.remove();
          },
        });
      } catch (err) {
        root.remove();
        devWarn(`[plugins] ${p.manifest.id} widget hata:`, err);
      }
    }
  }
}

export async function unmountPluginWidgets(slot?: string): Promise<void> {
  for (const [key, entry] of MOUNTED.entries()) {
    if (slot && !key.startsWith(`${slot}:`)) continue;
    entry.dispose();
    MOUNTED.delete(key);
  }
}

// ── Install / uninstall (Rust-backed, consent-gated) ────────────────

export interface PluginFetchPreview { manifest: HeraVexPluginManifest; staged: string }

/** Stage from a local .zip/.hvx path OR an http(s) URL; returns the
 *  manifest for the consent screen. Nothing is installed yet. */
export async function fetchPluginPreview(source: string): Promise<PluginFetchPreview> {
  return invoke<PluginFetchPreview>("plugin_fetch", { source });
}

export async function confirmPluginInstall(staged: string): Promise<HeraVexPluginManifest> {
  const manifest = await invoke<HeraVexPluginManifest>("plugin_install", { staged });
  await initPlugins();
  return manifest;
}

export async function discardStagedPlugin(staged: string): Promise<void> {
  try { await invoke<void>("plugin_discard", { staged }); } catch { /* best-effort */ }
}

export async function uninstallPlugin(id: string): Promise<void> {
  await invoke<void>("plugin_uninstall", { id });
  await initPlugins();
}

export async function pickPluginArchive(): Promise<string | null> {
  try {
    const path = await invoke<string>("pick_plugin_zip");
    return path && path.trim() ? path : null;
  } catch { return null; } // cancelled
}

// ── Editor extension host (consumed by MarkdownWorkspace) ───────────

export function getPluginSlashCommands(): Array<PluginSlashCommand & { pluginName: string }> {
  const out: Array<PluginSlashCommand & { pluginName: string }> = [];
  for (const p of runtime.values()) {
    if (p.status !== "active") continue;
    for (const cmd of p.slashCommands) out.push({ ...cmd, pluginName: p.manifest.name });
  }
  return out;
}

// ── App-wide plugin context menu (consumed by App.tsx) ──────────────

let ctxMenuEl: HTMLElement | null = null;
function closePluginContextMenu() {
  ctxMenuEl?.remove();
  ctxMenuEl = null;
}

/** Show a menu of every plugin item whose selector matches the
 *  right-click target. Returns false when no item applies (the caller
 *  keeps its plain suppress behaviour). */
export function openPluginContextMenu(e: MouseEvent): boolean {
  closePluginContextMenu();
  const target = e.target as HTMLElement | null;
  if (!target) return false;

  const items: Array<{ title: string; run: () => void }> = [];
  for (const p of runtime.values()) {
    if (p.status !== "active") continue;
    for (const item of p.menuItems) {
      const hit = item.selector ? (target.closest(item.selector) as HTMLElement | null) : target;
      if (!hit) continue;
      items.push({
        title: item.title,
        run: () => {
          try { item.onClick({ target: hit, x: e.clientX, y: e.clientY }); }
          catch (err) { devWarn(`[plugins] ${p.manifest.id} menu item:`, err); }
        },
      });
    }
  }
  if (items.length === 0) return false;

  // Reuse the Flow Center menu styling so plugin menus match the theme.
  const menu = document.createElement("div");
  menu.className = "flow-menu hv-plugin-ctx";
  const top = Math.min(e.clientY, Math.max(8, window.innerHeight - (items.length * 38 + 20)));
  const left = Math.min(e.clientX, Math.max(8, window.innerWidth - 210));
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
  for (const it of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "flow-menu-item";
    btn.textContent = it.title;
    btn.addEventListener("click", () => { closePluginContextMenu(); it.run(); });
    menu.appendChild(btn);
  }
  menu.addEventListener("mousedown", (ev) => ev.stopPropagation());
  document.body.appendChild(menu);
  ctxMenuEl = menu;
  const close = () => { closePluginContextMenu(); window.removeEventListener("mousedown", close); };
  window.setTimeout(() => window.addEventListener("mousedown", close), 0);
  return true;
}
