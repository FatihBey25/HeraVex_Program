import { useAppStore } from "../../store";
import { useEscape } from "../../lib/keyboard";
import type { AppLanguage } from "../../lib/i18n";

interface Props {
  onClose: () => void;
}

const LANGUAGE_OPTIONS: { key: AppLanguage; label: string; native: string }[] = [
  { key: "en", label: "English", native: "English" },
  { key: "tr", label: "Turkish", native: "Türkçe" },
  { key: "fr", label: "French", native: "Français" },
  { key: "es", label: "Spanish", native: "Español" },
];

export function LanguageModal({ onClose }: Props) {
  const { language, setLanguage, ui } = useAppStore();

  useEscape(onClose);

  const handleSelect = async (lang: AppLanguage) => {
    await setLanguage(lang);
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>{ui.languageTitle}</h3>
            <p className="detail-copy">{ui.languageBody}</p>
          </div>
          <button className="icon-button" onClick={onClose}>{ui.close}</button>
        </div>

        <div className="language-option-list">
          {LANGUAGE_OPTIONS.map(({ key, label, native }) => (
            <button
              key={key}
              className={`language-option-btn ${language === key ? "language-option-active" : ""}`}
              onClick={() => void handleSelect(key)}
            >
              <strong>{native}</strong>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
