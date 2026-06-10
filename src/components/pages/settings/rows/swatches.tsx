// Tiny colour-picker primitives shared by Theme + Studio Identity pages.
//
// A `ColorSwatch` is a 18×18 dot the user clicks to apply a preset.
// `AccentSwatchGrid` wraps 8 of them plus a small HEX input so the
// user can either pick a curated value or type their own. Custom
// values are validated permissively — anything matching `#RGB` or
// `#RRGGBB` is accepted; the row falls back to the previous value
// on parse failure (no UI error toast — silent rejection keeps the
// preview chip honest).

import { useState, useEffect } from "react";

interface SwatchProps {
  value: string;
  selected: boolean;
  onClick: () => void;
  label?: string;
}

export function ColorSwatch({ value, selected, onClick, label }: SwatchProps) {
  return (
    <button
      type="button"
      className={`color-swatch${selected ? " is-selected" : ""}`}
      style={{ background: value }}
      onClick={onClick}
      aria-label={label}
      title={label ?? value}
    />
  );
}

interface AccentSwatchGridProps {
  presets: { id: string; value: string; label?: string }[];
  current: string;
  onChange: (next: string) => void;
}

export function AccentSwatchGrid({ presets, current, onChange }: AccentSwatchGridProps) {
  // Local draft for the HEX text input so the user can type without
  // every keystroke roundtripping through the store. We commit on
  // blur (and on Enter) once the value is a syntactically valid hex.
  const [draft, setDraft] = useState(current);

  useEffect(() => { setDraft(current); }, [current]);

  const commit = () => {
    const v = draft.trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) {
      // Normalise to 6-char so downstream alpha math stays cheap.
      const six = v.length === 4
        ? "#" + v.slice(1).split("").map((c) => c + c).join("")
        : v;
      if (six.toLowerCase() !== current.toLowerCase()) onChange(six);
    } else {
      setDraft(current); // bad input → revert
    }
  };

  const isPreset = presets.some((p) => p.value.toLowerCase() === current.toLowerCase());

  return (
    <div className="accent-swatch-grid">
      {presets.map((p) => (
        <ColorSwatch
          key={p.id}
          value={p.value}
          selected={current.toLowerCase() === p.value.toLowerCase()}
          onClick={() => onChange(p.value)}
          label={p.label}
        />
      ))}
      <div className={`accent-swatch-custom${!isPreset ? " is-active" : ""}`}>
        <span
          className="accent-swatch-custom-preview"
          style={{ background: current }}
          aria-hidden="true"
        />
        <input
          type="text"
          className="accent-swatch-custom-input"
          value={draft}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label="Custom HEX"
        />
      </div>
    </div>
  );
}

/** Smaller color picker used in status colors / brand colours. Renders
 *  a clickable dot that opens a native `<input type="color">` —
 *  cross-platform, no third-party picker. */
export function ColorDot({
  value, onChange, label,
}: { value: string; onChange: (next: string) => void; label?: string }) {
  return (
    <label className="color-dot-wrap" title={label}>
      <span className="color-dot" style={{ background: value }} />
      <input
        type="color"
        className="color-dot-native"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      />
    </label>
  );
}
