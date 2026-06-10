// A titled stack of SettingRows. The label is rendered as the
// canonical 11px UPPERCASE letter-spaced section header (matches
// macOS / Linear / VS Code Settings conventions).
//
// Groups stack vertically with 28px between them; the rows inside a
// group stack with 8px gap. That ratio is what gives the page its
// "dense but breathable" cadence — squashing either number breaks
// the rhythm.

import React from "react";

interface Props {
  label: React.ReactNode;
  /** Rare: when a group needs a 1-line subtitle under its header
   *  (e.g. "These apply to every game"). Use sparingly. */
  hint?: React.ReactNode;
  children: React.ReactNode;
}

export function SettingGroup({ label, hint, children }: Props) {
  return (
    <section className="setting-group">
      <header className="setting-group-header">
        <span className="setting-group-label">{label}</span>
        {hint && <span className="setting-group-hint">{hint}</span>}
      </header>
      <div className="setting-group-rows">{children}</div>
    </section>
  );
}
