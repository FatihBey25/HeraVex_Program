import fs from 'fs';

const p = 'c:/tauri_hubUltra/src/App.tsx';
let data = fs.readFileSync(p, 'utf8');

// 1. Rewrite addExpense to handleAddExpense with parameter
const oldAddExpenseRegex = /const addExpense = async \(\) => \{[\s\S]*?setStatusMessage\(ui\.expenseAdded\);\n  \};/;
const newAddExpense = `const handleAddExpense = async (targetGameId: string | null) => {
    const targetGame = targetGameId ? games.find(g => g.id === targetGameId) : null;
    if (!expenseTitleDraft.trim() || !expenseAmountDraft.trim()) return;

    const amount = Number(expenseAmountDraft);
    if (Number.isNaN(amount) || amount <= 0) return;

    const nextExpense: ExpenseItem = {
      id: crypto.randomUUID(),
      title: expenseTitleDraft.trim(),
      amount,
      category: expenseCategoryDraft.trim() || "General",
      spentAt: expenseDateDraft || new Date().toISOString().slice(0, 10),
      notes: expenseNotesDraft.trim(),
      currency: expenseCurrencyDraft,
      isRecurring: expenseIsRecurringDraft
    };

    if (targetGame) {
      const updated = await saveGame({
        ...targetGame,
        expenses: [nextExpense, ...targetGame.expenses]
      });
      applySavedGameInState(updated);
    } else {
      const nextExpenses = [nextExpense, ...globalExpenses];
      await saveGlobalExpenses(nextExpenses);
      setGlobalExpenses(nextExpenses);
    }

    setExpenseTitleDraft("");
    setExpenseAmountDraft("");
    setExpenseCategoryDraft("Art");
    setExpenseNotesDraft("");
    setStatusMessage(ui.expenseAdded);
  };`;

data = data.replace(oldAddExpenseRegex, newAddExpense);

