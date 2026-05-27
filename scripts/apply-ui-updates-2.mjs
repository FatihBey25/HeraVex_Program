import fs from 'fs';

const p = 'c:/tauri_hubUltra/src/App.tsx';
let data = fs.readFileSync(p, 'utf8');

// 1. Add Expenses Tab content in the Game Details modal
const expensesTabContent = `
                    {detailTab === "expenses" && (
                      <div className="tab-pane">
                        <div className="panel-head">
                          <div>
                            <p className="eyebrow">{ui.walletEyebrow}</p>
                            <h3>Proje Giderleri ve Bütçe</h3>
                          </div>
                        </div>
                        
                        {selectedGame && selectedGame.budget && selectedGame.budget > 0 && (
                          <div style={{ marginBottom: "2rem", padding: "1rem", background: "rgba(79, 140, 255, 0.05)", border: "1px solid var(--primary)", borderRadius: "8px" }}>
                             <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                               <span>Bütçe Durumu</span>
                               <strong>$ {selectedGame.expenses.reduce((sum, e) => sum + calculateAccumulatedAmount(e, exchangeRates[e.currency || 'USD'] || 1), 0).toFixed(2)} / $ {selectedGame.budget}</strong>
                             </div>
                             <div style={{width: '100%', height: '8px', background: 'var(--bg-elevated)', borderRadius: '4px', overflow: 'hidden'}}>
                               <div style={{height: '100%', width: \`\${Math.min((selectedGame.expenses.reduce((sum, e) => sum + calculateAccumulatedAmount(e, exchangeRates[e.currency || 'USD'] || 1), 0) / selectedGame.budget) * 100, 100)}%\`, backgroundColor: (selectedGame.expenses.reduce((sum, e) => sum + calculateAccumulatedAmount(e, exchangeRates[e.currency || 'USD'] || 1), 0) / selectedGame.budget) * 100 > 100 ? 'var(--status-danger)' : 'var(--primary)', transition: 'width 0.3s'}} />
                             </div>
                          </div>
                        )}

                        <div className="wallet-multi-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", alignItems: 'start' }}>
                          <div className="expense-form">
                            <h4>Yeni Gider Ekle</h4>
                            <div className="field-grid" style={{ gridTemplateColumns: '1fr', marginTop: '1rem' }}>
                              <label>
                                <span>{ui.expenseTitle}</span>
                                <input className="input" value={expenseTitleDraft} onChange={e => setExpenseTitleDraft(e.target.value)} />
                              </label>
                              <div style={{ display: 'flex', gap: '1rem' }}>
                                <label style={{ flex: 1 }}>
                                  <span>{ui.amount}</span>
                                  <input className="input" type="number" step="0.01" value={expenseAmountDraft} onChange={e => setExpenseAmountDraft(e.target.value)} />
                                </label>
                                <label style={{ flex: 1 }}>
                                  <span>Birim</span>
                                  <select className="input" value={expenseCurrencyDraft} onChange={e => setExpenseCurrencyDraft(e.target.value as any)}>
                                    <option value="USD">USD ($)</option>
                                    <option value="EUR">EUR (€)</option>
                                    <option value="TRY">TRY (₺)</option>
                                  </select>
                                </label>
                              </div>
                              <label>
                                <span>{ui.category}</span>
                                <input className="input" value={expenseCategoryDraft} onChange={e => setExpenseCategoryDraft(e.target.value)} />
                              </label>
                              <label>
                                <span>{ui.spentAt} (Tarih)</span>
                                <input className="input" type="date" value={expenseDateDraft} onChange={e => setExpenseDateDraft(e.target.value)} />
                              </label>
                              <label style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
                                <input type="checkbox" checked={expenseIsRecurringDraft} onChange={e => setExpenseIsRecurringDraft(e.target.checked)} />
                                <span style={{marginBottom: 0}}>Aylık Tekrarlayan Gider (Abonelik)</span>
                              </label>
                              <button className="primary-button" style={{ marginTop: "1rem" }} onClick={async () => {
                                 if (!selectedGame || !expenseTitleDraft || !expenseAmountDraft) return;
                                 const nextExp = {
                                    id: crypto.randomUUID(),
                                    title: expenseTitleDraft,
                                    amount: Number(expenseAmountDraft),
                                    category: expenseCategoryDraft || "General",
                                    spentAt: expenseDateDraft,
                                    notes: expenseNotesDraft,
                                    currency: expenseCurrencyDraft,
                                    isRecurring: expenseIsRecurringDraft
                                 };
                                 await updateSelectedGame({ expenses: [nextExp, ...selectedGame.expenses] });
                                 setExpenseTitleDraft(""); setExpenseAmountDraft("");
                              }}>Gideri Kaydet</button>
                            </div>
                          </div>
                          <div className="expense-list-panel">
                            <h4>Pasta Grafik - Maliyet Dağılımı</h4>
                            <PieChartWidget expenses={selectedGame?.expenses || []} getExchangeRate={(c) => exchangeRates[c] || 1} />
                            
                            <h4 style={{ marginTop: "2rem" }}>Son Giderler</h4>
                            <div className="stack-list" style={{ marginTop: "1rem" }}>
                               {selectedGame?.expenses.map(e => (
                                 <div key={e.id} className="version-card">
                                   <div className="version-head">
                                     <strong>{e.title} {e.isRecurring && "🔄"}</strong>
                                     <span>{e.amount.toFixed(2)} {e.currency}</span>
                                   </div>
                                   <small className="version-file">{e.category} · {e.spentAt} {e.isRecurring ? \`( Toplam Maliyet: $\${calculateAccumulatedAmount(e, exchangeRates[e.currency || 'USD'] || 1).toFixed(2)}) \` : ""}</small>
                                 </div>
                               ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
`;

