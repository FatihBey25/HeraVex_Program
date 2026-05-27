import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Gamepad2, Link2, Unlink, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { ConfirmDialog } from "../../shared/ConfirmDialog";
import { useAppStore } from "../../../store";
import {
  fetchStoreData,
  fetchStoreGames,
  saveStoreMapping,
  unlinkStoreMapping,
} from "../../../lib/storage";
import type { GameRecord, StoreData, StoreGameInfo, StoreProvider } from "../../../types";

export function StoreSyncTab({ gameId }: { gameId: string }) {
  const {
    games, language,
    steamApiKey, itchApiKey, steamUserId,
    googlePlayJsonPath,
    applySavedGame, showToast,
  } = useAppStore();
  const game = games.find((g) => g.id === gameId);
  if (!game) return null;

  const t = (en: string, tr: string) => (language === "tr" ? tr : en);
  const mappings = game.storeMappings ?? {};

  return (
    <motion.div
      className="tab-panel storesync-tab"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
    >
      <StoreSyncRow
        provider="steam"
        providerLabel="Steam"
        apiKey={steamApiKey}
        userId={steamUserId}
        mappedId={mappings.steam?.id ?? ""}
        mappedTitle={mappings.steam?.title ?? ""}
        onMapped={applySavedGame}
        gameId={game.id}
        gameTitle={game.title}
        showToast={showToast}
        t={t}
      />
      <StoreSyncRow
        provider="itch"
        providerLabel="Itch.io"
        apiKey={itchApiKey}
        mappedId={mappings.itch?.id ?? ""}
        mappedTitle={mappings.itch?.title ?? ""}
        onMapped={applySavedGame}
        gameId={game.id}
        gameTitle={game.title}
        showToast={showToast}
        t={t}
      />
      <StoreSyncRow
        provider="play"
        providerLabel="Google Play"
        apiKey={googlePlayJsonPath}
        mappedId={mappings.play?.id ?? ""}
        mappedTitle={mappings.play?.title ?? ""}
        onMapped={applySavedGame}
        gameId={game.id}
        gameTitle={game.title}
        showToast={showToast}
        t={t}
        manualOnly
        manualPlaceholder="com.studio.gamepackage"
      />
    </motion.div>
  );
}

