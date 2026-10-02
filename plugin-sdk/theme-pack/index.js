// Theme Pack v2 — 8 tema, galeri sayfasi, dashboard widget, tema dongusu.
//
// hv.themes.register API'sini kullanir: cekirdegin Ayarlar → Tema
// sayfasinda native pill olarak gorunur, uygulanir/kaydedilir/geri
// alinir. Plugin kapaninca tum temalar otomatik temizlenir.

// ── Surface selector (tum kart/panel yuzeylerini kapsar) ─────────────

const SURFACES = [
  ".panel", ".hero-stat-card", ".plugin-row", ".stat-card", ".kcard",
  ".task-card", ".task-row", ".creator-card", ".version-card",
  ".analytics-card", ".game-card", ".integration-card", ".note-browser",
  ".note-browser-item", ".storehub-card", ".profile-card", ".modern-brand",
  ".sidebar-workspace-menu", ".wallet-project-card", ".wallet-list-panel",
  ".wallet-entry", ".wallet-side-stack", ".release-card",
  ".release-template-panel", ".pomodoro-widget", ".perf-monitor",
  ".quick-actions-panel", ".hero-stat-card", ".metric-card",
  ".dashboard-task-row", ".splash-card", ".moodboard-card", ".mb-card-body",
  ".tab-panel", ".task-detail-panel", ".detail-panel-modal",
  ".settings-card", ".toast",
].join(", ");

const MODALS = [
  ".modal-box", ".confirm-dialog", ".report-preview-modal",
  ".plugin-consent", ".task-detail-panel", ".detail-panel-modal",
].join(", ");

function themeCSS({ accent, accentRgb, bg, surface, surfaceAlt, sidebar, sidebarBorder, border, text, link, extra = "" }) {
  return `
    :root {
      --accent: ${accent} !important;
      --accent-soft: rgba(${accentRgb},.18) !important;
      --accent-softer: rgba(${accentRgb},.10) !important;
      --accent-faint: rgba(${accentRgb},.04) !important;
      --accent-strong: rgba(${accentRgb},.55) !important;
      --theme-surface: ${surface} !important;
      --theme-surface-alt: ${surfaceAlt} !important;
      --theme-border: ${border} !important;
    }
    body, #root, .workspace { background: ${bg} !important; }
    ${SURFACES} { background: ${surface} !important; border-color: ${border} !important; }
    .sidebar, .modern-sidebar { background: ${sidebar} !important; border-right: 1px solid ${sidebarBorder} !important; }
    h1, h2, h3, .hero-stat-value { color: ${text} !important; }
    a { color: ${link} !important; }
    ${MODALS} { background: ${surfaceAlt} !important; border-color: ${border} !important; }
    ${extra}
  `;
}

// ── Theme definitions ────────────────────────────────────────────────

