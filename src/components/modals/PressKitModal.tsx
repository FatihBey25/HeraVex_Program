import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Megaphone, FolderOpen, X, Plus, Trash2, Loader2 } from "lucide-react";
import { useAppStore } from "../../store";
import { generatePressKit, pickDirectory, revealInFolder } from "../../lib/storage";
import type { GameRecord, PressKitInput, PressKitTemplateId, CustomLink } from "../../types";

export function PressKitModal({
  game,
  onClose,
}: {
  game: GameRecord;
  onClose: () => void;
}) {
  const { language, showToast, showError } = useAppStore();
  const tr = (en: string, t: string) => (language === "tr" ? t : en);

  const defaultInput = useMemo<PressKitInput>(
    () => ({
      description: game.summary ?? "",
      features: [],
      history: "",
      developer: "HeraVex",
      releaseDate: game.status,
      website: "",
      pressContact: "",
      pricing: "",
      languages: "English",
      socialLinks: [],
      templateId: "classic",
      darkMode: false,
    }),
    [game]
  );

  const TEMPLATES: { id: PressKitTemplateId; label: { en: string; tr: string }; desc: { en: string; tr: string } }[] = [
    {
      id: "classic",
      label: { en: "Classic", tr: "Klasik" },
      desc: {
        en: "Two-column doPressKit standard with screenshots and factsheet.",
        tr: "doPressKit standardında iki sütun, ekran görüntüleri ve factsheet."
      },
    },
    {
      id: "minimal",
      label: { en: "Minimal", tr: "Minimal" },
      desc: {
        en: "Single column, lightweight, shareable on social.",
        tr: "Tek sütun, hafif, sosyal medyada paylaşılabilir."
      },
    },
    {
      id: "factsheet",
      label: { en: "Journalist Factsheet", tr: "Gazeteci Factsheet" },
      desc: {
        en: "Press-first layout: factsheet table at the top.",
        tr: "Basın odaklı düzen: factsheet tablosu önde."
      },
    },
    {
      id: "indie",
      label: { en: "Indie Spotlight", tr: "Indie Spotlight" },
      desc: {
        en: "Bold gradient hero, designed for social posts and convention booths.",
        tr: "İddialı gradient hero — sosyal paylaşım ve fuar standları için."
      },
    },
  ];

  const [input, setInput] = useState<PressKitInput>(defaultInput);
  const [busy, setBusy] = useState(false);

  const patch = (p: Partial<PressKitInput>) => setInput((prev) => ({ ...prev, ...p }));

  const addFeature = () => patch({ features: [...input.features, ""] });
  const updateFeature = (i: number, value: string) => {
    const next = input.features.slice();
    next[i] = value;
    patch({ features: next });
  };
  const removeFeature = (i: number) => {
    patch({ features: input.features.filter((_, idx) => idx !== i) });
  };

  const addSocial = () =>
    patch({ socialLinks: [...input.socialLinks, { label: "", url: "" } as CustomLink] });
  const updateSocial = (i: number, k: keyof CustomLink, value: string) => {
    const next = input.socialLinks.map((sl, idx) => (idx === i ? { ...sl, [k]: value } : sl));
    patch({ socialLinks: next });
  };
  const removeSocial = (i: number) => {
    patch({ socialLinks: input.socialLinks.filter((_, idx) => idx !== i) });
  };

  const onGenerate = async () => {
    setBusy(true);
    try {
      const dir = await pickDirectory();
      const kitPath = await generatePressKit(game.id, dir, input);
      showToast(
        tr(`Press kit ready: ${kitPath}`, `Basın kiti hazırlandı: ${kitPath}`),
        "success",
        () => { void revealInFolder(kitPath); },
        tr("Open folder", "Klasörü Aç")
      );
      onClose();
    } catch (err) {
      const msg = String(err);
      if (!msg.includes("iptal")) showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop press-kit-backdrop" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <motion.div
        className="modal-box press-kit-modal"
        initial={{ opacity: 0, y: -10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.34, 1.3, 0.64, 1] }}
      >
        <header className="press-kit-head">
          <div className="press-kit-head-icon">
            <Megaphone size={22} strokeWidth={2.1} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="eyebrow">{tr("PRESS KIT", "BASIN KİTİ")}</p>
            <h2 style={{ margin: "2px 0 4px" }}>{game.title}</h2>
            <p className="section-copy" style={{ margin: 0 }}>
              {tr(
                "Edit the marketing copy and factsheet before we lay out the doPressKit-style HTML.",
                "doPressKit standardındaki HTML'yi oluşturmadan önce pazarlama metnini ve factsheet'i düzenle."
              )}
            </p>
          </div>
          <button className="icon-button" onClick={onClose} title={tr("Close", "Kapat")}>
            <X size={16} />
          </button>
        </header>

        <div className="press-kit-form">
          {/* Template picker */}
          <fieldset className="press-kit-field press-kit-template-picker">
            <legend>{tr("Template", "Şablon")}</legend>
            <div className="press-kit-template-grid">
              {TEMPLATES.map((tpl) => {
                const active = (input.templateId ?? "classic") === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    className={`press-kit-template-card ${active ? "is-active" : ""}`}
                    onClick={() => patch({ templateId: tpl.id })}
                  >
                    <span className={`press-kit-template-thumb pk-thumb-${tpl.id}${input.darkMode && (tpl.id === "minimal" || tpl.id === "factsheet") ? " is-dark" : ""}`} aria-hidden />
                    <strong>{tpl.label[language === "tr" ? "tr" : "en"]}</strong>
                    <small>{tpl.desc[language === "tr" ? "tr" : "en"]}</small>
                  </button>
                );
              })}
            </div>

            {/* Dark-mode toggle — only meaningful for the two light templates */}
            {(input.templateId === "minimal" || input.templateId === "factsheet") && (
              <label className="press-kit-dark-toggle">
                <input
                  type="checkbox"
                  checked={!!input.darkMode}
                  onChange={(e) => patch({ darkMode: e.target.checked })}
                />
                <span>
                  {tr(
                    "Use dark palette for this template",
                    "Bu şablon için karanlık paleti kullan"
                  )}
                </span>
              </label>
            )}
          </fieldset>

          <label className="press-kit-field">
            <span>{tr("Description", "Açıklama")}</span>
            <textarea
              className="textarea"
              rows={4}
              value={input.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder={tr("Two-paragraph elevator pitch…", "İki paragraflık asansör konuşması…")}
            />
          </label>

          <label className="press-kit-field">
            <span>{tr("History", "Geçmiş")}</span>
            <textarea
              className="textarea"
              rows={3}
              value={input.history}
              onChange={(e) => patch({ history: e.target.value })}
              placeholder={tr("Origin story / milestones…", "Doğuş hikayesi / kilometre taşları…")}
            />
          </label>

          <fieldset className="press-kit-field press-kit-features">
            <legend>{tr("Features", "Özellikler")}</legend>
            {input.features.length === 0 && (
              <p className="press-kit-empty">
                {tr("No features yet. Add a few bullet selling points.", "Henüz özellik yok. Birkaç kısa satış noktası ekle.")}
              </p>
            )}
            {input.features.map((f, i) => (
              <div key={i} className="press-kit-feature-row">
                <input
                  className="input"
                  value={f}
                  onChange={(e) => updateFeature(i, e.target.value)}
                  placeholder={tr("Procedurally generated levels…", "Prosedürel üretilmiş bölümler…")}
                />
                <button
                  type="button"
                  className="icon-button icon-button-danger"
                  onClick={() => removeFeature(i)}
                  title={tr("Remove", "Sil")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button type="button" className="secondary-button compact-button" onClick={addFeature}>
              <Plus size={13} style={{ marginRight: 6 }} />
              {tr("Add feature", "Özellik ekle")}
            </button>
          </fieldset>

          <div className="press-kit-grid-2">
            <label className="press-kit-field">
              <span>{tr("Developer", "Geliştirici")}</span>
              <input
                className="input"
                value={input.developer}
                onChange={(e) => patch({ developer: e.target.value })}
              />
            </label>
            <label className="press-kit-field">
              <span>{tr("Release date", "Çıkış tarihi")}</span>
              <input
                className="input"
                value={input.releaseDate}
                onChange={(e) => patch({ releaseDate: e.target.value })}
                placeholder="Q3 2026"
              />
            </label>
            <label className="press-kit-field">
              <span>{tr("Website", "Web sitesi")}</span>
              <input
                className="input"
                value={input.website}
                onChange={(e) => patch({ website: e.target.value })}
                placeholder="https://heravex.dev"
              />
            </label>
            <label className="press-kit-field">
              <span>{tr("Press contact", "Basın iletişim")}</span>
              <input
                className="input"
                value={input.pressContact}
                onChange={(e) => patch({ pressContact: e.target.value })}
                placeholder="press@studio.dev"
              />
            </label>
            <label className="press-kit-field">
              <span>{tr("Pricing", "Fiyat")}</span>
              <input
                className="input"
                value={input.pricing}
                onChange={(e) => patch({ pricing: e.target.value })}
                placeholder="$14.99"
              />
            </label>
            <label className="press-kit-field">
              <span>{tr("Languages", "Diller")}</span>
              <input
                className="input"
                value={input.languages}
                onChange={(e) => patch({ languages: e.target.value })}
                placeholder="English, Türkçe"
              />
            </label>
          </div>

          <fieldset className="press-kit-field">
            <legend>{tr("Social links", "Sosyal bağlantılar")}</legend>
            {input.socialLinks.map((sl, i) => (
              <div key={i} className="press-kit-social-row">
                <input
                  className="input"
                  value={sl.label}
                  onChange={(e) => updateSocial(i, "label", e.target.value)}
                  placeholder={tr("Twitter / Discord / …", "Twitter / Discord / …")}
                />
                <input
                  className="input"
                  value={sl.url}
                  onChange={(e) => updateSocial(i, "url", e.target.value)}
                  placeholder="https://…"
                />
                <button
                  type="button"
                  className="icon-button icon-button-danger"
                  onClick={() => removeSocial(i)}
                  title={tr("Remove", "Sil")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button type="button" className="secondary-button compact-button" onClick={addSocial}>
              <Plus size={13} style={{ marginRight: 6 }} />
              {tr("Add social link", "Sosyal bağlantı ekle")}
            </button>
          </fieldset>
        </div>

        <footer className="press-kit-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            {tr("Cancel", "İptal")}
          </button>
          <button
            type="button"
            className="press-kit-cta"
            onClick={() => void onGenerate()}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 size={16} className="spin" style={{ marginRight: 8 }} />
                {tr("Generating…", "Oluşturuluyor…")}
              </>
            ) : (
              <>
                <FolderOpen size={16} style={{ marginRight: 8 }} />
                {tr("Pick folder & generate", "Klasör seç ve oluştur")}
              </>
            )}
          </button>
        </footer>
      </motion.div>
    </div>
  );
}
