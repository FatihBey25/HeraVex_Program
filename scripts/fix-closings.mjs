import fs from 'fs';
const p = 'c:/tauri_hubUltra/src/App.tsx';
let code = fs.readFileSync(p, 'utf-8');

// Use exact CRLF as it appears in file
const OLD = '        )\r\n        }\r\n        {createOpen && (';
const NEW = '          )\r\n        </div>\r\n        </>\r\n        )}\r\n        {createOpen && (';

if (!code.includes(OLD)) {
  // Try LF only
  const OLD2 = '        )\n        }\n        {createOpen && (';
  const NEW2 = '          )\n        </div>\n        </>\n        )}\n        {createOpen && (';
  if (!code.includes(OLD2)) {
    console.error('Pattern not found with either LF or CRLF!');
    // Print chars around the area
    const idx = code.indexOf('createOpen && (');
    console.log('Context:', JSON.stringify(code.slice(idx - 50, idx + 20)));
    process.exit(1);
  }
  code = code.replace(OLD2, NEW2);
} else {
  code = code.replace(OLD, NEW);
}

fs.writeFileSync(p, code, 'utf-8');
console.log('Done');
