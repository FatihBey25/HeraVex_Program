import { useAppStore } from "../../../store";
import { openStorePage, openExternal } from "../../../lib/storage";
import { Plus, Trash2, ExternalLink } from "lucide-react";
import type { CustomLink, GameRecord } from "../../../types";

const STORES = [
  { key: "steam" as const, title: "Steam" },
  { key: "itch" as const, title: "itch.io" },
  { key: "play" as const, title: "Play Store" },
];

export function IntegrationsTab({ gameId }: { gameId: string }) {
  const { games, handleSaveGame, ui, language } = useAppStore();
  const game = games.find((g) => g.id === gameId);
  if (!game) return null;

  const tr = (en: string, t: string) => (language === "tr" ? t : en);
  const customLinks: CustomLink[] = game.customLinks ?? [];

  const persistCustom = (next: CustomLink[]) =>
    void handleSaveGame({ ...game, customLinks: next });

  const updateCustom = (index: number, patch: Partial<CustomLink>) => {
    const next = customLinks.map((l, i) => (i === index ? { ...l, ...patch } : l));
    persistCustom(next);
  };

  const addCustomRow = () => {
    if (customLinks.length >= 8) return;
    persistCustom([...customLinks, { label: "", url: "" }]);
  };

  const removeCustomRow = (index: number) => {
    persistCustom(customLinks.filter((_, i) => i !== index));
  };

  const openCustom = (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    // v0.9 fix — Tauri's webview blocks `window.open` for external
    // schemes, so the old call silently no-op'd. Route through the
    // Rust `open_external` command (already wired for the "Send
    // feedback" + releases buttons) which validates the URL and hands
    // it to the OS default handler.
    //
    // Users typed `gog.com/...` without a scheme often enough that
    // we just prepend `https://` rather than reject the click.
    const hasScheme = /^(https?:|mailto:)/i.test(trimmed);
    const finalUrl = hasScheme ? trimmed : `https://${trimmed}`;
    void openExternal(finalUrl).catch((err) => {
      // Surface real errors (e.g. URL parse failure on the Rust side)
      // instead of silently dropping the click as the old version did.
      console.warn("[custom link] open failed:", err);
    });
  };

  return (
    <div key="integrations" className="tab-panel tab-content">
      <div className="analytics-grid">
        {STORES.map(({ key, title }) => {
          const store = game.stores[key];
          return (
            <div key={key} className="analytics-card integration-card">
              <span>{title}</span>
              <input
                className="input"
                placeholder={ui.storeLinkPlaceholder(title)}
                value={store.externalId}
                onChange={(e) =>
                  void handleSaveGame({
                    ...game,
                    stores: {
                      ...game.stores,
                      [key]: { ...store, externalId: e.target.value, enabled: Boolean(e.target.value.trim()) },
                    },
                  })
                }
              />
              <div className="button-row">
                <button
                  className="secondary-button"
                  onClick={() =>
                    void handleSaveGame({
                      ...game,
                      stores: { ...game.stores, [key]: { ...store, externalId: "", enabled: false } },
                    })
                  }
                >
                  {ui.clear}
                </button>
                <button
                  className="primary-button"
                  disabled={!store.externalId.trim()}
                  onClick={() => void openStorePage(game.id, key)}
                >
                  {ui.openPage}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="analytics-note">{ui.integrationHint}</p>

      {/* ── Custom Links / Social Marketplaces ─────────────────────────── */}
      <section className="custom-links-panel">
        <div className="custom-links-head">
          <div>
            <p className="eyebrow">{tr("CUSTOM LINKS", "ÖZEL BAĞLANTILAR")}</p>
            <h4 style={{ margin: "2px 0 4px" }}>
              {tr("Other Stores / Social Media", "Diğer Mağazalar / Sosyal Medya")}
            </h4>
            <p className="section-copy" style={{ margin: 0, fontSize: 12.5 }}>
              {tr(
                "GOG, Patreon, Discord, Twitter, press kit links — anywhere you want a one-click jump.",
                "GOG, Patreon, Discord, Twitter, press kit linkleri — tek tıkla atlamak istediğin her yer."
              )}
            </p>
          </div>
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={addCustomRow}
            disabled={customLinks.length >= 8}
          >
            <Plus size={14} style={{ marginRight: 6 }} />
            {tr("Add link", "Bağlantı ekle")}
          </button>
        </div>

        {customLinks.length === 0 ? (
          <p className="empty-inline-state" style={{ marginTop: 12 }}>
            {tr(
              "No custom links yet. Add up to 8 extra slots.",
              "Henüz özel bağlantı yok. 8 adede kadar ekleyebilirsin."
            )}
          </p>
        ) : (
          <div className="custom-links-grid">
            {customLinks.map((link, i) => (
              <div key={i} className="custom-link-row">
                <input
                  className="input custom-link-label"
                  placeholder={tr("Label (GOG, Patreon…)", "Etiket (GOG, Patreon…)")}
                  value={link.label}
                  onChange={(e) => updateCustom(i, { label: e.target.value })}
                  spellCheck={false}
                />
                <input
                  className="input custom-link-url"
                  placeholder="https://…"
                  value={link.url}
                  onChange={(e) => updateCustom(i, { url: e.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => openCustom(link.url)}
                  disabled={!link.url.trim()}
                  title={tr("Open", "Aç")}
                >
                  <ExternalLink size={14} />
                </button>
                <button
                  type="button"
                  className="icon-button icon-button-danger"
                  onClick={() => removeCustomRow(i)}
                  title={tr("Remove", "Sil")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// Ensure GameRecord import for type narrowing (not strictly needed, but documents intent)
const _typeAnchor: GameRecord | null = null;
void _typeAnchor;
