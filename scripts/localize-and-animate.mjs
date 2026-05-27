import fs from 'fs';

const appPath = 'c:/tauri_hubUltra/src/App.tsx';
let code = fs.readFileSync(appPath, 'utf-8');
let changeCount = 0;

function safeReplace(old, newStr, label) {
  if (!code.includes(old)) {
    console.error(`[SKIP] Pattern not found for: ${label}`);
    console.error(`  First 80 chars: ${JSON.stringify(old.slice(0, 80))}`);
    return false;
  }
  code = code.replace(old, newStr);
  changeCount++;
  console.log(`[OK] ${label}`);
  return true;
}

// ═══════════════════════════════════════════════
// GÖREV 1 — TR copy placeholder fixes
// ═══════════════════════════════════════════════
safeReplace(
  `    wAddGeneral: "wAddGeneral",`,
  `    wAddGeneral: "Genel Gider Ekle",`,
  "TR wAddGeneral fix"
);

safeReplace(
  `    wAmount: "wAmount",\n    wCurrency: "wCurrency",\n    wCategory: "wCategory",\n    wDate: "wDate",`,
  `    wAmount: "Tutar",\n    wCurrency: "Para Birimi",\n    wCategory: "Kategori",\n    wDate: "Tarih",`,
  "TR wAmount/wCurrency/wCategory/wDate fix"
);

safeReplace(
  `    wExpenseDist: "wExpenseDist",\n    wHistory: "wHistory",`,
  `    wExpenseDist: "Harcama Dağılımı",\n    wHistory: "Son Giderler",`,
  "TR wExpenseDist/wHistory fix"
);

safeReplace(
  `    amount: "wAmount",\n    category: "wCategory",\n    spentAt: "wDate",`,
  `    amount: "Tutar",\n    category: "Kategori",\n    spentAt: "Tarih",`,
  "TR amount/category/spentAt fix"
);

// ═══════════════════════════════════════════════
// GÖREV 1 — Add new localization keys to EN
// ═══════════════════════════════════════════════
safeReplace(
  `      wGeneralExpenseDeleted: "General expense deleted",\n\n\n    brandEyebrow: "Workspace",`,
  `      wGeneralExpenseDeleted: "General expense deleted",
      walletTabGeneral: "General Expenses",
      walletTabProjects: "Project Expenses",
      financialSummary: "Financial Summary",
      activeCurrencies: "Active Currencies",
      addCurrency: "+ Add Currency",
      ratesUpdated: "Exchange rates updated.",
      ratesUpdating: "Updating rates...",
      noExpenseYet: "No expenses yet.",
      deleteExpense: "Delete expense",

    brandEyebrow: "Workspace",`,
  "EN new keys"
);

// TR new keys
safeReplace(
  `      wGeneralExpenseDeleted: "Genel gider silindi",\n\n\n    brandEyebrow: "Calisma Alani",`,
  `      wGeneralExpenseDeleted: "Genel gider silindi",
      walletTabGeneral: "Genel Giderler",
      walletTabProjects: "Proje Giderleri",
      financialSummary: "Finansal Özet",
      activeCurrencies: "Aktif Dövizler",
      addCurrency: "+ Döviz Ekle",
      ratesUpdated: "Kurlar güncellendi.",
      ratesUpdating: "Kurlar güncelleniyor...",
      noExpenseYet: "Henüz gider yok.",
      deleteExpense: "Gideri sil",

    brandEyebrow: "Calisma Alani",`,
  "TR new keys"
);

// FR new keys
safeReplace(
  `      wGeneralExpenseDeleted: "Dépense générale supprimée",\n\n\n    brandEyebrow: "Espace",`,
  `      wGeneralExpenseDeleted: "Dépense générale supprimée",
      walletTabGeneral: "Dépenses Générales",
      walletTabProjects: "Dépenses Projets",
      financialSummary: "Résumé Financier",
      activeCurrencies: "Devises Actives",
      addCurrency: "+ Ajouter Devise",
      ratesUpdated: "Taux mis à jour.",
      ratesUpdating: "Mise à jour...",
      noExpenseYet: "Aucune dépense.",
      deleteExpense: "Supprimer",

    brandEyebrow: "Espace",`,
  "FR new keys"
);

// ES new keys
safeReplace(
  `      wGeneralExpenseDeleted: "Gasto general eliminado",\n\n\n    brandEyebrow: "Espacio",`,
  `      wGeneralExpenseDeleted: "Gasto general eliminado",
      walletTabGeneral: "Gastos Generales",
      walletTabProjects: "Gastos de Proyectos",
      financialSummary: "Resumen Financiero",
      activeCurrencies: "Divisas Activas",
      addCurrency: "+ Agregar Divisa",
      ratesUpdated: "Tasas actualizadas.",
      ratesUpdating: "Actualizando...",
      noExpenseYet: "Sin gastos aún.",
      deleteExpense: "Eliminar gasto",

    brandEyebrow: "Espacio",`,
  "ES new keys"
);

