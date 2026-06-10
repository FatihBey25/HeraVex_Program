import { Gamepad2, PlusCircle } from "lucide-react";
import { useAppStore } from "../store";

// v0.9 — pulled hardcoded Turkish copy out and wired this screen into
// the i18n bundle. The component still receives `onCreateFirstGame` as
// a prop because the open-modal handler lives in App.tsx.
export function Onboarding({
  onCreateFirstGame,
}: {
  onCreateFirstGame: () => void;
}) {
  const { ui } = useAppStore();
  return (
    <div className="onboarding-screen" style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      height: "100%", width: "100%", textAlign: "center", padding: "2rem"
    }}>
      <Gamepad2 size={64} style={{ marginBottom: "1.5rem", color: "var(--accent)" }} />
      <h1 style={{ marginBottom: "1rem" }}>{ui.onboardingTitle}</h1>
      <p style={{ maxWidth: "400px", color: "var(--text-muted)", marginBottom: "2rem", lineHeight: "1.6" }}>
        {ui.onboardingBody}
      </p>
      <button
        className="btn btn-primary"
        onClick={onCreateFirstGame}
        style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "1.1rem", padding: "0.75rem 1.5rem" }}
      >
        <PlusCircle size={20} />
        {ui.onboardingButton}
      </button>
    </div>
  );
}
