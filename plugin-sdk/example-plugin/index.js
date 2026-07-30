// HeraVex örnek eklentisi — "Stüdyo İstatistikleri".
//
// Dört katkı türünün dördünü de gösterir: tam sayfa, dashboard
// widget'ı, komut paleti komutu ve ayarlar paneli. Tamamı vanilla DOM —
// framework gerekmez. Tema uyumu için uygulamanın CSS değişkenlerini
// (--accent vb.) kullanın.

/** Sayfanın ve widget'ın paylaştığı özet hesabı. */
function computeStats(hv) {
  const games = hv.getGames();
  const tasks = hv.getTasks();
  const done = tasks.filter((t) => t.done).length;
  return {
    games: games.length,
    tasks: tasks.length,
    done,
    pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
  };
}

function statCard(label, value) {
  const div = document.createElement("div");
  div.style.cssText =
    "flex:1;min-width:120px;padding:16px;border-radius:12px;" +
    "background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);";
  div.innerHTML =
    `<div style="font-size:11px;letter-spacing:.06em;color:#8fa3bc;text-transform:uppercase">${label}</div>` +
    `<div style="font-size:26px;font-weight:700;color:var(--accent,#7aa0ff);margin-top:4px">${value}</div>`;
  return div;
}

export default function activate(hv) {
  // ── Tam sayfa ──────────────────────────────────────────────────────
  hv.registerPage("stats", (root) => {
    const draw = () => {
      const s = computeStats(hv);
      root.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.style.cssText = "padding:24px;display:flex;flex-direction:column;gap:16px;";
      const h = document.createElement("h2");
      h.textContent = hv.language === "tr" ? "Stüdyo İstatistikleri" : "Studio Stats";
      h.style.cssText = "margin:0;color:#eef4ff;";
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:12px;flex-wrap:wrap;";
      row.append(
        statCard(hv.language === "tr" ? "Oyun" : "Games", s.games),
        statCard(hv.language === "tr" ? "Görev" : "Tasks", s.tasks),
        statCard(hv.language === "tr" ? "Tamamlanan" : "Done", s.done),
        statCard(hv.language === "tr" ? "İlerleme" : "Progress", s.pct + "%"),
      );
      wrap.append(h, row);
      root.append(wrap);
    };
    draw();
    const unsub = hv.subscribe(draw); // store değişince canlı güncelle
    return unsub;                     // sayfa kapanınca temizlik
  });

  // ── Dashboard widget'ı ─────────────────────────────────────────────
  hv.registerWidget("mini", (root) => {
    const s = computeStats(hv);
    root.style.cssText =
      "padding:12px 16px;border-radius:12px;margin-top:10px;" +
      "background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);" +
      "color:#dce7f6;font-size:13px;";
    root.textContent = hv.language === "tr"
      ? `🧩 ${s.games} oyun · ${s.done}/${s.tasks} görev tamam (%${s.pct})`
      : `🧩 ${s.games} games · ${s.done}/${s.tasks} tasks done (${s.pct}%)`;
  });

  // ── Komut paleti komutu ────────────────────────────────────────────
  hv.registerCommand("refresh", () => {
    const s = computeStats(hv);
    hv.toast(
      hv.language === "tr"
        ? `${s.games} oyun, ${s.tasks} görev — %${s.pct} tamam`
        : `${s.games} games, ${s.tasks} tasks — ${s.pct}% done`,
      "info",
    );
  });

  // ── Ayarlar paneli ─────────────────────────────────────────────────
  hv.registerSettings("prefs", (root) => {
    const label = document.createElement("label");
    label.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 4px;color:#dce7f6;font-size:13px;cursor:pointer;";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = hv.storage.get("greeting") !== false;
    box.addEventListener("change", () => {
      hv.storage.set("greeting", box.checked);
      hv.toast(hv.language === "tr" ? "Kaydedildi." : "Saved.", "success");
    });
    const span = document.createElement("span");
    span.textContent = hv.language === "tr"
      ? "Yenile komutunda bildirim göster"
      : "Show a toast on the refresh command";
    label.append(box, span);
    root.append(label);
  });
}
