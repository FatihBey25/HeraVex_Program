import fs from 'fs';

const p = 'c:/tauri_hubUltra/src/App.tsx';
let data = fs.readFileSync(p, 'utf8');

// 1. Data Migration on refreshGames
data = data.replace(
  'const next = await loadGames();\n    setGames(next);',
  'let next = await loadGames();\n    next = next.map(g => ({ ...g, expenses: g.expenses || [] }));\n    setGames(next);'
);

// 2. Add deleteExpense
if(!data.includes('const deleteExpense = async')) {
  data = data.replace(
    'const handleAddExpense = async',
    'const deleteExpense = async (expenseId: string, gameId: string | null) => {\n    if (gameId) {\n      const targetGame = games.find(g => g.id === gameId);\n      if (!targetGame) return;\n      const updated = await saveGame({ ...targetGame, expenses: targetGame.expenses.filter(e => e.id !== expenseId) });\n      applySavedGameInState(updated);\n    } else {\n      const nextExpenses = globalExpenses.filter(e => e.id !== expenseId);\n      await saveGlobalExpenses(nextExpenses);\n      setGlobalExpenses(nextExpenses);\n    }\n  };\n\n  const handleAddExpense = async'
  );
}

// 3. UI Updates on Top Layer + Download Button + Currency Format
const oldTopLayerRegex = /\{\/\* TOP LAYER: Studio Dashboard \*\/\}[\s\S]*?\{\/\* MIDDLE LAYER: General Studio Expenses \*\/\}/m;
const topLayerNew = `
            {/* TOP LAYER: Studio Dashboard */}
            <section style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: 'var(--bg-card)', padding: '2rem', borderRadius: '16px', border: '1px solid #ffffff20', position: 'relative' }}>
              <div style={{flex: 1}}>
                <p className="eyebrow" style={{marginBottom: '0.5rem'}}>{ui.wTopLayer}</p>
                <h1 style={{margin: 0, fontSize: '2.5rem', fontWeight: 800}}>{ui.wStudioDash}</h1>
                <p style={{color: 'var(--text-muted)', marginTop: '0.5rem'}}>{ui.wStudioDashDesc}</p>
                
                <h2 style={{marginTop: '2rem', fontSize: '3rem', fontWeight: 900, color: 'var(--primary)'}}>
                   $ {(
                      globalExpenses.reduce((sum, e) => sum + calculateAccumulatedAmount(e, exchangeRates[e.currency || 'USD'] || 1), 0) +
                      games.reduce((s, g) => s + g.expenses.reduce((sum, e) => sum + calculateAccumulatedAmount(e, exchangeRates[e.currency || 'USD'] || 1), 0), 0)
                   ).toFixed(2)}
                </h2>
                <span className="eyebrow" style={{letterSpacing: '2px'}}>{ui.wTotalAll}</span>
              </div>

              {/* Export Button Top Right Elegance */}
              <button className="primary-button" style={{position: 'absolute', top: '2rem', right: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem'}} onClick={async () => {
                  const header = "Birim,Kategori,Tutar,Tarih,Not,Proje,Kur\\n";
                  const rows = allExpenses.map(e => \`"\${e.currency || 'USD'}","\${e.category}",\${e.amount},"\${e.spentAt}","\${e.notes}","\${e.gameTitle || 'Genel'}",\${(exchangeRates || {})[e.currency || 'USD'] || 1}\`).join("\\n");
                  const csv = header + rows;
                  try {
                    const saved = await exportCsvReport(csv);
                    setStatusMessage("CSV Raporu Şuraya Kaydedildi: " + saved);
                  } catch {}
                }}>
                  <Download size={18} /> {ui.wExportCSV}
              </button>

              <div className="settings-card" style={{ maxWidth: '400px', margin: 0, marginTop: '5rem', background: 'rgba(0,0,0,0.2)', border: '1px solid #ffffff10' }}>
                <span className="label" style={{fontSize: '1rem', fontWeight: 600}}>{ui.wExchangeRates}</span>
                <p style={{fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem'}}>{ui.wRatesDesc}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <label style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '0.5rem 1rem', borderRadius: '8px'}}>
                     <span style={{fontWeight: 'bold', fontSize: '1.1rem'}}>1 USD =</span>
                     <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                      <input className="input" type="number" step="0.01" style={{padding: '0.4rem', width: '100px', textAlign: 'right'}} value={exchangeRates.EUR || ''} onChange={e => {setExchangeRates({...exchangeRates, EUR: Number(e.target.value)}); saveExchangeRates({...exchangeRates, EUR: Number(e.target.value)});}} />
                      <span style={{fontWeight: 'bold', width: '30px'}}>EUR</span>
                     </div>
                  </label>
                  <label style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '0.5rem 1rem', borderRadius: '8px'}}>
                     <span style={{fontWeight: 'bold', fontSize: '1.1rem'}}>1 USD =</span>
                     <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                      <input className="input" type="number" step="0.01" style={{padding: '0.4rem', width: '100px', textAlign: 'right'}} value={exchangeRates.TRY || ''} onChange={e => {setExchangeRates({...exchangeRates, TRY: Number(e.target.value)}); saveExchangeRates({...exchangeRates, TRY: Number(e.target.value)});}} />
                      <span style={{fontWeight: 'bold', width: '30px'}}>TRY</span>
                     </div>
                  </label>
                </div>
              </div>
            </section>

            {/* MIDDLE LAYER: General Studio Expenses */}
`;
data = data.replace(oldTopLayerRegex, topLayerNew);

