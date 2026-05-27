// Klavye kısayolu konfigürasyon altyapısı.
//
// App.tsx 4 ana aksiyon tanımlar (palette/yeni oyun/görevler/notlar). Bu
// modül onları localStorage'da saklanan kullanıcı kombinasyonlarıyla
// eşleştirir. Kombinasyon stringi `keyboard.ts`'in beklediği formatta:
// "k", "shift+k", "force:k" — Ctrl/Cmd modifier'ı implicit (keyboard hook
// modifier zorunlu kılar).

import type { AppLanguage } from "./i18n";

export type ShortcutAction =
  | "openCommandPalette"
  | "newGame"
  | "openTasks"
  | "openNotes";

export type ShortcutDef = {
  action: ShortcutAction;
  /** Combo as passed to useKeyboardShortcuts. */
  combo: string;
  /** When true, fires even while focus is in an input/textarea. */
  force: boolean;
};

const STORAGE_KEY = "heravex_shortcuts_v1";

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, ShortcutDef> = {
  openCommandPalette: { action: "openCommandPalette", combo: "k", force: true },
  newGame:            { action: "newGame",            combo: "n", force: false },
  openTasks:          { action: "openTasks",          combo: "t", force: false },
  openNotes:          { action: "openNotes",          combo: "/", force: false },
};

export function actionLabel(action: ShortcutAction, lang: AppLanguage): string {
  const tr: Record<AppLanguage, Record<ShortcutAction, string>> = {
    tr: {
      openCommandPalette: "Komut paletini aç",
      newGame:            "Yeni oyun oluştur",
      openTasks:          "Görev Merkezi'ne git",
      openNotes:          "Notlar'a git",
    },
    en: {
      openCommandPalette: "Open command palette",
      newGame:            "Create new game",
      openTasks:          "Go to Task Center",
      openNotes:          "Go to Notes",
    },
    fr: {
      openCommandPalette: "Ouvrir la palette de commandes",
      newGame:            "Créer un nouveau jeu",
      openTasks:          "Aller au centre des tâches",
      openNotes:          "Aller aux notes",
    },
    es: {
      openCommandPalette: "Abrir paleta de comandos",
      newGame:            "Crear nuevo juego",
      openTasks:          "Ir al centro de tareas",
      openNotes:          "Ir a Notas",
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
    // Broadcast for live in-app listeners.
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

/** Build the map suitable for useKeyboardShortcuts(). */
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

/** Human-readable rendering of the combo (Ctrl/Cmd prefix added). */
export function formatCombo(combo: string, platformIsMac: boolean): string {
  const mod = platformIsMac ? "⌘" : "Ctrl";
  let rest = combo;
  let shift = false;
  if (rest.startsWith("shift+")) {
    shift = true;
    rest = rest.slice(6);
  }
  const keyName = rest === " " ? "Space" : rest.length === 1 ? rest.toUpperCase() : rest;
  return [mod, shift ? "Shift" : null, keyName].filter(Boolean).join(" + ");
}

export function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPod|iPad/i.test(navigator.platform);
}

/** Capture a keypress into a combo string compatible with useKeyboardShortcuts.
 *  Returns null if the event is a modifier-only or invalid combo. */
export function captureKeyEvent(e: KeyboardEvent): string | null {
  if (e.key === "Control" || e.key === "Meta" || e.key === "Shift" || e.key === "Alt") {
    return null;
  }
  // Modifier (Ctrl/Cmd) is implicit; we record only the rest.
  const key = e.key.toLowerCase();
  if (key.length === 0) return null;
  // Reject Tab/Enter/Escape — these shouldn't be rebound.
  if (["tab", "enter", "escape"].includes(key)) return null;
  return `${e.shiftKey ? "shift+" : ""}${key}`;
}
