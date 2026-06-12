// Inline typed-table database for the Notes editor (v0.9.7 Tur 3).
//
// The user's spec describes Notion-style "database" blocks embedded
// in notes — typed columns (Text / Select / Tag / Date / Number),
// inline-editable rows, and ultimately a clean JSON shape that future
// "export to Unity / Unreal" pipelines can consume.
//
// Design — JSON in the note HTML:
//   We store the whole database (schema + rows) as a JSON blob inside
//   a `data-db` attribute on a `<div class="note-db">` placeholder.
//   The note itself is the source of truth — no extra Zustand slice,
//   no extra disk file, automatic backup/portability.
//
// The mount routine (`mountDatabases`) is called from the editor's
// useEffect whenever the note content changes. It finds every
// placeholder, deserialises the JSON, and re-renders the table via
// plain DOM manipulation (no React tree inside contentEditable=false
// is fragile; vanilla DOM is bulletproof). Cell edits feed back
// through a small in-table input → onPersist callback that writes
// the new JSON into the placeholder and triggers the editor's
// emitChange so the autosaver sees it.

export type DbColumnType = "text" | "select" | "tag" | "date" | "number";

export interface DbColumn {
  id: string;
  name: string;
  type: DbColumnType;
  /** For select/tag types: the user-defined option strings. */
  options?: string[];
}

export interface DbRow {
  id: string;
  /** Cell values keyed by column id. Numbers stored as numbers,
   *  dates as ISO strings, select as a single string, tag as
   *  comma-separated string of option names. */
  cells: Record<string, string | number>;
}

