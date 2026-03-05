const path = require("node:path");
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require("electron");
const { dm, serializeError } = require("./backend.cjs");
const { checkForUpdate } = require("./update-check.cjs");

const UPDATE_REPO_OWNER = "gJoonhyuk";
const UPDATE_REPO_NAME = "Liquibase-Data-Manager";

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return await fn(payload);
    } catch (error) {
      const serialized = serializeError(error);
      const wrapped = new Error(JSON.stringify(serialized));
      wrapped.name = "DmIpcError";
      throw wrapped;
    }
  });
}

async function notifyIfUpdateAvailable() {
  const currentVersion = app.getVersion();
  const result = await checkForUpdate({
    currentVersion,
    owner: UPDATE_REPO_OWNER,
    repo: UPDATE_REPO_NAME,
    timeoutMs: 5000
  });

  if (result.status !== "update-available") {
    if (result.status === "skip") {
      console.warn("[update-check]", result.reason || "Skipped");
    }
    return;
  }

  const latestVersion = String(result.latestVersion || "").replace(/^[vV]/, "");
  const currentDisplay = String(currentVersion || "").replace(/^[vV]/, "");
  const releaseUrl = String(result.releaseUrl || "").trim();
  const response = await dialog.showMessageBox({
    type: "info",
    title: "새 버전이 있습니다",
    message: `현재 버전 ${currentDisplay}, 최신 버전 ${latestVersion}`,
    detail: "업데이트를 다운로드하려면 GitHub Releases 페이지를 여세요.",
    buttons: ["나중에", "릴리즈 페이지 열기"],
    defaultId: 1,
    cancelId: 0,
    noLink: true
  });

  if (response.response === 1 && releaseUrl) {
    await shell.openExternal(releaseUrl);
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  handle("dm:workspace:open", (p) => dm.openWorkspace(p || {}));
  handle("dm:workspace:openStatus", () => dm.getOpenWorkspaceStatus());
  handle("dm:workspace:cancelOpen", () => dm.cancelOpenWorkspace());
  handle("dm:tables:list", () => dm.listTables());
  handle("dm:tables:getRows", (p) => dm.getRows(p?.table, p?.page ?? 0, p?.size ?? 200));
  handle("dm:tables:commit", (p) => dm.commitTable(p?.table, p?.rows || [], p?.options || {}));
  handle("dm:tables:createRow", (p) => dm.createRow(p?.table, p?.values || {}));
  handle("dm:tables:updateRow", (p) => dm.updateRow(p?.table, p?.rowId, p?.values || {}));
  handle("dm:tables:deleteRow", (p) => dm.deleteRow(p?.table, p?.rowId));
  handle("dm:validate", () => dm.validate());
  handle("dm:changes:previewKeyUpdate", (p) => dm.previewKeyUpdate(p || {}));
  handle("dm:changes:previewDeleteRows", (p) => dm.previewDeleteRows(p || {}));
  handle("dm:changes:apply", (p) => dm.applyChange(p || {}));
  handle("dm:schema:get", () => dm.getSchema());
  handle("dm:workspace:objects", () => dm.getWorkspaceObjects());
  handle("dm:schema:formatStatus", () => dm.getChangelogFormatStatus());
  handle("dm:schema:update", (p) => dm.updateSchema(p?.tables || []));
  handle("dm:schema:saveAll", (p) => dm.saveAll(p || {}));
  handle("dm:schema:renameTable", (p) => dm.renameTable({ oldName: p?.oldName, newName: p?.newName }));
  handle("dm:schema:deleteTable", (p) => dm.deleteTable({ tableName: p?.tableName }));
  handle("dm:schema:changelog", () => dm.generateChangelog());
  handle("dm:query", (p) => dm.query(p?.sql || ""));
  handle("dm:pick:directory", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle("dm:pick:file", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"] });
    return result.canceled ? null : result.filePaths[0];
  });

  createWindow();
  notifyIfUpdateAvailable().catch((error) => {
    console.warn("[update-check]", error?.message || error);
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
