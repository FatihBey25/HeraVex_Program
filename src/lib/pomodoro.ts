// Global Pomodoro state machine.
//
// One running timer per app instance, advancing through
//   focus → shortBreak → focus → shortBreak → … → longBreak → focus
// at user-configured durations. Ctrl+Space toggles run/pause; the
// machine fires desktop notifications + an optional bell at each
// transition (gated by the Notifications preferences).
//
// State lives in module scope and is exposed through `usePomodoro`,
// a tiny subscription hook. Keeping it out of Zustand avoids
// re-rendering everything that touches the store on each tick —
// only components that subscribe via `usePomodoro` re-render every
// second.

import { useEffect, useState } from "react";
import { notify } from "./notify";
import { loadNotifications, loadPomodoroPrefs } from "./preferences";

export type PomodoroPhase = "focus" | "shortBreak" | "longBreak";

export interface PomodoroState {
  running: boolean;
  phase: PomodoroPhase;
  /** Seconds remaining in the current phase. */
  remainingSeconds: number;
  /** Completed focus sessions in this cycle (resets after a long break). */
  completedFocusSessions: number;
}

const INITIAL_PHASE: PomodoroPhase = "focus";

const listeners = new Set<(s: PomodoroState) => void>();
let state: PomodoroState = {
  running: false,
  phase: INITIAL_PHASE,
  remainingSeconds: 25 * 60,
  completedFocusSessions: 0,
};
let intervalId: ReturnType<typeof setInterval> | null = null;

function emit() {
  for (const l of listeners) l(state);
}
function update(patch: Partial<PomodoroState>) {
  state = { ...state, ...patch };
  emit();
}

function durationForPhase(phase: PomodoroPhase): number {
  const prefs = loadPomodoroPrefs();
  switch (phase) {
    case "focus":      return prefs.focusMinutes * 60;
    case "shortBreak": return prefs.shortBreakMinutes * 60;
    case "longBreak":  return prefs.longBreakMinutes * 60;
  }
}

function pickNextPhase(): { next: PomodoroPhase; completedFocus: number } {
  const prefs = loadPomodoroPrefs();
  if (state.phase === "focus") {
    const completedFocus = state.completedFocusSessions + 1;
    const isLongBreakTurn = completedFocus % prefs.longBreakCadence === 0;
    return {
      next: isLongBreakTurn ? "longBreak" : "shortBreak",
      completedFocus,
    };
  }
  // Coming out of any break, the cadence counter rolls forward
  // only when we just finished a long break.
  const resetCompleted = state.phase === "longBreak"
    ? 0
    : state.completedFocusSessions;
  return { next: "focus", completedFocus: resetCompleted };
}

function tick() {
  if (!state.running) return;
  if (state.remainingSeconds > 1) {
    update({ remainingSeconds: state.remainingSeconds - 1 });
    return;
  }
  // Phase boundary reached.
  const { next, completedFocus } = pickNextPhase();
  const prefs = loadPomodoroPrefs();
  const notifs = loadNotifications();

  // Notify only on the focus→break boundary, and only when the user
  // hasn't opted out. Sound is a separate toggle.
  if (state.phase === "focus" && notifs.pomodoroDesktopNotification) {
    void notify(
      "HeraVex 🍅",
      next === "longBreak"
        ? "Long break — step away for a bit."
        : "Short break — stand up, sip water.",
    );
  } else if (state.phase !== "focus" && notifs.pomodoroDesktopNotification) {
    void notify("HeraVex 🍅", "Back to focus.");
  }
  if (notifs.pomodoroSoundOnComplete && notifs.notificationSound !== "silent") {
    playBeep(notifs.volume / 100);
  }

  // Decide whether to keep running (auto-start) or pause until user
  // manually resumes.
  const wasFocus = state.phase === "focus";
  const shouldAutoRun =
    (wasFocus && prefs.autoStartNextPomodoro === false) ? false :
    (!wasFocus && prefs.autoResumeAfterBreak === false) ? false :
    true;

  update({
    phase: next,
    remainingSeconds: durationForPhase(next),
    completedFocusSessions: completedFocus,
    running: shouldAutoRun,
  });
}

