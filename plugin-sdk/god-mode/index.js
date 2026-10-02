// God Mode ⚡ — HeraVex "Sınırsız Güç" katmanı vitrin/test eklentisi.
//
// Dört damarı da canlı kullanır:
//   1. hv.dom       → Cyberpunk neon tema enjeksiyonu + sidebar'a rozet
//   2. hv.editor    → [progress:70] syntax'ını renkli ilerleme çubuğuna çevirir
//   3. hv.hooks     → game/note kaydını yakalar, damgalar + toast
//   4. hv.hotkeys/menu → Ctrl+Shift+G ve sağ-tık ile havalı bildirim
//
// Tümü vanilla DOM. Her kayıt bir disposer döndürür; eklenti
// kapatılınca host hepsini otomatik temizler (tema, rozet, hook'lar,
// hotkey — hiçbir artık kalmaz).

// ─────────────────────────────────────────────────────────────────────
// 1) NEON TEMA  (hv.dom.injectStyle)
// ─────────────────────────────────────────────────────────────────────
const NEON_CSS = `
  :root {
    --accent: #00fff2 !important;
    --accent-soft: rgba(0, 255, 242, 0.16) !important;
  }
  /* Neon kenarlıklı paneller + hafif tarama çizgisi hissi */
  .panel, .hero-stat-card, .plugin-row {
    border-color: rgba(0, 255, 242, 0.35) !important;
    box-shadow: 0 0 14px rgba(0, 255, 242, 0.10), inset 0 0 22px rgba(255, 0, 200, 0.04) !important;
  }
  .sidebar, .modern-sidebar {
    background: linear-gradient(180deg, #0a0014 0%, #10001f 100%) !important;
    border-right: 1px solid rgba(255, 0, 200, 0.35) !important;
  }
  .nav-item.active, .sidebar-nav-item.active {
    box-shadow: 0 0 12px rgba(0, 255, 242, 0.45) !important;
    text-shadow: 0 0 8px rgba(0, 255, 242, 0.8) !important;
  }
  h1, h2, h3, .hero-stat-value {
    text-shadow: 0 0 10px rgba(0, 255, 242, 0.35) !important;
  }
  /* İlerleme çubuğu (editör syntax'ı) */
  .god-progress {
    display: inline-flex; align-items: center; gap: 8px;
    vertical-align: middle; margin: 2px 0;
    font-family: ui-monospace, monospace; font-size: 12px;
  }
  .god-progress-track {
    width: 160px; height: 12px; border-radius: 999px;
    background: rgba(255,255,255,.08);
    border: 1px solid rgba(0,255,242,.4); overflow: hidden;
  }
  .god-progress-fill {
    height: 100%; border-radius: 999px;
    background: linear-gradient(90deg, #00fff2, #ff00c8);
    box-shadow: 0 0 10px rgba(0,255,242,.6);
    transition: width .4s ease;
  }
  .god-progress-num { color: #00fff2; font-weight: 700; }
`;

