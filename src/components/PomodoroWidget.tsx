// Floating Pomodoro widget — small play/pause + remaining time chip
// rendered when the user-configured `visibility` calls for it.
//
// The widget subscribes to the global Pomodoro state machine (see
// `lib/pomodoro.ts`) — no Zustand. It positions itself per the
// user's `position` preference (topRight / bottomLeft / floating).
// Floating means anchored to top-right via CSS; users in a future
// milestone will be able to drag it. The widget is the ONLY visible
// surface for the timer in M4 — Settings → Pomodoro tunes the
// numbers, Ctrl+Space toggles run/pause, the widget shows it.

import { useEffect, useState } from "react";
import { Play, Pause, RotateCcw, SkipForward } from "lucide-react";
import {
  formatPomodoroTime, pause, resetPomodoro, skipPhase, start, usePomodoro,
} from "../lib/pomodoro";
import { useAppStore } from "../store";

export function PomodoroWidget() {
  const state = usePomodoro();
  // Read live so visibility/style/position pref changes flow without
  // a remount of the App tree.
  const pomodoroPrefs = useAppStore((s) => s.pomodoroPrefs);

  // The "sidebarWidget" mode hides until the user activates the
  // timer for the first time — sitting under the sidebar quietly
  // when there's nothing to show is the spec intent.
  const [everStarted, setEverStarted] = useState(false);
  useEffect(() => {
    if (state.running || state.remainingSeconds < 25 * 60) setEverStarted(true);
  }, [state.running, state.remainingSeconds]);

  if (pomodoroPrefs.visibility === "whenTaskOpen") {
    // M4 ships only the global widget; whenTaskOpen is reserved for
    // a future per-task chip integration. Hide gracefully.
    return null;
  }
  if (pomodoroPrefs.visibility === "sidebarWidget" && !everStarted) {
    return null;
  }

  const positionClass = `pomodoro-widget-pos-${pomodoroPrefs.position}`;
  const styleClass = `pomodoro-widget-style-${pomodoroPrefs.style}`;
  const phaseClass = `pomodoro-widget-phase-${state.phase}`;

  // Total seconds for the current phase — used by the bar/circle to
  // render progress. `state` exposes `remainingSeconds`; we infer the
  // phase length from the user's prefs because the state machine only
  // tracks what's left, not what the original budget was.
  const phaseTotalSeconds = (
    state.phase === "focus"      ? pomodoroPrefs.focusMinutes
    : state.phase === "shortBreak" ? pomodoroPrefs.shortBreakMinutes
    :                                pomodoroPrefs.longBreakMinutes
  ) * 60;
  const progress = Math.max(0, Math.min(1, 1 - (state.remainingSeconds / Math.max(1, phaseTotalSeconds))));

  return (
    <div className={`pomodoro-widget ${positionClass} ${styleClass} ${phaseClass}`}>
      {pomodoroPrefs.style === "circle" && (
        // SVG progress ring — renders behind the time chip. Circumference
        // is 2πr ≈ 56.55 for r=9; we set strokeDasharray to the full
        // circumference and offset it by (1 - progress) * circumference
        // so the stroke fills clockwise as the phase progresses.
        <svg
          className="pomodoro-widget-ring"
          width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"
        >
          <circle cx="11" cy="11" r="9"
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.10)"
                  strokeWidth="2" />
          <circle cx="11" cy="11" r="9"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={`${Math.PI * 18}`}
                  strokeDashoffset={`${Math.PI * 18 * (1 - progress)}`}
                  transform="rotate(-90 11 11)" />
        </svg>
      )}
      <span className="pomodoro-widget-phase-label">
        {state.phase === "focus" ? "FOCUS" :
         state.phase === "shortBreak" ? "BREAK" : "LONG BREAK"}
      </span>
      <span className="pomodoro-widget-time">{formatPomodoroTime(state.remainingSeconds)}</span>
      <div className="pomodoro-widget-actions">
        <button
          type="button"
          className="pomodoro-widget-btn"
          onClick={() => (state.running ? pause() : start())}
          title={state.running ? "Pause" : "Start"}
          aria-label={state.running ? "Pause" : "Start"}
        >
          {state.running ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <button
          type="button"
          className="pomodoro-widget-btn"
          onClick={skipPhase}
          title="Skip phase"
          aria-label="Skip phase"
        >
          <SkipForward size={12} />
        </button>
        <button
          type="button"
          className="pomodoro-widget-btn"
          onClick={resetPomodoro}
          title="Reset"
          aria-label="Reset"
        >
          <RotateCcw size={12} />
        </button>
      </div>
    </div>
  );
}