// 2. Replace wallet UI structure
const walletUiRegex = /<div className="wallet-layout"[\s\S]*?\{showLanguagePrompt/m;
const newWalletUi = `
          <div className="wallet-layout" style={{ display: 'flex', flexDirection: 'column', padding: '2rem', gap: '2rem', overflowY: 'auto' }}>
            
            {/* TOP LAYER: Studio Dashboard */}
            <section style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: 'var(--bg-card)', padding: '2rem', borderRadius: '16px', border: '1px solid #ffffff20' }}>
              <div style={{flex: 1}}>
                <p className="eyebrow">TOP LAYER</p>
                <h1 style={{margin: 0, fontSize: '2rem'}}>Studio Dashboard</h1>
                <p style={{color: 'var(--text-muted)'}}>Stüdyo ve tüm projelere ait global durum.</p>
                
                <h2 style={{marginTop: '2rem', fontSize: '2.5rem', fontWeight: 800, color: 'var(--primary)'}}>
                   $ {(
                      globalExpenses.reduce((sum, e) => sum + calculateAccumulatedAmount(e, exchangeRates[e.currency || 'USD'] || 1), 0) +
                      games.reduce((s, g) => s + g.expenses.reduce((sum, e) => sum + calculateAccumulatedAmount(e, exchangeRates[e.currency || 'USD'] || 1), 0), 0)
                   ).toFixed(2)}
                </h2>
                <span className="eyebrow">TÜM PROJELER + GENEL TOPLAM GİDER</span>

                <br/>
                <button className="primary-button" style={{marginTop: '2rem'}} onClick={async () => {
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

              <div className="settings-card" style={{ maxWidth: '400px', margin: 0, background: 'rgba(0,0,0,0.2)', border: '1px solid #ffffff10' }}>
                <span className="label" style={{fontSize: '1rem', fontWeight: 600}}>Exchange Rates (Base USD)</span>
                <p style={{fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem'}}>Rakamlar anlık olarak güncellenir.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                  <label style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                     <span style={{fontWeight: 'bold', width: '40px'}}>EUR</span>
                     <input className="input" type="number" step="0.01" style={{padding: '0.4rem', width: '120px'}} value={exchangeRates.EUR || ''} onChange={e => {setExchangeRates({...exchangeRates, EUR: Number(e.target.value)}); saveExchangeRates({...exchangeRates, EUR: Number(e.target.value)});}} />
                  </label>
                  <label style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                     <span style={{fontWeight: 'bold', width: '40px'}}>TRY</span>
                     <input className="input" type="number" step="0.01" style={{padding: '0.4rem', width: '120px'}} value={exchangeRates.TRY || ''} onChange={e => {setExchangeRates({...exchangeRates, TRY: Number(e.target.value)}); saveExchangeRates({...exchangeRates, TRY: Number(e.target.value)});}} />
                  </label>
                </div>
              </div>
            </section>

            {/* MIDDLE LAYER: General Studio Expenses */}
            <section style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid #ffffff20', overflow: 'hidden' }}>
              <div style={{ padding: '1.5rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)' }} 
                   onClick={() => setWalletExpandedId(walletExpandedId === "__general__" ? null : "__general__")}>
                 <div style={{flex: 1}}>
                   <p className="eyebrow">MIDDLE LAYER</p>
                   <h3 style={{ margin: 0, fontSize: '1.4rem' }}>General Studio Expenses</h3>
                   <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-muted)' }}>Projelere bağlı olmayan ofis, donanım veya lisanslama masrafları.</p>
                 </div>
                 <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
                    $ {globalExpenses.reduce((sum, e) => sum + calculateAccumulatedAmount(e, exchangeRates[e.currency || 'USD'] || 1), 0).toFixed(2)}
                 </div>
              </div>
              
              {walletExpandedId === "__general__" && (
                  <div style={{ padding: '1.5rem', borderTop: '1px solid #ffffff20', background: 'rgba(0, 0, 0, 0.2)' }}>
                      <div className="wallet-multi-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
                          <div className="expense-form" style={{background: 'transparent', padding: 0, border: 'none'}}>
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
                              <label style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem", background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px' }}>
                                <input type="checkbox" checked={expenseIsRecurringDraft} onChange={e => setExpenseIsRecurringDraft(e.target.checked)} />
                                <span style={{marginBottom: 0, fontWeight: 600}}>Aylık Tekrarlayan Gider (Abonelik)</span>
                              </label>
                              <button className="primary-button" style={{ marginTop: "1rem" }} onClick={() => handleAddExpense(null)}>Ekle</button>
                            </div>
                          </div>
                          <div className="expense-list-panel">
                            <h4>Genel Gider Dağılımı</h4>
                            <PieChartWidget expenses={globalExpenses} getExchangeRate={(c) => exchangeRates[c] || 1} />
                            <h4 style={{ marginTop: "2rem" }}>Gider Geçmişi</h4>
                            <div className="stack-list" style={{ marginTop: "1rem", maxHeight: "250px", overflowY: "auto" }}>
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
            </section>

            {/* BOTTOM LAYER: Project Based Expenses */}
            <div>
              <p className="eyebrow" style={{marginBottom: '1rem'}}>BOTTOM LAYER - PROJECT BASED EXPENSES</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {games.map(g => {
                     const spent = g.expenses.reduce((sum, e) => sum + calculateAccumulatedAmount(e, exchangeRates[e.currency || 'USD'] || 1), 0);
                     const progress = g.budget && g.budget > 0 ? (spent / g.budget) * 100 : 0;
                     const isExpanded = walletExpandedId === g.id;

                     return (
                       <section key={g.id} style={{ background: 'var(--bg-card)', border: '1px solid #ffffff20', borderRadius: '12px', overflow: 'hidden' }}>
                          <div style={{ padding: '1.5rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)' }} 
                               onClick={() => setWalletExpandedId(isExpanded ? null : g.id)}>
                             
                             <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flex: 1 }}>
                               <div style={{
                                  width: '60px', height: '60px', borderRadius: '50%', backgroundColor: 'var(--bg-elevated)', 
                                  backgroundImage: g.coverDataUrl ? \`url(\${g.coverDataUrl})\` : 'none', 
                                  backgroundSize: 'cover', backgroundPosition: 'center', border: '2px solid #ffffff30',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                               }}>
                                  {!g.coverDataUrl && <span style={{fontSize:'0.8rem', color:'var(--text-muted)'}}>No Image</span>}
                               </div>

                               <div style={{ flex: 1 }}>
                                 <h3 style={{ margin: 0, fontSize: '1.4rem' }}>{g.title}</h3>
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
                             </div>

                             <div style={{ fontSize: '1.8rem', fontWeight: 'bold', marginLeft: '1rem' }}>
                                $ {spent.toFixed(2)}
                             </div>
                          </div>

                          {isExpanded && (
                             <div style={{ padding: '1.5rem', borderTop: '1px solid #ffffff20', background: 'rgba(0, 0, 0, 0.2)' }}>
                                <div className="wallet-multi-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
                                    <div className="expense-form" style={{background: 'transparent', padding: 0, border: 'none'}}>
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
                                        <label style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem", background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px' }}>
                                          <input type="checkbox" checked={expenseIsRecurringDraft} onChange={e => setExpenseIsRecurringDraft(e.target.checked)} />
                                          <span style={{marginBottom: 0, fontWeight: 600}}>Aylık Tekrarlayan Gider (Abonelik)</span>
                                        </label>
                                        <button className="primary-button" style={{ marginTop: "1rem" }} onClick={() => handleAddExpense(g.id)}>Projeye Ekle</button>
                                      </div>
                                    </div>
                                    <div className="expense-list-panel">
                                      <h4>Harcama Dağılımı</h4>
                                      <PieChartWidget expenses={g.expenses} getExchangeRate={(c) => exchangeRates[c] || 1} />
                                      <h4 style={{ marginTop: "2rem" }}>Son Giderler</h4>
                                      <div className="stack-list" style={{ marginTop: "1rem", maxHeight: "250px", overflowY: "auto" }}>
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
                       </section>
                     );
                  })}
              </div>
            </div>
          </div>
        )}
        {showLanguagePrompt`;

data = data.replace(walletUiRegex, newWalletUi);

fs.writeFileSync(p, data, 'utf8');
console.log("Hotfix injected!");