const oldMiddleLayerRegex = /\{\/\* MIDDLE LAYER: General Studio Expenses \*\/\}[\s\S]*?\{\/\* BOTTOM LAYER: Project Based Expenses \*\/\}/m;
let middleLayerNew = data.match(oldMiddleLayerRegex)[0];
middleLayerNew = middleLayerNew
  .replace('MIDDLE LAYER', '{ui.wMiddleLayer}')
  .replace('General Studio Expenses', '{ui.wMiddleLayerTitle}')
  .replace('Projelere bağlı olmayan ofis, donanım veya lisanslama masrafları.', '{ui.wMiddleLayerDesc}')
  .replace('Genel Gider Ekle', '{ui.wAddGeneral}')
  .replace('Gider Başlığı', '{ui.wExpenseTitle}')
  .replace('Tutar', '{ui.wAmount}')
  .replace('Para Birimi', '{ui.wCurrency}')
  .replace('Kategori', '{ui.wCategory}')
  .replace('<input className="input" value={expenseCategoryDraft} onChange={e => setExpenseCategoryDraft(e.target.value)} />', '<select className="input" value={expenseCategoryDraft} onChange={e => setExpenseCategoryDraft(e.target.value)}><option value="Art">Art</option><option value="Code">Code</option><option value="Sound">Sound</option><option value="Marketing">Marketing</option><option value="Office">Office</option><option value="Fees">Fees</option><option value="Asset">Asset</option><option value="Tax">Tax (Vergi)</option><option value="Other">Other</option></select>')
  .replace('Tarih', '{ui.wDate}')
  .replace('Aylık Tekrarlayan Gider (Abonelik)', '{ui.wRecurring}')
  .replace('>Ekle</button>', '>{ui.wAdd}</button>')
  .replace('Genel Gider Dağılımı', '{ui.wExpenseDist}')
  .replace('Gider Geçmişi', '{ui.wHistory}')
  .replace('<small className="version-file">{e.category} · {e.spentAt}</small>', '<small className="version-file">{e.category} · {e.spentAt}</small></div><button className="icon-button" style={{color: "var(--status-danger)"}} onClick={() => deleteExpense(e.id, null)}><Trash size={16} /></button>')
  .replace('<div key={e.id} className="version-card">', '<div key={e.id} className="version-card" style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}><div style={{flex: 1}}>');

data = data.replace(oldMiddleLayerRegex, middleLayerNew);

