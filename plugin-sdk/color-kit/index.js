// HeraVex Plugin — Color Kit
// Oyun bazlı renk paletleri, harmony analizi, multi-format export.

// ─── Color Utilities ─────────────────────────────────────────────────────────

function hexToHsl(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function contrastRatio(hex1, hex2) {
  const lum = (hex) => {
    const rgb = [hex.slice(1,3), hex.slice(3,5), hex.slice(5,7)]
      .map(c => { let v = parseInt(c, 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const l1 = lum(hex1), l2 = lum(hex2);
  const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
  return ((lighter + 0.05) / (darker + 0.05)).toFixed(2);
}

function generateHarmony(baseHex, type) {
  const [h, s, l] = hexToHsl(baseHex);
  switch (type) {
    case "complementary":
      return [baseHex, hslToHex((h + 180) % 360, s, l)];
    case "analogous":
      return [hslToHex((h + 330) % 360, s, l), baseHex, hslToHex((h + 30) % 360, s, l)];
    case "triadic":
      return [baseHex, hslToHex((h + 120) % 360, s, l), hslToHex((h + 240) % 360, s, l)];
    case "split-complementary":
      return [baseHex, hslToHex((h + 150) % 360, s, l), hslToHex((h + 210) % 360, s, l)];
    default:
      return [baseHex];
  }
}

function generateRandomPalette() {
  const baseH = Math.floor(Math.random() * 360);
  const baseS = 55 + Math.floor(Math.random() * 30);
  const colors = [];
  const offsets = [0, 30, 60, 180, 210];
  for (const off of offsets) {
    const h = (baseH + off) % 360;
    const l = 35 + Math.floor(Math.random() * 30);
    colors.push({ hex: hslToHex(h, baseS, l), name: "", note: "" });
  }
  return colors;
}

// ─── Export Formatters ───────────────────────────────────────────────────────

function exportCSS(palette, gameName) {
  const lines = [`/* ${gameName} — Color Palette */`, `:root {`];
  palette.forEach((c, i) => {
    const varName = c.name ? c.name.toLowerCase().replace(/\s+/g, "-") : `color-${i + 1}`;
    lines.push(`  --${varName}: ${c.hex};`);
  });
  lines.push("}");
  return lines.join("\n");
}

function exportUnity(palette, gameName) {
  const lines = [`// ${gameName} — Color Palette`, `using UnityEngine;`, "", `public static class GameColors {`];
  palette.forEach((c, i) => {
    const name = c.name ? c.name.replace(/\s+/g, "") : `Color${i + 1}`;
    const r = parseInt(c.hex.slice(1, 3), 16);
    const g = parseInt(c.hex.slice(3, 5), 16);
    const b = parseInt(c.hex.slice(5, 7), 16);
    lines.push(`    public static readonly Color ${name} = new Color(${(r/255).toFixed(3)}f, ${(g/255).toFixed(3)}f, ${(b/255).toFixed(3)}f, 1f);`);
  });
  lines.push("}");
  return lines.join("\n");
}

function exportGodot(palette, gameName) {
  const lines = [`# ${gameName} — Color Palette`, `class_name GameColors`, ""];
  palette.forEach((c, i) => {
    const name = c.name ? c.name.toUpperCase().replace(/\s+/g, "_") : `COLOR_${i + 1}`;
    const r = parseInt(c.hex.slice(1, 3), 16);
    const g = parseInt(c.hex.slice(3, 5), 16);
    const b = parseInt(c.hex.slice(5, 7), 16);
    lines.push(`const ${name} = Color(${(r/255).toFixed(3)}, ${(g/255).toFixed(3)}, ${(b/255).toFixed(3)}, 1.0)`);
  });
  return lines.join("\n");
}

function exportUnreal(palette, gameName) {
  const lines = [`// ${gameName} — Color Palette`, `// Use in Blueprint or C++`, ""];
  palette.forEach((c, i) => {
    const name = c.name ? c.name.replace(/\s+/g, "") : `Color${i + 1}`;
    const r = parseInt(c.hex.slice(1, 3), 16) / 255;
    const g = parseInt(c.hex.slice(3, 5), 16) / 255;
    const b = parseInt(c.hex.slice(5, 7), 16) / 255;
    lines.push(`const FLinearColor ${name} = FLinearColor(${r.toFixed(4)}f, ${g.toFixed(4)}f, ${b.toFixed(4)}f, 1.0f);`);
  });
  return lines.join("\n");
}

const EXPORTERS = { css: exportCSS, unity: exportUnity, godot: exportGodot, unreal: exportUnreal };

// ─── Storage Helpers ─────────────────────────────────────────────────────────

function getPalettes(hv) { return hv.storage.get("palettes") || {}; }
function savePalettes(hv, p) { hv.storage.set("palettes", p); }
function getActiveGame(hv) { return hv.storage.get("activeGame") || null; }
function setActiveGame(hv, id) { hv.storage.set("activeGame", id); }

// ─── UI Components ───────────────────────────────────────────────────────────

function colorSwatch(hex, size = 32, opts = {}) {
  const el = document.createElement("div");
  el.style.cssText =
    `width:${size}px;height:${size}px;border-radius:${size > 24 ? 8 : 4}px;` +
    `background:${hex};border:2px solid rgba(255,255,255,0.12);flex-shrink:0;` +
    `cursor:${opts.clickable ? "pointer" : "default"};transition:transform .1s;`;
  if (opts.clickable) {
    el.addEventListener("mouseenter", () => { el.style.transform = "scale(1.12)"; });
    el.addEventListener("mouseleave", () => { el.style.transform = "scale(1)"; });
  }
  if (opts.title) el.title = opts.title;
  return el;
}

function renderPaletteEditor(root, hv, gameId, onUpdate) {
  const tr = hv.language === "tr";
  const palettes = getPalettes(hv);
  const palette = palettes[gameId] || [];

  root.innerHTML = "";
  root.style.cssText = "display:flex;flex-direction:column;gap:12px;";

  // Color list
  palette.forEach((color, idx) => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);";

    const swatch = colorSwatch(color.hex, 36);

    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = color.hex;
    picker.style.cssText = "width:0;height:0;opacity:0;position:absolute;";
    swatch.addEventListener("click", () => picker.click());
    picker.addEventListener("input", () => {
      color.hex = picker.value;
      savePalettes(hv, palettes);
      onUpdate();
    });

    const hexLabel = document.createElement("code");
    hexLabel.style.cssText = "font-size:12px;color:#a0b4cc;min-width:70px;font-family:monospace;";
    hexLabel.textContent = color.hex;

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = tr ? "Renk adı..." : "Color name...";
    nameInput.value = color.name || "";
    nameInput.style.cssText = "flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:5px 8px;color:#dce7f6;font-size:12px;outline:none;";
    nameInput.addEventListener("change", () => {
      color.name = nameInput.value;
      savePalettes(hv, palettes);
    });

    const noteInput = document.createElement("input");
    noteInput.type = "text";
    noteInput.placeholder = tr ? "Kullanım notu..." : "Usage note...";
    noteInput.value = color.note || "";
    noteInput.style.cssText = "flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:5px 8px;color:#8fa3bc;font-size:11px;outline:none;";
    noteInput.addEventListener("change", () => {
      color.note = noteInput.value;
      savePalettes(hv, palettes);
    });

    const delBtn = document.createElement("button");
    delBtn.textContent = "×";
    delBtn.style.cssText = "background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;border-radius:6px;width:28px;height:28px;cursor:pointer;font-size:16px;line-height:1;";
    delBtn.addEventListener("click", () => {
      palette.splice(idx, 1);
      palettes[gameId] = palette;
      savePalettes(hv, palettes);
      onUpdate();
    });

    row.append(swatch, picker, hexLabel, nameInput, noteInput, delBtn);
    root.append(row);
  });

  // Add color button
  const addBtn = document.createElement("button");
  addBtn.textContent = tr ? "+ Renk ekle" : "+ Add color";
  addBtn.style.cssText = "align-self:flex-start;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);color:#a5b4fc;border-radius:8px;padding:8px 16px;cursor:pointer;font-size:12px;font-weight:600;";
  addBtn.addEventListener("click", () => {
    const h = Math.floor(Math.random() * 360);
    palette.push({ hex: hslToHex(h, 65, 50), name: "", note: "" });
    palettes[gameId] = palette;
    savePalettes(hv, palettes);
    onUpdate();
  });
  root.append(addBtn);
}

function renderHarmonySection(root, hv, gameId) {
  const tr = hv.language === "tr";
  const palettes = getPalettes(hv);
  const palette = palettes[gameId] || [];
  if (palette.length === 0) return;

  const section = document.createElement("div");
  section.style.cssText = "margin-top:20px;padding:16px;border-radius:10px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);";

  const title = document.createElement("div");
  title.style.cssText = "font-size:12px;color:#8fa3bc;text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px;font-weight:600;";
  title.textContent = tr ? "Renk Harmonisi" : "Color Harmony";
  section.append(title);

  const baseColor = palette[0].hex;
  const types = ["complementary", "analogous", "triadic", "split-complementary"];
  const typeLabels = tr
    ? ["Tamamlayıcı", "Benzer", "Üçlü", "Bölünmüş Tamamlayıcı"]
    : ["Complementary", "Analogous", "Triadic", "Split-Compl."];

  types.forEach((type, i) => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px;";

    const label = document.createElement("span");
    label.style.cssText = "font-size:11px;color:#6b7f96;min-width:110px;";
    label.textContent = typeLabels[i];

    const swatches = document.createElement("div");
    swatches.style.cssText = "display:flex;gap:4px;";
    const colors = generateHarmony(baseColor, type);
    colors.forEach(hex => swatches.append(colorSwatch(hex, 24, { title: hex })));

    row.append(label, swatches);
    section.append(row);
  });

  // Contrast check
  if (palette.length >= 2) {
    const contrastDiv = document.createElement("div");
    contrastDiv.style.cssText = "margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);";
    const contrastTitle = document.createElement("div");
    contrastTitle.style.cssText = "font-size:11px;color:#6b7f96;margin-bottom:6px;";
    contrastTitle.textContent = tr ? "Kontrast Oranları" : "Contrast Ratios";
    contrastDiv.append(contrastTitle);

    for (let i = 0; i < Math.min(palette.length, 4); i++) {
      for (let j = i + 1; j < Math.min(palette.length, 4); j++) {
        const ratio = contrastRatio(palette[i].hex, palette[j].hex);
        const pass = parseFloat(ratio) >= 4.5;
        const line = document.createElement("div");
        line.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:4px;";
        line.innerHTML =
          `<div style="display:flex;gap:3px;">${[colorSwatch(palette[i].hex, 16).outerHTML, colorSwatch(palette[j].hex, 16).outerHTML].join("")}</div>` +
          `<span style="font-size:11px;color:${pass ? "#4ade80" : "#f87171"};font-family:monospace;">${ratio}:1 ${pass ? "✓" : "✗"}</span>`;
        contrastDiv.append(line);
      }
    }
    section.append(contrastDiv);
  }

  root.append(section);
}

function renderExportSection(root, hv, gameId) {
  const tr = hv.language === "tr";
  const palettes = getPalettes(hv);
  const palette = palettes[gameId] || [];
  if (palette.length === 0) return;

  const games = hv.getGames();
  const game = games.find(g => g.id === gameId);
  const gameName = game ? game.title : "Game";

  const section = document.createElement("div");
  section.style.cssText = "margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;";

  const formats = [
    { key: "css", label: "CSS" },
    { key: "unity", label: "Unity C#" },
    { key: "godot", label: "GDScript" },
    { key: "unreal", label: "Unreal C++" },
  ];

  formats.forEach(({ key, label }) => {
    const btn = document.createElement("button");
    btn.textContent = `📋 ${label}`;
    btn.style.cssText = "background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);color:#dce7f6;border-radius:8px;padding:7px 14px;cursor:pointer;font-size:11px;font-weight:600;transition:background .15s;";
    btn.addEventListener("mouseenter", () => { btn.style.background = "rgba(255,255,255,0.1)"; });
    btn.addEventListener("mouseleave", () => { btn.style.background = "rgba(255,255,255,0.05)"; });
    btn.addEventListener("click", () => {
      const text = EXPORTERS[key](palette, gameName);
      navigator.clipboard.writeText(text).then(() => {
        hv.toast(tr ? `${label} formatında panoya kopyalandı!` : `Copied as ${label}!`, "success");
      });
    });
    section.append(btn);
  });

  root.append(section);
}

// ─── Plugin Activation ───────────────────────────────────────────────────────

export default function activate(hv) {

  // ── Full Page ──────────────────────────────────────────────────────────────
  hv.registerPage("palettes", (root) => {
    const draw = () => {
      const tr = hv.language === "tr";
      root.innerHTML = "";

      const wrap = document.createElement("div");
      wrap.style.cssText = "padding:24px;max-width:800px;display:flex;flex-direction:column;gap:16px;";

      // Header
      const h = document.createElement("h2");
      h.style.cssText = "margin:0;color:#eef4ff;";
      h.textContent = "Color Kit";
      wrap.append(h);

      // Game selector
      const games = hv.getGames();
      if (games.length === 0) {
        const empty = document.createElement("p");
        empty.style.cssText = "color:#8fa3bc;font-size:13px;";
        empty.textContent = tr ? "Henüz oyun yok. Önce bir oyun oluştur." : "No games yet. Create a game first.";
        wrap.append(empty);
        root.append(wrap);
        return;
      }

      let activeId = getActiveGame(hv);
      if (!activeId || !games.find(g => g.id === activeId)) {
        activeId = games[0].id;
        setActiveGame(hv, activeId);
      }

      const selector = document.createElement("div");
      selector.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
      games.forEach(g => {
        const btn = document.createElement("button");
        btn.textContent = g.title;
        const isActive = g.id === activeId;
        btn.style.cssText =
          `padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;` +
          (isActive
            ? "background:var(--accent,#7aa0ff);color:#fff;border:1px solid transparent;"
            : "background:rgba(255,255,255,0.05);color:#a0b4cc;border:1px solid rgba(255,255,255,0.1);");
        btn.addEventListener("click", () => {
          setActiveGame(hv, g.id);
          draw();
        });
        selector.append(btn);
      });
      wrap.append(selector);

      // Palette editor
      const editorRoot = document.createElement("div");
      renderPaletteEditor(editorRoot, hv, activeId, draw);
      wrap.append(editorRoot);

      // Harmony
      renderHarmonySection(wrap, hv, activeId);

      // Export
      renderExportSection(wrap, hv, activeId);

      root.append(wrap);
    };

    draw();
    const unsub = hv.subscribe(draw);
    return unsub;
  });

  // ── Dashboard Widget ───────────────────────────────────────────────────────
  hv.registerWidget("palette-mini", (root) => {
    const tr = hv.language === "tr";
    root.style.cssText =
      "padding:12px 16px;border-radius:12px;margin-top:10px;" +
      "background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);cursor:pointer;";
    root.addEventListener("click", () => hv.navigate("palettes"));

    const title = document.createElement("div");
    title.style.cssText = "font-size:11px;letter-spacing:.06em;color:#8fa3bc;text-transform:uppercase;margin-bottom:8px;";
    title.textContent = "Color Kit";
    root.append(title);

    const games = hv.getGames();
    const activeId = getActiveGame(hv) || (games[0] && games[0].id);
    if (!activeId) {
      root.append(Object.assign(document.createElement("span"), {
        textContent: tr ? "Palet yok" : "No palette",
        style: "font-size:12px;color:#6b7f96;"
      }));
      return;
    }

    const palettes = getPalettes(hv);
    const palette = palettes[activeId] || [];

    if (palette.length === 0) {
      root.append(Object.assign(document.createElement("span"), {
        textContent: tr ? "Henüz renk eklenmedi" : "No colors yet",
        style: "font-size:12px;color:#6b7f96;"
      }));
      return;
    }

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:5px;align-items:center;";
    palette.slice(0, 8).forEach(c => row.append(colorSwatch(c.hex, 22, { title: `${c.name || ""} ${c.hex}` })));
    if (palette.length > 8) {
      const more = document.createElement("span");
      more.style.cssText = "font-size:11px;color:#6b7f96;margin-left:4px;";
      more.textContent = `+${palette.length - 8}`;
      row.append(more);
    }
    root.append(row);
  });

  // ── Commands ───────────────────────────────────────────────────────────────
  hv.registerCommand("random-palette", () => {
    const tr = hv.language === "tr";
    const games = hv.getGames();
    const activeId = getActiveGame(hv) || (games[0] && games[0].id);
    if (!activeId) {
      hv.toast(tr ? "Önce bir oyun oluştur." : "Create a game first.", "warning");
      return;
    }

    const palettes = getPalettes(hv);
    palettes[activeId] = generateRandomPalette();
    savePalettes(hv, palettes);
    hv.toast(tr ? "Yeni rastgele palet oluşturuldu!" : "Random palette generated!", "success");
  });

  hv.registerCommand("export-clipboard", () => {
    const tr = hv.language === "tr";
    const games = hv.getGames();
    const activeId = getActiveGame(hv) || (games[0] && games[0].id);
    if (!activeId) { hv.toast(tr ? "Palet yok." : "No palette.", "warning"); return; }

    const palettes = getPalettes(hv);
    const palette = palettes[activeId] || [];
    if (palette.length === 0) { hv.toast(tr ? "Palet boş." : "Palette empty.", "warning"); return; }

    const format = hv.storage.get("exportFormat") || "css";
    const game = games.find(g => g.id === activeId);
    const text = EXPORTERS[format](palette, game ? game.title : "Game");
    navigator.clipboard.writeText(text).then(() => {
      hv.toast(tr ? "Panoya kopyalandı!" : "Copied to clipboard!", "success");
    });
  });

  // ── Settings ───────────────────────────────────────────────────────────────
  hv.registerSettings("color-prefs", (root) => {
    const tr = hv.language === "tr";
    root.style.cssText = "display:flex;flex-direction:column;gap:14px;padding:8px 4px;";

    // Export format
    const formatLabel = document.createElement("div");
    formatLabel.style.cssText = "font-size:11px;color:#8fa3bc;text-transform:uppercase;letter-spacing:.05em;";
    formatLabel.textContent = tr ? "Varsayılan export formatı" : "Default export format";
    root.append(formatLabel);

    const formats = [
      { key: "css", label: "CSS Variables" },
      { key: "unity", label: "Unity C#" },
      { key: "godot", label: "GDScript (Godot)" },
      { key: "unreal", label: "Unreal C++" },
    ];

    const currentFormat = hv.storage.get("exportFormat") || "css";
    const select = document.createElement("div");
    select.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";

    formats.forEach(({ key, label }) => {
      const btn = document.createElement("button");
      btn.textContent = label;
      const isActive = key === currentFormat;
      btn.style.cssText =
        `padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;transition:all .15s;` +
        (isActive
          ? "background:var(--accent,#7aa0ff);color:#fff;border:1px solid transparent;font-weight:600;"
          : "background:rgba(255,255,255,0.05);color:#a0b4cc;border:1px solid rgba(255,255,255,0.1);");
      btn.addEventListener("click", () => {
        hv.storage.set("exportFormat", key);
        hv.toast(tr ? "Kaydedildi." : "Saved.", "success");
        // re-render
        root.innerHTML = "";
        hv.registerSettings && renderSettingsContent(root, hv);
      });
      select.append(btn);
    });
    root.append(select);
  });
}
