// HeraVex Plugin SDK — type declarations (apiVersion 1).
//
// Usage (TypeScript):
//   /// <reference path="./heravex-plugin.d.ts" />
//   export default function activate(hv: HeraVexAPI) { ... }
//
// Ship your plugin as ONE bundled ES module (index.js) next to a
// heravex.plugin.json manifest, zipped together. See README.md.

export type PluginPermission =
  | "readGames"   // hv.getGames()
  | "readTasks"   // hv.getTasks()
  | "readNotes"   // hv.getNotes()
  | "writeNotes"  // hv.saveNote()
  | "readWallet"  // hv.getExpenses()
  | "network"     // hv.fetch() — HTTP through the Rust backend
  | "storage"     // hv.storage.*
  // ── power tier ──
  | "dom"         // hv.dom.* + hv.themes.* — inject CSS, observe/decorate UI, register themes
  | "hooks"       // hv.hooks.* + hv.store.watch — intercept core operations
  | "editor"      // hv.editor.* — custom syntax, slash commands
  | "input";      // hv.menu.* + hv.hotkeys.* — context menus, hotkeys

export interface HeraVexPluginManifest {
  /** lowercase-kebab, 2–64 chars. Also the install folder name. */
  id: string;
  name: string;
  description?: string;
  /** SemVer. */
  version: string;
  author?: string;
  apiVersion: 1;
  /** Entry module relative to the plugin folder. Default: "index.js". */
  entry?: string;
  permissions?: PluginPermission[];
  contributes?: {
    /** Full pages — each appears in the sidebar under PLUGINS. */
    pages?: { id: string; title: string; icon?: string }[];
    /** Small components mounted into host slots. */
    widgets?: { id: string; slot: "dashboard" | "sidebar" | "wallet" | "notes" }[];
    /** Command-palette entries. */
    commands?: { id: string; title: string }[];
    /** Panels shown in Settings → Plugins. */
    settings?: { id: string; title: string }[];
  };
}

/** Render into `root` with plain DOM; return a cleanup function if you
 *  attached listeners or timers. */
export type PluginRender = (root: HTMLElement) => void | (() => void);

export interface PluginGame {
  id: string; title: string; summary: string; status: string;
  platforms: string[]; tags: string[]; updatedAt: string;
  tasks: PluginTask[];
  [key: string]: unknown;
}
export interface PluginTask {
  id: string; title: string; description: string; done: boolean;
  priority: 1 | 2 | 3; dueDate?: string;
  [key: string]: unknown;
}
export interface PluginTaskView extends PluginTask { gameId: string; gameTitle: string }
export interface PluginNote {
  id: string; title: string; content: string; updatedAt: string;
  [key: string]: unknown;
}
export interface PluginExpense {
  id: string; title: string; amount: number; category: string; spentAt: string;
  [key: string]: unknown;
}

export interface HeraVexAPI {
  readonly apiVersion: 1;
  readonly manifest: HeraVexPluginManifest;
  /** Active UI language: "en" | "tr" | "fr" | "es". */
  readonly language: string;

  /** Register the render function for a page declared in the manifest. */
  registerPage(id: string, render: PluginRender): void;
  registerWidget(id: string, render: PluginRender): void;
  registerCommand(id: string, run: () => void | Promise<void>): void;
  registerSettings(id: string, render: PluginRender): void;

  /** Requires "readGames". Returned objects are live — treat READ-ONLY. */
  getGames(): ReadonlyArray<PluginGame>;
  /** Requires "readTasks". */
  getTasks(): ReadonlyArray<PluginTaskView>;
  /** Requires "readNotes". */
  getNotes(): Promise<ReadonlyArray<PluginNote>>;
  /** Requires "writeNotes". Pass `id: ""` to create a new note. */
  saveNote(note: PluginNote): Promise<PluginNote>;
  /** Requires "readWallet". Project + studio-wide expenses combined. */
  getExpenses(): ReadonlyArray<PluginExpense>;

