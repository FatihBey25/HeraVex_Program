import fs from 'fs';
const p = 'c:/tauri_hubUltra/src/App.tsx';
let data = fs.readFileSync(p, 'utf8');

// Fix missing ) }
data = data.replace(
  '          </div>\\n        {showLanguagePrompt',
  '          </div>\\n        )}\\n        {showLanguagePrompt'
);

// Fix tabs en
data = data.replace(
  'integrations: "Links"\\n    },',
  'integrations: "Links",\\n      expenses: "Wallet"\\n    },'
);
// Fix tabs tr
data = data.replace(
  'integrations: "Linkler"\\n    },',
  'integrations: "Linkler",\\n      expenses: "Giderler"\\n    },'
);
// Fix tabs fr
data = data.replace(
  'integrations: "Liens"\\n    },',
  'integrations: "Liens",\\n      expenses: "Depenses"\\n    },'
);
// Fix tabs es
data = data.replace(
  'integrations: "Enlaces"\\n    },',
  'integrations: "Enlaces",\\n      expenses: "Gastos"\\n    },'
); // wait, lets use a regex for safety

data = data.replaceAll(/integrations:\n?\s*"([^"]+)"\n?\s*}/g, 'integrations: "$1",\\n      expenses: "Wallet"\\n    }');

fs.writeFileSync(p, data, 'utf8');
console.log("Fixed syntax and translations!");

// Fix PieChartWidget type
const chartFile = 'c:/tauri_hubUltra/src/components/PieChartWidget.tsx';
let chartData = fs.readFileSync(chartFile, 'utf8');
chartData = chartData.replace('formatter={(value: number) =>', 'formatter={(value: any) =>');
fs.writeFileSync(chartFile, chartData, 'utf8');
