const { app, BrowserWindow, Menu, ipcMain, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const { discover, probe } = require("./discovery");
const { PrintAgent } = require("./print-agent");

const HEALTH_EVERY_MS = 8000;
const RETRY_MS = 3000;

let win = null;
let current = null;
let searching = false;
let healthTimer = null;
let misses = 0;
let printAgent = null;

const configFile = () => path.join(app.getPath("userData"), "config.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2));
}

function status(text) {
  if (win && !win.isDestroyed()) win.webContents.send("hotel:status", text);
}

function showSplash() {
  current = null;
  return win.loadFile(path.join(__dirname, "connecting.html"));
}

async function connect() {
  if (searching) return;
  searching = true;
  stopHealth();
  stopPrintAgent();
  await showSplash();
  const cfg = loadConfig();
  try {
    for (let pass = 0; ; pass++) {
      // After one strict pass for the pinned server, accept any Hotel System server
      // (covers a reinstalled server whose id changed).
      const hit = await discover(pass === 0 ? cfg : { ...cfg, serverId: null }, status);
      if (hit) {
        const next = { ...cfg, serverUrl: hit.origin, serverId: hit.health.serverId, port: hit.health.port };
        saveConfig(next);
        current = hit.origin;
        status(`Connected: ${hit.health.name} (${hit.origin})`);
        await win.loadURL(hit.origin);
        startHealth();
        startPrintAgent();
        return;
      }
      status("Server not found. Check that the server PC is on and on the same network. Retrying…");
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  } finally {
    searching = false;
  }
}

function startHealth() {
  stopHealth();
  misses = 0;
  healthTimer = setInterval(async () => {
    if (!current || searching) return;
    const h = await probe(current, 3000);
    const cfg = loadConfig();
    if (h && (!cfg.serverId || cfg.serverId === h.serverId)) {
      misses = 0;
      return;
    }
    misses += 1;
    if (misses >= 2) void connect();
  }, HEALTH_EVERY_MS);
}

function stopHealth() {
  if (healthTimer) clearInterval(healthTimer);
  healthTimer = null;
}

function startPrintAgent() {
  if (!printAgent) {
    printAgent = new PrintAgent({
      getOrigin: () => current,
      loadConfig,
      saveConfig,
      userDataDir: app.getPath("userData"),
      onStatus: (text) => status(text),
    });
  }
  printAgent.start();
}

function stopPrintAgent() {
  if (printAgent) printAgent.stop();
}

async function forgetServer() {
  const { response } = await dialog.showMessageBox(win, {
    type: "question",
    buttons: ["Find a new server", "Cancel"],
    defaultId: 1,
    message: "Forget the saved server and search the network for a new one?",
  });
  if (response !== 0) return;
  saveConfig({});
  void connect();
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: "PixalBotics Restaurant",
      submenu: [
        { label: "Reload", accelerator: "F5", click: () => (current ? win.reload() : connect()) },
        { label: "Reconnect to server", click: () => connect() },
        { label: "Change server…", click: () => forgetServer() },
        { type: "separator" },
        { label: "Full screen", accelerator: "F11", click: () => win.setFullScreen(!win.isFullScreen()) },
        { label: "Developer tools", accelerator: "Ctrl+Shift+I", click: () => win.webContents.toggleDevTools() },
        { type: "separator" },
        { role: "quit", label: "Exit" },
      ],
    },
  ]);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    title: "PixalBotics Restaurant",
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    backgroundColor: "#101820",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(buildMenu());

  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || url.startsWith("file:")) return;
    void connect();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (current && url.startsWith(current)) return { action: "allow" };
    return { action: "deny" };
  });

  win.on("closed", () => {
    win = null;
    stopHealth();
    stopPrintAgent();
  });

  void connect();
}

ipcMain.on("hotel:reconnect", () => void connect());
ipcMain.handle("hotel:server-url", () => current);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(createWindow);
  app.on("window-all-closed", () => app.quit());
}
