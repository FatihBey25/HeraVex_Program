// Two-step workspace creation modal (v0.9.7 rewrite).
//
// Step 1 — "What kind of workspace?": local vs team. The choice
// determines whether HeraVex writes a `heravex-members.json` to the
// folder and surfaces the team-mode UI. Picking team here is the
// *only* path that turns team mode on for a brand-new workspace; the
// Team Mode settings page still lets the user opt-in/out later.
//
// Step 2 — name + folder. When the user picked "team" we auto-detect
// the cloud provider from the path and warn if the folder doesn't
// look cloudy (no OneDrive/Dropbox/iCloud/GDrive hint). The user can
// override the warning — solo devs sometimes use a self-hosted sync
// (Syncthing, NAS-mounted folder) the heuristic can't see.

import { useState } from "react";
import { FolderOpen, FolderPlus, Cloud, HardDrive, ShieldCheck, AlertTriangle } from "lucide-react";
import { useAppStore } from "../../store";
import { pickDirectory } from "../../lib/storage";
import {
  addWorkspace, switchToWorkspace,
  detectCloudProvider, cloudProviderLabel,
  type CloudProvider, type WorkspaceMode,
} from "../../lib/workspaces";
import { useEscape } from "../../lib/keyboard";

interface Props {
  onClose: () => void;
}

type Step = "kind" | "details";

