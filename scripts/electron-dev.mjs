// Desarrollo: usa el `next dev` que ya esté corriendo en :3000 o lo inicia, y abre Electron.
import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const URL = process.env.MAILING_DEV_URL || "http://localhost:3000";

const up = async () => {
  try {
    const r = await fetch(URL);
    return r.status < 500;
  } catch {
    return false;
  }
};

let next = null;
if (!(await up())) {
  console.log("Iniciando next dev…");
  const port = new globalThis.URL(URL).port || "3000";
  next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "-p", port], { cwd: root, stdio: "inherit" });
  const t0 = Date.now();
  while (!(await up())) {
    if (Date.now() - t0 > 60000) {
      console.error("next dev no respondió en 60 s");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
} else {
  console.log(`Usando el servidor existente en ${URL}`);
}

const electron = spawn(require("electron"), [root], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, MAILING_ELECTRON_DEV: "1", MAILING_DEV_URL: URL },
});
electron.on("exit", (code) => {
  next?.kill();
  process.exit(code ?? 0);
});
