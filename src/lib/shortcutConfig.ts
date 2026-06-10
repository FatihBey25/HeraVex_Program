// Keyboard shortcut config — v0.9 M3 expansion (4 → 16 actions).
//
// Every action's combo is user-rebindable from Settings → Keyboard.
// Ctrl/Cmd is implicit (the keyboard hook enforces a modifier); the
// combo string carries only the optional `shift+` prefix and the
// final key. `force:` prefix means the shortcut fires even while
// focus sits in an input/textarea — reserve that for truly global
// actions (command palette, quick search, toggle pomodoro).
//
// localStorage shape stays `Record<ShortcutAction, ShortcutDef>` —
// loadShortcuts merges saved entries with the defaults so adding a
// new action in this file never breaks existing users (they pick up
// the default until they rebind).

import type { AppLanguage } from "./i18n";

export type ShortcutAction =
  // ── Navigation (10)
  | "openCommandPalette"
  | "quickSearch"
  | "openDashboard"
  | "openLibrary"
  | "openStoreHub"
  | "openTasks"
  | "openNotes"
  | "openWallet"
  | "openAnalytics"
  | "openSettings"
  // ── Create (3)
  | "newGame"
  | "newTask"
  | "newNote"
  // ── Actions (3)
  | "togglePomodoro"
  | "quickBackup"
  | "switchGame";

export type ShortcutDef = {
  action: ShortcutAction;
  combo: string;
  force: boolean;
};

const STORAGE_KEY = "heravex_shortcuts_v1";

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, ShortcutDef> = {
  // Navigation
  openCommandPalette: { action: "openCommandPalette", combo: "k",       force: true  },
  quickSearch:        { action: "quickSearch",        combo: "f",       force: true  },
  openDashboard:      { action: "openDashboard",      combo: "1",       force: false },
  openLibrary:        { action: "openLibrary",        combo: "2",       force: false },
  openStoreHub:       { action: "openStoreHub",       combo: "3",       force: false },
  openTasks:          { action: "openTasks",          combo: "t",       force: false },
  openNotes:          { action: "openNotes",          combo: "/",       force: false },
  openWallet:         { action: "openWallet",         combo: "4",       force: false },
  openAnalytics:      { action: "openAnalytics",      combo: "5",       force: false },
  openSettings:       { action: "openSettings",       combo: ",",       force: false },
  // Create
  newGame:            { action: "newGame",            combo: "n",       force: false },
  newTask:            { action: "newTask",            combo: "shift+t", force: false },
  newNote:            { action: "newNote",            combo: "shift+n", force: false },
  // Actions
  togglePomodoro:     { action: "togglePomodoro",     combo: " ",       force: true  },
  quickBackup:        { action: "quickBackup",        combo: "shift+b", force: false },
  switchGame:         { action: "switchGame",         combo: "g",       force: false },
};

/** Logical groups for the Keyboard settings page. Used purely by the
 *  rendering side; runtime never iterates this. */
export const SHORTCUT_GROUPS: { id: "navigation" | "create" | "actions"; ids: ShortcutAction[] }[] = [
  {
    id: "navigation",
    ids: [
      "openCommandPalette", "quickSearch",
      "openDashboard", "openLibrary", "openStoreHub",
      "openTasks", "openNotes",
      "openWallet", "openAnalytics", "openSettings",
    ],
  },
  { id: "create",  ids: ["newGame", "newTask", "newNote"] },
  { id: "actions", ids: ["togglePomodoro", "quickBackup", "switchGame"] },
];

