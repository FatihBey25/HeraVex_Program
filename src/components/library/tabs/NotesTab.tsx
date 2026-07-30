import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../../store";
import { MarkdownWorkspace, type SaveStatus, type MarkdownTemplate } from "../../shared/MarkdownWorkspace";

const GDD_TEMPLATE_TR = `# {{title}} — Game Design Document

> Versiyon 1.0 · HeraVex · {{date}}

## 1. Oyun Özeti (High Concept)
- **Tek cümle:** _Buraya oyununu bir satırda anlat._
- **Tür / Hedef Kitle:**
- **Platform:**
- **Referans Oyunlar:**

## 2. Temel Mekanikler (Core Loop)
- Adım 1 →
- Adım 2 →
- Adım 3 →

\`\`\`text
[Player Action] → [Game Response] → [Reward] → [New Challenge]
\`\`\`

## 3. Hikaye ve Karakterler
- **Ana Karakter:**
- **Çatışma:**
- **Ana Hat:**

- [ ] Karakter taslakları hazır
- [ ] Mihenk taşı sahneler yazıldı

## 4. Sanat Tarzı ve Sesler
- **Görsel Stil:**
- **Renk Paleti:**
- **Ses Yönü / Müzik:**
- **Referanslar:** (link ekle)
`;

const GDD_TEMPLATE_EN = `# {{title}} — Game Design Document

> Version 1.0 · HeraVex · {{date}}

## 1. High Concept
- **Pitch (one sentence):** _Describe the game in a single line._
- **Genre / Audience:**
- **Platform:**
- **Reference titles:**

## 2. Core Loop
- Step 1 →
- Step 2 →
- Step 3 →

\`\`\`text
[Player Action] → [Game Response] → [Reward] → [New Challenge]
\`\`\`

## 3. Story & Characters
- **Protagonist:**
- **Conflict:**
- **Main arc:**

- [ ] Character sketches ready
- [ ] Key scenes drafted

## 4. Art Style & Audio
- **Visual style:**
- **Color palette:**
- **Audio direction / music:**
- **References:** (add link)
`;

export function NotesTab({ gameId }: { gameId: string }) {
  const { games, handleSaveGame, language, ui, showToast, showError } = useAppStore();
  const game = games.find((g) => g.id === gameId);
  const [draft, setDraft] = useState(game?.notes ?? "");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setDraft(game?.notes ?? ""); }, [game?.id]);

  if (!game) return null;

  const tr = (en: string, t: string) => (language === "tr" ? t : en);

  const persist = async (value: string) => {
    if (value === game.notes) { setSaveStatus("saved"); return; }
    setSaveStatus("saving");
    await handleSaveGame({ ...game, notes: value });
    setSaveStatus("saved");
  };

  const onChange = (value: string) => {
    setDraft(value);
    setSaveStatus("idle");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void persist(value), 800);
  };

  const exportPdf = async () => {
    // v0.9.7 PDF rewrite — browser-print path. See
    // `lib/notePdfExport.ts` for the full rationale; the short version
    // is the old Rust printpdf path couldn't render UTF-8 and didn't
    // understand the editor's HTML output.
    try {
      if (draft !== game.notes) await persist(draft);
      const { exportNoteAsPdf } = await import("../../../lib/notePdfExport");
      await exportNoteAsPdf(draft || "", {
        title: game.title,
        subtitle: `${tr("Status", "Durum")}: ${game.status}`,
        eyebrow: tr("HERAVEX · GAME DESIGN DOCUMENT", "HERAVEX · GAME DESIGN DOCUMENT"),
        meta: (game.platforms || []).join(" · ") || tr("No platforms set", "Platform yok"),
      }, language);
      showToast(tr("Print dialog opened — choose Save as PDF.", "Yazdırma penceresi açıldı — PDF olarak kaydet seç."), "success");
    } catch (err) {
      const msg = String(err);
      if (!msg.includes("iptal")) showError(err);
    }
  };

  const templates: MarkdownTemplate[] = [
    {
      id: "gdd",
      label: tr("Game Design Document", "Game Design Document"),
      build: () =>
        (language === "tr" ? GDD_TEMPLATE_TR : GDD_TEMPLATE_EN)
          .replace("{{title}}", game.title)
          .replace("{{date}}", new Date().toLocaleDateString()),
    },
  ];

  return (
    <div className="tab-panel tab-content notes-tab-wrap">
      <MarkdownWorkspace
        key={`game-notes:${game.id}`}
        value={draft}
        onChange={onChange}
        language={language}
        ui={ui}
        saveStatus={saveStatus}
        templates={templates}
        onExportPdf={exportPdf}
        customTemplateScope={`game-${game.id}`}
      />
    </div>
  );
}
