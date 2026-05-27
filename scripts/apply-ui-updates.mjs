import fs from 'fs';

const p = 'c:/tauri_hubUltra/src/App.tsx';
let data = fs.readFileSync(p, 'utf8');

// 1. Add exchangeRates to settings load
if (!data.includes('setExchangeRates(settings?.exchangeRates ??')) {
  data = data.replace(
    'setGlobalExpenses(settings?.globalExpenses ?? []);',
    'setGlobalExpenses(settings?.globalExpenses ?? []);\n      setExchangeRates(settings?.exchangeRates ?? { USD: 1, EUR: 1.05, TRY: 0.028 });'
  );
}

if (!data.includes('setExchangeRates(settings?.exchangeRates ??')) {
  data = data.replace(
    'setGlobalExpenses(settings?.globalExpenses ?? []);',
    'setGlobalExpenses(settings?.globalExpenses ?? []);\n      setExchangeRates(settings?.exchangeRates ?? { USD: 1, EUR: 1.05, TRY: 0.028 });' // for the importBackup section
  );
}

// 2. Add Onboarding logic in the main body
if (!data.includes('<Onboarding')) {
  const targetOnboard = '<main className="workspace">';
  data = data.replace(
    targetOnboard,
    targetOnboard + '\n        {games.length === 0 && !isLoading ? (\n          <Onboarding onCreateFirstGame={() => { setCreateOpen(true); setShowSettingsModal(false); setShowLanguagePrompt(false); }} />\n        ) : (\n          <>'
  );
  data = data.replace(
    '</main>',
    '  </>\n        )}\n      </main>'
  );
}

// 3. Platform Icons
if (!data.includes('function PlatformIcon(')) {
  const pIcon = `
function PlatformIcon({ platform }: { platform: string }) {
  if (platform === "Windows") return <Monitor size={14} />;
  if (platform === "macOS") return <Laptop size={14} />;
  if (platform === "Linux") return <TerminalIcon size={14} />;
  if (platform === "Android" || platform === "iOS") return <Smartphone size={14} />;
  if (platform === "Web") return <Globe size={14} />;
  return <span style={{fontSize: "0.8rem"}}>{platform}</span>;
}
`;
  data = data.replace('function renderInlineMarkdown', pIcon + '\nfunction renderInlineMarkdown');
}

// And replace simple platform rendering
const tsxPlatform = `<span key={p} className="mini-tag">{p}</span>`;
const newTsxPlatform = `<span key={p} className="mini-tag" style={{display:'inline-flex', alignItems:'center', gap:'4px'}}><PlatformIcon platform={p}/></span>`;
data = data.replaceAll(tsxPlatform, newTsxPlatform);

// For the project platforms mapping, there's likely a place rendering tags and platforms together.
// E.g. game.platforms.map(p => ...)
data = data.replaceAll(
  `{game.platforms.map((p) => (
                          <span key={p} className="mini-tag">
                            {p}
                          </span>
                        ))}`,
  `{game.platforms.map((p) => (
                          <span key={p} className="mini-tag" style={{display:'inline-flex', alignItems:'center', gap:'4px'}}>
                            <PlatformIcon platform={p}/>
                          </span>
                        ))}`
);

// 4. Overhaul Wallet layout
// The wallet layout block starts at `) : (` before `<div className="wallet-layout">`
const walletStart = '<div className="wallet-layout">';
const newWalletBlock = `<div className="wallet-layout" style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            <section className="topbar" style={{ padding: '2rem' }}>
              <div>
                <p className="eyebrow">CÜZDAN MERKEZİ</p>
                <h2>Tüm Giderler ve Proje Bütçeleri</h2>
              </div>
              <button className="primary-button" onClick={async () => {
                const header = "Birim,Kategori,Tutar,Tarih,Not,Proje,Kur\\n";
                const rows = allExpenses.map(e => \`"\${e.currency || 'USD'}","\${e.category}",\${e.amount},"\${e.spentAt}","\${e.notes}","\${e.gameTitle || 'Genel'}",\${(exchangeRates || {})[e.currency || 'USD'] || 1}\`).join("\\n");
                const csv = header + rows;
                try {
                  const saved = await exportCsvReport(csv);
                  setStatusMessage("CSV Raporu Şuraya Kaydedildi: " + saved);
                } catch(e) { /* ignore */ }
              }}>
                <Download size={16} style={{marginRight: '8px'}} /> Export CSV (Excel)
              </button>
            </section>
            
            <div className="wallet-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', padding: '0 2rem 2rem 2rem' }}>
                <div className="version-card" style={{ cursor: 'pointer', border: '1px solid var(--primary)', background: 'rgba(79, 140, 255, 0.05)' }} onClick={() => { setExpenseGameIdDraft("__general__"); setDetailTab("expenses"); setSelectedId("___global___"); }}>
                   <h3>Genel Stüdyo Giderleri</h3>
                   <p style={{marginTop:'0.5rem', color:'var(--text-muted)'}}>Stüdyo genelindeki tüm ortak ve projeden bağımsız harcamalar.</p>
                   <div style={{marginTop: '1rem', fontSize: '1.25rem', fontWeight: 'bold'}}>$ {
                     globalExpenses.reduce((sum, e) => sum + calculateAccumulatedAmount(e, exchangeRates[e.currency || 'USD'] || 1), 0).toFixed(2)
                   }</div>
                </div>
                {games.map(g => {
                   const spent = g.expenses.reduce((sum, e) => sum + calculateAccumulatedAmount(e, exchangeRates[e.currency || 'USD'] || 1), 0);
                   const progress = g.budget && g.budget > 0 ? (spent / g.budget) * 100 : 0;
                   return (
                     <div key={g.id} className="version-card" style={{ cursor: 'pointer' }} onClick={() => { setWorkspaceTab("library"); setDetailTab("expenses"); setSelectedId(g.id); }}>
                       <h3>{g.title}</h3>
                       <div style={{marginTop: '1rem', fontSize: '1.25rem', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between'}}>
                         <span>$ {spent.toFixed(2)}</span>
                         {g.budget && <span style={{fontSize:'0.9rem', color:'var(--text-muted)', fontWeight:'normal'}}>Limit: $ {g.budget}</span>}
                       </div>
                       {g.budget && g.budget > 0 && (
                         <div style={{width: '100%', height: '6px', background: 'var(--bg-elevated)', borderRadius: '3px', marginTop: '0.5rem', overflow: 'hidden'}}>
                           <div style={{height: '100%', width: \`\${Math.min(progress, 100)}%\`, backgroundColor: progress > 100 ? 'var(--status-danger)' : 'var(--primary)', transition: 'width 0.3s'}} />
                         </div>
                       )}
                     </div>
                   );
                })}
            </div>
          </div>`;

// Delete old wallet layout up to {showLanguagePrompt}
const walletRegex = /<div className="wallet-layout">[\s\S]*?{showLanguagePrompt && \(/;
if (walletRegex.test(data)) {
  data = data.replace(walletRegex, newWalletBlock + '\\n\\n        {showLanguagePrompt && (');
}

fs.writeFileSync(p, data, 'utf8');
console.log('App.tsx partial updates applied!');