// ═══════════════════════════════════════════════
// GÖREV 1 — Replace hardcoded wallet JSX strings with ui.xxx
// ═══════════════════════════════════════════════

// Studio Dashboard eyebrow + heading
safeReplace(
  `<p className="eyebrow">STUDIO DASHBOARD</p>\n                <h1 style={{margin: 0, fontSize: '2rem'}}>Finansal Özet</h1>`,
  `<p className="eyebrow">STUDIO DASHBOARD</p>\n                <h1 style={{margin: 0, fontSize: '2rem'}}>{ui.financialSummary}</h1>`,
  "JSX financialSummary"
);

// Total eyebrow
safeReplace(
  `<span className="eyebrow">TÜM PROJELER + GENEL TOPLAM</span>`,
  `<span className="eyebrow">{ui.wTotalAllPlain}</span>`,
  "JSX wTotalAllPlain"
);

// Tab buttons
safeReplace(
  `📋 Genel Giderler\n              </button>`,
  `{ui.wTabGeneral}\n              </button>`,
  "JSX tab general"
);

safeReplace(
  `🎮 Proje Giderleri\n              </button>`,
  `{ui.wTabProjects}\n              </button>`,
  "JSX tab projects"
);

// General studio expenses section
safeReplace(
  `<p className="eyebrow">GENEL STÜDYO GİDERLERİ</p>\n                      <h3 style={{ margin: 0 }}>Ofis, Donanım, Lisanslama</h3>\n                      <p style={{ margin: '0.4rem 0 0', color: 'var(--text-muted)' }}>Oyunlara bağlı olmayan sabit giderler</p>`,
  `<p className="eyebrow">{ui.wGeneralStudioExp}</p>\n                      <h3 style={{ margin: 0 }}>{ui.wGeneralStudioDesc}</h3>\n                      <p style={{ margin: '0.4rem 0 0', color: 'var(--text-muted)' }}>{ui.wGeneralStudioSub}</p>`,
  "JSX general studio section"
);

// General expense form heading
safeReplace(
  `<h4 style={{marginBottom: '1.5rem'}}>Genel Gider Ekle</h4>`,
  `<h4 style={{marginBottom: '1.5rem'}}>{ui.wAddGeneral}</h4>`,
  "JSX wAddGeneral heading"
);

// Form labels in general tab
safeReplace(
  `<label><span>Başlık</span><input className="input" value={expenseTitleDraft} onChange={e => setExpenseTitleDraft(e.target.value)} /></label>\n                            <div style={{ display: 'flex', gap: '1.5rem' }}>\n                              <label style={{flex: 1}}><span>Tutar</span>`,
  `<label><span>{ui.wExpenseTitle}</span><input className="input" value={expenseTitleDraft} onChange={e => setExpenseTitleDraft(e.target.value)} /></label>\n                            <div style={{ display: 'flex', gap: '1.5rem' }}>\n                              <label style={{flex: 1}}><span>{ui.wAmount}</span>`,
  "JSX general form labels 1"
);

safeReplace(
  `<label style={{flex: 1}}><span>Birim</span>\n                                <select className="input" value={expenseCurrencyDraft} onChange={e => setExpenseCurrencyDraft(e.target.value)}>\n                                  {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}\n                                </select>\n                              </label>\n                            </div>\n                            <label><span>Kategori</span>`,
  `<label style={{flex: 1}}><span>{ui.wCurrency}</span>\n                                <select className="input" value={expenseCurrencyDraft} onChange={e => setExpenseCurrencyDraft(e.target.value)}>\n                                  {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}\n                                </select>\n                              </label>\n                            </div>\n                            <label><span>{ui.wCategory}</span>`,
  "JSX general form labels 2"
);

safeReplace(
  `<label><span>Tarih</span><input className="input" type="date" value={expenseDateDraft} onChange={e => setExpenseDateDraft(e.target.value)} /></label>\n                            <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.75rem', background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px' }}>\n                              <input type="checkbox" checked={expenseIsRecurringDraft} onChange={e => setExpenseIsRecurringDraft(e.target.checked)} />\n                              <span style={{marginBottom: 0, fontWeight: 600}}>Aylık Tekrarlayan Gider</span>\n                            </label>\n                            <button className="primary-button" style={{marginTop: '1rem', padding: '1rem'}} onClick={() => handleAddExpense(null)}>Gider Ekle</button>`,
  `<label><span>{ui.wDate}</span><input className="input" type="date" value={expenseDateDraft} onChange={e => setExpenseDateDraft(e.target.value)} /></label>\n                            <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.75rem', background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px' }}>\n                              <input type="checkbox" checked={expenseIsRecurringDraft} onChange={e => setExpenseIsRecurringDraft(e.target.checked)} />\n                              <span style={{marginBottom: 0, fontWeight: 600}}>{ui.wRecurring}</span>\n                            </label>\n                            <button className="primary-button" style={{marginTop: '1rem', padding: '1rem'}} onClick={() => handleAddExpense(null)}>{ui.wAdd}</button>`,
  "JSX general form labels 3"
);