/** Toggle the running flag. Called by Ctrl+Space + the widget play
 *  button. Starts the interval on first transition; stop teardown
 *  is handled by `pause()`. */
export function togglePomodoro() {
  if (state.running) {
    pause();
  } else {
    start();
  }
}

export function start() {
  if (intervalId == null) {
    intervalId = setInterval(tick, 1000);
  }
  update({ running: true });
}

export function pause() {
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  update({ running: false });
}

export function resetPomodoro() {
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  state = {
    running: false,
    phase: "focus",
    remainingSeconds: durationForPhase("focus"),
    completedFocusSessions: 0,
  };
  emit();
}

export function skipPhase() {
  const { next, completedFocus } = pickNextPhase();
  update({
    phase: next,
    remainingSeconds: durationForPhase(next),
    completedFocusSessions: completedFocus,
  });
}

/** React subscription. Returns the current state and re-renders the
 *  caller whenever it changes. */
export function usePomodoro(): PomodoroState {
  const [s, setS] = useState(state);
  useEffect(() => {
    const cb = (next: PomodoroState) => setS(next);
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }, []);
  return s;
}

/** Whenever preferences change we want the *next* phase boundary to
 *  pick up the new durations. The currently-running phase keeps its
 *  remaining time so users don't get a confusing reset mid-focus. */
export function refreshDurationsForCurrentPhase() {
  if (state.running) return; // don't disturb a running session
  const expected = durationForPhase(state.phase);
  if (state.remainingSeconds === 0 || state.remainingSeconds > expected) {
    update({ remainingSeconds: expected });
  }
}

// ── Sound ───────────────────────────────────────────────────────────

/** Play the user's notification sound at the given volume.
 *
 *  v0.9 polish: there is ONE notification sound. When the user has
 *  uploaded a custom audio file (via Settings → Notifications), we
 *  read its bytes out of the notifications slice as a data URL and
 *  play it through a regular `<audio>` tag. When no custom file is
 *  set we fall back to a two-tone Web Audio beep so the test
 *  button + pomodoro completion still produce audible feedback.
 *
 *  Volume is clipped to [0, 1]. */
export function playBeep(volume: number) {
  try {
    // Pull the latest custom sound straight from localStorage so we
    // don't have to thread the store through every caller (the
    // pomodoro state machine sits outside React).
    const raw = localStorage.getItem("heravex_notifications_v1");
    let dataUrl = "";
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { customSoundDataUrl?: string };
        if (parsed.customSoundDataUrl && typeof parsed.customSoundDataUrl === "string") {
          dataUrl = parsed.customSoundDataUrl;
        }
      } catch { /* fall through to beep */ }
    }
    if (dataUrl) {
      const audio = new Audio(dataUrl);
      audio.volume = Math.max(0, Math.min(1, volume));
      void audio.play().catch(() => {
        // Autoplay refused — fall back to the synthesised beep so
        // the user always hears something on test.
        synthBeep(volume);
      });
      return;
    }
    synthBeep(volume);
  } catch { /* audio API blocked — silent fallback */ }
}

function synthBeep(volume: number) {
  const Ctx: typeof AudioContext | undefined =
    typeof window !== "undefined"
      ? (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
  if (!Ctx) return;
  const ctx = new Ctx();
  const playTone = (freq: number, start: number, length: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.value = Math.max(0, Math.min(1, volume));
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + length);
  };
  playTone(880, 0,    0.18);
  playTone(660, 0.20, 0.22);
  setTimeout(() => ctx.close(), 600);
}

/** Pretty mm:ss formatter for the widget. */
export function formatPomodoroTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
