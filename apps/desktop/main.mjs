import { app, BrowserWindow, dialog } from "electron";
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import net from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isElectronBinary = /^electron(?:\.exe)?$/i.test(basename(process.execPath));
const isDev = Boolean(process.defaultApp) || (!app.isPackaged && isElectronBinary);
const repoRoot = resolve(__dirname, "../..");
const bundleRoot = isDev ? repoRoot : join(process.resourcesPath, "app-bundle");
const webEntry = join(bundleRoot, "apps", "web", "dist", "index.html");
const serverEntry = join(bundleRoot, "apps", "server", "dist", "index.js");
const bundledNodeEntry = join(bundleRoot, "runtime", "node", process.platform === "win32" ? "node.exe" : "node");
const seedDataRoot = join(bundleRoot, "data-seed");
const desktopDataRoot = join(app.getPath("userData"), "claudio-data");
const desktopLogPath = join(app.getPath("userData"), "logs", "desktop.log");
const managedChildren = [];

function hasFiles(pathValue) {
  return existsSync(pathValue) && readdirSync(pathValue).length > 0;
}

function logDesktop(message) {
  try {
    mkdirSync(dirname(desktopLogPath), { recursive: true });
    appendFileSync(desktopLogPath, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch {
    // Ignore logging failures to avoid blocking app startup.
  }
}

function ensureSeedData() {
  mkdirSync(desktopDataRoot, { recursive: true });

  if (!existsSync(seedDataRoot)) {
    return;
  }

  const shouldSeed =
    !hasFiles(join(desktopDataRoot, "imports")) &&
    !hasFiles(join(desktopDataRoot, "config")) &&
    !hasFiles(join(desktopDataRoot, "tts-voices"));

  if (shouldSeed) {
    cpSync(seedDataRoot, desktopDataRoot, {
      recursive: true,
      force: false
    });
    logDesktop(`Seeded desktop data into ${desktopDataRoot}`);
  }
}

function isPortOpen(port) {
  return new Promise((resolvePortCheck) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });

    socket.once("connect", () => {
      socket.end();
      resolvePortCheck(true);
    });

    socket.once("error", () => {
      resolvePortCheck(false);
    });
  });
}

function waitForPort(port, timeoutMs = 60000) {
  return new Promise((resolvePort, rejectPort) => {
    const deadline = Date.now() + timeoutMs;

    const probe = async () => {
      if (await isPortOpen(port)) {
        resolvePort(true);
        return;
      }

      if (Date.now() >= deadline) {
        rejectPort(new Error(`Port ${port} did not become ready in time.`));
        return;
      }

      setTimeout(() => {
        void probe();
      }, 500);
    };

    void probe();
  });
}

function resolveNodeExecutable() {
  const configuredPath = process.env.CLAUDIO_NODE_PATH?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  if (!isDev && existsSync(bundledNodeEntry)) {
    return bundledNodeEntry;
  }

  return process.platform === "win32" ? "node.exe" : "node";
}

function startManagedNodeScript(scriptPath, serviceName, extraEnv = {}) {
  const nodeExecutable = resolveNodeExecutable();
  logDesktop(`Starting ${serviceName}: ${nodeExecutable} ${scriptPath}`);

  const child = spawn(nodeExecutable, [scriptPath], {
    cwd: bundleRoot,
    env: {
      ...process.env,
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  child.stdout?.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      logDesktop(`[${serviceName}:stdout] ${text}`);
    }
  });

  child.stderr?.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      logDesktop(`[${serviceName}:stderr] ${text}`);
    }
  });

  child.on("error", (error) => {
    logDesktop(`${serviceName} failed to spawn: ${error.message}`);
  });

  child.on("exit", (code, signal) => {
    logDesktop(`${serviceName} exited with code=${code ?? "null"} signal=${signal ?? "null"}`);
  });

  managedChildren.push(child);
  return child;
}

async function startManagedServices() {
  logDesktop("Desktop app boot sequence started.");
  ensureSeedData();

  const serverOpen = await isPortOpen(8787);
  if (!serverOpen && existsSync(serverEntry)) {
    startManagedNodeScript(serverEntry, "server", {
      PORT: "8787",
      CORS_ORIGIN: "",
      CLAUDIO_DATA_DIR: desktopDataRoot,
      CLAUDIO_APP_SHELL: "desktop"
    });
  }

  await waitForPort(8787, 60000);
  logDesktop("Desktop server is ready on port 8787.");
}

function stopManagedServices() {
  for (const child of managedChildren.splice(0)) {
    try {
      child.kill();
    } catch {
      // Ignore shutdown errors during app exit.
    }
  }
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1520,
    height: 980,
    minWidth: 1220,
    minHeight: 780,
    backgroundColor: "#07111f",
    title: "Claudio",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    await window.loadURL("http://127.0.0.1:5173");
    return window;
  }

  await window.loadFile(webEntry);
  return window;
}

app.on("before-quit", () => {
  stopManagedServices();
});

app.whenReady()
  .then(async () => {
    if (!isDev) {
      await startManagedServices();
    }

    await createWindow();
    logDesktop("Desktop window created.");

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
      }
    });
  })
  .catch(async (error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    logDesktop(`Startup failed: ${message}`);
    await dialog.showErrorBox(
      "Claudio 启动失败",
      error instanceof Error ? `${error.message}\n\n日志：${desktopLogPath}` : `桌面应用初始化失败。\n\n日志：${desktopLogPath}`
    );
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