export interface NoteDatabase {
  id: string;
  name: string;
  columns: DbColumn[];
  rows: DbRow[];
  createdAt: string;
  updatedAt: string;
}

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function makeDatabase(name: string): NoteDatabase {
  const now = new Date().toISOString();
  return {
    id: makeId("db"),
    name,
    columns: [
      { id: makeId("col"), name: "Name", type: "text" },
      { id: makeId("col"), name: "Status", type: "select", options: ["Idea", "WIP", "Done"] },
      { id: makeId("col"), name: "Notes", type: "text" },
    ],
    rows: [
      { id: makeId("row"), cells: {} },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

/** Serialise to the data attribute. JSON is HTML-attribute-escaped
 *  via `encodeURIComponent` so a quote inside a select option doesn't
 *  break the surrounding markup. */
export function encodeDb(db: NoteDatabase): string {
  return encodeURIComponent(JSON.stringify(db));
}
export function decodeDb(raw: string): NoteDatabase | null {
  try {
    const json = decodeURIComponent(raw);
    const parsed = JSON.parse(json) as NoteDatabase;
    if (!parsed || !Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch { return null; }
}

/** The HTML the editor inserts when the user picks "Insert Database".
 *  contentEditable=false keeps the contentEditable shell from typing
 *  into the table; all interactions go through the mount routine. */
export function buildDatabasePlaceholder(db: NoteDatabase): string {
  return `<div class="note-db" contenteditable="false" data-db="${encodeDb(db)}"></div>`;
}

// ── Mount + interactive renderer ─────────────────────────────────────

export interface MountOpts {
  language: string;
  /** Called every time the user mutates the database — the editor uses
   *  this to write the fresh JSON back into the placeholder's
   *  `data-db` attribute and bump its onChange. */
  onPersist: (placeholder: HTMLElement, db: NoteDatabase) => void;
}

/** Find every `.note-db` placeholder inside `root` and render an
 *  interactive table into it. Idempotent — re-mounting wipes the
 *  previous DOM, so this is safe to call on every editor update. */
export function mountDatabases(root: HTMLElement, opts: MountOpts): void {
  const blocks = root.querySelectorAll<HTMLElement>(".note-db[data-db]");
  blocks.forEach((block) => {
    // Skip if we already mounted (avoid clobbering the live edit
    // input during keystrokes). The mount marker is a tiny data attr.
    if (block.dataset.mounted === "1") return;
    const db = decodeDb(block.getAttribute("data-db") || "");
    if (!db) return;
    block.innerHTML = "";
    block.appendChild(renderTable(db, block, opts));
    block.dataset.mounted = "1";
  });
}

/** Called when the editor unmounts or the note swaps — wipes the
 *  mounted markers so a later mount pass re-attaches handlers fresh. */
export function unmountDatabases(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(".note-db[data-mounted]").forEach((b) => {
    delete b.dataset.mounted;
  });
}

function pickLang(language: string, en: string, tr: string, fr: string, es: string): string {
  return language === "tr" ? tr : language === "fr" ? fr : language === "es" ? es : en;
}

function renderTable(db: NoteDatabase, block: HTMLElement, opts: MountOpts): HTMLElement {
  const root = document.createElement("div");
  root.className = "note-db-inner";

  // Header — db name (editable) + add column / add row buttons.
  const head = document.createElement("div");
  head.className = "note-db-head";

  const name = document.createElement("input");
  name.className = "note-db-name";
  name.type = "text";
  name.value = db.name;
  name.placeholder = pickLang(opts.language, "Untitled database", "İsimsiz tablo", "Base sans nom", "Tabla sin nombre");
  name.addEventListener("blur", () => {
    if (name.value !== db.name) {
      db.name = name.value;
      db.updatedAt = new Date().toISOString();
      opts.onPersist(block, db);
    }
  });
  head.appendChild(name);

  const actions = document.createElement("div");
  actions.className = "note-db-head-actions";

  const addColBtn = document.createElement("button");
  addColBtn.type = "button";
  addColBtn.className = "note-db-head-btn";
  addColBtn.textContent = "+ " + pickLang(opts.language, "Column", "Sütun", "Colonne", "Columna");
  addColBtn.addEventListener("click", () => {
    db.columns.push({ id: makeId("col"), name: pickLang(opts.language, "New column", "Yeni sütun", "Nouvelle colonne", "Nueva columna"), type: "text" });
    db.updatedAt = new Date().toISOString();
    opts.onPersist(block, db);
    remount(block, opts);
  });

  const addRowBtn = document.createElement("button");
  addRowBtn.type = "button";
  addRowBtn.className = "note-db-head-btn primary";
  addRowBtn.textContent = "+ " + pickLang(opts.language, "Row", "Satır", "Ligne", "Fila");
  addRowBtn.addEventListener("click", () => {
    db.rows.push({ id: makeId("row"), cells: {} });
    db.updatedAt = new Date().toISOString();
    opts.onPersist(block, db);
    remount(block, opts);
  });

  actions.appendChild(addColBtn);
  actions.appendChild(addRowBtn);
  head.appendChild(actions);

  root.appendChild(head);

  // Table — header row + body
  const table = document.createElement("table");
  table.className = "note-db-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const col of db.columns) {
    const th = document.createElement("th");
    th.className = `note-db-th type-${col.type}`;
    th.dataset.colId = col.id;

    const colName = document.createElement("input");
    colName.className = "note-db-col-name";
    colName.type = "text";
    colName.value = col.name;
    colName.addEventListener("blur", () => {
      if (colName.value !== col.name) {
        col.name = colName.value;
        db.updatedAt = new Date().toISOString();
        opts.onPersist(block, db);
      }
    });

    const colMeta = document.createElement("div");
    colMeta.className = "note-db-col-meta";

    const typePicker = document.createElement("select");
    typePicker.className = "note-db-col-type";
    const types: { id: DbColumnType; label: string }[] = [
      { id: "text",   label: pickLang(opts.language, "Text",   "Metin",       "Texte",   "Texto") },
      { id: "select", label: pickLang(opts.language, "Select", "Çoklu Seçim", "Choix",   "Selección") },
      { id: "tag",    label: pickLang(opts.language, "Tag",    "Etiket",      "Tag",     "Etiqueta") },
      { id: "date",   label: pickLang(opts.language, "Date",   "Tarih",       "Date",    "Fecha") },
      { id: "number", label: pickLang(opts.language, "Number", "Sayı",        "Nombre",  "Número") },
    ];
    for (const t of types) {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.label;
      if (t.id === col.type) o.selected = true;
      typePicker.appendChild(o);
    }
    typePicker.addEventListener("change", () => {
      col.type = typePicker.value as DbColumnType;
      if ((col.type === "select" || col.type === "tag") && !col.options) {
        col.options = [];
      }
      db.updatedAt = new Date().toISOString();
      opts.onPersist(block, db);
      remount(block, opts);
    });

    const deleteCol = document.createElement("button");
    deleteCol.type = "button";
    deleteCol.className = "note-db-col-delete";
    deleteCol.textContent = "×";
    deleteCol.title = pickLang(opts.language, "Delete column", "Sütunu sil", "Supprimer la colonne", "Eliminar columna");
    deleteCol.addEventListener("click", () => {
      if (!confirm(pickLang(opts.language, "Delete this column?", "Bu sütun silinsin mi?", "Supprimer cette colonne ?", "¿Eliminar esta columna?"))) return;
      db.columns = db.columns.filter((c) => c.id !== col.id);
      for (const r of db.rows) delete r.cells[col.id];
      db.updatedAt = new Date().toISOString();
      opts.onPersist(block, db);
      remount(block, opts);
    });

    colMeta.appendChild(typePicker);
    colMeta.appendChild(deleteCol);

    th.appendChild(colName);
    th.appendChild(colMeta);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of db.rows) {
    const tr = document.createElement("tr");
    tr.dataset.rowId = row.id;
    for (const col of db.columns) {
      const td = document.createElement("td");
      td.className = `note-db-td type-${col.type}`;
      td.appendChild(renderCell(col, row, () => {
        db.updatedAt = new Date().toISOString();
        opts.onPersist(block, db);
      }));
      tr.appendChild(td);
    }

    // Row delete chip at the very end (outside the typed cells).
    const trDeleteWrap = document.createElement("td");
    trDeleteWrap.className = "note-db-row-actions";
    const rowDelete = document.createElement("button");
    rowDelete.type = "button";
    rowDelete.className = "note-db-row-delete";
    rowDelete.textContent = "−";
    rowDelete.title = pickLang(opts.language, "Delete row", "Satırı sil", "Supprimer la ligne", "Eliminar fila");
    rowDelete.addEventListener("click", () => {
      db.rows = db.rows.filter((r) => r.id !== row.id);
      db.updatedAt = new Date().toISOString();
      opts.onPersist(block, db);
      remount(block, opts);
    });
    trDeleteWrap.appendChild(rowDelete);
    tr.appendChild(trDeleteWrap);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  root.appendChild(table);

  // Footer hint
  const footer = document.createElement("div");
  footer.className = "note-db-foot";
  footer.textContent = `${db.rows.length} ${pickLang(opts.language, db.rows.length === 1 ? "row" : "rows", "satır", "lignes", "filas")} · ${db.columns.length} ${pickLang(opts.language, db.columns.length === 1 ? "column" : "columns", "sütun", "colonnes", "columnas")}`;
  root.appendChild(footer);

  return root;
}

function remount(block: HTMLElement, opts: MountOpts) {
  delete block.dataset.mounted;
  // Decode + re-render. The placeholder's data-db is already up-to-date
  // because onPersist runs synchronously before any remount call site.
  const db = decodeDb(block.getAttribute("data-db") || "");
  if (!db) return;
  block.innerHTML = "";
  block.appendChild(renderTable(db, block, opts));
  block.dataset.mounted = "1";
}

function renderCell(col: DbColumn, row: DbRow, onChange: () => void): HTMLElement {
  const raw = row.cells[col.id];
  switch (col.type) {
    case "number": {
      const input = document.createElement("input");
      input.type = "number";
      input.className = "note-db-cell-input";
      input.value = raw == null ? "" : String(raw);
      input.addEventListener("blur", () => {
        const n = input.value.trim() === "" ? 0 : Number(input.value);
        row.cells[col.id] = Number.isFinite(n) ? n : 0;
        onChange();
      });
      return input;
    }
    case "date": {
      const input = document.createElement("input");
      input.type = "date";
      input.className = "note-db-cell-input";
      input.value = typeof raw === "string" ? raw : "";
      input.addEventListener("change", () => {
        row.cells[col.id] = input.value;
        onChange();
      });
      return input;
    }
    case "select": {
      const select = document.createElement("select");
      select.className = "note-db-cell-input";
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "—";
      select.appendChild(blank);
      for (const opt of col.options ?? []) {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        if (raw === opt) o.selected = true;
        select.appendChild(o);
      }
      const addOpt = document.createElement("option");
      addOpt.value = "__add__";
      addOpt.textContent = "+ New option";
      select.appendChild(addOpt);
      select.addEventListener("change", () => {
        if (select.value === "__add__") {
          const name = prompt("Option name");
          if (name && name.trim()) {
            const v = name.trim();
            col.options = [...(col.options ?? []), v];
            row.cells[col.id] = v;
            onChange();
          } else {
            select.value = String(row.cells[col.id] ?? "");
          }
          return;
        }
        row.cells[col.id] = select.value;
        onChange();
      });
      return select;
    }
    case "tag": {
      const wrap = document.createElement("div");
      wrap.className = "note-db-tag-wrap";
      const current = typeof raw === "string" && raw.length > 0 ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
      const allOptions = col.options ?? [];

      // Render current tags as removable chips
      for (const tag of current) {
        const chip = document.createElement("span");
        chip.className = "note-db-tag-chip";
        chip.textContent = tag;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "note-db-tag-remove";
        remove.textContent = "×";
        remove.addEventListener("click", () => {
          const next = current.filter((t) => t !== tag);
          row.cells[col.id] = next.join(",");
          onChange();
        });
        chip.appendChild(remove);
        wrap.appendChild(chip);
      }

      // Add-tag dropdown
      const add = document.createElement("select");
      add.className = "note-db-tag-add";
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "+";
      add.appendChild(blank);
      for (const opt of allOptions) {
        if (current.includes(opt)) continue;
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        add.appendChild(o);
      }
      const addNew = document.createElement("option");
      addNew.value = "__add__";
      addNew.textContent = "+ New";
      add.appendChild(addNew);
      add.addEventListener("change", () => {
        if (!add.value) return;
        let v = add.value;
        if (v === "__add__") {
          const name = prompt("Tag name");
          if (!name || !name.trim()) return;
          v = name.trim();
          col.options = [...(col.options ?? []), v];
        }
        if (!current.includes(v)) current.push(v);
        row.cells[col.id] = current.join(",");
        onChange();
      });
      wrap.appendChild(add);

      return wrap;
    }
    case "text":
    default: {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "note-db-cell-input";
      input.value = typeof raw === "string" ? raw : "";
      input.addEventListener("blur", () => {
        row.cells[col.id] = input.value;
        onChange();
      });
      return input;
    }
  }
}