if (!data.includes('detailTab === "expenses"')) {
  data = data.replace(
    '                    {detailTab === "integrations" && (\n                      <div className="tab-pane">\n                        <div className="panel-head">',
    expensesTabContent + '\n                    {detailTab === "integrations" && (\n                      <div className="tab-pane">\n                        <div className="panel-head">'
  );
}

// 2. Add Settings Modal Exchange Rates
if (!data.includes('Döviz Kurları (Baz Dolar)')) {
  const settingsModalAdditions = `
                <div className="settings-card" style={{ gridColumn: '1 / -1' }}>
                  <span className="label">Döviz Kurları (Baz Dolar)</span>
                  <p className="helper-copy">Uygulamadaki tüm toplamlar ve grafikler USD üzerinden gösterilir. Manuel kurları buradan ayarlayabilirsiniz.</p>
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                    <label>
                       <span>1 USD = (USD)</span>
                       <input className="input" type="number" disabled value={1} />
                    </label>
                    <label>
                       <span>1 EUR = (USD)</span>
                       <input className="input" type="number" step="0.01" value={exchangeRates.EUR} onChange={e => setExchangeRates({...exchangeRates, EUR: Number(e.target.value)})} />
                    </label>
                    <label>
                       <span>1 TRY = (USD)</span>
                       <input className="input" type="number" step="0.01" value={exchangeRates.TRY} onChange={e => setExchangeRates({...exchangeRates, TRY: Number(e.target.value)})} />
                    </label>
                  </div>
                  <button className="primary-button" style={{ marginTop: '1rem' }} onClick={async () => {
                     await saveExchangeRates(exchangeRates);
                     setStatusMessage("Kurlar kaydedildi.");
                  }}>Kurları Kaydet</button>
                </div>
`;
  data = data.replace(
    '<div className="settings-grid">',
    '<div className="settings-grid">' + settingsModalAdditions
  );
}

// 3. Add Budget to create game modal
if (!data.includes('Bütçe Sınırı (USD)')) {
  data = data.replace(
    '<label>\n                        <span>{ui.targetPlatforms}</span>',
    '<label>\n                        <span>Bütçe Sınırı (USD)</span>\n                        <input className="input" type="number" placeholder="Proje bütçesi (İsteğe bağlı)" value={draftBudget} onChange={e => setDraftBudget(e.target.value)} />\n                      </label>\n                      <label>\n                        <span>{ui.targetPlatforms}</span>'
  );
  
  // also add budget when calling createGame!
  data = data.replace(
    'tags: draftTags\n    });',
    'tags: draftTags\n    });\n\n    if (Number(draftBudget) > 0) { created.budget = Number(draftBudget); await updateSelectedGame({budget: Number(draftBudget)}); }'
  );
}

fs.writeFileSync(p, data, 'utf8');
console.log('App.tsx part 2 updates applied!');