// Expense distribution and history headings (general tab)
safeReplace(
  `<h4 style={{marginBottom: '1rem'}}>Harcama Dağılımı</h4>\n                          <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '1.5rem' }}>\n                            <PieChartWidget expenses={globalExpenses}`,
  `<h4 style={{marginBottom: '1rem'}}>{ui.wExpenseDist}</h4>\n                          <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '1.5rem' }}>\n                            <PieChartWidget expenses={globalExpenses}`,
  "JSX general expense dist heading"
);

safeReplace(
  `<h4 style={{marginTop: '2rem', marginBottom: '1rem'}}>Son Giderler</h4>\n                          <div className="stack-list" style={{ maxHeight: '350px', overflowY: 'auto', paddingRight: '0.5rem' }}>\n                            {globalExpenses.length === 0 && <p style={{color:'var(--text-muted)', fontSize:'0.9rem', fontStyle: 'italic'}}>Henüz eklenmiş gider yok.</p>}`,
  `<h4 style={{marginTop: '2rem', marginBottom: '1rem'}}>{ui.wHistory}</h4>\n                          <div className="stack-list" style={{ maxHeight: '350px', overflowY: 'auto', paddingRight: '0.5rem' }}>\n                            {globalExpenses.length === 0 && <p style={{color:'var(--text-muted)', fontSize:'0.9rem', fontStyle: 'italic'}}>{ui.wNoExpensesYet}</p>}`,
  "JSX general history heading + empty"
);

// Project expenses eyebrow
safeReplace(
  `<p className="eyebrow" style={{marginBottom: '1rem'}}>PROJE BAZLI GİDERLER</p>`,
  `<p className="eyebrow" style={{marginBottom: '1rem'}}>{ui.wProjectExpEyebrow}</p>`,
  "JSX project eyebrow"
);

// Project no budget
safeReplace(
  `<p style={{margin:'0.3rem 0 0', color:'var(--text-muted)', fontSize:'0.85rem'}}>Bütçe sınırı yok</p>`,
  `<p style={{margin:'0.3rem 0 0', color:'var(--text-muted)', fontSize:'0.85rem'}}>{ui.wNoBudgetLimit}</p>`,
  "JSX no budget"
);

// Project form labels
safeReplace(
  `<label><span>Başlık</span><input className="input" value={expenseTitleDraft} onChange={e => setExpenseTitleDraft(e.target.value)} /></label>\n                                  <div style={{display:'flex', gap:'1.5rem'}}>\n                                    <label style={{flex:1}}><span>Tutar</span>`,
  `<label><span>{ui.wExpenseTitle}</span><input className="input" value={expenseTitleDraft} onChange={e => setExpenseTitleDraft(e.target.value)} /></label>\n                                  <div style={{display:'flex', gap:'1.5rem'}}>\n                                    <label style={{flex:1}}><span>{ui.wAmount}</span>`,
  "JSX project form labels 1"
);

safeReplace(
  `<label style={{flex:1}}><span>Birim</span>\n                                      <select className="input" value={expenseCurrencyDraft} onChange={e => setExpenseCurrencyDraft(e.target.value)}>\n                                        {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}\n                                      </select>\n                                    </label>\n                                  </div>\n                                  <label><span>Kategori</span>`,
  `<label style={{flex:1}}><span>{ui.wCurrency}</span>\n                                      <select className="input" value={expenseCurrencyDraft} onChange={e => setExpenseCurrencyDraft(e.target.value)}>\n                                        {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}\n                                      </select>\n                                    </label>\n                                  </div>\n                                  <label><span>{ui.wCategory}</span>`,
  "JSX project form labels 2"
);

