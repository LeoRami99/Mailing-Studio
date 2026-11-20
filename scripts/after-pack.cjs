// electron-builder omite node_modules y carpetas ocultas (.next) en extraResources,
// así que el servidor autónomo de Next se copia aquí, después de empaquetar.
const { cpSync, existsSync, rmSync } = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const src = path.join(context.packager.projectDir, ".next", "standalone");
  if (!existsSync(path.join(src, "server.js"))) {
    throw new Error('Falta .next/standalone. Ejecute "npm run electron:build" antes de empaquetar.');
  }
  const resources =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  const dest = path.join(resources, "server");
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true, dereference: true });
  console.log(`  • servidor Next copiado a ${dest}`);
};
