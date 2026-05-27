
import fs from "fs";
const p = "c:/tauri_hubUltra/src/App.tsx";
let code = fs.readFileSync(p, "utf-8");
const mMatch = code.match(/\{createOpen && \([\s\S]*?className="creator-actions"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*\)\}/);
if (mMatch) {
  const modalCode = mMatch[0];
  code = code.replace(modalCode, "");
  code = code.replace("{showLanguagePrompt && (", modalCode + "\n\n        {showLanguagePrompt && (");
  fs.writeFileSync(p, code);
  console.log("Success");
} else {
  console.log("Failed to match modal");
}

