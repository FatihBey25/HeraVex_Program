import http from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

const port = 1420;

function checkPort() {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${port}`, () => {
      request.destroy();
      resolve(true);
    });
    request.on("error", () => resolve(false));
  });
}

const isRunning = await checkPort();

if (isRunning) {
  console.log(`Vite already running on ${port}, reusing existing dev server.`);
  process.exit(0);
}

const viteCmd =
  process.platform === "win32"
    ? join(process.cwd(), "node_modules", ".bin", "vite.cmd")
    : join(process.cwd(), "node_modules", ".bin", "vite");

const child = spawn(viteCmd, [], {
  stdio: "inherit",
  shell: process.platform === "win32"
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
