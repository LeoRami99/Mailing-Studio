// Proceso principal de Electron para Misiva.
//
// - En desarrollo (MAILING_ELECTRON_DEV=1) carga el servidor de `next dev`.
// - En producción arranca el servidor autónomo de Next (.next/standalone/server.js)
//   en un proceso utilitario, en un puerto libre de 127.0.0.1, y lo expone bajo el
//   esquema fijo app://misiva. Así el origen no cambia entre ejecuciones y los
//   proyectos guardados en localStorage se conservan aunque cambie el puerto.

const { app, BrowserWindow, Menu, dialog, net, protocol, session, shell, utilityProcess } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const netNode = require("node:net");
const http = require("node:http");

const SCHEME = "app";
const HOST = "misiva";
const APP_ORIGIN = `${SCHEME}://${HOST}`;
const isDev = process.env.MAILING_ELECTRON_DEV === "1";
const DEV_URL = process.env.MAILING_DEV_URL || "http://localhost:3000";

app.setName("Misiva");

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
  },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/** @type {Electron.UtilityProcess | null} */
let server = null;
/** @type {BrowserWindow | null} */
let win = null;
let serverOrigin = "";

const logFile = () => path.join(app.getPath("userData"), "logs", "server.log");
const storageDir = () => path.join(app.getPath("userData"), "storage");

function log(line) {
  try {
    fs.mkdirSync(path.dirname(logFile()), { recursive: true });
    fs.appendFileSync(logFile(), `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* sin registro */
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = netNode.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function standaloneDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "server")
    : path.join(__dirname, "..", ".next", "standalone");
}

async function waitFor(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve((res.statusCode ?? 500) < 500);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(2000, () => req.destroy());
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`El servidor no respondió en ${timeoutMs / 1000} s (${url}).`);
}

async function startServer() {
  const dir = standaloneDir();
  const entry = path.join(dir, "server.js");
  if (!fs.existsSync(entry)) {
    throw new Error(`No se encontró ${entry}. Ejecute "npm run electron:build" antes de iniciar.`);
  }
  const port = await freePort();
  fs.mkdirSync(storageDir(), { recursive: true });

  server = utilityProcess.fork(entry, [], {
    cwd: dir,
    serviceName: "Misiva – servidor",
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NEXT_TELEMETRY_DISABLED: "1",
      MAILING_STORAGE_DIR: storageDir(),
    },
  });
  server.stdout?.on("data", (d) => log(String(d).trimEnd()));
  server.stderr?.on("data", (d) => log("ERR " + String(d).trimEnd()));
  server.on("exit", (code) => {
    log(`servidor terminado (código ${code})`);
    server = null;
    if (!app.isQuitting && win) {
      dialog.showErrorBox("Misiva", `El servidor interno se detuvo (código ${code}). Revise el registro en:\n${logFile()}`);
    }
  });

  serverOrigin = `http://127.0.0.1:${port}`;
  await waitFor(serverOrigin + "/");
  log(`servidor listo en ${serverOrigin}`);
}

/** app://misiva/<ruta> → http://127.0.0.1:<puerto>/<ruta> */
function registerProxy() {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    const target = serverOrigin + url.pathname + url.search;
    const hasBody = !["GET", "HEAD"].includes(request.method);
    return net.fetch(target, {
      method: request.method,
      headers: request.headers,
      body: hasBody ? request.body : undefined,
      duplex: hasBody ? "half" : undefined,
      bypassCustomProtocolHandlers: true,
    });
  });
}

function isInternal(url) {
  return url.startsWith(APP_ORIGIN) || (isDev && url.startsWith(DEV_URL));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    title: "Misiva",
    backgroundColor: "#f4f4f5",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  win.once("ready-to-show", () => win?.show());

  // Enlaces externos (documentación de plataformas, etc.) en el navegador del sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url) && !isInternal(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!isInternal(url)) {
      e.preventDefault();
      if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    }
  });

  win.loadURL(isDev ? DEV_URL : `${APP_ORIGIN}/`);
  win.on("closed", () => {
    win = null;
  });
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "Archivo",
      submenu: [
        {
          label: "Abrir carpeta de imágenes",
          click: () => {
            const dir = isDev ? path.join(__dirname, "..", "storage", "uploads") : path.join(storageDir(), "uploads");
            fs.mkdirSync(dir, { recursive: true });
            shell.openPath(dir);
          },
        },
        { label: "Abrir registro del servidor", enabled: !isDev, click: () => shell.openPath(logFile()) },
        { type: "separator" },
        isMac ? { role: "close", label: "Cerrar ventana" } : { role: "quit", label: "Salir" },
      ],
    },
    {
      // Sin deshacer/rehacer: los atajos Ctrl+Z / Ctrl+Shift+Z los maneja el editor.
      label: "Edición",
      submenu: [
        { role: "cut", label: "Cortar" },
        { role: "copy", label: "Copiar" },
        { role: "paste", label: "Pegar" },
        { role: "pasteAndMatchStyle", label: "Pegar sin formato" },
        { role: "selectAll", label: "Seleccionar todo" },
      ],
    },
    {
      label: "Ver",
      submenu: [
        { role: "reload", label: "Recargar" },
        ...(isDev || !app.isPackaged ? [{ role: "toggleDevTools", label: "Herramientas de desarrollo" }] : []),
        { type: "separator" },
        { role: "resetZoom", label: "Tamaño real" },
        { role: "zoomIn", label: "Acercar" },
        { role: "zoomOut", label: "Alejar" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Pantalla completa" },
      ],
    },
    {
      label: "Ayuda",
      submenu: [
        {
          label: "Acerca de Misiva",
          click: () =>
            dialog.showMessageBox({
              type: "info",
              title: "Misiva",
              message: `Misiva ${app.getVersion()}`,
              detail: `Editor visual de correos HTML de código abierto (licencia MIT).\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome}\n\nDatos: ${app.getPath("userData")}`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  buildMenu();

  // Las descargas (HTML, TXT, proyecto) preguntan dónde guardar.
  session.defaultSession.on("will-download", (_e, item) => {
    item.setSaveDialogOptions({
      title: "Guardar archivo",
      defaultPath: path.join(app.getPath("downloads"), item.getFilename()),
    });
  });

  try {
    if (!isDev) {
      await startServer();
      registerProxy();
    }
    createWindow();
  } catch (err) {
    log(String(err?.stack || err));
    dialog.showErrorBox("Misiva no pudo iniciar", String(err?.message || err));
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
  server?.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
