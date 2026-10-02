// Settings page shell.
//
// v0.9 deep-settings redesign — M1 of 8.
//
// The previous monolithic Profile.tsx (~970 lines of inline section
// JSX, hero avatars, paragraph copy, big-button action grids) is
// replaced by a thin shell that delegates the entire right panel to
// `SettingsPage`, a per-section renderer in `settings/pages.tsx`.
//
// M1 ships placeholder SettingRow scaffolding for every section so
// the new visual discipline (dense, row-based, no hero icons) is
// auditable today. M3-M7 milestones replace placeholders with the
// real controls one section at a time — see the milestone plan in
// the spec.
//
// IMPORTANT: avatar upload, API-key forms, shortcut editor, backup
// buttons, etc. are temporarily unreachable from the UI. On-disk
// data is untouched and returns through the new SettingRow controls
// in upcoming milestones.

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAppStore } from "../../store";
import { SettingsSidebar } from "./settings/SettingsSidebar";
import { SettingsShell } from "./settings/SettingsShell";
import { SettingsPage } from "./settings/pages";
import { SETTINGS_FLAT_ORDER, type SettingsSection } from "./settings/sections";

const LAST_SECTION_KEY = "heravex_settings_last_section_v1";

function readLastSection(): SettingsSection {
  try {
    const raw = localStorage.getItem(LAST_SECTION_KEY);
    if (raw && (SETTINGS_FLAT_ORDER as string[]).includes(raw)) {
      return raw as SettingsSection;
    }
  } catch { /* swallow */ }
  return "profile";
}

export function Profile({ onOpenLanguage: _onOpenLanguage }: { onOpenLanguage: () => void }) {
  // `_onOpenLanguage` is currently unused — language picker lives on
  // the General page placeholder until M3 wires the real dropdown.
  const { ui } = useAppStore();

  // Restore the last section the user was on so re-entering Settings
  // drops them back where they left off instead of always landing on
  // "profile". The value is persisted on every change in the effect
  // below.
  const [activeSection, setActiveSection] = useState<SettingsSection>(readLastSection);
  useEffect(() => {
    try { localStorage.setItem(LAST_SECTION_KEY, activeSection); } catch { /* quota */ }
  }, [activeSection]);
  // A settings page can send the user to another section.
  useEffect(() => {
    const go = (e: Event) => {
      const s = (e as CustomEvent<SettingsSection>).detail;
      if ((SETTINGS_FLAT_ORDER as string[]).includes(s)) setActiveSection(s);
    };
    window.addEventListener("heravex:settings-go", go);
    return () => window.removeEventListener("heravex:settings-go", go);
  }, []);

  return (
    <motion.div
      className="page-fade profile-wrapper"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="profile-backdrop" aria-hidden="true">
        <div className="profile-backdrop-orb profile-backdrop-orb-1" />
        <div className="profile-backdrop-orb profile-backdrop-orb-2" />
        <div className="profile-backdrop-orb profile-backdrop-orb-3" />
      </div>

      <header className="settings-page-header">
        <h1>{ui.settingsPageTitle}</h1>
      </header>

      <div className="settings-layout">
        <SettingsSidebar active={activeSection} onSelect={setActiveSection} />

        <SettingsShell
          active={activeSection}
          onJumpTo={setActiveSection}
        >
          <SettingsPage section={activeSection} />
        </SettingsShell>
      </div>
    </motion.div>
  );
}