const oldBottomLayerRegex = /\{\/\* BOTTOM LAYER: Project Based Expenses \*\/\}[\s\S]*?<\/div>\n        \)}/m;
let bottomLayerNew = data.match(oldBottomLayerRegex)[0];
bottomLayerNew = bottomLayerNew
  .replace('BOTTOM LAYER - PROJECT BASED EXPENSES', '{ui.wBottomLayer}')
  .replace('Bütçe Harcaması', '{ui.wBudgetSpent}')
  .replace('Bütçe sınırı belirtilmedi.', '{ui.wNoBudget}')
  .replace('" İçin Yeni Gider Ekle', ' {ui.wAddProject}')
  .replace('Gider Başlığı', '{ui.wExpenseTitle}')
  .replace('Tutar', '{ui.wAmount}')
  .replace('Birim', '{ui.wCurrency}')
  .replace('Kategori', '{ui.wCategory}')
  .replace('<input className="input" value={expenseCategoryDraft} onChange={e => setExpenseCategoryDraft(e.target.value)} />', '<select className="input" value={expenseCategoryDraft} onChange={e => setExpenseCategoryDraft(e.target.value)}><option value="Art">Art</option><option value="Code">Code</option><option value="Sound">Sound</option><option value="Marketing">Marketing</option><option value="Office">Office</option><option value="Fees">Fees</option><option value="Asset">Asset</option><option value="Tax">Tax (Vergi)</option><option value="Other">Other</option></select>')
  .replace('Tarih', '{ui.wDate}')
  .replace('Aylık Tekrarlayan Gider (Abonelik)', '{ui.wRecurring}')
  .replace('>Projeye Ekle</button>', '>{ui.wAdd}</button>')
  .replace('Harcama Dağılımı', '{ui.wExpenseDist}')
  .replace('Son Giderler', '{ui.wHistory}')
  .replace('<small className="version-file">{e.category} · {e.spentAt}</small>', '<small className="version-file">{e.category} · {e.spentAt}</small></div><button className="icon-button" style={{color: "var(--status-danger)"}} onClick={() => deleteExpense(e.id, g.id)}><Trash size={16} /></button>')
  .replace('<div key={e.id} className="version-card">', '<div key={e.id} className="version-card" style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}><div style={{flex: 1}}>');

data = data.replace(oldBottomLayerRegex, bottomLayerNew);

data = data.replace(
  'const ALL_TABS: DetailTab[] = ["overview", "expenses", "notes", "tasks", "versions", "release", "moodboard", "integrations"];',
  'const ALL_TABS: DetailTab[] = ["overview", "notes", "tasks", "versions", "release", "moodboard", "integrations"];'
);

data = data.replace(
  'type DetailTab = "overview" | "expenses" | "notes" | "tasks" | "versions" | "release" | "moodboard" | "integrations";',
  'type DetailTab = "overview" | "notes" | "tasks" | "versions" | "release" | "moodboard" | "integrations";'
);

data = data.replace(
  /totalSpent:\s*"Total Spent",/,
  `totalSpent: "Total Spent",
    wTopLayer: "TOP LAYER",
    wStudioDash: "Studio Dashboard",
    wStudioDashDesc: "Global state of the studio and all projects.",
    wTotalAll: "ALL PROJECTS + GENERAL TOTAL EXPENSES",
    wExportCSV: "Export (CSV)",
    wExchangeRates: "Exchange Rates (Base USD)",
    wRatesDesc: "Numbers update instantly.",
    wMiddleLayer: "MIDDLE LAYER",
    wMiddleLayerTitle: "General Studio Expenses",
    wMiddleLayerDesc: "Non-project studio costs like rent, equipment or licenses.",
    wBottomLayer: "BOTTOM LAYER - PROJECT BASED EXPENSES",
    wAddGeneral: "Add General Expense",
    wAddProject: "Add Project Expense",
    wExpenseTitle: "Expense Title",
    wAmount: "Amount",
    wCurrency: "Currency",
    wCategory: "Category",
    wDate: "Date",
    wRecurring: "Monthly Recurring (Subscription)",
    wAdd: "Add",
    wExpenseDist: "Expense Distribution",
    wHistory: "Expense History",
    wBudgetSpent: "Budget Spent",
    wNoBudget: "No budget limit defined.",`
);

data = data.replace(
  /totalSpent:\s*"Toplam Harcama",/,
  `totalSpent: "Toplam Harcama",
    wTopLayer: "ÜST KATMAN",
    wStudioDash: "Stüdyo Kontrol Paneli",
    wStudioDashDesc: "Stüdyo ve tüm projelere ait global durum.",
    wTotalAll: "TÜM PROJELER + GENEL TOPLAM GİDER",
    wExportCSV: "Dışa Aktar (CSV)",
    wExchangeRates: "Döviz Kurları (Baz USD)",
    wRatesDesc: "Rakamlar anlık olarak sayfada güncellenir.",
    wMiddleLayer: "ORTA KATMAN",
    wMiddleLayerTitle: "Genel Stüdyo Giderleri",
    wMiddleLayerDesc: "Projelere bağlı olmayan ofis, donanım veya lisanslama masrafları.",
    wBottomLayer: "ALT KATMAN - OYUN BAZLI GİDERLER",
    wAddGeneral: "Genel Gider Ekle",
    wAddProject: "İçin Proje Gideri Ekle",
    wExpenseTitle: "Gider Başlığı",
    wAmount: "Tutar",
    wCurrency: "Birim",
    wCategory: "Kategori",
    wDate: "Tarih",
    wRecurring: "Aylık Tekrarlayan Gider (Abonelik)",
    wAdd: "Ekle",
    wExpenseDist: "Harcama Dağılımı",
    wHistory: "Son Giderler",
    wBudgetSpent: "Bütçe Harcaması",
    wNoBudget: "Bütçe sınırı belirtilmedi.",`
);

