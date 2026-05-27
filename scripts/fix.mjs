import fs from 'fs';
const p = 'c:/tauri_hubUltra/src/App.tsx';
let data = fs.readFileSync(p, 'utf8');
data = data.replace(/\\\\n\\\\n        \\{showLanguagePrompt/g, '\\n\\n        {showLanguagePrompt');
fs.writeFileSync(p, data, 'utf8');
console.log("Fixed backslashes!");
