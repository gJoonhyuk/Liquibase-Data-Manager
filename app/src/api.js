const API = "http://localhost:8080/api";
const bridge = globalThis?.window?.dmApi;

async function call(path, options = {}) {
  if (bridge) {
    throw new Error("HTTP mode is disabled in Electron context");
  }
  const response = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

export const api = {
  openWorkspace: (payload) => bridge ? bridge.openWorkspace(payload) : call("/workspaces/open", { method: "POST", body: JSON.stringify(payload) }),
  getOpenWorkspaceStatus: () => bridge ? bridge.getOpenWorkspaceStatus() : Promise.resolve({ running: false, current: 0, total: 0, step: "", message: "" }),
  cancelOpenWorkspace: () => bridge ? bridge.cancelOpenWorkspace() : Promise.resolve({ status: "unsupported" }),
  listTables: () => bridge ? bridge.listTables() : call("/tables"),
  getRows: (table, page = 0, size = 200) => bridge ? bridge.getRows(table, page, size) : call(`/tables/${table}/rows?page=${page}&size=${size}`),
  commitTable: (table, rows, options = {}) => bridge ? bridge.commitTable(table, rows, options) : call(`/tables/${table}/commit`, { method: "PUT", body: JSON.stringify({ rows, options }) }),
  createRow: (table, values) => bridge ? bridge.createRow(table, values) : call(`/tables/${table}/rows`, { method: "POST", body: JSON.stringify({ values }) }),
  updateRow: (table, rowId, values) => bridge ? bridge.updateRow(table, rowId, values) : call(`/tables/${table}/rows/${rowId}`, { method: "PUT", body: JSON.stringify({ values }) }),
  deleteRow: (table, rowId) => bridge ? bridge.deleteRow(table, rowId) : call(`/tables/${table}/rows/${rowId}`, { method: "DELETE" }),
  validate: () => bridge ? bridge.validate() : call("/validate", { method: "POST" }),
  previewKeyUpdate: (payload) => bridge ? bridge.previewKeyUpdate(payload) : call("/changes/preview-key-update", { method: "POST", body: JSON.stringify(payload) }),
  previewDeleteRows: (payload) => bridge ? bridge.previewDeleteRows(payload) : call("/changes/preview-delete-rows", { method: "POST", body: JSON.stringify(payload) }),
  applyChange: (payload) => bridge ? bridge.applyChange(payload) : call("/changes/apply", { method: "POST", body: JSON.stringify(payload) }),
  getSchema: () => bridge ? bridge.getSchema() : call("/schema"),
  updateSchema: (tables) => bridge ? bridge.updateSchema(tables) : call("/schema", { method: "PUT", body: JSON.stringify({ tables }) }),
  renameTable: (oldName, newName) => bridge ? bridge.renameTable(oldName, newName) : call("/schema/rename-table", { method: "POST", body: JSON.stringify({ oldName, newName }) }),
  deleteTable: (tableName) => bridge ? bridge.deleteTable(tableName) : call("/schema/delete-table", { method: "POST", body: JSON.stringify({ tableName }) }),
  generateChangelog: () => bridge ? bridge.generateChangelog() : call("/schema/changelog", { method: "POST" }),
  query: (sql) => bridge ? bridge.query(sql) : call("/query", { method: "POST", body: JSON.stringify({ sql }) }),
  pickDirectory: () => bridge ? bridge.pickDirectory() : Promise.resolve(null),
  pickFile: () => bridge ? bridge.pickFile() : Promise.resolve(null)
};