function StoreSyncRow({
  provider,
  providerLabel,
  apiKey,
  userId,
  mappedId,
  mappedTitle,
  onMapped,
  gameId,
  gameTitle,
  showToast,
  t,
  manualOnly = false,
  manualPlaceholder = "",
}: {
  provider: StoreProvider;
  providerLabel: string;
  apiKey: string;
  userId?: string;
  mappedId: string;
  mappedTitle: string;
  onMapped: (g: GameRecord) => void;
  gameId: string;
  gameTitle: string;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
  t: (en: string, tr: string) => string;
  manualOnly?: boolean;
  manualPlaceholder?: string;
}) {
  const showError = useAppStore((s) => s.showError);
  const connected = apiKey.trim().length > 0;
  const isMapped = mappedId.length > 0;

  const [list, setList] = useState<StoreGameInfo[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selection, setSelection] = useState<string>(mappedId);
  const [data, setData] = useState<StoreData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const autoFetchedFor = useRef<string>("");

  useEffect(() => {
    setSelection(mappedId);
  }, [mappedId]);

  const refreshData = async (silent = false) => {
    if (!mappedId) return;
    setLoadingData(true);
    setErrorMsg("");
    try {
      const d = await fetchStoreData(provider, mappedId);
      setData(d);
    } catch (err) {
      const friendly = !silent ? showError(err) : String(err);
      setErrorMsg(friendly);
    } finally {
      setLoadingData(false);
    }
  };

  // Auto-fetch live data when the mapping is present (once per mapping id).
  useEffect(() => {
    if (!isMapped) {
      setData(null);
      autoFetchedFor.current = "";
      return;
    }
    if (autoFetchedFor.current === mappedId) return;
    autoFetchedFor.current = mappedId;
    void refreshData(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappedId, provider]);

  const loadList = async () => {
    if (!connected) return;
    setLoadingList(true);
    try {
      const items = await fetchStoreGames(provider, apiKey, userId);
      setList(items);
    } catch (err) {
      showError(err);
    } finally {
      setLoadingList(false);
    }
  };

  const save = async () => {
    const picked = list.find((g) => g.id === selection);
    const title = picked?.title ?? mappedTitle ?? providerLabel;
    try {
      const updated = await saveStoreMapping(gameId, provider, selection, title);
      onMapped(updated);
      autoFetchedFor.current = "";
      showToast(t("Mapping saved.", "Eşleşme kaydedildi."), "success");
    } catch (err) {
      showError(err);
    }
  };

  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const unlink = async () => {
    try {
      const updated = await unlinkStoreMapping(gameId, provider);
      onMapped(updated);
      setData(null);
      setSelection("");
      autoFetchedFor.current = "";
      showToast(t("Connection unlinked.", "Bağlantı kesildi."), "success");
    } catch (err) {
      showError(err);
    }
  };

  return (
    <section className={`storesync-row ${isMapped ? "storesync-row-mapped" : ""}`}>
      <header className="storesync-row-head">
        <div className="storesync-row-title">
          <Gamepad2 size={18} strokeWidth={1.9} />
          <strong>{providerLabel}</strong>
          {isMapped ? (
            <span className="api-status-badge api-status-on">
              <CheckCircle2 size={12} strokeWidth={2.4} />
              {t("Mapped", "EŞLEŞTİ")}
            </span>
          ) : connected ? (
            <span className="api-status-badge api-status-off">
              <AlertCircle size={12} strokeWidth={2.4} />
              {t("Not mapped", "Eşleşmedi")}
            </span>
          ) : (
            <span className="api-status-badge api-status-off">
              <AlertCircle size={12} strokeWidth={2.4} />
              {t("No API key", "API anahtarı yok")}
            </span>
          )}
          {isMapped && mappedTitle && (
            <span className="storesync-mapped-title">
              · {mappedTitle}{" "}
              <span className="storesync-mapped-id">#{mappedId}</span>
            </span>
          )}
        </div>

        <div className="storesync-row-actions">
          {isMapped && (
            <button
              type="button"
              className="secondary-button compact-button danger-button"
              onClick={() => setConfirmUnlink(true)}
              title={t("Unlink", "Bağlantıyı kes")}
            >
              <Unlink size={14} style={{ marginRight: 6 }} />
              {t("Unlink", "Bağlantıyı Kes")}
            </button>
          )}
          {connected && !manualOnly && (
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={() => void loadList()}
              disabled={loadingList}
            >
              <RefreshCw size={14} style={{ marginRight: 6 }} />
              {loadingList
                ? t("Loading…", "Yükleniyor…")
                : list.length
                  ? t("Reload", "Yenile")
                  : t("Load my games", "Oyunlarımı getir")}
            </button>
          )}
        </div>
      </header>

      {!connected && (
        <p className="section-copy">
          {t(
            `Add your ${providerLabel} API key from the Profile page to enable mapping.`,
            `Eşleştirmeyi etkinleştirmek için Profil sayfasından ${providerLabel} API anahtarını gir.`
          )}
        </p>
      )}

      {connected && manualOnly && (
        <div className="storesync-mapper">
          <label className="storesync-label">
            {t(`Match "${gameTitle}" with:`, `"${gameTitle}" şununla eşle:`)}
          </label>
          <div className="storesync-controls">
            <input
              className="input"
              value={selection}
              onChange={(e) => setSelection(e.target.value)}
              placeholder={manualPlaceholder || t("Store ID", "Mağaza ID")}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              className="primary-button compact-button"
              disabled={!selection.trim() || selection === mappedId}
              onClick={() => void save()}
            >
              <Link2 size={14} style={{ marginRight: 6 }} />
              {t("Save mapping", "Eşleşmeyi kaydet")}
            </button>
          </div>
        </div>
      )}

      {connected && !manualOnly && (list.length > 0 || !isMapped) && (
        <div className="storesync-mapper">
          <label className="storesync-label">
            {t(`Match "${gameTitle}" with:`, `"${gameTitle}" şununla eşle:`)}
          </label>
          <div className="storesync-controls">
            <select
              className="input"
              value={selection}
              onChange={(e) => setSelection(e.target.value)}
              disabled={list.length === 0}
            >
              <option value="">
                {list.length === 0
                  ? t("— Load your games first —", "— Önce oyunlarını yükle —")
                  : t("— Select a store game —", "— Mağaza oyunu seç —")}
              </option>
              {list.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title} ({g.id})
                </option>
              ))}
            </select>
            <button
              className="primary-button compact-button"
              disabled={!selection || selection === mappedId}
              onClick={() => void save()}
            >
              <Link2 size={14} style={{ marginRight: 6 }} />
              {t("Save mapping", "Eşleşmeyi kaydet")}
            </button>
          </div>
        </div>
      )}

      {isMapped && (
        <div className="storesync-data">
          <div className="storesync-data-head">
            <span className="eyebrow">{t("LIVE DATA", "CANLI VERİ")}</span>
            <button
              className="icon-button"
              onClick={() => void refreshData()}
              title={t("Refresh", "Yenile")}
              disabled={loadingData}
            >
              <RefreshCw size={14} className={loadingData ? "spin" : ""} />
            </button>
          </div>
          {errorMsg && (
            <div className="storesync-error">
              <AlertCircle size={14} strokeWidth={2.2} />
              <span>{errorMsg}</span>
            </div>
          )}
          {loadingData && !data && !errorMsg && (
            <div className="storesync-loading">
              <RefreshCw size={14} className="spin" />
              <span>{t("Fetching store metrics…", "Mağaza metrikleri çekiliyor…")}</span>
            </div>
          )}
          {data && !errorMsg ? (
            <div className="dashboard-stats" style={{ marginTop: 10 }}>
              {provider === "steam" && (
                <>
                  <Metric label={t("Wishlist", "Wishlist")} value={data.wishlist} />
                  <Metric label={t("Recommendations", "Öneriler")} value={data.purchases} />
                </>
              )}
              {provider === "itch" && (
                <>
                  <Metric label={t("Views", "Görüntülenme")} value={data.views} />
                  <Metric label={t("Downloads", "İndirme")} value={data.downloads} />
                  <Metric label={t("Purchases", "Satın Alım")} value={data.purchases} />
                  <Metric
                    label={t("Earnings", "Kazanç")}
                    value={
                      data.earnings != null
                        ? `${data.earnings.toFixed(2)} ${data.currency ?? ""}`.trim()
                        : null
                    }
                  />
                </>
              )}
              {provider === "play" && (
                <>
                  <Metric label={t("Reviews", "Yorumlar")} value={data.purchases} />
                  <Metric label={t("Avg Rating", "Ortalama")} value={data.currency} />
                </>
              )}
            </div>
          ) : !loadingData && !errorMsg ? (
            <p className="section-copy">
              {t("Press refresh to pull store metrics.", "Mağaza metriklerini çekmek için yenile.")}
            </p>
          ) : null}
        </div>
      )}

      {confirmUnlink && (
        <ConfirmDialog
          title={t("Unlink mapping", "Bağlantıyı Kes")}
          body={
            t(
              `${providerLabel} mapping will be removed. Live metrics for this provider stop syncing until you re-map.`,
              `${providerLabel} eşleşmesi kaldırılacak. Yeniden eşleşene kadar bu sağlayıcının canlı metrikleri çekilmeyecek.`,
            )
          }
          confirmLabel={t("Unlink", "Bağlantıyı Kes")}
          cancelLabel={t("Cancel", "Vazgeç")}
          variant="warning"
          onConfirm={() => { void unlink(); setConfirmUnlink(false); }}
          onCancel={() => setConfirmUnlink(false)}
        />
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | string | null | undefined }) {
  const display =
    value == null
      ? "—"
      : typeof value === "number"
        ? value.toLocaleString()
        : value;
  return (
    <div className="metric-card">
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{display}</strong>
      <div className="metric-bar" />
    </div>
  );
}
