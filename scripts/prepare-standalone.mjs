// Copia los recursos estáticos al servidor autónomo de Next para empaquetarlo en Electron.
// Uso: node scripts/prepare-standalone.mjs (después de `next build`).
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const standalone = path.join(root, ".next", "standalone");

if (!existsSync(path.join(standalone, "server.js"))) {
  console.error('No existe .next/standalone/server.js. Verifique output: "standalone" en next.config.ts y ejecute next build.');
  process.exit(1);
}

cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
if (existsSync(path.join(root, "public"))) cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });

// No empaquetar imágenes de desarrollo ni archivos que no hacen falta.
for (const p of ["storage", ".env", ".env.local", "electron", "dist-electron"]) {
  rmSync(path.join(standalone, p), { recursive: true, force: true });
}
console.log("Servidor autónomo listo en .next/standalone");
