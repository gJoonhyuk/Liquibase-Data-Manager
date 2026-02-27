const { contextBridge, ipcRenderer } = require("electron");

function call(channel, payload) {
  return ipcRenderer.invoke(channel, payload).catch((e) => {
    let parsed = null;
    try {
      parsed = JSON.parse(String(e?.message || ""));
    } catch {
      parsed = null;
    }
    const msg = parsed?.error || e?.error || e?.message || "Unknown error";
    const err = new Error(msg);
    if (parsed?.code) err.code = parsed.code;
    if (parsed?.details) err.details = parsed.details;
    throw err;
  });
}

contextBridge.exposeInMainWorld("dmApi", {
  openWorkspace: (payload) => call("dm:workspace:open", payload),
  getOpenWorkspaceStatus: () => call("dm:workspace:openStatus"),
  cancelOpenWorkspace: () => call("dm:workspace:cancelOpen"),
  listTables: () => call("dm:tables:list"),
  getRows: (table, page = 0, size = 200) => call("dm:tables:getRows", { table, page, size }),
  commitTable: (table, rows, options = {}) => call("dm:tables:commit", { table, rows, options }),
  createRow: (table, values) => call("dm:tables:createRow", { table, values }),
  updateRow: (table, rowId, values) => call("dm:tables:updateRow", { table, rowId, values }),
  deleteRow: (table, rowId) => call("dm:tables:deleteRow", { table, rowId }),
  validate: () => call("dm:validate"),
  previewKeyUpdate: (payload) => call("dm:changes:previewKeyUpdate", payload),
  previewDeleteRows: (payload) => call("dm:changes:previewDeleteRows", payload),
  applyChange: (payload) => call("dm:changes:apply", payload),
  getSchema: () => call("dm:schema:get"),
  updateSchema: (tables) => call("dm:schema:update", { tables }),
  renameTable: (oldName, newName) => call("dm:schema:renameTable", { oldName, newName }),
  deleteTable: (tableName) => call("dm:schema:deleteTable", { tableName }),
  generateChangelog: () => call("dm:schema:changelog"),
  query: (sql) => call("dm:query", { sql }),
  pickDirectory: () => call("dm:pick:directory"),
  pickFile: () => call("dm:pick:file")
});
