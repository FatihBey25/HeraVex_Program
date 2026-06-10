// Idle-lock overlay.
//
// Active when Settings → Privacy → "Auto-lock" picks a non-zero
// timeout. The hook (mounted from App.tsx) tracks mouse + key
// activity, schedules a lock after the configured idle window, and
// renders a blocking overlay until the user dismisses it. There's
// no real password yet — dismissal is one click, the goal is to
// hide on-screen secrets when the user walks away. Real
// password-gated dismissal lands when we ship the keychain
// integration (the spec's "v1.0").

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { useAppStore } from "../store";
import { autoLockMs } from "../lib/privacyExperimental";

export function AutoLockOverlay() {
  const privacy = useAppStore((s) => s.privacy);
  const ui = useAppStore((s) => s.ui);
  const [locked, setLocked] = useState(false);

  const timeoutMs = autoLockMs(privacy.autoLock);

  useEffect(() => {
    if (timeoutMs <= 0) {
      setLocked(false);
      return;
    }
    let timer: number | undefined;
    const reset = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setLocked(true), timeoutMs);
    };
    reset();
    // Reset on any activity. Keep the listener list small so we
    // don't churn on every wheel/scroll event.
    const onActivity = () => reset();
    window.addEventListener("mousedown", onActivity);
    window.addEventListener("keydown", onActivity);
    window.addEventListener("touchstart", onActivity);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("mousedown", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("touchstart", onActivity);
    };
  }, [timeoutMs]);

  if (!locked) return null;

  return (
    <div className="autolock-overlay">
      <div className="autolock-card">
        <div className="autolock-icon">
          <Lock size={28} strokeWidth={2} />
        </div>
        <h2>{ui.privacyLockedTitle}</h2>
        <p>{ui.privacyLockedBody}</p>
        <button
          type="button"
          className="primary-button"
          onClick={() => setLocked(false)}
        >
          {ui.privacyUnlock}
        </button>
      </div>
    </div>
  );
}
