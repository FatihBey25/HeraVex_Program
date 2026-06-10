// Subtle floating spinner shown when a long-running operation is in
// flight. Provides reassurance the app isn't frozen — sits in the
// bottom-right corner above everything else but unobtrusively.
//
// Activation model: any code path can hit
//   `window.dispatchEvent(new CustomEvent("heravex:busy", { detail: { label: "Saving…", id: "x" } }))`
// to mark the start of a job, then dispatch the same id with
//   `detail: { id: "x", done: true }`
// to clear it. Multiple concurrent jobs are stacked; the indicator
// stays visible until the count drops to zero.
//
// Convenience: `withBusy(label, fn)` wraps a Promise so most callers
// don't need to think about event plumbing.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAppStore } from "../store";

interface BusyJob {
  id: string;
  label: string;
}

let nextId = 1;

export function BusyIndicator() {
  const { language } = useAppStore();
  const [jobs, setJobs] = useState<BusyJob[]>([]);

  useEffect(() => {
    const onBusy = (e: Event) => {
      const detail = (e as CustomEvent<{ id?: string; label?: string; done?: boolean }>).detail;
      const id = detail?.id ?? "anon";
      setJobs((prev) => {
        if (detail?.done) return prev.filter((j) => j.id !== id);
        if (prev.some((j) => j.id === id)) return prev; // dedupe
        return [...prev, { id, label: detail?.label ?? "Working…" }];
      });
    };
    window.addEventListener("heravex:busy", onBusy);
    return () => window.removeEventListener("heravex:busy", onBusy);
  }, []);

  if (jobs.length === 0) return null;
  const top = jobs[jobs.length - 1];
  const label = top.label || (language === "tr" ? "İşlem sürüyor…" : "Working…");

  return (
    <div className="busy-indicator" role="status" aria-live="polite">
      <Loader2 size={14} className="busy-indicator-spin" />
      <span>{label}</span>
      {jobs.length > 1 && (
        <em>+{jobs.length - 1}</em>
      )}
    </div>
  );
}

/** Wrap any Promise-returning op with the busy indicator. Resolves /
 *  rejects with the same value the wrapped op returned. */
export async function withBusy<T>(label: string, run: () => Promise<T>): Promise<T> {
  const id = `busy-${nextId++}`;
  window.dispatchEvent(new CustomEvent("heravex:busy", { detail: { id, label } }));
  try {
    return await run();
  } finally {
    window.dispatchEvent(new CustomEvent("heravex:busy", { detail: { id, done: true } }));
  }
}
