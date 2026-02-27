const path = require("node:path");
const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const { dm, serializeError } = require("./backend.cjs");

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
  handle("dm:schema:update", (p) => dm.updateSchema(p?.tables || []));
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
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
