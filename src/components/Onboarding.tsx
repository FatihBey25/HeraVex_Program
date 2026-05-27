import { Gamepad2, PlusCircle } from "lucide-react";

export function Onboarding({
  onCreateFirstGame
}: {
  onCreateFirstGame: () => void;
}) {
  return (
    <div className="onboarding-screen" style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      height: "100%", width: "100%", textAlign: "center", padding: "2rem"
    }}>
      <Gamepad2 size={64} style={{ marginBottom: "1.5rem", color: "var(--accent)" }} />
      <h1 style={{ marginBottom: "1rem" }}>Hadi gel ilk oyununu kaydedelim</h1>
      <p style={{ maxWidth: "400px", color: "var(--text-muted)", marginBottom: "2rem", lineHeight: "1.6" }}>
        HeraVex'e hoş geldin. Oyun geliştirme sürecini baştan sona yönetmek,
        giderlerini, görevlerini ve build sürümlerini takip etmek için ilk projeni oluştur.
      </p>
      <button className="btn btn-primary" onClick={onCreateFirstGame} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "1.1rem", padding: "0.75rem 1.5rem" }}>
        <PlusCircle size={20} />
        Oyun Ekle
      </button>
    </div>
  );
}
