// Settings → Plugins (v0.9.9).
//
// Manager UI for the plugin system: install (file or URL, consent-gated
// with the manifest's permission list), enable/disable, uninstall, and
// hosting for plugin-contributed settings panels. All destructive /
// code-executing steps funnel through the consent modal — nothing is
// extracted before the user approves.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Puzzle } from "lucide-react";
import { useAppStore } from "../../../store";
import { SettingGroup } from "./rows/SettingGroup";
import { SettingRow } from "./rows/SettingRow";
import { Toggle, CompactButton } from "./rows/controls";
import {
  getPluginList, getPluginSettingsPanels, setPluginEnabled,
  fetchPluginPreview, confirmPluginInstall, discardStagedPlugin,
  uninstallPlugin, pickPluginArchive, initPlugins,
  type PluginListItem, type PluginFetchPreview, type PluginRender, type PluginPermission,
} from "../../../lib/plugins";

/** Consent-screen labels for manifest permissions. Unknown permissions
 *  fall through as the raw string so a newer plugin still renders
 *  something meaningful. */
function permissionLabel(perm: string, tr: (en: string, t: string) => string): string {
  const map: Record<string, [string, string]> = {
    readGames:  ["Read your games & projects", "Oyunlarını ve projelerini okuma"],
    readTasks:  ["Read your tasks", "Görevlerini okuma"],
    readNotes:  ["Read your notes", "Notlarını okuma"],
    writeNotes: ["Create & edit notes", "Not oluşturma ve düzenleme"],
    readWallet: ["Read financial data", "Finans verilerini okuma"],
    network:    ["Access the internet (hv.fetch)", "İnternete erişim (hv.fetch)"],
    storage:    ["Store its own data", "Kendi verilerini saklama"],
    dom:        ["Modify the interface (CSS & existing UI)", "Arayüzü değiştirme (CSS ve mevcut UI)"],
    hooks:      ["Intercept & modify save/delete operations", "Kaydetme/silme işlemlerine müdahale"],
    editor:     ["Extend the note editor", "Not editörünü genişletme"],
    input:      ["Add hotkeys & right-click menu items", "Kısayol ve sağ-tık menüsü ekleme"],
  };
  const hit = map[perm];
  return hit ? tr(hit[0], hit[1]) : perm;
}

/** Mounts one plugin-contributed settings panel into a plain DOM node. */
function PluginSettingsHost({ render }: { render: PluginRender }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = "";
    let cleanup: (() => void) | void;
    try { cleanup = render(el); } catch { /* contained */ }
    return () => { try { cleanup?.(); } catch { /* plugin */ } el.innerHTML = ""; };
  }, [render]);
  return <div ref={ref} className="plugin-settings-host" />;
}

