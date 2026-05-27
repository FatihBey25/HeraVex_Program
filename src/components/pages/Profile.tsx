import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Eye, EyeOff, KeyRound, CheckCircle2, Circle, Camera, Trash2, Sparkles,
  FolderOpen, CloudUpload, Link2Off, Users, Save,
  Database, Archive, Info, Globe, Calendar as CalendarIcon, Mail,
  Settings as SettingsIcon, RefreshCcw, FileText, Keyboard, Pencil, X as XIcon, RotateCcw,
  Upload, Download,
} from "lucide-react";
import {
  DEFAULT_SHORTCUTS,
  actionLabel,
  captureKeyEvent,
  detectMac,
  formatCombo,
  loadShortcuts,
  resetShortcuts,
  saveShortcuts,
  type ShortcutAction,
  type ShortcutDef,
} from "../../lib/shortcutConfig";
import { LoadingButton } from "../shared/LoadingButton";
import logoMarkUrl from "../../assets/logo-mark.svg";
import { useAppStore } from "../../store";
import { imgSrc } from "../../lib/images";
import {
  pickGooglePlayJson,
  pickDirectory,
  getWorkspacePath,
  setWorkspacePath,
  clearWorkspacePath,
  revealInFolder,
  openExternal,
} from "../../lib/storage";
import { APP_VERSION, APP_BUILD_DATE, RELEASES_URL, FEEDBACK_EMAIL } from "../../lib/app-meta";
import { resetTutorial } from "../Tutorial/TutorialOverlay";
import { TUTORIAL_UI } from "../../lib/tutorialSteps";

const DATE_FORMATS = [
  { id: "dd.mm.yyyy", label: "DD.MM.YYYY" },
  { id: "mm.dd.yyyy", label: "MM.DD.YYYY" },
  { id: "yyyy-mm-dd", label: "YYYY-MM-DD" },
];

const CURRENCY_DEFAULTS = ["USD", "EUR", "TRY", "GBP", "JPY"];