export function actionLabel(action: ShortcutAction, lang: AppLanguage): string {
  const tr: Record<AppLanguage, Record<ShortcutAction, string>> = {
    tr: {
      openCommandPalette: "Komut paletini aç",
      quickSearch:        "Hızlı arama",
      openDashboard:      "Dashboard",
      openLibrary:        "Kütüphane",
      openStoreHub:       "Mağaza Merkezi",
      openTasks:          "Görev Merkezi",
      openNotes:          "Notlar",
      openWallet:         "Cüzdan",
      openAnalytics:      "Analitik",
      openSettings:       "Ayarlar",
      newGame:            "Yeni oyun",
      newTask:            "Yeni görev",
      newNote:            "Yeni not",
      togglePomodoro:     "Pomodoro başlat/durdur",
      quickBackup:        "Hızlı yedek",
      switchGame:         "Şu anki oyunu değiştir",
    },
    en: {
      openCommandPalette: "Open command palette",
      quickSearch:        "Quick search",
      openDashboard:      "Dashboard",
      openLibrary:        "Library",
      openStoreHub:       "Store Hub",
      openTasks:          "Task Center",
      openNotes:          "Notes",
      openWallet:         "Wallet",
      openAnalytics:      "Analytics",
      openSettings:       "Settings",
      newGame:            "New game",
      newTask:            "New task",
      newNote:            "New note",
      togglePomodoro:     "Toggle Pomodoro",
      quickBackup:        "Quick backup",
      switchGame:         "Switch current game",
    },
    fr: {
      openCommandPalette: "Ouvrir la palette de commandes",
      quickSearch:        "Recherche rapide",
      openDashboard:      "Tableau de bord",
      openLibrary:        "Bibliothèque",
      openStoreHub:       "Hub Boutiques",
      openTasks:          "Centre des tâches",
      openNotes:          "Notes",
      openWallet:         "Budget",
      openAnalytics:      "Analytique",
      openSettings:       "Paramètres",
      newGame:            "Nouveau jeu",
      newTask:            "Nouvelle tâche",
      newNote:            "Nouvelle note",
      togglePomodoro:     "Lancer / arrêter Pomodoro",
      quickBackup:        "Sauvegarde rapide",
      switchGame:         "Changer de jeu actif",
    },
    es: {
      openCommandPalette: "Abrir paleta de comandos",
      quickSearch:        "Búsqueda rápida",
      openDashboard:      "Panel",
      openLibrary:        "Biblioteca",
      openStoreHub:       "Centro de Tiendas",
      openTasks:          "Centro de Tareas",
      openNotes:          "Notas",
      openWallet:         "Cartera",
      openAnalytics:      "Analítica",
      openSettings:       "Ajustes",
      newGame:            "Nuevo juego",
      newTask:            "Nueva tarea",
      newNote:            "Nueva nota",
      togglePomodoro:     "Alternar Pomodoro",
      quickBackup:        "Copia rápida",
      switchGame:         "Cambiar juego activo",
    },
  };
  return tr[lang][action];
}

export function loadShortcuts(): Record<ShortcutAction, ShortcutDef> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SHORTCUTS };
    const parsed = JSON.parse(raw) as Partial<Record<ShortcutAction, ShortcutDef>>;
    const merged = { ...DEFAULT_SHORTCUTS };
    for (const k of Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]) {
      const v = parsed[k];
      if (v && typeof v.combo === "string") {
        merged[k] = {
          action: k,
          combo: v.combo,
          force: typeof v.force === "boolean" ? v.force : DEFAULT_SHORTCUTS[k].force,
        };
      }
    }
    return merged;
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}

export function saveShortcuts(map: Record<ShortcutAction, ShortcutDef>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent("heravex:shortcuts-updated"));
  } catch {
    /* localStorage disabled — silently fall back to defaults */
  }
}

export function resetShortcuts(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("heravex:shortcuts-updated"));
  } catch {}
}

/** Detect duplicate combos across the map. Returns a Set of actions
 *  whose combo collides with at least one other. Empty Set means no
 *  conflicts. */
export function findShortcutConflicts(
  defs: Record<ShortcutAction, ShortcutDef>,
): Set<ShortcutAction> {
  const byCombo = new Map<string, ShortcutAction[]>();
  for (const def of Object.values(defs)) {
    const key = `${def.force ? "f:" : ""}${def.combo}`;
    const list = byCombo.get(key) ?? [];
    list.push(def.action);
    byCombo.set(key, list);
  }
  const conflicts = new Set<ShortcutAction>();
  for (const list of byCombo.values()) {
    if (list.length > 1) list.forEach((a) => conflicts.add(a));
  }
  return conflicts;
}

export function buildShortcutMap(
  defs: Record<ShortcutAction, ShortcutDef>,
  handlers: Record<ShortcutAction, () => void>,
): Record<string, () => void> {
  const out: Record<string, () => void> = {};
  for (const def of Object.values(defs)) {
    const key = def.force ? `force:${def.combo}` : def.combo;
    out[key] = handlers[def.action];
  }
  return out;
}

export function formatCombo(combo: string, platformIsMac: boolean): string {
  const mod = platformIsMac ? "⌘" : "Ctrl";
  let rest = combo;
  let shift = false;
  if (rest.startsWith("shift+")) {
    shift = true;
    rest = rest.slice(6);
  }
  const keyName =
    rest === " " ? "Space" :
    rest === "/" ? "/" :
    rest === "," ? "," :
    rest.length === 1 ? rest.toUpperCase() :
    rest;
  return [mod, shift ? "Shift" : null, keyName].filter(Boolean).join(" + ");
}

export function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPod|iPad/i.test(navigator.platform);
}

export function captureKeyEvent(e: KeyboardEvent): string | null {
  if (e.key === "Control" || e.key === "Meta" || e.key === "Shift" || e.key === "Alt") {
    return null;
  }
  const key = e.key.toLowerCase();
  if (key.length === 0) return null;
  if (["tab", "enter", "escape"].includes(key)) return null;
  return `${e.shiftKey ? "shift+" : ""}${key}`;
}

/** Export the current map as a downloadable JSON string. Used by the
 *  Keyboard settings page's "Export shortcuts" row. */
export function exportShortcutsJson(defs: Record<ShortcutAction, ShortcutDef>): string {
  return JSON.stringify({ version: 1, shortcuts: defs }, null, 2);
}
