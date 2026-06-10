// The atomic building block of every Settings page.
//
// A SettingRow is a single horizontal slot: title (+ optional one-line
// description) on the left, a control on the right. Every settings
// page is built out of `SettingGroup` containers stacked vertically,
// each one holding a handful of these rows. No section block, no
// hero icon, no paragraph copy — that's the entire design discipline.
//
// Disabled rows still render at full height with the standard chrome
// so a page never feels uneven; the title dims to convey state.

import React from "react";

interface Props {
  title: React.ReactNode;
  /** Optional one-liner sub-copy. Hard cap of ~80 chars in practice
   *  so the row stays single-line wide. */
  description?: React.ReactNode;
  control?: React.ReactNode;
  /** When true, the row dims and the control is non-interactive. */
  disabled?: boolean;
  /** Small badge slot to the right of the title (e.g. "Coming in 1.0"). */
  badge?: React.ReactNode;
}

export function SettingRow({ title, description, control, disabled = false, badge }: Props) {
  return (
    <div className={`setting-row${disabled ? " is-disabled" : ""}`}>
      <div className="setting-row-text">
        <div className="setting-row-title-line">
          <span className="setting-row-title">{title}</span>
          {badge && <span className="setting-row-badge">{badge}</span>}
        </div>
        {description && <span className="setting-row-desc">{description}</span>}
      </div>
      {control && <div className="setting-row-control">{control}</div>}
    </div>
  );
}