const THEMES = [
  {
    id: "dracula",
    label: "Dracula",
    preview: "#282a36",
    previewAccent: "#bd93f9",
    css: themeCSS({
      accent: "#bd93f9", accentRgb: "189,147,249",
      bg: "#282a36", surface: "#343746", surfaceAlt: "#3a3d4e",
      sidebar: "#21222c", sidebarBorder: "#44475a",
      border: "#44475a", text: "#f8f8f2", link: "#8be9fd",
    }),
  },
  {
    id: "nord",
    label: "Nord",
    preview: "#2e3440",
    previewAccent: "#88c0d0",
    css: themeCSS({
      accent: "#88c0d0", accentRgb: "136,192,208",
      bg: "#2e3440", surface: "#3b4252", surfaceAlt: "#434c5e",
      sidebar: "#292e39", sidebarBorder: "#434c5e",
      border: "#434c5e", text: "#eceff4", link: "#88c0d0",
    }),
  },
  {
    id: "aurora",
    label: "Aurora",
    preview: "#0a0e1a",
    previewAccent: "#7dd3fc",
    css: themeCSS({
      accent: "#7dd3fc", accentRgb: "125,211,252",
      bg: "#0a0e1a", surface: "rgba(16,24,48,0.75)", surfaceAlt: "rgba(22,32,60,0.85)",
      sidebar: "#080c16", sidebarBorder: "rgba(125,211,252,0.12)",
      border: "rgba(125,211,252,0.10)", text: "#e0f2fe", link: "#38bdf8",
      extra: `
        body::before {
          content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
          background:
            radial-gradient(ellipse 60% 40% at 20% 10%, rgba(56,189,248,0.18), transparent),
            radial-gradient(ellipse 50% 30% at 80% 85%, rgba(167,139,250,0.14), transparent),
            radial-gradient(ellipse 40% 35% at 50% 50%, rgba(52,211,153,0.08), transparent);
        }
      `,
    }),
  },
  {
    id: "sakura",
    label: "Sakura",
    preview: "#1a0a14",
    previewAccent: "#f9a8d4",
    css: themeCSS({
      accent: "#f9a8d4", accentRgb: "249,168,212",
      bg: "#1a0a14", surface: "rgba(48,18,36,0.72)", surfaceAlt: "rgba(60,24,46,0.82)",
      sidebar: "#140810", sidebarBorder: "rgba(249,168,212,0.12)",
      border: "rgba(249,168,212,0.10)", text: "#fce7f3", link: "#f472b6",
      extra: `
        body::before {
          content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
          background:
            radial-gradient(ellipse 55% 40% at 75% 15%, rgba(244,114,182,0.20), transparent),
            radial-gradient(ellipse 45% 35% at 25% 80%, rgba(251,113,133,0.14), transparent);
        }
      `,
    }),
  },
  {
    id: "neon-city",
    label: "Neon City",
    preview: "#0a0a1a",
    previewAccent: "#a78bfa",
    css: themeCSS({
      accent: "#a78bfa", accentRgb: "167,139,250",
      bg: "#0a0a1a", surface: "rgba(20,14,40,0.78)", surfaceAlt: "rgba(30,22,56,0.85)",
      sidebar: "#08061a", sidebarBorder: "rgba(167,139,250,0.15)",
      border: "rgba(167,139,250,0.12)", text: "#ede9fe", link: "#c084fc",
      extra: `
        body::before {
          content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
          background:
            radial-gradient(ellipse 50% 35% at 15% 20%, rgba(139,92,246,0.24), transparent),
            radial-gradient(ellipse 45% 30% at 85% 75%, rgba(236,72,153,0.18), transparent),
            radial-gradient(ellipse 30% 25% at 50% 50%, rgba(34,211,238,0.10), transparent);
        }
        .sidebar, .modern-sidebar {
          box-shadow: inset -1px 0 12px rgba(167,139,250,0.08);
        }
      `,
    }),
  },
  {
    id: "sandstorm",
    label: "Sandstorm",
    preview: "#1a1408",
    previewAccent: "#fbbf24",
    css: themeCSS({
      accent: "#fbbf24", accentRgb: "251,191,36",
      bg: "#1a1408", surface: "rgba(42,34,16,0.75)", surfaceAlt: "rgba(54,44,22,0.82)",
      sidebar: "#141006", sidebarBorder: "rgba(251,191,36,0.12)",
      border: "rgba(217,168,60,0.12)", text: "#fef3c7", link: "#f59e0b",
      extra: `
        body::before {
          content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
          background:
            radial-gradient(ellipse 60% 40% at 30% 15%, rgba(251,191,36,0.14), transparent),
            radial-gradient(ellipse 50% 35% at 70% 80%, rgba(245,158,11,0.10), transparent);
        }
      `,
    }),
  },
  {
    id: "deep-space",
    label: "Deep Space",
    preview: "#04060e",
    previewAccent: "#60a5fa",
    css: themeCSS({
      accent: "#60a5fa", accentRgb: "96,165,250",
      bg: "#04060e", surface: "rgba(8,14,30,0.80)", surfaceAlt: "rgba(14,22,44,0.85)",
      sidebar: "#030510", sidebarBorder: "rgba(96,165,250,0.08)",
      border: "rgba(96,165,250,0.08)", text: "#dbeafe", link: "#93c5fd",
      extra: `
        body::before {
          content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
          background:
            radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.6), transparent),
            radial-gradient(1px 1px at 40% 70%, rgba(255,255,255,0.4), transparent),
            radial-gradient(1px 1px at 60% 20%, rgba(255,255,255,0.5), transparent),
            radial-gradient(1px 1px at 80% 50%, rgba(255,255,255,0.3), transparent),
            radial-gradient(ellipse 40% 30% at 50% 50%, rgba(96,165,250,0.06), transparent);
        }
      `,
    }),
  },
  {
    id: "ember",
    label: "Ember",
    preview: "#1a0808",
    previewAccent: "#fb923c",
    css: themeCSS({
      accent: "#fb923c", accentRgb: "251,146,60",
      bg: "#1a0808", surface: "rgba(44,16,12,0.75)", surfaceAlt: "rgba(58,22,16,0.82)",
      sidebar: "#140606", sidebarBorder: "rgba(251,146,60,0.12)",
      border: "rgba(239,68,68,0.10)", text: "#fee2e2", link: "#f87171",
      extra: `
        body::before {
          content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
          background:
            radial-gradient(ellipse 55% 40% at 25% 20%, rgba(239,68,68,0.18), transparent),
            radial-gradient(ellipse 45% 35% at 75% 75%, rgba(251,146,60,0.14), transparent),
            radial-gradient(ellipse 30% 25% at 50% 50%, rgba(245,158,11,0.06), transparent);
        }
      `,
    }),
  },
];

