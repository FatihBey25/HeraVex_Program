import { useRef, useState, type ChangeEvent } from "react";
import { Clock, Megaphone } from "lucide-react";
import { useAppStore } from "../../../store";
import { TagEditor } from "../../shared/TagEditor";
import { PLATFORMS } from "../../../lib/storage";
import { openCurrentBuild } from "../../../lib/storage";
import { saveImageToDisk, fileToBase64 } from "../../../lib/images";
import { sumEffectiveSeconds, formatDuration, useSecondTicker } from "../../../lib/taskTimer";
import { PressKitModal } from "../../modals/PressKitModal";
import type { GameRecord } from "../../../types";

export function OverviewTab({ gameId }: { gameId: string }) {
  const { games, handleSaveGame, showToast, showError, language, ui } = useAppStore();
  const game = games.find((g) => g.id === gameId);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [pressKitOpen, setPressKitOpen] = useState(false);

  // Live update if any task is running.
  const anyRunning = !!game?.tasks?.some((t) => !t.done && t.runningSince);
  useSecondTicker(anyRunning);

  if (!game) return null;

  const totalSeconds = sumEffectiveSeconds(game.tasks);

  const update = (patch: Partial<GameRecord>) =>
    void handleSaveGame({ ...game, ...patch });

  const handleCoverSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const base64 = await fileToBase64(file);
      const path = await saveImageToDisk(base64, game.id);
      void handleSaveGame({ ...game, coverDataUrl: path }, ui.coverSaved);
    } catch (err) {
      showError(err);
    }
  };

  return (
    <div key="overview" className="tab-panel tab-content">
      <div className="field-grid">
        <label>
          <span>{ui.title}</span>
          <input
            className="input"
            value={game.title}
            onChange={(e) => update({ title: e.target.value })}
          />
        </label>
        <label>
          <span>{ui.status}</span>
          <select
            className="input"
            value={game.status}
            onChange={(e) => update({ status: e.target.value as typeof game.status })}
          >
            {(["Fikir","Prototip","Demo","Alpha","Beta","Yayina Hazir","Yayinda"] as const).map((s) => (
              <option key={s} value={s}>{ui.statuses ? (ui as unknown as { statuses: Record<string, string> }).statuses[s] : s}</option>
            ))}
          </select>
        </label>
      </div>

      <label>
        <span>{ui.description}</span>
        <textarea
          className="textarea large"
          value={game.summary}
          onChange={(e) => update({ summary: e.target.value })}
        />
      </label>

      <div className="tag-editor-block">
        <span className="label">{ui.tags}</span>
        <TagEditor
          tags={game.tags}
          inputValue={tagInput}
          onInputChange={setTagInput}
          onAdd={() => {
            const t = tagInput.trim();
            if (t && !game.tags.includes(t)) {
              update({ tags: [...game.tags, t] });
              setTagInput("");
            }
          }}
          onRemove={(tag) => update({ tags: game.tags.filter((t) => t !== tag) })}
          addLabel={ui.addTag}
          inputPlaceholder={ui.tagPlaceholder}
        />
      </div>

      <div>
        <span className="label">{ui.platforms}</span>
        <div className="chip-group">
          {PLATFORMS.map((platform) => {
            const active = game.platforms.includes(platform);
            return (
              <button
                key={platform}
                type="button"
                className={`chip ${active ? "chip-active" : ""}`}
                onClick={() =>
                  update({
                    platforms: active
                      ? game.platforms.filter((p) => p !== platform)
                      : [...game.platforms, platform],
                  })
                }
              >
                {platform}
              </button>
            );
          })}
        </div>
      </div>

      {totalSeconds > 0 && (
        <div className="game-time-aggregate" title={language === "tr" ? "Tüm görevlerde harcanan toplam süre" : "Total time across all tasks"}>
          <Clock size={14} strokeWidth={2} />
          <span>{language === "tr" ? "Bu oyuna harcanan" : "Time on this game"}:</span>
          <strong>{formatDuration(totalSeconds, language)}</strong>
        </div>
      )}

      <div className="button-row">
        <button className="secondary-button" onClick={() => coverInputRef.current?.click()}>
          {ui.selectCover}
        </button>
        <button
          type="button"
          className="secondary-button press-kit-trigger"
          onClick={() => setPressKitOpen(true)}
          title={language === "tr" ? "Profesyonel basın kiti üret" : "Generate a professional press kit"}
        >
          <Megaphone size={14} style={{ marginRight: 6 }} />
          {language === "tr" ? "Press Kit Bas" : "Generate Press Kit"}
        </button>
        <button className="primary-button" onClick={() => void openCurrentBuild(game.id)}>
          {ui.openGame}
        </button>
      </div>

      <input ref={coverInputRef} type="file" accept="image/*" hidden onChange={handleCoverSelected} />

      {pressKitOpen && (
        <PressKitModal game={game} onClose={() => setPressKitOpen(false)} />
      )}
    </div>
  );
}