export function Profile({ onOpenLanguage }: { onOpenLanguage: () => void }) {
  const {
    language, ui,
    steamApiKey, itchApiKey, steamUserId, handleSaveApiKeys,
    googlePlayJsonPath,
    avatarPath, handlePickAvatar, handleClearAvatar,
    showToast, showError, handleExportBackup, handleImportBackup, refreshGames,
  } = useAppStore();

  const [workspacePath, setWorkspacePathState] = useState<string>("");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const cloudSyncRef = useRef<HTMLElement | null>(null);

  // Identity (editable display name + description, persisted to localStorage)
  const defaultName = language === "tr" ? "HeraVex Kullanıcısı" : "HeraVex User";
  const [displayName, setDisplayName] = useState<string>(() => {
    try { return localStorage.getItem("heravex_user_name") || defaultName; }
    catch { return defaultName; }
  });
  const [displayRole, setDisplayRole] = useState<string>(() => {
    try { return localStorage.getItem("heravex_user_role") || ""; }
    catch { return ""; }
  });
  useEffect(() => {
    try { localStorage.setItem("heravex_user_name", displayName); } catch {}
  }, [displayName]);
  useEffect(() => {
    try { localStorage.setItem("heravex_user_role", displayRole); } catch {}
  }, [displayRole]);

  // Preferences (persisted to localStorage, used as soft defaults across the app)
  const [defaultCurrency, setDefaultCurrency] = useState<string>(() => {
    try { return localStorage.getItem("heravex_default_currency") || "USD"; }
    catch { return "USD"; }
  });
  const [dateFormat, setDateFormat] = useState<string>(() => {
    try { return localStorage.getItem("heravex_date_format") || "dd.mm.yyyy"; }
    catch { return "dd.mm.yyyy"; }
  });
  useEffect(() => {
    try { localStorage.setItem("heravex_default_currency", defaultCurrency); } catch {}
  }, [defaultCurrency]);
  useEffect(() => {
    try { localStorage.setItem("heravex_date_format", dateFormat); } catch {}
  }, [dateFormat]);

  const scrollToCloudSync = () => {
    cloudSyncRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openDataFolder = async () => {
    if (!workspacePath) {
      showToast(
        language === "tr"
          ? "Önce 'Ekip Modu' altında bir senkronizasyon klasörü seç. Varsayılan klasör görüntülenemiyor."
          : "Pick a sync folder in 'Team Mode' first. Default folder can't be revealed.",
        "info"
      );
      return;
    }
    try {
      await revealInFolder(workspacePath);
    } catch (err) {
      showError(err);
    }
  };

  const onBackupClick = async () => {
    await handleExportBackup();
  };

  const sendFeedback = async () => {
    const subject = encodeURIComponent(
      language === "tr" ? "HeraVex Geri Bildirim" : "HeraVex Feedback"
    );
    const body = encodeURIComponent(
      (language === "tr" ? "Sürüm" : "Version") +
        `: v${APP_VERSION}\n` +
        (language === "tr" ? "Build" : "Build") +
        `: ${APP_BUILD_DATE}\n\n`
    );
    // Route through the Rust `open_external` command — Tauri's webview blocks
    // raw mailto: navigations from JS, but the OS shell honours the scheme
    // and hands it to the default mail client.
    try {
      await openExternal(`mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`);
    } catch (err) {
      showError(err);
    }
  };

  const viewReleases = async () => {
    // Opens the GitHub releases page in the user's default browser.
    // (No in-app updater — releases are published manually for now.)
    try {
      await openExternal(RELEASES_URL);
    } catch (err) {
      showError(err);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const p = await getWorkspacePath();
        if (p) setWorkspacePathState(p);
      } catch {}
    })();
  }, []);

  const handlePickWorkspace = async () => {
    setWorkspaceBusy(true);
    try {
      const dir = await pickDirectory();
      const saved = await setWorkspacePath(dir);
      setWorkspacePathState(saved);
      showToast(
        t("Workspace moved successfully. Reloading…", "Çalışma alanı başarıyla taşındı. Yeniden yükleniyor…"),
        "success"
      );
      setTimeout(() => { window.location.reload(); }, 900);
    } catch (err) {
      const msg = String(err);
      if (!msg.includes("iptal")) showError(err);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleClearWorkspace = async () => {
    setWorkspaceBusy(true);
    try {
      await clearWorkspacePath();
      setWorkspacePathState("");
      showToast(
        t("Workspace reset to local. Reloading…", "Çalışma alanı yerele döndürüldü. Yeniden yükleniyor…"),
        "success"
      );
      setTimeout(() => { window.location.reload(); }, 900);
    } catch (err) {
      showError(err);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const [steamKey, setSteamKey] = useState(steamApiKey);
  const [itchKey, setItchKey] = useState(itchApiKey);
  const [steamId, setSteamId] = useState(steamUserId);
  const [playJson, setPlayJson] = useState(googlePlayJsonPath);
  const [showSteam, setShowSteam] = useState(false);
  const [showItch, setShowItch] = useState(false);
  const [saving, setSaving] = useState(false);

  const steamConnected = steamApiKey.trim().length > 0;
  const itchConnected = itchApiKey.trim().length > 0;
  const playConnected = googlePlayJsonPath.trim().length > 0;
  const dirty =
    steamKey !== steamApiKey ||
    itchKey !== itchApiKey ||
    steamId !== steamUserId ||
    playJson !== googlePlayJsonPath;

  const t = (en: string, tr: string) => (language === "tr" ? tr : en);
  const avatarSrc = imgSrc(avatarPath);

  const onSave = async () => {
    setSaving(true);
    try {
      await handleSaveApiKeys({
        steamApiKey: steamKey,
        itchApiKey: itchKey,
        steamUserId: steamId,
        googlePlayJsonPath: playJson,
      });
      showToast(
        language === "tr"
          ? "API anahtarları başarıyla kaydedildi"
          : "API keys saved successfully",
        "success",
      );
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  };

  const pickPlayJson = async () => {
    try {
      const path = await pickGooglePlayJson();
      setPlayJson(path);
    } catch (err) {
      const msg = String(err);
      if (!msg.includes("iptal")) showError(err);
    }
  };

  return (
    <motion.div
      className="page-fade profile-wrapper"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="profile-backdrop" aria-hidden="true">
        <div className="profile-backdrop-orb profile-backdrop-orb-1" />
        <div className="profile-backdrop-orb profile-backdrop-orb-2" />
        <div className="profile-backdrop-orb profile-backdrop-orb-3" />
      </div>

      <section className="panel profile-page profile-card-hero">
        <div className="profile-hero profile-hero-large">
          <button
            type="button"
            className="profile-avatar-ring"
            onClick={() => void handlePickAvatar()}
            title={t("Change avatar", "Avatarı değiştir")}
          >
            {avatarSrc ? (
              <img src={avatarSrc} alt="avatar" className="profile-avatar-image" />
            ) : (
              <img
                src={logoMarkUrl}
                alt="HeraVex"
                className="profile-avatar-image profile-avatar-mark-large"
                draggable={false}
              />
            )}
            <span className="profile-avatar-hover">
              <Camera size={22} strokeWidth={2} />
              <span>{t("Upload", "Yükle")}</span>
            </span>
          </button>

          <div className="profile-hero-meta">
            <p className="eyebrow">{t("IDENTITY", "KIMLIK")}</p>
            <input
              className="profile-identity-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={defaultName}
              spellCheck={false}
              title={t("Click to edit", "Düzenlemek için tıkla")}
            />
            <input
              className="profile-identity-role"
              value={displayRole}
              onChange={(e) => setDisplayRole(e.target.value)}
              placeholder={t("Add a short bio…", "Kısa bir açıklama ekle…")}
              spellCheck={false}
              title={t("Click to edit", "Düzenlemek için tıkla")}
            />
            {avatarSrc && (
              <button
                className="profile-avatar-remove"
                onClick={() => void handleClearAvatar()}
                title={t("Remove avatar", "Avatarı kaldır")}
              >
                <Trash2 size={12} style={{ marginRight: 4 }} />
                {t("Remove photo", "Fotoğrafı kaldır")}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Preferences ─────────────────────────────────────────────────────── */}
      <section className="panel profile-page" style={{ marginTop: 18 }}>
        <div className="profile-hero" style={{ alignItems: "flex-start" }}>
          <div className="profile-hero-avatar" style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
            <SettingsIcon size={28} strokeWidth={2} />
          </div>
          <div>
            <p className="eyebrow">{t("PREFERENCES", "TERCİHLER")}</p>
            <h2 style={{ margin: "2px 0 4px" }}>{t("App Defaults", "Uygulama Varsayılanları")}</h2>
            <p className="section-copy" style={{ marginTop: 4 }}>
              {t(
                "Tweak language, theme, currency and date conventions used across HeraVex.",
                "HeraVex genelinde kullanılan dil, tema, para birimi ve tarih biçimini ayarla."
              )}
            </p>
          </div>
        </div>

        <div className="preferences-grid">
          <div className="preference-row">
            <label className="preference-label">
              <Globe size={13} strokeWidth={2.2} />
              {t("Language", "Dil")}
            </label>
            <button
              type="button"
              className="preference-control preference-button"
              onClick={onOpenLanguage}
            >
              <span>{language.toUpperCase()}</span>
              <span className="preference-edit">{t("Change", "Değiştir")}</span>
            </button>
          </div>

          {/*
            Theme picker intentionally removed until a full light theme is shipped.
            CSS custom properties in :root remain ready for a future light variant
            (palette swap via [data-theme="light"]) without UI surface today.
          */}

          <div className="preference-row">
            <label className="preference-label" htmlFor="pref-currency">
              <FileText size={13} strokeWidth={2.2} />
              {t("Default Currency", "Varsayılan Para Birimi")}
            </label>
            <select
              id="pref-currency"
              className="input preference-control"
              value={defaultCurrency}
              onChange={(e) => setDefaultCurrency(e.target.value)}
            >
              {CURRENCY_DEFAULTS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="preference-row">
            <label className="preference-label" htmlFor="pref-date">
              <CalendarIcon size={13} strokeWidth={2.2} />
              {t("Date Format", "Tarih Formatı")}
            </label>
            <select
              id="pref-date"
              className="input preference-control"
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value)}
            >
              {DATE_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* ── Data Management ─────────────────────────────────────────────────── */}
      <section className="panel profile-page" style={{ marginTop: 18 }}>
        <div className="profile-hero" style={{ alignItems: "flex-start" }}>
          <div className="profile-hero-avatar" style={{ background: "linear-gradient(135deg, #22d3ee, #4f8cff)" }}>
            <Database size={28} strokeWidth={2} />
          </div>
          <div>
            <p className="eyebrow">{t("DATA MANAGEMENT", "VERİ YÖNETİMİ")}</p>
            <h2 style={{ margin: "2px 0 4px" }}>
              {t("Your studio files", "Stüdyo dosyaların")}
            </h2>
            <p className="section-copy" style={{ marginTop: 4 }}>
              {t(
                "Open the data folder, back up everything as a ZIP, or move your workspace to a synced location.",
                "Veri klasörünü aç, her şeyi ZIP olarak yedekle veya çalışma alanını senkron bir konuma taşı."
              )}
            </p>
          </div>
        </div>

        <div className="data-mgmt-grid">
          <button
            type="button"
            className="data-mgmt-btn"
            onClick={() => void openDataFolder()}
            disabled={!workspacePath}
            title={
              workspacePath
                ? workspacePath
                : t("Set a workspace folder below to enable this", "Bu butonu etkinleştirmek için aşağıdan klasör seç")
            }
          >
            <FolderOpen size={18} strokeWidth={2} />
            <span>
              <strong>{t("Open Data Folder", "Veri Klasörünü Aç")}</strong>
              <small>
                {workspacePath
                  ? t("Reveal in file manager", "Dosya yöneticisinde göster")
                  : t("Default app-data location", "Varsayılan uygulama veri konumu")}
              </small>
            </span>
          </button>

          <button
            type="button"
            className="data-mgmt-btn"
            onClick={() => void onBackupClick()}
          >
            <Archive size={18} strokeWidth={2} />
            <span>
              <strong>{t("Back Up All Data (ZIP)", "Tüm Verileri Yedekle (ZIP)")}</strong>
              <small>{t("Export every game, note and asset", "Tüm oyun, not ve görselleri dışa aktar")}</small>
            </span>
          </button>

          <button
            type="button"
            className="data-mgmt-btn"
            onClick={scrollToCloudSync}
          >
            <CloudUpload size={18} strokeWidth={2} />
            <span>
              <strong>{t("Change Workspace Folder", "Veri Klasörünü Değiştir")}</strong>
              <small>
                {t("Configure in Team Mode below ↓", "Aşağıdaki Ekip Modu'ndan ayarla ↓")}
              </small>
            </span>
          </button>
        </div>
      </section>

      {/* ── API Connections Panel ────────────────────────────────────────────── */}
      <section className="panel profile-page" style={{ marginTop: 18 }}>
        <div className="profile-hero" style={{ alignItems: "flex-start" }}>
          <div className="profile-hero-avatar" style={{ background: "linear-gradient(135deg, #a78bfa, #4f8cff)" }}>
            <KeyRound size={28} strokeWidth={2} />
          </div>
          <div>
            <p className="eyebrow">{t("STORE CONNECTIONS", "MAĞAZA BAĞLANTILARI")}</p>
            <h2 style={{ margin: "2px 0 4px" }}>{t("API Keys", "API Anahtarları")}</h2>
            <p className="section-copy" style={{ marginTop: 4 }}>
              {t(
                "Connect Steam and Itch.io to sync wishlist, downloads and revenue metrics.",
                "Wishlist, indirme ve gelir metriklerini senkronize etmek için Steam ve Itch.io'yu bağla."
              )}
            </p>
          </div>
        </div>

        <div className="api-key-grid">
          <ApiKeyField
            label="Steam Web API"
            placeholder={t("Steam Web API Key", "Steam Web API Anahtarı")}
            value={steamKey}
            onChange={setSteamKey}
            visible={showSteam}
            onToggleVisible={() => setShowSteam((v) => !v)}
            connected={steamConnected}
            connectedLabel={t("Connected", "Bağlı")}
            helper={
              <input
                className="input api-secondary-input"
                placeholder={t("SteamID64 (optional)", "SteamID64 (opsiyonel)")}
                value={steamId}
                onChange={(e) => setSteamId(e.target.value)}
              />
            }
          />
          <ApiKeyField
            label="Itch.io"
            placeholder={t("Itch.io API Key", "Itch.io API Anahtarı")}
            value={itchKey}
            onChange={setItchKey}
            visible={showItch}
            onToggleVisible={() => setShowItch((v) => !v)}
            connected={itchConnected}
            connectedLabel={t("Connected", "Bağlı")}
          />
          <div className="api-key-field">
            <div className="api-key-header">
              <span className="api-key-label">Google Play Console</span>
              <span className={`api-status-badge ${playConnected ? "api-status-on" : "api-status-off"}`}>
                {playConnected ? <CheckCircle2 size={12} strokeWidth={2.4} /> : <Circle size={12} strokeWidth={2.4} />}
                {playConnected ? t("Connected", "Bağlı") : "—"}
              </span>
            </div>
            <div className="api-key-input-wrap">
              <input
                className="input api-key-input"
                placeholder={t("Service Account JSON path", "Service Account JSON yolu")}
                value={playJson}
                onChange={(e) => setPlayJson(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={() => void pickPlayJson()}
              style={{ alignSelf: "flex-start" }}
            >
              <FolderOpen size={14} style={{ marginRight: 6 }} />
              {t("Choose JSON file", "JSON Dosyası Seç")}
            </button>
          </div>
        </div>

        <div className="profile-actions" style={{ marginTop: 18 }}>
          <LoadingButton
            disabled={!dirty}
            loading={saving}
            onClick={() => onSave()}
            loadingLabel={t("Saving…", "Kaydediliyor…")}
            leadingIcon={<Save size={13} style={{ marginRight: 6 }} />}
            style={{ opacity: !dirty && !saving ? 0.55 : 1 }}
          >
            {t("Save API Keys", "API Anahtarlarını Kaydet")}
          </LoadingButton>
        </div>
      </section>

      {/* ── Cloud Sync (Team Mode) ──────────────────────────────────────── */}
      <section ref={cloudSyncRef} className="panel profile-page cloud-sync-panel" style={{ marginTop: 18 }}>
        <div className="profile-hero" style={{ alignItems: "flex-start" }}>
          <div
            className="profile-hero-avatar"
            style={{ background: "linear-gradient(135deg, #34d399, #4f8cff)" }}
          >
            <CloudUpload size={28} strokeWidth={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="eyebrow">{t("TEAM MODE", "EKİP MODU")}</p>
            <h2 style={{ margin: "2px 0 4px" }}>{t("Cloud Sync", "Bulut Senkronizasyonu")}</h2>
            <p className="section-copy" style={{ marginTop: 4 }}>
              {t(
                "Point HeraVex at a Dropbox / Drive / OneDrive folder. Games and notes write as per-id files to keep team edits merge-safe.",
                "HeraVex'i bir Dropbox / Drive / OneDrive klasörüne yönlendir. Oyunlar ve notlar id-bazlı tek dosyalar olarak yazılır; ekip düzenlemeleri çakışmadan birleşir."
              )}
            </p>
          </div>
          <div className={`cloud-sync-status ${workspacePath ? "cloud-sync-on" : "cloud-sync-off"}`}>
            {workspacePath ? (
              <>
                <Users size={12} strokeWidth={2.4} />
                {t("Synced", "Senkron")}
              </>
            ) : (
              <>
                <Circle size={12} strokeWidth={2.4} />
                {t("Local only", "Sadece yerel")}
              </>
            )}
          </div>
        </div>

        <div className="cloud-sync-body">
          <label className="cloud-sync-label">
            {t("Workspace folder", "Çalışma alanı klasörü")}
          </label>
          <div className="cloud-sync-row">
            <input
              className="input cloud-sync-path"
              readOnly
              value={
                workspacePath ||
                t("Default app data folder", "Varsayılan uygulama veri klasörü")
              }
              title={workspacePath}
            />
            <button
              type="button"
              className="primary-button compact-button"
              onClick={() => void handlePickWorkspace()}
              disabled={workspaceBusy}
            >
              <FolderOpen size={14} style={{ marginRight: 6 }} />
              {workspacePath
                ? t("Change folder", "Klasörü değiştir")
                : t("Pick sync folder", "Senkronizasyon klasörü seç")}
            </button>
            {workspacePath && (
              <button
                type="button"
                className="secondary-button compact-button danger-button"
                onClick={() => void handleClearWorkspace()}
                disabled={workspaceBusy}
                title={t("Reset to local", "Yerele döndür")}
              >
                <Link2Off size={14} style={{ marginRight: 6 }} />
                {t("Unlink", "Bağlantıyı kes")}
              </button>
            )}
          </div>

          <ul className="cloud-sync-bullets">
            <li>{t("Atomic per-id writes minimise Dropbox / Drive merge conflicts.", "Id-bazlı tekil yazımlar Dropbox / Drive birleşme çakışmalarını minimize eder.")}</li>
            <li>{t("Live workspace watcher pings a toast when a teammate's change lands.", "Canlı watcher bir ekip arkadaşı değişiklik yaptığında toast ile haber verir.")}</li>
            <li>{t("An activity.json log captures who did what and when.", "Bir activity.json kim ne zaman ne yaptı bilgisini tutar.")}</li>
          </ul>
        </div>
      </section>

      {/* ── Data & Backup ─────────────────────────────────────────────────── */}
      <BackupSection
        t={t}
        handleExportBackup={handleExportBackup}
        handleImportBackup={handleImportBackup}
        refreshGames={refreshGames}
      />

      {/* ── Keyboard shortcuts ────────────────────────────────────────────── */}
      <ShortcutsSection
        language={language}
        t={t}
        showToast={showToast}
      />

      {/* ── About ───────────────────────────────────────────────────────────── */}
      <section className="panel profile-page about-panel" style={{ marginTop: 18 }}>
        <div className="profile-hero" style={{ alignItems: "flex-start" }}>
          <div className="profile-hero-avatar" style={{ background: "linear-gradient(135deg, #7c3aed, #06b6d4)" }}>
            <Info size={28} strokeWidth={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="eyebrow">{t("ABOUT", "HAKKINDA")}</p>
            <h2 style={{ margin: "2px 0 4px" }}>
              HeraVex v{APP_VERSION}
            </h2>
            <p className="section-copy" style={{ marginTop: 4 }}>
              {t(
                `Build date: ${APP_BUILD_DATE} · Tauri + React desktop suite for indie game studios.`,
                `Build tarihi: ${APP_BUILD_DATE} · Bağımsız oyun stüdyoları için Tauri + React masaüstü paketi.`
              )}
            </p>
          </div>
        </div>

        <div className="about-actions">
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={() => {
              resetTutorial();
              window.dispatchEvent(new CustomEvent("heravex:start-tutorial"));
            }}
            title={TUTORIAL_UI[language].startTitle}
          >
            <Sparkles size={13} style={{ marginRight: 6 }} />
            {TUTORIAL_UI[language].startTitle}
          </button>
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={() => void viewReleases()}
            title={RELEASES_URL}
          >
            <RefreshCcw size={13} style={{ marginRight: 6 }} />
            {t("View releases", "Sürümleri Gör")}
          </button>
          <span className="about-helper">
            {t(
              "Latest builds are published on GitHub.",
              "En son sürüm GitHub'da yayınlanır.",
            )}
          </span>
          <button
            type="button"
            className="about-link-btn"
            onClick={() => void sendFeedback()}
          >
            <Mail size={12} style={{ marginRight: 5 }} />
            {t("Send feedback", "Geri bildirim gönder")}
          </button>
        </div>
      </section>
    </motion.div>
  );
}




// ── Backup section (was SettingsModal) ─────────────────────────────────
function BackupSection({
  t,
  handleExportBackup,
  handleImportBackup,
  refreshGames,
}: {
  t: (en: string, tr: string) => string;
  handleExportBackup: () => Promise<void>;
  handleImportBackup: () => Promise<void>;
  refreshGames: () => Promise<void>;
}) {
  return (
    <section className="panel profile-page" style={{ marginTop: 18 }}>
      <div className="profile-hero" style={{ alignItems: "flex-start" }}>
        <div
          className="profile-hero-avatar"
          style={{ background: "linear-gradient(135deg, #f59e0b, #f87171)" }}
        >
          <Database size={28} strokeWidth={2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="eyebrow">{t("DATA & BACKUP", "VERİ & YEDEK")}</p>
          <h2 style={{ margin: "2px 0 4px" }}>{t("Export & Import", "Dışa & İçe Aktar")}</h2>
          <p className="section-copy" style={{ marginTop: 4 }}>
            {t(
              "Bundle every game, note, expense and integration into a single JSON file you can stash anywhere. Restore on a new machine in one click.",
              "Tüm oyunları, notları, giderleri ve entegrasyonları tek bir JSON dosyasına paketle ve istediğin yere sakla. Yeni bir makinede tek tıkla geri yükle."
            )}
          </p>
        </div>
      </div>

      <div className="api-grid" style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void handleExportBackup()}
        >
          <Download size={14} style={{ marginRight: 8 }} />
          {t("Export backup", "Yedek Al")}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={async () => {
            await handleImportBackup();
            await refreshGames();
          }}
        >
          <Upload size={14} style={{ marginRight: 8 }} />
          {t("Import backup", "Yedek Yükle")}
        </button>
      </div>
    </section>
  );
}

// ── Shortcuts section (was SettingsModal) ──────────────────────────────
function ShortcutsSection({
  language,
  t,
  showToast,
}: {
  language: "tr" | "en" | "fr" | "es";
  t: (en: string, tr: string) => string;
  showToast: (msg: string, type?: "success" | "error" | "info" | "warning") => void;
}) {
  const isMac = detectMac();
  const [defs, setDefs] = useState<Record<ShortcutAction, ShortcutDef>>(() => loadShortcuts());
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setCapturing(null);
        return;
      }
      const combo = captureKeyEvent(e);
      if (!combo) return;
      e.preventDefault();
      e.stopPropagation();

      // Reject combos already bound to another action.
      const clash = (Object.values(defs) as ShortcutDef[]).find(
        (d) => d.action !== capturing && d.combo === combo,
      );
      if (clash) {
        showToast(
          t(
            `Combo "${formatCombo(combo, isMac)}" is already in use.`,
            `"${formatCombo(combo, isMac)}" zaten kullanılıyor.`,
          ),
          "error",
        );
        setCapturing(null);
        return;
      }

      const next = { ...defs, [capturing]: { ...defs[capturing], combo } };
      setDefs(next);
      saveShortcuts(next);
      setCapturing(null);
      showToast(
        t(`Shortcut updated: ${formatCombo(combo, isMac)}`,
          `Kısayol güncellendi: ${formatCombo(combo, isMac)}`),
        "success",
      );
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, defs, isMac, showToast, language, t]);

  const restore = () => {
    resetShortcuts();
    setDefs({ ...DEFAULT_SHORTCUTS });
    showToast(t("Shortcuts restored.", "Kısayollar varsayılana döndürüldü."), "success");
  };

  const actions: ShortcutAction[] = ["openCommandPalette", "newGame", "openTasks", "openNotes"];

  return (
    <section className="panel profile-page" style={{ marginTop: 18 }}>
      <div className="profile-hero" style={{ alignItems: "flex-start" }}>
        <div
          className="profile-hero-avatar"
          style={{ background: "linear-gradient(135deg, #4f8cff, #06b6d4)" }}
        >
          <Keyboard size={28} strokeWidth={2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="eyebrow">{t("KEYBOARD", "KLAVYE")}</p>
          <h2 style={{ margin: "2px 0 4px" }}>
            {t("Keyboard shortcuts", "Klavye Kısayolları")}
          </h2>
          <p className="section-copy" style={{ marginTop: 4 }}>
            {t(
              "Ctrl/Cmd is implied — click Rebind, press the second key.",
              "Ctrl/Cmd otomatik — Yeniden Ata'ya tıkla, ikinci tuşa bas."
            )}
          </p>
        </div>
        <button
          type="button"
          className="secondary-button compact-button"
          onClick={restore}
          title={t("Restore defaults", "Varsayılana dön")}
        >
          <RotateCcw size={13} style={{ marginRight: 6 }} />
          {t("Defaults", "Varsayılan")}
        </button>
      </div>

      <ul className="settings-shortcut-list" style={{ marginTop: 14 }}>
        {actions.map((a) => {
          const def = defs[a];
          const isCapturing = capturing === a;
          return (
            <li key={a} className="settings-shortcut-row">
              <span className="settings-shortcut-label">{actionLabel(a, language)}</span>
              {isCapturing ? (
                <span className="settings-shortcut-combo settings-shortcut-capturing">
                  {t("Press a key… (Esc cancel)", "Tuşa bas… (Esc iptal)")}
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setCapturing(null)}
                    title={t("Cancel", "İptal")}
                  >
                    <XIcon size={12} />
                  </button>
                </span>
              ) : (
                <span className="settings-shortcut-combo">
                  <kbd>{formatCombo(def.combo, isMac)}</kbd>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setCapturing(a)}
                    title={t("Rebind", "Yeniden ata")}
                  >
                    <Pencil size={12} />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}


function ApiKeyField({
  label,
  placeholder,
  value,
  onChange,
  visible,
  onToggleVisible,
  connected,
  connectedLabel,
  helper,
  comingSoon = false,
  comingSoonLabel = "Coming soon",
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
  connected: boolean;
  connectedLabel: string;
  helper?: React.ReactNode;
  comingSoon?: boolean;
  comingSoonLabel?: string;
}) {
  return (
    <div className={`api-key-field ${comingSoon ? "api-key-field-soon" : ""}`}>
      <div className="api-key-header">
        <span className="api-key-label">{label}</span>
        {comingSoon ? (
          <span className="api-status-badge api-status-soon">
            <Sparkles size={12} strokeWidth={2.4} />
            {comingSoonLabel}
          </span>
        ) : (
          <span className={`api-status-badge ${connected ? "api-status-on" : "api-status-off"}`}>
            {connected ? <CheckCircle2 size={12} strokeWidth={2.4} /> : <Circle size={12} strokeWidth={2.4} />}
            {connected ? connectedLabel : "—"}
          </span>
        )}
      </div>
      <div className="api-key-input-wrap">
        <input
          className="input api-key-input"
          type={visible ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          disabled={comingSoon}
        />
        {!comingSoon && (
          <button
            type="button"
            className="api-key-eye"
            onClick={onToggleVisible}
            title={visible ? "Hide" : "Show"}
          >
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {helper}
    </div>
  );
}