// ── Helpers ──────────────────────────────────────────────────────────

function swatch(hex, size, opts = {}) {
  const el = document.createElement("div");
  el.style.cssText =
    `width:${size}px;height:${size}px;border-radius:${size > 20 ? 8 : 4}px;` +
    `background:${hex};border:2px solid rgba(255,255,255,0.12);flex-shrink:0;` +
    `cursor:${opts.click ? "pointer" : "default"};transition:transform .12s,box-shadow .12s;`;
  if (opts.click) {
    el.addEventListener("mouseenter", () => { el.style.transform = "scale(1.08)"; });
    el.addEventListener("mouseleave", () => { el.style.transform = "scale(1)"; });
  }
  if (opts.title) el.title = opts.title;
  if (opts.active) el.style.boxShadow = `0 0 0 2px ${opts.accentColor || "#7aa0ff"}`;
  return el;
}

// ── Activate ─────────────────────────────────────────────────────────

export default function activate(hv) {
  const disposers = [];

  // Register all themes with the core
  for (const t of THEMES) {
    const d = hv.themes.register({
      id: t.id, label: t.label, css: t.css,
      preview: t.preview, previewAccent: t.previewAccent,
    });
    disposers.push(d);
  }

  // ── Gallery Page ───────────────────────────────────────────────────
  hv.registerPage("theme-gallery", (root) => {
    const tr = hv.language === "tr";

    const draw = () => {
      root.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.style.cssText = "padding:24px;max-width:860px;display:flex;flex-direction:column;gap:20px;";

      const h = document.createElement("h2");
      h.style.cssText = "margin:0;color:#eef4ff;";
      h.textContent = tr ? "Tema Galerisi" : "Theme Gallery";

      const sub = document.createElement("p");
      sub.style.cssText = "margin:0;font-size:13px;color:#8fa3bc;";
      sub.textContent = tr
        ? "Bir temaya tikla ve Ayarlar → Tema'dan etkinlestir. Her tema arkaplan, yuzeyler, accent rengi ve sidebar'i kapsar."
        : "Click a theme to preview. Activate from Settings → Theme. Each theme covers background, surfaces, accent and sidebar.";
      wrap.append(h, sub);

      const grid = document.createElement("div");
      grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;";

      for (const t of THEMES) {
        const card = document.createElement("div");
        card.style.cssText =
          `border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);` +
          `cursor:pointer;transition:transform .15s,box-shadow .15s;`;
        card.addEventListener("mouseenter", () => {
          card.style.transform = "translateY(-2px)";
          card.style.boxShadow = `0 8px 24px rgba(0,0,0,0.3)`;
        });
        card.addEventListener("mouseleave", () => {
          card.style.transform = "";
          card.style.boxShadow = "";
        });

        // Preview area
        const preview = document.createElement("div");
        preview.style.cssText =
          `height:120px;background:${t.preview};position:relative;display:flex;align-items:center;justify-content:center;gap:8px;`;

        // Mini mockup: sidebar + content
        const mockSidebar = document.createElement("div");
        mockSidebar.style.cssText = `width:40px;height:80px;border-radius:6px;background:rgba(0,0,0,0.3);`;

        const mockContent = document.createElement("div");
        mockContent.style.cssText = `width:120px;height:80px;border-radius:6px;background:rgba(255,255,255,0.06);display:flex;flex-direction:column;gap:4px;padding:8px;`;

        const mockBar = document.createElement("div");
        mockBar.style.cssText = `height:6px;border-radius:3px;background:${t.previewAccent};width:70%;`;

        const mockLine1 = document.createElement("div");
        mockLine1.style.cssText = `height:4px;border-radius:2px;background:rgba(255,255,255,0.15);width:90%;`;
        const mockLine2 = document.createElement("div");
        mockLine2.style.cssText = `height:4px;border-radius:2px;background:rgba(255,255,255,0.10);width:60%;`;

        mockContent.append(mockBar, mockLine1, mockLine2);
        preview.append(mockSidebar, mockContent);

        // Info area
        const info = document.createElement("div");
        info.style.cssText = "padding:12px 14px;background:rgba(255,255,255,0.03);display:flex;align-items:center;gap:10px;";

        const accentDot = document.createElement("div");
        accentDot.style.cssText = `width:14px;height:14px;border-radius:50%;background:${t.previewAccent};flex-shrink:0;`;

        const name = document.createElement("span");
        name.style.cssText = "font-size:13px;font-weight:600;color:#dce7f6;";
        name.textContent = t.label;

        const hint = document.createElement("span");
        hint.style.cssText = "font-size:11px;color:#6b7f96;margin-left:auto;";
        hint.textContent = tr ? "Ayarlar → Tema" : "Settings → Theme";

        info.append(accentDot, name, hint);
        card.append(preview, info);

        card.addEventListener("click", () => {
          hv.toast(
            tr ? `"${t.label}" temasini Ayarlar → Tema'dan etkinlestirebilirsin.` : `Activate "${t.label}" from Settings → Theme.`,
            "info"
          );
        });

        grid.append(card);
      }

      wrap.append(grid);
      root.append(wrap);
    };

    draw();
    return hv.subscribe(draw);
  });

  // ── Dashboard Widget ───────────────────────────────────────────────
  hv.registerWidget("theme-mini", (root) => {
    const tr = hv.language === "tr";
    root.style.cssText =
      "padding:12px 16px;border-radius:12px;margin-top:10px;" +
      "background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);cursor:pointer;";
    root.addEventListener("click", () => hv.navigate("theme-gallery"));

    const title = document.createElement("div");
    title.style.cssText = "font-size:11px;letter-spacing:.06em;color:#8fa3bc;text-transform:uppercase;margin-bottom:8px;";
    title.textContent = "Theme Pack";
    root.append(title);

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:6px;align-items:center;";
    for (const t of THEMES) {
      const s = swatch(t.previewAccent, 18, { title: t.label });
      row.append(s);
    }
    const label = document.createElement("span");
    label.style.cssText = "font-size:11px;color:#6b7f96;margin-left:6px;";
    label.textContent = tr ? `${THEMES.length} tema` : `${THEMES.length} themes`;
    row.append(label);
    root.append(row);
  });

  // ── Cycle Command ──────────────────────────────────────────────────
  let cycleIdx = 0;
  hv.registerCommand("cycle-theme", () => {
    const tr = hv.language === "tr";
    const t = THEMES[cycleIdx % THEMES.length];
    cycleIdx++;
    hv.toast(
      tr ? `Tema: ${t.label} — Ayarlar'dan etkinlestir` : `Theme: ${t.label} — activate in Settings`,
      "info"
    );
  });

  // ── Settings Panel ─────────────────────────────────────────────────
  hv.registerSettings("theme-prefs", (root) => {
    const tr = hv.language === "tr";
    root.style.cssText = "display:flex;flex-direction:column;gap:10px;padding:8px 4px;";

    const desc = document.createElement("p");
    desc.style.cssText = "margin:0;font-size:12px;color:#8fa3bc;";
    desc.textContent = tr
      ? "Bu eklenti 8 tema saglar. Ayarlar → Tema sayfasindan etkinlestir."
      : "This plugin provides 8 themes. Activate them from Settings → Theme.";
    root.append(desc);

    const list = document.createElement("div");
    list.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;";
    for (const t of THEMES) {
      const pill = document.createElement("div");
      pill.style.cssText =
        `display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:8px;` +
        `background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);font-size:12px;color:#dce7f6;`;
      const dot = document.createElement("div");
      dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${t.previewAccent};`;
      pill.append(dot, document.createTextNode(t.label));
      list.append(pill);
    }
    root.append(list);
  });

  // ── Sidebar badge ──────────────────────────────────────────────────
  const badge = document.createElement("div");
  badge.style.cssText =
    "margin:8px 12px;padding:8px 10px;border-radius:10px;font-size:11px;" +
    "background:var(--accent-soft,rgba(167,139,250,.15));color:var(--accent,#a78bfa);text-align:center;cursor:pointer;";
  badge.textContent = hv.language === "tr"
    ? "Ayarlar → Tema'dan dene"
    : "Try in Settings → Theme";
  badge.addEventListener("click", () => hv.navigate("theme-gallery"));
  hv.dom.mountToSlot("sidebar-nav-end", badge);

  return () => { for (const d of disposers) d(); };
}
