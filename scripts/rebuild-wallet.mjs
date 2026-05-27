import fs from 'fs';

const p = 'c:/tauri_hubUltra/src/App.tsx';
let data = fs.readFileSync(p, 'utf8');

// 1. Rewrite addExpense to use new fields
data = data.replace(
  'notes: expenseNotesDraft.trim()\n    };',
  'notes: expenseNotesDraft.trim(),\n      currency: expenseCurrencyDraft,\n      isRecurring: expenseIsRecurringDraft\n    };'
);

// 2. Add Accordion state handling
if (!data.includes('const [walletExpandedId, setWalletExpandedId]')) {
  data = data.replace(
    'const [draftBudget, setDraftBudget] = useState("");',
    'const [draftBudget, setDraftBudget] = useState("");\n  const [walletExpandedId, setWalletExpandedId] = useState<string | null>(null);\n'
  );
}

// 3. Replace Wallet Layout inside workspaceTab === "wallet"
// Since my previous script replaced the whole thing down to {showLanguagePrompt}, let's find the boundaries.
let walletStartRegex = /<div className="wallet-layout"[\s\S]*?\{showLanguagePrompt/m;
let match = data.match(walletStartRegex);

if (match) {
  let newWallet = `
          <div className="wallet-layout" style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            <section className="topbar" style={{ padding: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p className="eyebrow">CÜZDAN MERKEZİ</p>
                <h2>Tüm Giderler ve Proje Bütçeleri</h2>
                <button className="primary-button" style={{marginTop: '1rem'}} onClick={async () => {
                  const header = "Birim,Kategori,Tutar,Tarih,Not,Proje,Kur\\n";
                  const rows = allExpenses.map(e => \`"\${e.currency || 'USD'}","\${e.category}",\${e.amount},"\${e.spentAt}","\${e.notes}","\${e.gameTitle || 'Genel'}",\${(exchangeRates || {})[e.currency || 'USD'] || 1}\`).join("\\n");
                  const csv = header + rows;
                  try {
                    const saved = await exportCsvReport(csv);
                    setStatusMessage("CSV Raporu Şuraya Kaydedildi: " + saved);
                  } catch {}
                }}>
                  <Download size={16} style={{marginRight: '8px'}} /> Dışa Aktar (CSV)
                </button>
              </div>

              <div className="settings-card" style={{ maxWidth: '400px', margin: 0 }}>
                <span className="label">Anlık Kurlar (Baz USD)</span>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <label><span style={{fontSize: '0.8rem'}}>EUR</span><input className="input" type="number" step="0.01" style={{padding: '0.2rem'}} value={exchangeRates.EUR} onChange={e => setExchangeRates({...exchangeRates, EUR: Number(e.target.value)})} /></label>
                  <label><span style={{fontSize: '0.8rem'}}>TRY</span><input className="input" type="number" step="0.01" style={{padding: '0.2rem'}} value={exchangeRates.TRY} onChange={e => setExchangeRates({...exchangeRates, TRY: Number(e.target.value)})} /></label>
                  <button className="secondary-button" onClick={() => saveExchangeRates(exchangeRates)}>Kaydet</button>
                </div>
              </div>
            </section>

            <div style={{ padding: '0 2rem 4rem 2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Genel Stüdyo Giderleri Accordion */}
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
                    <div style={{ padding: '1.5rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} 
                         onClick={() => setWalletExpandedId(walletExpandedId === "__general__" ? null : "__general__")}>
                       <div>
                         <h3 style={{ margin: 0 }}>Genel Stüdyo Giderleri</h3>
                         <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-muted)' }}>Projelere bağlı olmayan genel ofis, kira veya donanım masrafları.</p>
                       </div>
                       <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
                          $ {globalExpenses.reduce((sum, e) => sum + calculateAccumulatedAmount(e, exchangeRates[e.currency || 'USD'] || 1), 0).toFixed(2)}
                       </div>
                    </div>
                    
                    {walletExpandedId === "__general__" && (
                        <div style={{ padding: '1.5rem', borderTop: '1px solid var(--border)', background: 'rgba(0, 0, 0, 0.1)' }}>
                            <div className="wallet-multi-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
                                <div className="expense-form">
                                  <h4>Genel Gider Ekle</h4>
                                  <div className="field-grid" style={{ gridTemplateColumns: '1fr', marginTop: '1rem' }}>
                                    <label><span>Gider Başlığı</span><input className="input" value={expenseTitleDraft} onChange={e => setExpenseTitleDraft(e.target.value)} /></label>
                                    <div style={{ display: 'flex', gap: '1rem' }}>
                                      <label style={{ flex: 1 }}><span>Tutar</span><input className="input" type="number" step="0.01" value={expenseAmountDraft} onChange={e => setExpenseAmountDraft(e.target.value)} /></label>
                                      <label style={{ flex: 1 }}><span>Para Birimi</span>
                                        <select className="input" value={expenseCurrencyDraft} onChange={e => setExpenseCurrencyDraft(e.target.value as any)}>
                                          <option value="USD">USD ($)</option><option value="EUR">EUR (€)</option><option value="TRY">TRY (₺)</option>
                                        </select>
                                      </label>
                                    </div>
                                    <label><span>Kategori</span><input className="input" value={expenseCategoryDraft} onChange={e => setExpenseCategoryDraft(e.target.value)} /></label>
                                    <label><span>Tarih</span><input className="input" type="date" value={expenseDateDraft} onChange={e => setExpenseDateDraft(e.target.value)} /></label>
                                    <label style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
                                      <input type="checkbox" checked={expenseIsRecurringDraft} onChange={e => setExpenseIsRecurringDraft(e.target.checked)} />
                                      <span style={{marginBottom: 0}}>Aylık Tekrarlayan Gider</span>
                                    </label>
                                    <button className="primary-button" style={{ marginTop: "1rem" }} onClick={() => { setExpenseGameIdDraft('__general__'); setTimeout(() => addExpense(), 50); }}>Ekle</button>
                                  </div>
                                </div>
                                <div className="expense-list-panel">
                                  <h4>Pasta Grafik</h4>
                                  <PieChartWidget expenses={globalExpenses} getExchangeRate={(c) => exchangeRates[c] || 1} />
                                  <h4 style={{ marginTop: "2rem" }}>Gider Geçmişi</h4>
                                  <div className="stack-list" style={{ marginTop: "1rem", maxHeight: "300px", overflowY: "auto" }}>
                                    {globalExpenses.map(e => (
                                       <div key={e.id} className="version-card">
                                         <div className="version-head"><strong>{e.title} {e.isRecurring && "🔄"}</strong><span>{e.amount.toFixed(2)} {e.currency}</span></div>
                                         <small className="version-file">{e.category} · {e.spentAt}</small>
                                       </div>
                                    ))}
                                  </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Oyunlara Özel Giderler Accordions */}
                {games.map(g => {
                   const spent = g.expenses.reduce((sum, e) => sum + calculateAccumulatedAmount(e, exchangeRates[e.currency || 'USD'] || 1), 0);
                   const progress = g.budget && g.budget > 0 ? (spent / g.budget) * 100 : 0;
                   const isExpanded = walletExpandedId === g.id;

                   return (
                     <div key={g.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
                        <div style={{ padding: '1.5rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} 
                             onClick={() => setWalletExpandedId(isExpanded ? null : g.id)}>
                           <div style={{ flex: 1 }}>
                             <h3 style={{ margin: 0 }}>{g.title}</h3>
                             {g.budget && g.budget > 0 ? (
                               <div style={{ marginTop: '0.8rem', width: '80%' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                     <span>Bütçe Harcaması: $ {spent.toFixed(2)} / $ {g.budget}</span>
                                     <span>{progress.toFixed(0)}%</span>
                                  </div>
                                  <div style={{ width: '100%', height: '6px', background: 'var(--bg-elevated)', borderRadius: '3px', marginTop: '0.3rem', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: \`\${Math.min(progress, 100)}%\`, backgroundColor: progress > 100 ? 'var(--status-danger)' : 'var(--primary)', transition: 'width 0.3s' }} />
                                  </div>
                               </div>
                             ) : (
                               <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-muted)' }}>Bütçe sınırı belirtilmedi.</p>
                             )}
                           </div>
                           <div style={{ fontSize: '1.5rem', fontWeight: 'bold', marginLeft: '1rem' }}>
                              $ {spent.toFixed(2)}
                           </div>
                        </div>

                        {isExpanded && (
                           <div style={{ padding: '1.5rem', borderTop: '1px solid var(--border)', background: 'rgba(0, 0, 0, 0.1)' }}>
                              <div className="wallet-multi-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
                                  <div className="expense-form">
                                    <h4>"{g.title}" İçin Yeni Gider Ekle</h4>
                                    <div className="field-grid" style={{ gridTemplateColumns: '1fr', marginTop: '1rem' }}>
                                      <label><span>Gider Başlığı</span><input className="input" value={expenseTitleDraft} onChange={e => setExpenseTitleDraft(e.target.value)} /></label>
                                      <div style={{ display: 'flex', gap: '1rem' }}>
                                        <label style={{ flex: 1 }}><span>Tutar</span><input className="input" type="number" step="0.01" value={expenseAmountDraft} onChange={e => setExpenseAmountDraft(e.target.value)} /></label>
                                        <label style={{ flex: 1 }}><span>Birim</span>
                                          <select className="input" value={expenseCurrencyDraft} onChange={e => setExpenseCurrencyDraft(e.target.value as any)}>
                                            <option value="USD">USD ($)</option><option value="EUR">EUR (€)</option><option value="TRY">TRY (₺)</option>
                                          </select>
                                        </label>
                                      </div>
                                      <label><span>Kategori</span><input className="input" value={expenseCategoryDraft} onChange={e => setExpenseCategoryDraft(e.target.value)} /></label>
                                      <label><span>Tarih</span><input className="input" type="date" value={expenseDateDraft} onChange={e => setExpenseDateDraft(e.target.value)} /></label>
                                      <label style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
                                        <input type="checkbox" checked={expenseIsRecurringDraft} onChange={e => setExpenseIsRecurringDraft(e.target.checked)} />
                                        <span style={{marginBottom: 0}}>Aylık Tekrarlayan Gider</span>
                                      </label>
                                      <button className="primary-button" style={{ marginTop: "1rem" }} onClick={() => { setExpenseGameIdDraft(g.id); setTimeout(() => addExpense(), 50); }}>Ekle</button>
                                    </div>
                                  </div>
                                  <div className="expense-list-panel">
                                    <h4>Maliyet Dağılımı</h4>
                                    <PieChartWidget expenses={g.expenses} getExchangeRate={(c) => exchangeRates[c] || 1} />
                                    <h4 style={{ marginTop: "2rem" }}>Son Giderler</h4>
                                    <div className="stack-list" style={{ marginTop: "1rem", maxHeight: "300px", overflowY: "auto" }}>
                                      {g.expenses.map(e => (
                                         <div key={e.id} className="version-card">
                                           <div className="version-head"><strong>{e.title} {e.isRecurring && "🔄"}</strong><span>{e.amount.toFixed(2)} {e.currency}</span></div>
                                           <small className="version-file">{e.category} · {e.spentAt}</small>
                                         </div>
                                      ))}
                                    </div>
                                  </div>
                              </div>
                           </div>
                        )}
                     </div>
                   );
                })}
            </div>
          </div>
        {showLanguagePrompt`;

  data = data.replace(walletStartRegex, newWallet);
  fs.writeFileSync(p, data, 'utf8');
  console.log("Wallet layout replaced successfully!");
} else {
  console.log("Regex couldn't match the wallet boundary");
}
