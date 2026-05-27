import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const cargoBin = join(process.env.USERPROFILE ?? "", ".cargo", "bin");
const baseEnv = {
  ...process.env,
  PATH: existsSync(cargoBin)
    ? `${cargoBin};${process.env.PATH ?? ""}`
    : process.env.PATH ?? ""
};

const tauriCmd =
  process.platform === "win32"
    ? join(process.cwd(), "node_modules", ".bin", "tauri.cmd")
    : join(process.cwd(), "node_modules", ".bin", "tauri");

function loadWindowsBuildEnv(env) {
  if (process.platform !== "win32") {
    return env;
  }

  const captureScript = join(process.cwd(), "scripts", "capture-vs-env.cmd");
  if (!existsSync(captureScript)) {
    return env;
  }

  const output = execFileSync(
    "cmd.exe",
    ["/d", "/c", captureScript],
    {
      encoding: "utf8",
      env
    }
  );

  const nextEnv = { ...env };
  for (const line of output.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index);
    const value = line.slice(index + 1);
    nextEnv[key] = value;
  }
  return nextEnv;
}

const child = spawn(tauriCmd, process.argv.slice(2), {
  stdio: "inherit",
  env: loadWindowsBuildEnv(baseEnv),
  shell: process.platform === "win32"
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
