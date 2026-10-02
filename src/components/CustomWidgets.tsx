// Settings → Experimental → "Custom dashboard widgets" (v0.9.9 beta).
//
// The user's own Dashboard panels, rendered in the same grid and with the
// same panel chrome as the built-in ones:
//   note      — a pinned piece of text (goals, a reminder, a checklist)
//   countdown — days left until a date (launch, festival, deadline)
//   links     — quick links (store page, Discord, docs...)
// Data lives in the experimental slice (`customWidgets`).

import { CalendarClock, Link2, StickyNote } from "lucide-react";
import { motion } from "framer-motion";
import type { CSSProperties } from "react";
import { openExternal } from "../lib/storage";
import type { CustomWidget } from "../lib/privacyExperimental";

const ICON = { note: StickyNote, countdown: CalendarClock, links: Link2 } as const;
const ACCENT = { note: "#facc15", countdown: "#f472b6", links: "#22d3ee" } as const;

/** Whole days from today (local) to `iso` (YYYY-MM-DD); negative = past. */
export function daysUntil(iso: string, today = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

/** `Label | https://url` per line → links. Lines without a URL are skipped. */
export function parseLinks(text: string): { label: string; url: string }[] {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const [a, b] = line.includes("|") ? line.split("|") : ["", line];
      const url = (b ?? "").trim();
      if (!/^https?:\/\//i.test(url)) return null;
      return { label: a.trim() || url.replace(/^https?:\/\//i, ""), url };
    })
    .filter((x): x is { label: string; url: string } => x !== null);
}

export function CustomWidgetPanel({ widget, language }: { widget: CustomWidget; language: string }) {
  const tr = (en: string, t: string) => (language === "tr" ? t : en);
  const Icon = ICON[widget.type];
  const eyebrow =
    widget.type === "note" ? tr("NOTE", "NOT") : widget.type === "countdown" ? tr("COUNTDOWN", "GERİ SAYIM") : tr("LINKS", "BAĞLANTILAR");
  return (
    <motion.section
      className="panel dashboard-panel custom-widget-panel"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="dashboard-panel-head">
        <div className="dashboard-panel-head-icon" style={{ "--ph-accent": ACCENT[widget.type] } as CSSProperties}>
          <Icon size={16} />
        </div>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{widget.title || tr("Untitled", "Başlıksız")}</h3>
        </div>
      </div>
      <div className="dashboard-panel-body">
        {widget.type === "note" && (
          <p className="custom-widget-note">{widget.text?.trim() || tr("Empty note.", "Boş not.")}</p>
        )}
        {widget.type === "countdown" && (() => {
          const d = daysUntil(widget.date ?? "");
          if (d == null) return <p className="custom-widget-muted">{tr("Pick a date in Settings.", "Ayarlar'dan bir tarih seç.")}</p>;
          return (
            <div className="custom-widget-countdown">
              <strong>{Math.abs(d)}</strong>
              <span>
                {d > 0 ? tr(d === 1 ? "day left" : "days left", "gün kaldı")
                  : d === 0 ? tr("today", "bugün")
                  : tr("days ago", "gün önce")}
              </span>
              <small>{new Date(`${widget.date}T00:00:00`).toLocaleDateString(language === "tr" ? "tr-TR" : "en-US", { day: "numeric", month: "long", year: "numeric" })}</small>
            </div>
          );
        })()}
        {widget.type === "links" && (() => {
          const links = parseLinks(widget.text ?? "");
          if (links.length === 0) return <p className="custom-widget-muted">{tr("Add links in Settings.", "Ayarlar'dan bağlantı ekle.")}</p>;
          return (
            <ul className="custom-widget-links">
              {links.map((l, i) => (
                <li key={i}>
                  <button type="button" onClick={() => void openExternal(l.url)} title={l.url}>
                    <Link2 size={13} /> <span>{l.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          );
        })()}
      </div>
    </motion.section>
  );
}