  toast(message: string, kind?: "info" | "success" | "error" | "warning"): void;
  /** Core tab name ("dashboard", "tasks", …) or one of YOUR page ids. */
  navigate(target: string): void;
  /** Fires on any app-store change. Returns unsubscribe. */
  subscribe(cb: () => void): () => void;
  /** Listen to host events, e.g. "heravex:games-list-changed". */
  on(event: string, cb: (detail: unknown) => void): () => void;
  /** Dispatches `heravex:plugin:<yourId>:<name>`. */
  emit(name: string, detail?: unknown): void;
  /** Per-plugin persistent key-value storage. */
  storage: {
    get<T = unknown>(key: string): T | null;
    set(key: string, value: unknown): void;
    remove(key: string): void;
  };

  // ── power tier (apiVersion 1, v0.9.9+) ────────────────────────────
  // Every register/inject call returns a dispose function AND is
  // auto-disposed when your plugin is disabled or uninstalled.

  /** HTTP through the Rust backend (the webview CSP blocks plain
   *  fetch() to arbitrary hosts). Requires "network". */
  fetch(url: string, opts?: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
    body?: string;
    headers?: Record<string, string>;
  }): Promise<{ status: number; body: string; contentType: string | null }>;

  /** Visual interception — requires "dom". */
  dom: {
    /** Inject a stylesheet. Full-theme power: any selector, any rule. */
    injectStyle(css: string): () => void;
    /** Runs `cb` for every current AND future element matching
     *  `selector` (MutationObserver-backed).
     *  ⚠️ NEVER append into / remove children from React-owned nodes —
     *  it can crash the app (removeChild). Use `mountToSlot` instead. */
    onElement(selector: string, cb: (el: HTMLElement) => void): () => void;
    /** SAFE injection point (v0.9.9). Append `el` into one of the core's
     *  stable `data-hv-slot` mounts. React never renders children there,
     *  so appending never crashes reconciliation; re-mounted if the slot
     *  remounts; removed on dispose. Known slots:
     *    "sidebar-nav-end" · "dashboard-top" */
    mountToSlot(slot: string, el: HTMLElement): () => void;
  };

  /** Register a custom app theme — requires "dom". The core renders it as
   *  a native pill in Settings → Appearance → Theme and owns
   *  apply/persist/revert. This is the crash-proof way to theme the app
   *  (do NOT try to inject into Settings via onElement). */
  themes: {
    register(theme: { id: string; label: string; css: string }): () => void;
  };

  /** Core-operation interception — requires "hooks".
   *  Hooks: "game:beforeSave" | "game:afterSave" | "game:beforeDelete" |
   *  "game:afterDelete" | "note:beforeSave" | "note:afterSave" |
   *  "note:beforeDelete" | "note:afterDelete".
   *  before* payload: the record (delete hooks get the id string).
   *  Filters may return a MODIFIED payload, or null to BLOCK. */
  hooks: {
    filter(hook: string, fn: (payload: unknown) => unknown | null | Promise<unknown | null>): () => void;
    on(hook: string, fn: (payload: unknown) => void): () => void;
  };

  /** Live fine-grained state observation — requires "hooks". */
  store: {
    watch<T>(selector: (state: unknown) => T, cb: (next: T, prev: T) => void): () => void;
  };

  /** Note-editor extension — requires "editor".
   *  Slash commands are the safe surface: they insert normal, editable
   *  content at the caret. (Live-content syntax transforms were removed
   *  in the v0.9.9 hardening pass — mutating the contentEditable fought
   *  the save round-trip and could corrupt notes.) */
  editor: {
    /** Add an entry to the editor's "/" menu. `insert` writes HTML at
     *  the caret — it becomes normal, user-editable note content. */
    addSlashCommand(cmd: {
      id: string;
      label: string;
      hint?: string;
      onSelect: (insert: (html: string) => void) => void;
    }): () => void;
  };

  /** App-wide right-click menu — requires "input". */
  menu: {
    register(item: {
      id: string;
      title: string;
      /** Only show when the click target is inside a match. Omit = everywhere. */
      selector?: string;
      onClick: (ctx: { target: HTMLElement; x: number; y: number }) => void;
    }): () => void;
  };

  /** Global hotkeys — requires "input". Combo e.g. "Ctrl+Shift+K". */
  hotkeys: {
    register(combo: string, handler: () => void, opts?: { allowInEditable?: boolean }): () => void;
  };
}

/** Your entry module's default export. Optionally return a cleanup
 *  function (or export a separate `deactivate`). */
export type PluginActivate = (hv: HeraVexAPI) => void | (() => void);
