// Shell chrome around the active settings section.
//
// Layout:
//   ┌──────────────────────────────────────────┐
//   │ breadcrumb           [search-input]      │  ← header (search now lives here)
//   ├──────────────────────────────────────────┤
//   │ Section title / subtitle                 │
//   │                                          │
//   │ <SettingsPage section={active} />        │  ← scrollable body
//   │                                          │
//   └──────────────────────────────────────────┘
//
// Search now matches across:
//   - the section's nav label
//   - the section's subtitle copy
//   - the section's group label
//   - and a curated keyword index per section so common terms
//     ("password", "theme", "delete data") land on the right page
//     even when the localised label doesn't include them.

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useAppStore } from "../../../store";
import { SETTINGS_GROUPS, SETTINGS_ITEMS, type SettingsSection } from "./sections";

interface Props {
  active: SettingsSection;
  /** Section-aware deep-link for the settings search jump. */
  onJumpTo: (id: SettingsSection) => void;
  children: React.ReactNode;
}

/** Curated keyword hints per section. Strings here are language-neutral
 *  and matched substring-style — adding both TR and EN forms means the
 *  same query lands in both locales. Keep entries short and on-topic. */
const SECTION_KEYWORDS: Record<SettingsSection, string[]> = {
  profile:       ["avatar", "name", "bio", "isim", "biyografi", "rol", "role", "engine", "social", "twitter", "github", "discord"],
  studio:        ["studio", "stüdyo", "legal", "tax", "brand", "logo", "marka", "press", "email"],
  notifications: ["notification", "bildirim", "sound", "ses", "alert", "pomodoro", "deadline"],
  theme:         ["theme", "tema", "color", "renk", "accent", "background", "arkaplan", "dark", "light", "midnight"],
  typography:    ["font", "yazı", "size", "letter", "harf", "tabular"],
  layout:        ["density", "yoğunluk", "padding", "spacing", "radius", "animation", "animasyon", "sidebar", "dashboard"],
  general:       ["language", "dil", "locale", "currency", "para", "date", "tarih", "time", "saat", "format"],
  startup:       ["startup", "launch", "açılış", "tutorial", "window", "pencere", "tray"],
  keyboard:      ["shortcut", "kısayol", "hotkey", "key"],
  pomodoro:      ["pomodoro", "timer", "focus", "break", "odak", "mola"],
  storage:       ["storage", "depolama", "data folder", "veri klasörü", "workspace", "size", "boyut"],
  backup:        ["backup", "yedek", "schedule", "restore"],
  importExport:  ["import", "export", "içe", "dışa", "json"],
  apiKeys:       ["api", "token", "key", "anahtar", "steam", "itch", "google"],
  teamMode:      ["team", "ekip", "sync", "senkron", "watcher", "conflict", "merge"],
  webhooks:      ["webhook", "discord", "github"],
  privacy:       ["privacy", "gizlilik", "screenshot", "lock", "auto-lock"],
  experimental:  ["experimental", "deneysel", "beta", "log"],
  about:         ["about", "version", "sürüm", "release", "license", "feedback"],
};

export function SettingsShell({
  active,
  onJumpTo,
  children,
}: Props) {
  const { ui, language } = useAppStore();
  const [query, setQuery] = useState("");

  const activeItem = SETTINGS_ITEMS.find((i) => i.id === active);
  const activeLabel = activeItem ? ui[activeItem.labelKey] : "";
  const activeSubtitle = activeItem ? ui[activeItem.subtitleKey] : "";

  const suggestions = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(language);
    if (!q) return [];
    return SETTINGS_ITEMS
      .filter((it) => {
        // Aggregate every searchable surface for the section.
        const label    = String(ui[it.labelKey] ?? "");
        const subtitle = String(ui[it.subtitleKey] ?? "");
        const group    = String(ui[SETTINGS_GROUPS.find((g) => g.id === it.group)?.labelKey ?? "settingsGroupUser"] ?? "");
        const keywords = SECTION_KEYWORDS[it.id]?.join(" ") ?? "";
        const hay = `${label} ${subtitle} ${group} ${keywords}`.toLocaleLowerCase(language);
        return hay.includes(q);
      })
      .slice(0, 8);
  }, [query, ui, language]);

  return (
    <div className="settings-shell">
      <header className="settings-shell-header">
        <nav className="settings-breadcrumb" aria-label="Breadcrumb">
          <span>{ui.settingsBreadcrumbRoot}</span>
          <span className="settings-breadcrumb-sep">›</span>
          <span className="settings-breadcrumb-leaf">{activeLabel}</span>
        </nav>
        <div className="settings-shell-search-top">
          <div className="settings-search-input">
            <Search size={13} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={ui.settingsSearchPlaceholder}
              aria-label={ui.settingsSearchPlaceholder}
              onKeyDown={(e) => {
                if (e.key === "Enter" && suggestions[0]) {
                  onJumpTo(suggestions[0].id);
                  setQuery("");
                }
                if (e.key === "Escape") setQuery("");
              }}
            />
          </div>
          {suggestions.length > 0 && (
            <div className="settings-search-suggestions">
              {suggestions.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="settings-search-suggestion"
                    onClick={() => {
                      onJumpTo(s.id);
                      setQuery("");
                    }}
                  >
                    <Icon size={12} strokeWidth={2} />
                    <span>{ui[s.labelKey]}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </header>

      <header className="settings-section-header">
        <h2 className="settings-section-title">{activeLabel}</h2>
        {activeSubtitle && <p className="settings-section-subtitle">{activeSubtitle}</p>}
      </header>

      <div className="settings-shell-body">
        {children}
      </div>
    </div>
  );
}
