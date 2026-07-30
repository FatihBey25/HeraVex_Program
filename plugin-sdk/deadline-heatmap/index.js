// HeraVex Plugin — Deadline Heatmap
// Görevlerin dueDate alanını haftalık ısı haritasına dönüştürür.

const DAY_NAMES_TR = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const DAY_NAMES_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES_TR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const MONTH_NAMES_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getWeekStart(date, mondayFirst) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = mondayFirst ? (day === 0 ? -6 : 1 - day) : -day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildTaskMap(hv) {
  const tasks = hv.getTasks();
  const excludedGames = hv.storage.get("excludedGames") || [];
  const map = {};
  for (const t of tasks) {
    if (!t.dueDate || t.done) continue;
    if (excludedGames.includes(t.gameId)) continue;
    const key = t.dueDate.slice(0, 10);
    if (!map[key]) map[key] = [];
    map[key].push(t);
  }
  return map;
}

function heatColor(count, max) {
  if (count === 0) return "rgba(255,255,255,0.03)";
  const intensity = Math.min(count / Math.max(max, 1), 1);
  if (intensity <= 0.25) return "rgba(34,197,94,0.25)";
  if (intensity <= 0.5) return "rgba(234,179,8,0.4)";
  if (intensity <= 0.75) return "rgba(249,115,22,0.55)";
  return "rgba(239,68,68,0.7)";
}

function heatBorder(count, max) {
  if (count === 0) return "rgba(255,255,255,0.06)";
  const intensity = Math.min(count / Math.max(max, 1), 1);
  if (intensity <= 0.25) return "rgba(34,197,94,0.5)";
  if (intensity <= 0.5) return "rgba(234,179,8,0.6)";
  if (intensity <= 0.75) return "rgba(249,115,22,0.7)";
  return "rgba(239,68,68,0.85)";
}

function isToday(dateStr) {
  return dateStr === dateKey(new Date());
}

function renderGrid(root, hv, weeks, options = {}) {
  const { showTaskList = false } = options;
  const tr = hv.language === "tr";
  const mondayFirst = hv.storage.get("mondayFirst") !== false;
  const dayNames = tr ? DAY_NAMES_TR : DAY_NAMES_EN;
  const monthNames = tr ? MONTH_NAMES_TR : MONTH_NAMES_EN;
  const taskMap = buildTaskMap(hv);

  const today = new Date();
  const weekStart = getWeekStart(today, mondayFirst);

  const allDays = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + w * 7 + d);
      allDays.push(dateKey(date));
    }
  }

  const maxCount = Math.max(1, ...allDays.map((k) => (taskMap[k] || []).length));

  const container = document.createElement("div");
  container.style.cssText = "display:flex;flex-direction:column;gap:6px;";

  // Day name headers
  const headerRow = document.createElement("div");
  headerRow.style.cssText = "display:grid;grid-template-columns:48px repeat(7,1fr);gap:4px;";
  headerRow.innerHTML = `<div></div>` + dayNames.map((n) =>
    `<div style="text-align:center;font-size:10px;color:#8fa3bc;text-transform:uppercase;letter-spacing:.05em;">${n}</div>`
  ).join("");
  container.append(headerRow);

  let selectedDay = null;
  const taskListEl = showTaskList ? document.createElement("div") : null;

  for (let w = 0; w < weeks; w++) {
    const row = document.createElement("div");
    row.style.cssText = "display:grid;grid-template-columns:48px repeat(7,1fr);gap:4px;";

    // Week label
    const weekDate = new Date(weekStart);
    weekDate.setDate(weekDate.getDate() + w * 7);
    const weekLabel = document.createElement("div");
    weekLabel.style.cssText = "font-size:10px;color:#6b7f96;display:flex;align-items:center;justify-content:flex-end;padding-right:6px;";
    weekLabel.textContent = `${weekDate.getDate()} ${monthNames[weekDate.getMonth()]}`;
    row.append(weekLabel);

    for (let d = 0; d < 7; d++) {
      const idx = w * 7 + d;
      const key = allDays[idx];
      const tasks = taskMap[key] || [];
      const count = tasks.length;

      const cell = document.createElement("div");
      cell.style.cssText =
        `aspect-ratio:1;border-radius:6px;display:flex;align-items:center;justify-content:center;` +
        `font-size:11px;font-weight:600;cursor:${count ? "pointer" : "default"};transition:transform .1s;` +
        `background:${heatColor(count, maxCount)};border:1px solid ${heatBorder(count, maxCount)};` +
        `color:${count ? "#fff" : "#4a5568"};` +
        (isToday(key) ? "box-shadow:0 0 0 2px var(--accent,#7aa0ff);" : "");

      cell.textContent = count || "";
      cell.title = `${key} — ${count} ${tr ? "görev" : "task(s)"}`;

      if (count && showTaskList) {
        cell.addEventListener("click", () => {
          selectedDay = key;
          renderTaskList(taskListEl, tasks, key, hv);
        });
        cell.addEventListener("mouseenter", () => { cell.style.transform = "scale(1.15)"; });
        cell.addEventListener("mouseleave", () => { cell.style.transform = "scale(1)"; });
      }

      row.append(cell);
    }
    container.append(row);
  }

  // Legend
  const legend = document.createElement("div");
  legend.style.cssText = "display:flex;align-items:center;gap:6px;margin-top:8px;font-size:10px;color:#8fa3bc;";
  legend.innerHTML =
    `<span>${tr ? "Az" : "Low"}</span>` +
    `<div style="width:14px;height:14px;border-radius:4px;background:rgba(34,197,94,0.25);"></div>` +
    `<div style="width:14px;height:14px;border-radius:4px;background:rgba(234,179,8,0.4);"></div>` +
    `<div style="width:14px;height:14px;border-radius:4px;background:rgba(249,115,22,0.55);"></div>` +
    `<div style="width:14px;height:14px;border-radius:4px;background:rgba(239,68,68,0.7);"></div>` +
    `<span>${tr ? "Yoğun" : "Heavy"}</span>`;
  container.append(legend);

  root.append(container);
  if (taskListEl) root.append(taskListEl);
}