export default function activate(hv) {
  const t = (en, tr) => (hv.language === "tr" ? tr : en);

  // Neon tema — tercihe göre açık başlar. injectStyle bir disposer döner;
  // onu saklayıp aç/kapat için kullanıyoruz.
  let neonDispose = null;
  const neonOn = () => {
    if (neonDispose) return;
    neonDispose = hv.dom.injectStyle(NEON_CSS);
    hv.storage.set("neon", true);
  };
  const neonOff = () => {
    if (!neonDispose) return;
    neonDispose();          // <style>'ı kaldırır
    neonDispose = null;
    hv.storage.set("neon", false);
  };
  const neonToggle = () => {
    if (neonDispose) { neonOff(); hv.toast(t("Neon off", "Neon kapandı"), "info"); }
    else { neonOn(); hv.toast(t("Neon ON ⚡", "Neon AÇIK ⚡"), "success"); }
  };
  if (hv.storage.get("neon") !== false) neonOn();

  // ───────────────────────────────────────────────────────────────────
  // 1b) Güvenli slot → sidebar nav altına "God Mode aktif" rozeti.
  // ───────────────────────────────────────────────────────────────────
  // ESKİ sürüm ⚡'yı onElement ile doğrudan marka başlığına eklerdi —
  // bu React'in DOM'una dokunmaktır (yasak) ve markanın ciddiyetini
  // bozar. Artık resmi güvenli slot kullanılıyor.
  const badge = document.createElement("div");
  badge.textContent = "⚡ God Mode";
  badge.style.cssText =
    "margin:8px 12px;padding:6px 10px;border-radius:9px;text-align:center;" +
    "font-size:11px;font-weight:700;color:#00fff2;background:rgba(0,255,242,.12)";
  hv.dom.mountToSlot("sidebar-nav-end", badge);

  // ───────────────────────────────────────────────────────────────────
  // 2) EDİTÖR — "/" menüsüne ilerleme çubuğu snippet'i ekler
  // ───────────────────────────────────────────────────────────────────
  // v0.9.9 sağlamlaştırma: canlı-syntax dönüşümü kaldırıldı (contentEditable
  // mutasyonu kaydetme round-trip'iyle çakışıyordu). Slash komutu güvenli
  // yol — caret'e DÜZENLENEBİLİR, normal bir HTML çubuk yazar.
  const bar = (pct) =>
    `<span class="god-progress" contenteditable="false">` +
    `<span class="god-progress-track"><span class="god-progress-fill" style="width:${pct}%"></span></span>` +
    `<span class="god-progress-num">${pct}%</span></span>&nbsp;`;
  hv.editor.addSlashCommand({
    id: "progress",
    label: t("Progress bar (70%)", "İlerleme çubuğu (%70)"),
    hint: "▓▓░",
    onSelect: (insert) => insert(bar(70)),
  });

  // ───────────────────────────────────────────────────────────────────
  // 3) HOOKS — kaydı yakala, damgala + toast
  // ───────────────────────────────────────────────────────────────────
  // Not: burada veriyi DEĞİŞTİRİYORUZ (summary/content sonuna görünmez
  // damga). null döndürseydik kaydı ENGELLERDİK.
  const STAMP = "\n<!-- 👁 God-Mode tarafından izlendi -->";

  hv.hooks.filter("game:beforeSave", (game) => {
    hv.toast(t(`👁 Watching save: ${game.title}`, `👁 Kayıt izleniyor: ${game.title}`), "info");
    if (typeof game.summary === "string" && !game.summary.includes("God-Mode")) {
      return { ...game, summary: game.summary + STAMP };
    }
    return game;
  });

  hv.hooks.filter("note:beforeSave", (note) => {
    if (typeof note.content === "string" && !note.content.includes("God-Mode")) {
      return { ...note, content: note.content + STAMP };
    }
    return note;
  });

  // after* olayı: sadece bildirim (veriyi değiştiremez)
  hv.hooks.on("game:afterDelete", () => {
    hv.toast(t("A game was deleted. God saw it. 💀", "Bir oyun silindi. Tanrı gördü. 💀"), "warning");
  });

  // Canlı state izleme — oyun sayısı değişince say
  hv.store.watch(
    (s) => (s.games ? s.games.length : 0),
    (next, prev) => {
      if (next > prev) hv.toast(t(`New game! Total: ${next} 🎮`, `Yeni oyun! Toplam: ${next} 🎮`), "success");
    },
  );

  // ───────────────────────────────────────────────────────────────────
  // 4) INPUT — Ctrl+Shift+G hotkey + sağ-tık menüsü
  // ───────────────────────────────────────────────────────────────────
  const QUIPS = [
    ["You now wield God Mode. Use it wisely. ⚡", "Artık God Mode senin. Bilgece kullan. ⚡"],
    ["Reality bends to your cursor. 🌀", "Gerçeklik imlecine boyun eğiyor. 🌀"],
    ["Somewhere, a bug just fled in terror. 🐛💨", "Bir yerlerde bir bug korkuyla kaçtı. 🐛💨"],
    ["ROOT access to your imagination granted. 🔓", "Hayal gücüne ROOT erişimi verildi. 🔓"],
  ];
  const quip = () => {
    const q = QUIPS[Math.floor(Math.random() * QUIPS.length)];
    hv.toast(t(q[0], q[1]), "success");
  };

  hv.hotkeys.register("Ctrl+Shift+G", quip);

  hv.menu.register({
    id: "invoke",
    title: t("⚡ Invoke God Mode", "⚡ God Mode'u çağır"),
    onClick: quip,
  });
  hv.menu.register({
    id: "toggle-neon",
    title: t("🎨 Toggle neon theme", "🎨 Neon temayı aç/kapat"),
    onClick: neonToggle,
  });

  // Komut paleti komutu (manifest'te tanımlı)
  hv.registerCommand("toggle-neon", neonToggle);

  // ───────────────────────────────────────────────────────────────────
  // Vitrin sayfası — dört gücün özeti + canlı kontroller
  // ───────────────────────────────────────────────────────────────────
  hv.registerPage("console", (root) => {
    const games = hv.getGames();
    root.innerHTML = `
      <div style="padding:28px;max-width:760px;font-family:ui-monospace,monospace;color:#dce7f6">
        <h1 style="margin:0 0 4px;color:#00fff2">⚡ GOD MODE CONSOLE</h1>
        <p style="color:#ff00c8;margin:0 0 20px">// Sınırsız Güç katmanı — canlı test paneli</p>
        <div style="display:grid;gap:12px">
          ${card("1 · DOM / TEMA", t(
            "Neon theme injected app-wide + a ⚡ badge on the sidebar.",
            "Uygulama geneline neon tema + sidebar'da ⚡ rozeti enjekte edildi."))}
          ${card("2 · EDİTÖR", t(
            "Type [progress:70] in any note → live progress bar.",
            "Herhangi bir nota [progress:70] yaz → canlı ilerleme çubuğu."))}
          ${card("3 · HOOKS", t(
            "Every game/note save is watched & stamped. Games tracked: " + games.length,
            "Her game/note kaydı izlenir & damgalanır. İzlenen oyun: " + games.length))}
          ${card("4 · INPUT", t(
            "Press Ctrl+Shift+G or right-click anywhere for a God quip.",
            "Ctrl+Shift+G'ye bas ya da bir yere sağ-tıkla."))}
        </div>
        <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
          <button id="god-neon" class="god-btn">🎨 ${t("Toggle Neon", "Neon Aç/Kapat")}</button>
          <button id="god-quip" class="god-btn">⚡ ${t("Invoke", "Çağır")}</button>
        </div>
        <p style="margin-top:24px;color:#5a6b82;font-size:12px">${t(
          "Live editor demo:", "Canlı editör demosu:")} <code style="color:#00fff2">[progress:70]</code></p>
      </div>
    `;
    const style = document.createElement("style");
    style.textContent = `.god-btn{cursor:pointer;padding:10px 16px;border-radius:10px;
      background:rgba(0,255,242,.1);border:1px solid rgba(0,255,242,.5);color:#00fff2;
      font-family:inherit;font-weight:700}.god-btn:hover{background:rgba(0,255,242,.2)}`;
    root.appendChild(style);
    root.querySelector("#god-neon").onclick = neonToggle;
    root.querySelector("#god-quip").onclick = quip;
  });

  function card(title, body) {
    return `<div style="padding:14px 16px;border:1px solid rgba(0,255,242,.3);
      border-radius:12px;background:rgba(0,255,242,.03)">
      <div style="color:#00fff2;font-weight:700;font-size:12px;letter-spacing:.08em">${title}</div>
      <div style="color:#a9bad2;font-size:13px;margin-top:4px">${body}</div></div>`;
  }

  // ───────────────────────────────────────────────────────────────────
  // Ayarlar paneli — neon açık/kapalı tercihi
  // ───────────────────────────────────────────────────────────────────
  hv.registerSettings("prefs", (root) => {
    const label = document.createElement("label");
    label.style.cssText = "display:flex;gap:10px;align-items:center;padding:8px 4px;color:#dce7f6;font-size:13px;cursor:pointer";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !!neonDispose;
    box.onchange = () => (box.checked ? neonOn() : neonOff());
    const span = document.createElement("span");
    span.textContent = t("Neon theme enabled", "Neon tema açık");
    label.append(box, span);
    root.append(label);
  });

  // activate temizlik fonksiyonu döndürebilir; ama tüm hv.* kayıtları
  // zaten otomatik dispose olduğu için burada elle bir şey yapmıyoruz.
  // (neon <style>'ı da injectStyle disposer'ıyla host tarafından
  // temizlenir.)
}