data = data.replace(
  /totalSpent:\s*"Dépenses Totales",/,
  `totalSpent: "Dépenses Totales",
    wTopLayer: "COUCHE SUPÉRIEURE",
    wStudioDash: "Tableau de Bord du Studio",
    wStudioDashDesc: "État global du studio et de tous les projets.",
    wTotalAll: "TOUS LES PROJETS + DÉPENSES GÉNÉRALES TOTALES",
    wExportCSV: "Exporter (CSV)",
    wExchangeRates: "Taux de Change (Base USD)",
    wRatesDesc: "Les chiffres se mettent à jour instantanément.",
    wMiddleLayer: "COUCHE INTERMÉDIAIRE",
    wMiddleLayerTitle: "Dépenses Générales du Studio",
    wMiddleLayerDesc: "Coûts non liés au projet comme le loyer, le matériel ou les licences.",
    wBottomLayer: "COUCHE INFÉRIEURE - DÉPENSES PAR PROJET",
    wAddGeneral: "Ajouter une Dépense Générale",
    wAddProject: "Ajouter une Dépense de Projet",
    wExpenseTitle: "Titre de la Dépense",
    wAmount: "Montant",
    wCurrency: "Devise",
    wCategory: "Catégorie",
    wDate: "Date",
    wRecurring: "Mensuel Récurrent (Abonnement)",
    wAdd: "Ajouter",
    wExpenseDist: "Répartition des Dépenses",
    wHistory: "Historique des Dépenses",
    wBudgetSpent: "Budget Dépensé",
    wNoBudget: "Aucune limite de budget définie.",`
);

data = data.replace(
  /totalSpent:\s*"Total Gastado",/,
  `totalSpent: "Total Gastado",
    wTopLayer: "CAPA SUPERIOR",
    wStudioDash: "Panel del Estudio",
    wStudioDashDesc: "Estado global del estudio y todos los proyectos.",
    wTotalAll: "TODOS LOS PROYECTOS + GASTOS GENERALES",
    wExportCSV: "Exportar (CSV)",
    wExchangeRates: "Tipos de Cambio (Base USD)",
    wRatesDesc: "Los números se actualizan de inmediato.",
    wMiddleLayer: "CAPA MEDIA",
    wMiddleLayerTitle: "Gastos Generales del Estudio",
    wMiddleLayerDesc: "Gastos no relacionados con el proyecto como oficina, equipo o licencias.",
    wBottomLayer: "CAPA INFERIOR - GASTOS POR PROYECTO",
    wAddGeneral: "Agregar Gasto General",
    wAddProject: "Agregar Gasto al Proyecto",
    wExpenseTitle: "Título del Gasto",
    wAmount: "Monto",
    wCurrency: "Moneda",
    wCategory: "Categoría",
    wDate: "Fecha",
    wRecurring: "Recurrente Mensual (Suscripción)",
    wAdd: "Agregar",
    wExpenseDist: "Distribución de Gastos",
    wHistory: "Historial de Gastos",
    wBudgetSpent: "Presupuesto Gastado",
    wNoBudget: "Sin límite de presupuesto.",`
);

data = data.replace(
  'import { Gamepad2, Settings, Download',
  'import { Gamepad2, Settings, Download, Trash'
);

data = data.replace('expenses: "Wallet",', '');
data = data.replace('expenses: "Giderler",', '');
data = data.replace('expenses: "Dépenses",', '');
data = data.replace('expenses: "Gastos",', '');

fs.writeFileSync(p, data, 'utf8');
console.log("App.tsx Polish Inject Complete!");
