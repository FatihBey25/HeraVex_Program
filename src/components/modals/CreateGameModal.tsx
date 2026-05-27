import { useState } from "react";
import { useAppStore } from "../../store";
import { useEscape } from "../../lib/keyboard";
import { STATUSES, PLATFORMS } from "../../lib/storage";
import type { GameStatus } from "../../types";

interface Props {
  onClose: () => void;
}

export function CreateGameModal({ onClose }: Props) {
  const { handleCreateGame, setSelectedId, setWorkspaceTab, language, ui } = useAppStore();

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState<GameStatus>("Fikir");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);

  useEscape(onClose);

  const togglePlatform = (p: string) => {
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    const created = await handleCreateGame({
      title: title.trim(),
      summary: summary.trim(),
      status,
      platforms,
      tags: [],
      budget: budget ? Number(budget) : undefined,
    });
    setBusy(false);
    if (created) {
      setSelectedId(created.id);
      setWorkspaceTab("library");
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">{ui.gamesEyebrow}</p>
            <h3>{ui.createProjectTitle}</h3>
            <p className="detail-copy">{ui.createProjectBody}</p>
          </div>
          <button className="icon-button" onClick={onClose}>{ui.close}</button>
        </div>

        <label>
          <span>{ui.gameName}</span>
          <input
            className="input"
            placeholder={ui.gameNamePlaceholder}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </label>

        <label>
          <span>{ui.shortDescription}</span>
          <textarea
            className="textarea"
            placeholder={ui.shortDescriptionPlaceholder}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </label>

        <label>
          <span>{ui.developmentStatus}</span>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as GameStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {(ui as unknown as { statuses: Record<string, string> }).statuses[s] ?? s}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{ui.targetPlatforms}</span>
          <div className="platform-grid">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                className={`filter-chip ${platforms.includes(p) ? "filter-chip-active" : ""}`}
                onClick={() => togglePlatform(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </label>

        <div className="button-row" style={{ marginTop: "1.5rem" }}>
          <button className="secondary-button" onClick={onClose}>{ui.cancel}</button>
          <button className="primary-button" disabled={!title.trim() || busy} onClick={() => void handleSubmit()}>
            {ui.createGame}
          </button>
        </div>
      </div>
    </div>
  );
}
