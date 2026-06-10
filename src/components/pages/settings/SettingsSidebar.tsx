// Grouped sidebar for the v0.9.x deep Settings.
//
// Items are rendered under six visual groups (USER / APPEARANCE /
// BEHAVIOR / DATA / CONNECTIONS / SYSTEM). The flat order in
// `SETTINGS_FLAT_ORDER` is the canonical arrow-key traversal order —
// group separators are visual chrome only, they don't break the
// rotation. Items flagged `comingSoon` still render and are
// selectable; the content side decides what to show.

import { useRef } from "react";
import { useAppStore } from "../../../store";
import {
  SETTINGS_GROUPS,
  SETTINGS_ITEMS,
  SETTINGS_FLAT_ORDER,
  type SettingsSection,
} from "./sections";

interface Props {
  active: SettingsSection;
  onSelect: (id: SettingsSection) => void;
}

export function SettingsSidebar({ active, onSelect }: Props) {
  const { ui } = useAppStore();
  const buttonsRef = useRef<Record<SettingsSection, HTMLButtonElement | null>>({} as Record<SettingsSection, HTMLButtonElement | null>);

  const onKeyDown = (id: SettingsSection) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const dir = e.key === "ArrowDown" ? 1 : -1;
    const idx = SETTINGS_FLAT_ORDER.indexOf(id);
    const next = SETTINGS_FLAT_ORDER[
      (idx + dir + SETTINGS_FLAT_ORDER.length) % SETTINGS_FLAT_ORDER.length
    ];
    onSelect(next);
    buttonsRef.current[next]?.focus();
  };

  return (
    <aside className="settings-sidebar" aria-label={ui.settingsNavLabel}>
      <p className="settings-sidebar-eyebrow">{ui.settingsNavLabel}</p>
      <nav role="tablist" aria-orientation="vertical">
        {SETTINGS_GROUPS.map((group) => {
          const itemsInGroup = SETTINGS_ITEMS.filter((it) => it.group === group.id);
          if (itemsInGroup.length === 0) return null;
          return (
            <div key={group.id} className="settings-sidebar-group">
              <p className="settings-sidebar-group-label">{ui[group.labelKey]}</p>
              {itemsInGroup.map((item) => {
                const Icon = item.icon;
                const isActive = active === item.id;
                return (
                  <button
                    key={item.id}
                    ref={(el) => { buttonsRef.current[item.id] = el; }}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    className={`settings-sidebar-item${isActive ? " is-active" : ""}`}
                    onClick={() => onSelect(item.id)}
                    onKeyDown={onKeyDown(item.id)}
                  >
                    <Icon size={15} strokeWidth={2} />
                    <span>{ui[item.labelKey]}</span>
                    {item.comingSoon && (
                      <span className="settings-sidebar-soon" title={ui.settingsComingSoonBadge}>
                        {/* tiny dot indicator; text reserved for the page header */}
                        •
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