export function NewWorkspaceModal({ onClose }: Props) {
  const { language, showToast, showError } = useAppStore();
  useEscape(onClose);
  const tr = (en: string, t: string) => (language === "tr" ? t : en);
  const pick = (en: string, t: string, fr: string, es: string) =>
    language === "tr" ? t : language === "fr" ? fr : language === "es" ? es : en;

  const [step, setStep] = useState<Step>("kind");
  const [mode, setMode] = useState<WorkspaceMode>("local");
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  /** When the heuristic returns null but the user picked "team", we
   *  flag this so the modal can warn — they're free to override. */
  const [override, setOverride] = useState(false);

  const detected: CloudProvider | null = path ? detectCloudProvider(path) : null;

  const handlePickDir = async () => {
    try {
      const dir = await pickDirectory();
      setPath(dir);
      if (!name.trim()) {
        const leaf = dir.split(/[\\/]/).filter(Boolean).pop() || "";
        if (leaf) setName(leaf);
      }
      // Reset override flag whenever the folder changes — the warning
      // gates the *current* pick, not a previous one.
      setOverride(false);
    } catch (err) {
      const msg = String(err);
      if (!msg.includes("iptal")) showToast(msg, "error");
    }
  };

  // Team mode + path picked + no cloud hint detected → block with override.
  const needsOverride = mode === "team" && !!path && !detected && !override;

  const handleCreate = async () => {
    if (!name.trim() || !path.trim()) return;
    if (needsOverride) {
      // User must explicitly tick "yine de devam et" to bypass.
      return;
    }
    setBusy(true);
    try {
      const ws = addWorkspace(name, path, {
        mode,
        cloudProvider: mode === "team" ? (detected ?? "other") : undefined,
      });
      showToast(
        mode === "team"
          ? pick(
              `Team workspace "${ws.name}" created. Reloading…`,
              `"${ws.name}" ekip çalışma alanı oluşturuldu. Yeniden yükleniyor…`,
              `Espace équipe "${ws.name}" créé. Rechargement…`,
              `Espacio de equipo "${ws.name}" creado. Recargando…`,
            )
          : pick(
              `Workspace "${ws.name}" created. Reloading…`,
              `"${ws.name}" çalışma alanı oluşturuldu. Yeniden yükleniyor…`,
              `Espace "${ws.name}" créé. Rechargement…`,
              `Espacio "${ws.name}" creado. Recargando…`,
            ),
        "success",
      );
      await switchToWorkspace(ws);
      setTimeout(() => { window.location.reload(); }, 700);
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        className="modal-box new-workspace-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={tr("New workspace", "Yeni çalışma alanı")}
      >
        <header className="new-workspace-head">
          <div className="new-workspace-icon" aria-hidden="true">
            <FolderPlus size={22} strokeWidth={2} />
          </div>
          <div>
            <p className="eyebrow">{tr("WORKSPACE", "ÇALIŞMA ALANI")}</p>
            <h3 style={{ margin: "2px 0 0" }}>
              {step === "kind"
                ? tr("Pick a workspace type", "Çalışma alanı türünü seç")
                : tr("Name & folder", "İsim ve klasör")}
            </h3>
          </div>
        </header>

        {step === "kind" && (
          <>
            <p className="section-copy" style={{ marginTop: 8, marginBottom: 18 }}>
              {pick(
                "A workspace is an isolated folder of games, notes, tasks and builds. Pick whether you're working alone or as a team.",
                "Bir çalışma alanı; oyunlar, notlar, görevler ve build'lerin tutulduğu izole bir klasördür. Tek başına mı, ekiple mi çalışacağını seç.",
                "Un espace est un dossier isolé de jeux, notes, tâches et builds. Choisissez si vous travaillez seul ou en équipe.",
                "Un espacio es una carpeta aislada de juegos, notas, tareas y builds. Elige si trabajas solo o en equipo.",
              )}
            </p>

            <div className="ws-kind-choices">
              <button
                type="button"
                className={`ws-kind-choice ${mode === "local" ? "is-selected" : ""}`}
                onClick={() => setMode("local")}
              >
                <div className="ws-kind-choice-icon" style={{ "--c": "#4f8cff" } as React.CSSProperties}>
                  <HardDrive size={20} />
                </div>
                <div className="ws-kind-choice-body">
                  <strong>{pick("Local folder", "Yerel klasör", "Dossier local", "Carpeta local")}</strong>
                  <span>
                    {pick(
                      "Only on this computer. No sync, no team panel.",
                      "Sadece bu bilgisayarda. Senk yok, ekip paneli yok.",
                      "Uniquement sur cet ordinateur. Pas de sync, pas d'équipe.",
                      "Solo en este ordenador. Sin sync, sin equipo.",
                    )}
                  </span>
                </div>
                {mode === "local" && <ShieldCheck size={14} className="ws-kind-choice-mark" />}
              </button>

              <button
                type="button"
                className={`ws-kind-choice ${mode === "team" ? "is-selected" : ""}`}
                onClick={() => setMode("team")}
              >
                <div className="ws-kind-choice-icon" style={{ "--c": "#a78bfa" } as React.CSSProperties}>
                  <Cloud size={20} />
                </div>
                <div className="ws-kind-choice-body">
                  <strong>{pick("Team folder (cloud)", "Ekip klasörü (bulut)", "Dossier équipe (cloud)", "Carpeta de equipo (nube)")}</strong>
                  <span>
                    {pick(
                      "Inside OneDrive / Dropbox / iCloud / GDrive. Members panel + leader role.",
                      "OneDrive / Dropbox / iCloud / GDrive içinde. Üye paneli + lider rolü.",
                      "Dans OneDrive / Dropbox / iCloud / GDrive. Panneau membres + rôle leader.",
                      "Dentro de OneDrive / Dropbox / iCloud / GDrive. Panel de miembros + rol líder.",
                    )}
                  </span>
                </div>
                {mode === "team" && <ShieldCheck size={14} className="ws-kind-choice-mark" />}
              </button>
            </div>

            <div className="new-workspace-actions">
              <button type="button" className="secondary-button" onClick={onClose}>
                {tr("Cancel", "Vazgeç")}
              </button>
              <button type="button" className="primary-button" onClick={() => setStep("details")}>
                {tr("Continue", "Devam")}
              </button>
            </div>
          </>
        )}

        {step === "details" && (
          <>
            <div className="ws-kind-summary">
              {mode === "team" ? <Cloud size={14} /> : <HardDrive size={14} />}
              <span>
                {mode === "team"
                  ? pick("Team folder", "Ekip klasörü", "Dossier équipe", "Carpeta de equipo")
                  : pick("Local folder", "Yerel klasör", "Dossier local", "Carpeta local")}
              </span>
              <button type="button" className="link-button" onClick={() => setStep("kind")}>
                {tr("Change", "Değiştir")}
              </button>
            </div>

            <label className="new-workspace-field">
              <span>{tr("Workspace name", "Çalışma Alanı Adı")}</span>
              <input
                className="input"
                placeholder={tr("e.g. Mobile Studio", "Örn. Mobil Stüdyo")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </label>

            <label className="new-workspace-field">
              <span>{tr("Folder", "Klasör")}</span>
              <div className="new-workspace-folder-row">
                <input
                  className="input"
                  readOnly
                  placeholder={tr("Pick an empty or existing folder…", "Boş veya mevcut bir klasör seç…")}
                  value={path}
                  title={path}
                />
                <button
                  type="button"
                  className="secondary-button compact-button"
                  onClick={() => void handlePickDir()}
                  disabled={busy}
                >
                  <FolderOpen size={13} style={{ marginRight: 6 }} />
                  {tr("Choose folder", "Klasör seç")}
                </button>
              </div>
            </label>

            {/* Cloud provider hint chip — only when team mode + detected. */}
            {mode === "team" && detected && (
              <div className="ws-cloud-detected">
                <Cloud size={12} />
                {pick(
                  `Detected: ${cloudProviderLabel(detected, language)}`,
                  `Algılandı: ${cloudProviderLabel(detected, language)}`,
                  `Détecté : ${cloudProviderLabel(detected, language)}`,
                  `Detectado: ${cloudProviderLabel(detected, language)}`,
                )}
              </div>
            )}

            {/* Override warning — team mode + no cloud hint. */}
            {mode === "team" && path && !detected && (
              <div className="ws-cloud-warn">
                <AlertTriangle size={13} />
                <div>
                  <strong>
                    {pick(
                      "This folder doesn't look like a cloud-sync folder.",
                      "Bu klasör bulut-senk klasörü gibi görünmüyor.",
                      "Ce dossier ne ressemble pas à un dossier cloud.",
                      "Esta carpeta no parece estar en la nube.",
                    )}
                  </strong>
                  <p>
                    {pick(
                      "Team mode only works when teammates can sync to this folder. Continue only if you're using a custom sync (Syncthing, NAS, mounted share, etc.).",
                      "Ekip modu, takım üyelerinin bu klasöre senkronlanabildiği durumda çalışır. Özel bir senk (Syncthing, NAS, paylaşılan mount vb.) kullanıyorsan devam et.",
                      "Le mode équipe ne fonctionne que si vos coéquipiers peuvent se synchroniser. Continuez seulement si vous utilisez une sync personnalisée (Syncthing, NAS…).",
                      "El modo equipo solo funciona si los miembros pueden sincronizar. Continúa solo si usas una sync personalizada (Syncthing, NAS…).",
                    )}
                  </p>
                  <label className="ws-cloud-override">
                    <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                    <span>
                      {pick(
                        "I know what I'm doing — continue with this folder.",
                        "Ne yaptığımı biliyorum — bu klasörle devam et.",
                        "Je sais ce que je fais — continuer avec ce dossier.",
                        "Sé lo que hago — continuar con esta carpeta.",
                      )}
                    </span>
                  </label>
                </div>
              </div>
            )}

            <p className="new-workspace-note">
              {tr(
                "Existing workspace files in the chosen folder are loaded; an empty folder starts fresh. Your current data is never deleted.",
                "Seçilen klasördeki mevcut çalışma alanı dosyaları yüklenir; boş klasör sıfırdan başlar. Mevcut veriniz hiçbir zaman silinmez.",
              )}
            </p>

            <div className="new-workspace-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setStep("kind")}
                disabled={busy}
              >
                {tr("Back", "Geri")}
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void handleCreate()}
                disabled={!name.trim() || !path.trim() || busy || needsOverride}
              >
                {busy
                  ? tr("Creating…", "Oluşturuluyor…")
                  : tr("Create & Switch", "Oluştur ve Geç")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