export function PluginsPage() {
  const { language, showToast } = useAppStore();
  const tr = (en: string, t: string) => (language === "tr" ? t : en);

  const [list, setList] = useState<PluginListItem[]>(() => getPluginList());
  const [panels, setPanels] = useState(() => getPluginSettingsPanels());
  const [consent, setConsent] = useState<PluginFetchPreview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onChange = () => { setList(getPluginList()); setPanels(getPluginSettingsPanels()); };
    window.addEventListener("heravex:plugins-changed", onChange);
    // Refresh once on mount in case discovery finished before we mounted.
    void initPlugins();
    return () => window.removeEventListener("heravex:plugins-changed", onChange);
  }, []);

  const startInstall = async (source: string) => {
    setBusy(true);
    try {
      const preview = await fetchPluginPreview(source);
      setConsent(preview);
    } catch (err) {
      showToast(String(err), "error");
    } finally { setBusy(false); }
  };

  const installFromFile = async () => {
    const path = await pickPluginArchive();
    if (path) await startInstall(path);
  };
  const installFromUrl = async () => {
    const url = window.prompt(tr("Plugin archive URL (.zip)", "Eklenti arşiv URL'si (.zip)"), "https://");
    if (url && url.trim() && url.trim() !== "https://") await startInstall(url.trim());
  };

  const approveConsent = async () => {
    if (!consent) return;
    setBusy(true);
    try {
      const manifest = await confirmPluginInstall(consent.staged);
      setConsent(null);
      showToast(tr(`Installed: ${manifest.name}`, `Yüklendi: ${manifest.name}`), "success");
    } catch (err) {
      showToast(String(err), "error");
    } finally { setBusy(false); }
  };
  const cancelConsent = async () => {
    if (consent) await discardStagedPlugin(consent.staged);
    setConsent(null);
  };

  const removePlugin = async (item: PluginListItem) => {
    const ok = window.confirm(tr(
      `Uninstall "${item.manifest.name}"? Its files will be deleted.`,
      `"${item.manifest.name}" kaldırılsın mı? Dosyaları silinecek.`,
    ));
    if (!ok) return;
    setBusy(true);
    try {
      await uninstallPlugin(item.manifest.id);
      showToast(tr("Plugin removed.", "Eklenti kaldırıldı."), "info");
    } catch (err) {
      showToast(String(err), "error");
    } finally { setBusy(false); }
  };

  const statusLabelOf = (p: PluginListItem) =>
    p.status === "active" ? tr("Active", "Aktif")
    : p.status === "error" ? tr("Failed", "Hata")
    : tr("Disabled", "Devre dışı");

  return (
    <>
      <SettingGroup label={tr("Install", "Yükle")}>
        <SettingRow
          title={tr("Add a plugin", "Eklenti ekle")}
          description={tr(
            "Only install plugins you trust — they run with full access to the app.",
            "Yalnızca güvendiğin eklentileri yükle — uygulamada tam yetkiyle çalışırlar.",
          )}
          control={
            <div style={{ display: "inline-flex", gap: 6 }}>
              <CompactButton onClick={() => void installFromFile()} disabled={busy}>
                {tr("From file (.zip)", "Dosyadan (.zip)")}
              </CompactButton>
              <CompactButton onClick={() => void installFromUrl()} disabled={busy}>
                {tr("From URL", "URL'den")}
              </CompactButton>
            </div>
          }
        />
      </SettingGroup>

      <SettingGroup label={tr("Installed plugins", "Yüklü eklentiler")}>
        {list.length === 0 ? (
          <SettingRow
            title={tr("No plugins installed", "Yüklü eklenti yok")}
            description={tr(
              "Plugins add new pages, widgets and commands to HeraVex.",
              "Eklentiler HeraVex'e yeni sayfalar, widget'lar ve komutlar ekler.",
            )}
          />
        ) : (
          <div className="plugin-list">
            {list.map((p) => (
              <div key={p.manifest.id} className={`plugin-row status-${p.status}`}>
                <div className="plugin-row-icon"><Puzzle size={17} /></div>
                <div className="plugin-row-body">
                  <div className="plugin-row-title">
                    <strong>{p.manifest.name}</strong>
                    <span className="plugin-row-version">v{p.manifest.version}</span>
                    {p.manifest.author && <span className="plugin-row-author">· {p.manifest.author}</span>}
                    <span className={`plugin-row-status is-${p.status}`}>{statusLabelOf(p)}</span>
                  </div>
                  {p.manifest.description && <p className="plugin-row-desc">{p.manifest.description}</p>}
                  {p.status === "error" && p.error && <p className="plugin-row-error">{p.error}</p>}
                </div>
                <div className="plugin-row-actions">
                  <Toggle checked={p.enabled} onChange={(v) => setPluginEnabled(p.manifest.id, v)} />
                  <CompactButton variant="danger" onClick={() => void removePlugin(p)} disabled={busy}>
                    {tr("Remove", "Kaldır")}
                  </CompactButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingGroup>

      {panels.map((panel) => (
        <SettingGroup key={panel.key} label={`${panel.pluginName} — ${panel.title}`}>
          <PluginSettingsHost render={panel.render} />
        </SettingGroup>
      ))}

      {consent && createPortal(
        <div className="plugin-consent-backdrop" onMouseDown={() => void cancelConsent()}>
          <div className="plugin-consent" onMouseDown={(e) => e.stopPropagation()}>
            <div className="plugin-consent-head">
              <Puzzle size={20} />
              <div>
                <strong>{consent.manifest.name}</strong>
                <span className="plugin-consent-meta">
                  v{consent.manifest.version}{consent.manifest.author ? ` · ${consent.manifest.author}` : ""}
                </span>
              </div>
            </div>
            {consent.manifest.description && (
              <p className="plugin-consent-desc">{consent.manifest.description}</p>
            )}
            <p className="plugin-consent-perms-label">
              {tr("This plugin requests:", "Bu eklenti şunları istiyor:")}
            </p>
            <ul className="plugin-consent-perms">
              {(consent.manifest.permissions ?? []).length === 0 ? (
                <li>{tr("No data permissions", "Veri izni istemiyor")}</li>
              ) : (
                (consent.manifest.permissions ?? []).map((perm: PluginPermission) => (
                  <li key={perm}>{permissionLabel(perm, tr)}</li>
                ))
              )}
            </ul>
            <p className="plugin-consent-warning">
              {tr(
                "Plugins run with full application access. Install only from sources you trust.",
                "Eklentiler uygulamada tam yetkiyle çalışır. Yalnızca güvendiğin kaynaklardan yükle.",
              )}
            </p>
            <div className="plugin-consent-actions">
              <CompactButton onClick={() => void cancelConsent()} disabled={busy}>
                {tr("Cancel", "Vazgeç")}
              </CompactButton>
              <button type="button" className="primary-button compact-button" onClick={() => void approveConsent()} disabled={busy}>
                {tr("Install", "Yükle")}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
