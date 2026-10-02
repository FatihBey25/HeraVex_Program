// Settings → Pomodoro → "Lock app during break" (v0.9.9).
//
// While a break is on, the app is covered by a full-window screen with
// the break countdown. App shortcuts are blocked underneath it. The only
// way past it early is HOLDING "skip break" for a moment, so a reflex
// click doesn't throw the break away. When the break ends (or is
// skipped) the timer moves to focus and the screen goes away by itself.

import { useEffect, useRef, useState } from "react";
import { Coffee, Play, Pause } from "lucide-react";
import { useAppStore } from "../store";
import { usePomodoro, formatPomodoroTime, skipPhase, togglePomodoro } from "../lib/pomodoro";

const HOLD_MS = 1500;

export function BreakLockOverlay() {
  const enabled = useAppStore((s) => s.pomodoroPrefs.lockAppDuringBreak === true);
  const language = useAppStore((s) => s.language);
  const state = usePomodoro();
  const locked = enabled && state.phase !== "focus";
  const tr = (en: string, t: string) => (language === "tr" ? t : en);

  const rootRef = useRef<HTMLDivElement>(null);
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Block the app's keyboard shortcuts while locked. Capture phase on
  // window runs before every other key handler; keys aimed at the lock
  // screen's own buttons still work.
  useEffect(() => {
    if (!locked) return;
    const onKey = (e: KeyboardEvent) => {
      const inside = rootRef.current?.contains(e.target as Node);
      if (inside && (e.key === "Tab" || e.key === "Enter" || e.key === " ")) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => window.removeEventListener("keydown", onKey, true);
  }, [locked]);

  useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current); }, []);

  if (!locked) return null;

  const startHold = () => {
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      setHolding(false);
      skipPhase();
    }, HOLD_MS);
  };
  const cancelHold = () => {
    setHolding(false);
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const isLong = state.phase === "longBreak";
  return (
    <div
      ref={rootRef}
      className="break-lock"
      role="dialog"
      aria-modal="true"
      aria-labelledby="break-lock-title"
    >
      <div className="break-lock-card">
        <span className="break-lock-icon"><Coffee size={26} /></span>
        <p className="eyebrow">{isLong ? tr("LONG BREAK", "UZUN MOLA") : tr("BREAK", "MOLA")}</p>
        <h2 id="break-lock-title">{tr("Time to step away", "Biraz ara ver")}</h2>
        <div className="break-lock-time" aria-live="polite">{formatPomodoroTime(state.remainingSeconds)}</div>
        <p className="break-lock-hint">
          {state.running
            ? tr("HeraVex unlocks when the break is over.", "Mola bitince HeraVex kendiliğinden açılır.")
            : tr("The break timer is paused.", "Mola sayacı duraklatıldı.")}
        </p>
        <div className="break-lock-actions">
          <button type="button" className="secondary-button compact-button" onClick={() => togglePomodoro()}>
            {state.running ? <Pause size={13} /> : <Play size={13} />}
            {state.running ? tr("Pause break", "Molayı duraklat") : tr("Resume break", "Molaya devam et")}
          </button>
          <button
            type="button"
            className={"break-lock-skip" + (holding ? " is-holding" : "")}
            style={{ ["--hold-ms" as string]: `${HOLD_MS}ms` }}
            onPointerDown={startHold}
            onPointerUp={cancelHold}
            onPointerLeave={cancelHold}
            onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) startHold(); }}
            onKeyUp={(e) => { if (e.key === "Enter" || e.key === " ") cancelHold(); }}
          >
            <span className="break-lock-skip-fill" aria-hidden="true" />
            <span className="break-lock-skip-label">{tr("Hold to skip break", "Molayı atlamak için basılı tut")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