safeReplace(
  `<label><span>Tarih</span><input className="input" type="date" value={expenseDateDraft} onChange={e => setExpenseDateDraft(e.target.value)} /></label>\n                                  <label style={{flexDirection:'row', alignItems:'center', gap:'0.75rem', background:'rgba(255,255,255,0.05)', padding:'1rem', borderRadius:'8px'}}>\n                                    <input type="checkbox" checked={expenseIsRecurringDraft} onChange={e => setExpenseIsRecurringDraft(e.target.checked)} />\n                                    <span style={{marginBottom:0, fontWeight:600}}>Aylık Tekrarlayan Gider</span>\n                                  </label>\n                                  <button className="primary-button" style={{marginTop:'1rem', padding: '1rem'}} onClick={() => handleAddExpense(g.id)}>Projeye Ekle</button>`,
  `<label><span>{ui.wDate}</span><input className="input" type="date" value={expenseDateDraft} onChange={e => setExpenseDateDraft(e.target.value)} /></label>\n                                  <label style={{flexDirection:'row', alignItems:'center', gap:'0.75rem', background:'rgba(255,255,255,0.05)', padding:'1rem', borderRadius:'8px'}}>\n                                    <input type="checkbox" checked={expenseIsRecurringDraft} onChange={e => setExpenseIsRecurringDraft(e.target.checked)} />\n                                    <span style={{marginBottom:0, fontWeight:600}}>{ui.wRecurring}</span>\n                                  </label>\n                                  <button className="primary-button" style={{marginTop:'1rem', padding: '1rem'}} onClick={() => handleAddExpense(g.id)}>{ui.wAddToProject}</button>`,
  "JSX project form labels 3"
);

// Project expense dist/history headings
safeReplace(
  `<h4 style={{marginBottom: '1rem'}}>Harcama Dağılımı</h4>\n                                <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '1.5rem' }}>\n                                  <PieChartWidget expenses={g.expenses}`,
  `<h4 style={{marginBottom: '1rem'}}>{ui.wExpenseDist}</h4>\n                                <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '1.5rem' }}>\n                                  <PieChartWidget expenses={g.expenses}`,
  "JSX project expense dist"
);

safeReplace(
  `<h4 style={{marginTop:'2rem', marginBottom: '1rem'}}>Son Giderler</h4>\n                                <div className="stack-list" style={{maxHeight:'350px', overflowY:'auto', paddingRight: '0.5rem'}}>\n                                  {g.expenses.length === 0 && <p style={{color:'var(--text-muted)', fontSize:'0.9rem', fontStyle:'italic'}}>Henüz gider yok.</p>}`,
  `<h4 style={{marginTop:'2rem', marginBottom: '1rem'}}>{ui.wHistory}</h4>\n                                <div className="stack-list" style={{maxHeight:'350px', overflowY:'auto', paddingRight: '0.5rem'}}>\n                                  {g.expenses.length === 0 && <p style={{color:'var(--text-muted)', fontSize:'0.9rem', fontStyle:'italic'}}>{ui.wNoExpensesYet}</p>}`,
  "JSX project history heading + empty"
);

// No projects yet
safeReplace(
  `{games.length === 0 && <p style={{color:'var(--text-muted)'}}>Henüz proje yok. Önce bir proje oluşturun.</p>}`,
  `{games.length === 0 && <p style={{color:'var(--text-muted)'}}>{ui.wNoProjectsYet}</p>}`,
  "JSX no projects"
);

// ═══════════════════════════════════════════════
// GÖREV 2 — Detail panel: add key={selectedId} and className="detail-panel" with animation
// ═══════════════════════════════════════════════
safeReplace(
  `              <div\n                className="detail-modal-backdrop"\n                onMouseDown={handleDetailBackdropMouseDown}\n              >\n                <div\n                  className="detail-modal"\n                  onMouseDown={(event) => event.stopPropagation()}\n                >`,
  `              <div\n                className="detail-modal-backdrop"\n                onMouseDown={handleDetailBackdropMouseDown}\n              >\n                <div\n                  key={selectedId}\n                  className="detail-modal detail-slide-in"\n                  onMouseDown={(event) => event.stopPropagation()}\n                >`,
  "JSX detail-modal key + slide-in class"
);

// ═══════════════════════════════════════════════
// GÖREV 3 — Detail tab panels: add key={detailTab} and tab-content class
// ═══════════════════════════════════════════════
// Each tab starts with {detailTab === "xxx" && (\n  <div className="tab-panel">
// We replace tab-panel with tab-panel tab-content and add key

const tabKeys = ["overview", "notes", "tasks", "versions", "release", "moodboard", "integrations"];
for (const tab of tabKeys) {
  const old = `{detailTab === "${tab}" && (\n                      <div className="tab-panel">`;
  const newStr = `{detailTab === "${tab}" && (\n                      <div key="${tab}" className="tab-panel tab-content">`;
  safeReplace(old, newStr, `JSX tab-content key for ${tab}`);
}

fs.writeFileSync(appPath, code, 'utf-8');
console.log(`\nDone! Applied ${changeCount} changes.`);
