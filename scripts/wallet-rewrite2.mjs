import fs from 'fs';

const appPath = 'c:/tauri_hubUltra/src/App.tsx';
let code = fs.readFileSync(appPath, 'utf-8');

const OLD_WALLET_START = `          <div key="wallet" className="wallet-layout page-fade" style={{ display: 'flex', flexDirection: 'column', padding: '2rem', gap: '2rem', overflowY: 'auto' }}>`;
const OLD_WALLET_END_MARKER = `            </div>\n          )\n        }\n        </div>\n        </>\n        )}`;

const walletStart = code.indexOf(OLD_WALLET_START);
const walletEnd = code.indexOf(OLD_WALLET_END_MARKER, walletStart);
if (walletStart === -1 || walletEnd === -1) {
  console.error('Could not find wallet section! start:', walletStart, 'end:', walletEnd);
  process.exit(1);
}

const NEW_WALLET = `          <div key="wallet" className="wallet-layout page-fade" style={{ display: 'flex', flexDirection: 'column', padding: '2rem', gap: '2rem', overflowY: 'auto', position: 'relative' }}>

            {/* CURRENCY PANEL (ABSOLUTE TOP RIGHT) */}
            <div className="wallet-currency-panel" style={{ position: 'absolute', top: '2rem', right: '2rem', zIndex: 10, minWidth: '280px', maxWidth: '320px', background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.1)', padding: '1.25rem', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
                <span style={{fontWeight: 700, fontSize: '0.9rem'}}>
                  {isFetchingRates ? "⏳ Kurlar güncelleniyor..." : "Aktif Dövizler"}
                </span>
                <button className="icon-button" style={{fontSize: '0.75rem', padding: '4px 10px', border: '1px solid #ffffff20', borderRadius: '8px'}}
                  onClick={() => setCurrencyAddOpen(o => !o)}>
                  {currencyAddOpen ? "Kapat" : "+ Döviz Ekle"}
                </button>
              </div>

              {/* Active currency list */}
              <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
                {activeCurrencies.map(cur => (
                  <div key={cur} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'rgba(255,255,255,0.06)', borderRadius: '8px'}}>
                    <span style={{fontWeight: 600}}>{cur}</span>
                    <span style={{color: 'var(--text-muted)', fontSize: '0.85rem'}}>
                      1 USD = {cur === 'USD' ? '1.00' : (exchangeRates[cur] ? exchangeRates[cur].toFixed(4) : '—')} {cur}
                    </span>
                    {cur !== 'USD' && (
                      <button className="icon-button" style={{color: 'var(--status-danger)', padding: '2px 6px'}}
                        onClick={() => setActiveCurrencies(prev => prev.filter(c => c !== cur))}>
                        <Trash size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Add currency accordion */}
              <div className={\`wallet-accordion \${currencyAddOpen ? 'wallet-accordion-open' : ''}\`}>
                <div style={{display: 'flex', gap: '0.75rem', alignItems: 'center', paddingTop: '1rem'}}>
                  <select className="input" value={newCurrencyDraft} onChange={e => setNewCurrencyDraft(e.target.value)}
                    style={{flex: 1, padding: '0.4rem'}}>
                    {["EUR","TRY","JPY","GBP","CAD","AUD","CHF","SEK","NOK","DKK","PLN","CZK"].filter(c => !activeCurrencies.includes(c)).map(c => (
                      <option key={c} value={c}>{c} — 1 USD = {exchangeRates[c]?.toFixed(4) ?? '...'}</option>
                    ))}
                  </select>
                  <button className="primary-button" style={{padding: '0.4rem 1rem', whiteSpace: 'nowrap'}}
                    onClick={() => {
                      if (newCurrencyDraft && !activeCurrencies.includes(newCurrencyDraft)) {
                        const next = [...activeCurrencies, newCurrencyDraft];
                        setActiveCurrencies(next);
                        setNewCurrencyDraft(["EUR","TRY","JPY","GBP","CAD","AUD","CHF","SEK","NOK","DKK","PLN","CZK"].find(c => !next.includes(c)) ?? "EUR");
                      }
                    }}>Ekle</button>
                </div>
              </div>
            </div>

            {/* TOP LAYER — Studio Dashboard */}
            <section className="wallet-top-card" style={{ paddingRight: '360px' }}>
              <div style={{flex: 1}}>
                <p className="eyebrow">STUDIO DASHBOARD</p>
                <h1 style={{margin: 0, fontSize: '2rem'}}>Finansal Özet</h1>
                <h2 style={{marginTop: '1rem', fontSize: '2.5rem', fontWeight: 800, color: 'var(--primary)'}}>
                  $ {(
                    globalExpenses.reduce((sum, e) => sum + calculateAccumulatedAmount(e, exchangeRates[e.currency || 'USD'] || 1), 0) +
                    games.reduce((s, g) => s + g.expenses.reduce((sum, e) => sum + calculateAccumulatedAmount(e, exchangeRates[e.currency || 'USD'] || 1), 0), 0)
                  ).toFixed(2)}
                </h2>
                <span className="eyebrow">TÜM PROJELER + GENEL TOPLAM</span>
                <div style={{marginTop: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap'}}>
                  <button className="secondary-button" style={{display: 'flex', alignItems: 'center', gap: '6px'}} onClick={async () => {
                    const header = "Birim,Kategori,Tutar,Tarih,Not,Proje,Kur\\n";
                    const rows = allExpenses.map(e => \`"$\{e.currency || 'USD'}","$\{e.category}",$\{e.amount},"$\{e.spentAt}","$\{e.notes}","$\{e.gameTitle || 'Genel'}",$\{(exchangeRates || {})[e.currency || 'USD'] || 1}\`).join("\\n");
                    try { const saved = await exportCsvReport(header + rows); showToast("CSV: " + saved, "success"); } catch {}
                  }}>
                    <Download size={14} /> CSV Dışa Aktar
                  </button>
                </div>
              </div>
            </section>

            {/* WALLET TABS */}
            <div className="wallet-tabs">
              <button className={\`wallet-tab-btn \${walletTab === 'general' ? 'wallet-tab-active' : ''}\`}
                onClick={() => setWalletTab('general')}>
                📋 Genel Giderler
              </button>
              <button className={\`wallet-tab-btn \${walletTab === 'projects' ? 'wallet-tab-active' : ''}\`}
                onClick={() => setWalletTab('projects')}>
                🎮 Proje Giderleri
              </button>
            </div>

            {/* TAB: GENERAL EXPENSES */}
            {walletTab === 'general' && (
              <div className="wallet-tab-panel page-fade">
                <section style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid #ffffff20', overflow: 'hidden' }}>
                  <div style={{ padding: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', cursor: 'pointer' }}
                    onClick={() => setWalletExpandedId(walletExpandedId === '__general__' ? null : '__general__')}>
                    <div style={{flex: 1}}>
                      <p className="eyebrow">GENEL STÜDYO GİDERLERİ</p>
                      <h3 style={{ margin: 0 }}>Ofis, Donanım, Lisanslama</h3>
                      <p style={{ margin: '0.4rem 0 0', color: 'var(--text-muted)' }}>Oyunlara bağlı olmayan sabit giderler</p>
                    </div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 'bold' }}>
                      $ {globalExpenses.reduce((sum, e) => sum + calculateAccumulatedAmount(e, exchangeRates[e.currency || 'USD'] || 1), 0).toFixed(2)}
                    </div>
                  </div>

                  <div className={\`wallet-accordion \${walletExpandedId === '__general__' ? 'wallet-accordion-open' : ''}\`}
                    style={{ borderTop: walletExpandedId === '__general__' ? '1px solid #ffffff20' : 'none', background: 'rgba(0,0,0,0.2)' }}>
                    <div style={{ padding: '2rem' }}>
                      <div style={{ display: "grid", gridTemplateColumns: "55% 45%", gap: "3rem", alignItems: "start" }}>
                        <div className="expense-form" style={{background: 'transparent', padding: 0, border: 'none'}}>
                          <h4 style={{marginBottom: '1.5rem'}}>Genel Gider Ekle</h4>
                          <div className="field-grid" style={{ gridTemplateColumns: '1fr', marginTop: '1rem', gap: '1.25rem' }}>
                            <label><span>Başlık</span><input className="input" value={expenseTitleDraft} onChange={e => setExpenseTitleDraft(e.target.value)} /></label>
                            <div style={{ display: 'flex', gap: '1.5rem' }}>
                              <label style={{flex: 1}}><span>Tutar</span><input className="input" type="number" step="0.01" value={expenseAmountDraft} onChange={e => setExpenseAmountDraft(e.target.value)} /></label>
                              <label style={{flex: 1}}><span>Birim</span>
                                <select className="input" value={expenseCurrencyDraft} onChange={e => setExpenseCurrencyDraft(e.target.value)}>
                                  {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </label>
                            </div>
                            <label><span>Kategori</span>
                              <select className="input" value={expenseCategoryDraft} onChange={e => setExpenseCategoryDraft(e.target.value)}>
                                <option>Office</option><option>Hardware</option><option>License</option><option>Art</option><option>Sound</option><option>Marketing</option><option>Tax</option><option>Other</option>
                              </select>
                            </label>
                            <label><span>Tarih</span><input className="input" type="date" value={expenseDateDraft} onChange={e => setExpenseDateDraft(e.target.value)} /></label>
                            <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.75rem', background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px' }}>
                              <input type="checkbox" checked={expenseIsRecurringDraft} onChange={e => setExpenseIsRecurringDraft(e.target.checked)} />
                              <span style={{marginBottom: 0, fontWeight: 600}}>Aylık Tekrarlayan Gider</span>
                            </label>
                            <button className="primary-button" style={{marginTop: '1rem', padding: '1rem'}} onClick={() => handleAddExpense(null)}>Gider Ekle</button>
                          </div>
                        </div>
                        <div className="expense-list-panel">
                          <h4 style={{marginBottom: '1rem'}}>Harcama Dağılımı</h4>
                          <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '1.5rem' }}>
                            <PieChartWidget expenses={globalExpenses} getExchangeRate={c => exchangeRates[c] || 1} />
                          </div>
                          <h4 style={{marginTop: '2rem', marginBottom: '1rem'}}>Son Giderler</h4>
                          <div className="stack-list" style={{ maxHeight: '350px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                            {globalExpenses.length === 0 && <p style={{color:'var(--text-muted)', fontSize:'0.9rem', fontStyle: 'italic'}}>Henüz eklenmiş gider yok.</p>}
                            {globalExpenses.map(e => (
                              <div key={e.id} className="version-card" style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding: '1rem', background: 'rgba(255,255,255,0.03)'}}>
                                <div>
                                  <div className="version-head" style={{fontSize: '1.1rem'}}><strong>{e.title} {e.isRecurring && "🔄"}</strong><span style={{color: 'var(--primary)', fontWeight: 800}}>{e.amount.toFixed(2)} {e.currency}</span></div>
                                  <small className="version-file" style={{opacity: 0.7, marginTop: '0.4rem', display: 'block'}}>{e.category} · {e.spentAt}</small>
                                </div>
                                <button className="icon-button" style={{color:'var(--status-danger)', padding: '0.5rem', background: 'rgba(245, 87, 87, 0.1)'}} onClick={() => deleteExpense(e.id, null)}><Trash size={16} /></button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* TAB: PROJECT EXPENSES */}
            {walletTab === 'projects' && (
              <div className="wallet-tab-panel page-fade">
                <p className="eyebrow" style={{marginBottom: '1rem'}}>PROJE BAZLI GİDERLER</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {games.map(g => {
                    const spent = g.expenses.reduce((sum, e) => sum + calculateAccumulatedAmount(e, exchangeRates[e.currency || 'USD'] || 1), 0);
                    const progress = g.budget && g.budget > 0 ? (spent / g.budget) * 100 : 0;
                    const isExpanded = walletExpandedId === g.id;
                    return (
                      <section key={g.id} className="wallet-project-card">
                        <div className="wallet-project-header" onClick={() => setWalletExpandedId(isExpanded ? null : g.id)}>
                          <div style={{ display: 'flex', gap: '1.2rem', alignItems: 'center', flex: 1 }}>
                            <div style={{
                              width: '56px', height: '56px', borderRadius: '50%',
                              backgroundImage: g.coverDataUrl ? \`url($\{g.coverDataUrl})\` : 'none',
                              backgroundColor: 'var(--bg-elevated)', backgroundSize: 'cover', backgroundPosition: 'center',
                              border: '2px solid #ffffff30', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                            }}>
                              {!g.coverDataUrl && <span style={{fontSize: '0.7rem', color: 'var(--text-muted)'}}>IMG</span>}
                            </div>
                            <div style={{flex: 1}}>
                              <h3 style={{margin: 0}}>{g.title}</h3>
                              {g.budget && g.budget > 0 ? (
                                <div style={{marginTop: '0.6rem'}}>
                                  <div style={{display:'flex', justifyContent:'space-between', fontSize:'0.8rem', color:'var(--text-muted)'}}>
                                    <span>$ {spent.toFixed(2)} / $ {g.budget}</span>
                                    <span>{progress.toFixed(0)}%</span>
                                  </div>
                                  <div style={{width:'100%', height:'5px', background:'var(--bg-elevated)', borderRadius:'3px', marginTop:'4px', overflow:'hidden'}}>
                                    <div style={{height:'100%', width:\`\${Math.min(progress,100)}%\`, backgroundColor: progress > 100 ? 'var(--status-danger)' : 'var(--primary)', transition:'width 0.3s'}} />
                                  </div>
                                </div>
                              ) : (
                                <p style={{margin:'0.3rem 0 0', color:'var(--text-muted)', fontSize:'0.85rem'}}>Bütçe sınırı yok</p>
                              )}
                            </div>
                          </div>
                          <div style={{fontSize:'1.8rem', fontWeight:'bold', marginLeft:'1rem'}}>$ {spent.toFixed(2)}</div>
                        </div>

                        <div className={\`wallet-accordion \${isExpanded ? 'wallet-accordion-open' : ''}\`}
                          style={{ borderTop: isExpanded ? '1px solid #ffffff20' : 'none', background: 'rgba(0,0,0,0.2)' }}>
                          <div style={{padding: '2rem'}}>
                            <div style={{ display: "grid", gridTemplateColumns: "55% 45%", gap: "3rem", alignItems: "start" }}>
                              <div className="expense-form" style={{background:'transparent', padding:0, border:'none'}}>
                                <h4 style={{marginBottom: '1.5rem'}}>"{g.title}" İçin Gider Ekle</h4>
                                <div className="field-grid" style={{gridTemplateColumns:'1fr', marginTop:'1rem', gap: '1.25rem'}}>
                                  <label><span>Başlık</span><input className="input" value={expenseTitleDraft} onChange={e => setExpenseTitleDraft(e.target.value)} /></label>
                                  <div style={{display:'flex', gap:'1.5rem'}}>
                                    <label style={{flex:1}}><span>Tutar</span><input className="input" type="number" step="0.01" value={expenseAmountDraft} onChange={e => setExpenseAmountDraft(e.target.value)} /></label>
                                    <label style={{flex:1}}><span>Birim</span>
                                      <select className="input" value={expenseCurrencyDraft} onChange={e => setExpenseCurrencyDraft(e.target.value)}>
                                        {activeCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
                                      </select>
                                    </label>
                                  </div>
                                  <label><span>Kategori</span>
                                    <select className="input" value={expenseCategoryDraft} onChange={e => setExpenseCategoryDraft(e.target.value)}>
                                      <option>Art</option><option>Code</option><option>Sound</option><option>Marketing</option><option>License</option><option>Tax</option><option>Other</option>
                                    </select>
                                  </label>
                                  <label><span>Tarih</span><input className="input" type="date" value={expenseDateDraft} onChange={e => setExpenseDateDraft(e.target.value)} /></label>
                                  <label style={{flexDirection:'row', alignItems:'center', gap:'0.75rem', background:'rgba(255,255,255,0.05)', padding:'1rem', borderRadius:'8px'}}>
                                    <input type="checkbox" checked={expenseIsRecurringDraft} onChange={e => setExpenseIsRecurringDraft(e.target.checked)} />
                                    <span style={{marginBottom:0, fontWeight:600}}>Aylık Tekrarlayan Gider</span>
                                  </label>
                                  <button className="primary-button" style={{marginTop:'1rem', padding: '1rem'}} onClick={() => handleAddExpense(g.id)}>Projeye Ekle</button>
                                </div>
                              </div>
                              <div className="expense-list-panel">
                                <h4 style={{marginBottom: '1rem'}}>Harcama Dağılımı</h4>
                                <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '1.5rem' }}>
                                  <PieChartWidget expenses={g.expenses} getExchangeRate={c => exchangeRates[c] || 1} />
                                </div>
                                <h4 style={{marginTop:'2rem', marginBottom: '1rem'}}>Son Giderler</h4>
                                <div className="stack-list" style={{maxHeight:'350px', overflowY:'auto', paddingRight: '0.5rem'}}>
                                  {g.expenses.length === 0 && <p style={{color:'var(--text-muted)', fontSize:'0.9rem', fontStyle:'italic'}}>Henüz gider yok.</p>}
                                  {g.expenses.map(e => (
                                    <div key={e.id} className="version-card" style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding: '1rem', background: 'rgba(255,255,255,0.03)'}}>
                                      <div>
                                        <div className="version-head" style={{fontSize: '1.1rem'}}><strong>{e.title} {e.isRecurring && "🔄"}</strong><span style={{color: 'var(--primary)', fontWeight: 800}}>{e.amount.toFixed(2)} {e.currency}</span></div>
                                        <small className="version-file" style={{opacity: 0.7, marginTop: '0.4rem', display: 'block'}}>{e.category} · {e.spentAt}</small>
                                      </div>
                                      <button className="icon-button" style={{color:'var(--status-danger)', padding: '0.5rem', background: 'rgba(245, 87, 87, 0.1)'}} onClick={() => deleteExpense(e.id, g.id)}><Trash size={16} /></button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </section>
                    );
                  })}
                  {games.length === 0 && <p style={{color:'var(--text-muted)'}}>Henüz proje yok. Önce bir proje oluşturun.</p>}
                </div>
              </div>
            )}

            </div>
          )
        }
        </div>
        </>
        )}`;

const endMarkerLength = OLD_WALLET_END_MARKER.length;
code = code.slice(0, walletStart) + NEW_WALLET + code.slice(walletEnd + endMarkerLength);

fs.writeFileSync(appPath, code, 'utf-8');
console.log('App.tsx updated successfully with wallet rewrite 2.');
