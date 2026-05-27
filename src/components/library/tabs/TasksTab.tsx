import { useMemo, useState } from "react";
import { useAppStore } from "../../../store";
import { compareTasks, taskDeadlineLabel, dueToneClass, priorityLabel } from "../../../lib/i18n";
import type { TaskItem } from "../../../types";

export function TasksTab({ gameId }: { gameId: string }) {
  const { games, handleSaveGame, toggleTask, deleteTask, language, ui } = useAppStore();
  const game = games.find((g) => g.id === gameId);

  const [titleDraft, setTitleDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [priorityDraft, setPriorityDraft] = useState<1 | 2 | 3>(2);
  const [dueDateDraft, setDueDateDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const sortedTasks = useMemo(() => {
    if (!game) return [];
    return [...game.tasks].sort((a, b) => compareTasks(a, b));
  }, [game]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase(language);
    if (!q) return sortedTasks;
    return sortedTasks.filter((t) =>
      [t.title, t.description].join(" ").toLocaleLowerCase(language).includes(q)
    );
  }, [sortedTasks, searchQuery, language]);

  if (!game) return null;

  const addTask = async () => {
    if (!titleDraft.trim()) return;
    const task: TaskItem = {
      id: crypto.randomUUID(),
      title: titleDraft.trim(),
      description: descDraft.trim(),
      done: false,
      priority: priorityDraft,
      dueDate: dueDateDraft || undefined,
      timeSpentSeconds: 0,
      runningSince: new Date().toISOString(), // auto-start when task is created
    };
    await handleSaveGame({ ...game, tasks: [...game.tasks, task] }, ui.taskAdded);
    setTitleDraft(""); setDescDraft(""); setPriorityDraft(2); setDueDateDraft("");
  };

  return (
    <div key="tasks" className="tab-panel tab-content">
      <div className="task-creator">
        <h4>{ui.addTaskToGame}</h4>
        <input className="input" placeholder={ui.taskTitlePlaceholder} value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} />
        <textarea className="textarea" placeholder={ui.taskDescriptionPlaceholder} value={descDraft} onChange={(e) => setDescDraft(e.target.value)} />
        <label>
          <span>{ui.dueDate}</span>
          <input className="input" type="date" value={dueDateDraft} onChange={(e) => setDueDateDraft(e.target.value)} />
        </label>
        <div className="inline-grid task-inline">
          <select className="input" value={priorityDraft} onChange={(e) => setPriorityDraft(Number(e.target.value) as 1 | 2 | 3)}>
            <option value={3}>{ui.highPriority}</option>
            <option value={2}>{ui.mediumPriority}</option>
            <option value={1}>{ui.lowPriority}</option>
          </select>
          <button className="primary-button" onClick={() => void addTask()}>{ui.addTask}</button>
        </div>
      </div>

      <input className="input" placeholder={ui.searchTasks} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />

      <div className="stack-list">
        {!filtered.length && <div className="empty-inline-state">{ui.noTasksFound}</div>}
        {filtered.map((task) => (
          <div key={task.id} className="task-row">
            <div>
              <strong>{task.title}</strong>
              <p>{task.description || ui.noDescription}</p>
              <small className={`due-chip ${dueToneClass(task)}`}>
                {taskDeadlineLabel(task, language)}
              </small>
            </div>
            <div className="button-row">
              <span className={`priority-badge priority-${task.priority}`}>{priorityLabel(task.priority, language)}</span>
              <button className="secondary-button" onClick={() => void toggleTask(game.id, task.id)}>
                {task.done ? ui.reopen : ui.complete}
              </button>
              <button className="secondary-button danger-button" onClick={() => void deleteTask(game.id, task.id)}>
                {ui.delete}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