function renderTaskList(el, tasks, dateStr, hv) {
  const tr = hv.language === "tr";
  el.innerHTML = "";
  el.style.cssText = "margin-top:16px;padding:12px 16px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);";

  const header = document.createElement("div");
  header.style.cssText = "font-size:12px;color:#8fa3bc;margin-bottom:8px;font-weight:600;";
  header.textContent = `${dateStr} — ${tasks.length} ${tr ? "görev" : "task(s)"}`;
  el.append(header);

  for (const t of tasks) {
    const item = document.createElement("div");
    item.style.cssText = "padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;align-items:center;gap:8px;";

    const priorityDot = document.createElement("span");
    const colors = { 1: "#ef4444", 2: "#f59e0b", 3: "#6b7280" };
    priorityDot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${colors[t.priority] || "#6b7280"};flex-shrink:0;`;

    const title = document.createElement("span");
    title.style.cssText = "font-size:13px;color:#dce7f6;flex:1;";
    title.textContent = t.title;

    const game = document.createElement("span");
    game.style.cssText = "font-size:11px;color:#6b7f96;";
    game.textContent = t.gameTitle;

    item.append(priorityDot, title, game);
    el.append(item);
  }
}

function getBusiestDay(hv) {
  const tr = hv.language === "tr";
  const mondayFirst = hv.storage.get("mondayFirst") !== false;
  const taskMap = buildTaskMap(hv);

  const today = new Date();
  const weekStart = getWeekStart(today, mondayFirst);
  let maxKey = null;
  let maxCount = 0;

  for (let d = 0; d < 7; d++) {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + d);
    const key = dateKey(date);
    const count = (taskMap[key] || []).length;
    if (count > maxCount) {
      maxCount = count;
      maxKey = key;
    }
  }

  if (!maxKey || maxCount === 0) {
    return tr ? "Bu hafta deadline yok!" : "No deadlines this week!";
  }
  return tr
    ? `En yoğun gün: ${maxKey} (${maxCount} görev)`
    : `Busiest day: ${maxKey} (${maxCount} tasks)`;
}

export default function activate(hv) {
  // ── Full Page: 12 haftalık heatmap ─────────────────────────────────
  hv.registerPage("heatmap", (root) => {
    const draw = () => {
      root.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.style.cssText = "padding:24px;display:flex;flex-direction:column;gap:16px;max-width:700px;";

      const h = document.createElement("h2");
      h.style.cssText = "margin:0;color:#eef4ff;display:flex;align-items:center;gap:8px;";
      h.textContent = hv.language === "tr" ? "Deadline Heatmap" : "Deadline Heatmap";

      const sub = document.createElement("p");
      sub.style.cssText = "margin:0;font-size:13px;color:#8fa3bc;";
      sub.textContent = hv.language === "tr"
        ? "Önümüzdeki 12 haftadaki görev yoğunluğu. Bir güne tıklayarak detay gör."
        : "Task density for the next 12 weeks. Click a day for details.";

      wrap.append(h, sub);
      renderGrid(wrap, hv, 12, { showTaskList: true });
      root.append(wrap);
    };
    draw();
    const unsub = hv.subscribe(draw);
    return unsub;
  });

  // ── Dashboard Widget: 4 haftalık kompakt heatmap ───────────────────
  hv.registerWidget("heatmap-mini", (root) => {
    root.style.cssText =
      "padding:14px 16px;border-radius:12px;margin-top:10px;" +
      "background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);";

    const title = document.createElement("div");
    title.style.cssText = "font-size:11px;letter-spacing:.06em;color:#8fa3bc;text-transform:uppercase;margin-bottom:10px;";
    title.textContent = hv.language === "tr" ? "Deadline Haritasi" : "Deadline Heatmap";
    root.append(title);

    renderGrid(root, hv, 4);
  });

  // ── Command: Bu haftanın en yoğun günü ─────────────────────────────
  hv.registerCommand("busiest-day", () => {
    hv.toast(getBusiestDay(hv), "info");
  });

  // ── Settings Panel ─────────────────────────────────────────────────
  hv.registerSettings("heatmap-prefs", (root) => {
    const tr = hv.language === "tr";
    root.style.cssText = "display:flex;flex-direction:column;gap:12px;padding:8px 4px;";

    // Monday first toggle
    const mondayLabel = document.createElement("label");
    mondayLabel.style.cssText = "display:flex;align-items:center;gap:10px;color:#dce7f6;font-size:13px;cursor:pointer;";
    const mondayBox = document.createElement("input");
    mondayBox.type = "checkbox";
    mondayBox.checked = hv.storage.get("mondayFirst") !== false;
    mondayBox.addEventListener("change", () => {
      hv.storage.set("mondayFirst", mondayBox.checked);
      hv.toast(tr ? "Kaydedildi." : "Saved.", "success");
    });
    const mondaySpan = document.createElement("span");
    mondaySpan.textContent = tr ? "Hafta Pazartesi başlasın" : "Week starts on Monday";
    mondayLabel.append(mondayBox, mondaySpan);
    root.append(mondayLabel);

    // Exclude games
    const games = hv.getGames();
    if (games.length > 0) {
      const divider = document.createElement("div");
      divider.style.cssText = "font-size:11px;color:#8fa3bc;text-transform:uppercase;letter-spacing:.05em;margin-top:8px;";
      divider.textContent = tr ? "Hariç tutulan oyunlar" : "Excluded games";
      root.append(divider);

      const excludedGames = hv.storage.get("excludedGames") || [];

      for (const g of games) {
        const label = document.createElement("label");
        label.style.cssText = "display:flex;align-items:center;gap:10px;color:#dce7f6;font-size:13px;cursor:pointer;padding-left:4px;";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = excludedGames.includes(g.id);
        box.addEventListener("change", () => {
          let current = hv.storage.get("excludedGames") || [];
          if (box.checked) {
            current = [...current, g.id];
          } else {
            current = current.filter((x) => x !== g.id);
          }
          hv.storage.set("excludedGames", current);
          hv.toast(tr ? "Kaydedildi." : "Saved.", "success");
        });
        const span = document.createElement("span");
        span.textContent = g.title;
        label.append(box, span);
        root.append(label);
      }
    }
  });
}
