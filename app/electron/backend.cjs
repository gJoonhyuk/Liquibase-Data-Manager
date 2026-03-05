const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parse: parseCsv } = require("csv-parse/sync");
const { parse: parseCsvStream } = require("csv-parse");
const { stringify: stringifyCsv } = require("csv-stringify/sync");
const YAML = require("yaml");
const alasql = require("alasql");

class AppError extends Error {
  constructor(message, code = "APP_ERROR", details = null) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

const state = {
  workspacePath: null,
  changelogPath: null,
  schemas: new Map(),
  rowsByTable: new Map(),
  pendingChangeSets: new Map(),
  openWorkspaceJob: {
    running: false,
    canceled: false,
    step: "",
    current: 0,
    total: 0,
    message: ""
  }
};

function uid() {
  return crypto.randomUUID();
}

function nowTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function ensureOpen() {
  if (!state.workspacePath) throw new AppError("Workspace is not opened");
}

function startOpenJob(step, total = 0) {
  state.openWorkspaceJob = {
    running: true,
    canceled: false,
    step: step || "starting",
    current: 0,
    total: Number.isFinite(total) ? total : 0,
    message: ""
  };
}

function updateOpenJob(patch = {}) {
  state.openWorkspaceJob = {
    ...state.openWorkspaceJob,
    ...patch
  };
}

function ensureNotCanceled() {
  if (state.openWorkspaceJob.canceled) throw new AppError("Workspace open canceled by user", "CANCELED");
}

function finishOpenJob(ok = true, message = "") {
  state.openWorkspaceJob = {
    ...state.openWorkspaceJob,
    running: false,
    message: message || (ok ? "completed" : "failed")
  };
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function normalizeType(type) {
  return String(type || "").trim().toLowerCase();
}

function validateType(value, column) {
  if (value == null || String(value).trim() === "") return;
  const type = normalizeType(column.type);
  const v = String(value);
  const fail = () => {
    throw new AppError(`Invalid value for type ${column.type} in column ${column.name}: ${value}`);
  };

  try {
    if (type.startsWith("varchar") || type.startsWith("char") || type.startsWith("text")) return;
    if (type === "int" || type === "integer") {
      if (!Number.isInteger(Number(v))) fail();
      return;
    }
    if (type === "bigint") {
      BigInt(v);
      return;
    }
    if (type.startsWith("decimal") || type.startsWith("numeric") || type === "double" || type === "float" || type === "real") {
      if (Number.isNaN(Number(v))) fail();
      return;
    }
    if (type === "boolean" || type === "bool") {
      const ok = ["true", "false", "1", "0"].includes(v.toLowerCase());
      if (!ok) fail();
      return;
    }
    if (type === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) fail();
      return;
    }
    if (type === "datetime" || type === "timestamp") {
      if (Number.isNaN(Date.parse(v.replace(" ", "T")))) fail();
    }
  } catch {
    fail();
  }
}

function keyOf(values, cols) {
  return cols.map((c) => values?.[c] ?? "").join("|");
}

function readCsvTable(csvPath) {
  if (!fs.existsSync(csvPath)) return [];
  const content = fs.readFileSync(csvPath, "utf8");
  if (!content.trim()) return [];
  const records = parseCsv(content, { columns: true, skip_empty_lines: true });
  return records.map((r) => ({ id: uid(), values: { ...r } }));
}

async function readCsvTableWithProgress(csvPath, { onProgress, isCanceled } = {}) {
  if (!fs.existsSync(csvPath)) {
    if (onProgress) onProgress(1);
    return [];
  }

  const stat = fs.statSync(csvPath);
  if (!stat.size) {
    if (onProgress) onProgress(1);
    return [];
  }

  return new Promise((resolve, reject) => {
    const rows = [];
    const stream = fs.createReadStream(csvPath, { encoding: "utf8" });
    const parser = parseCsvStream({ columns: true, skip_empty_lines: true });
    let finished = false;
    let lastPercent = -1;

    const closeWithError = (err) => {
      if (finished) return;
      finished = true;
      try {
        stream.destroy();
      } catch {}
      try {
        parser.destroy();
      } catch {}
      reject(err);
    };

    const maybeCancel = () => {
      if (isCanceled && isCanceled()) {
        closeWithError(new AppError("Workspace open canceled by user", "CANCELED"));
        return true;
      }
      return false;
    };

    stream.on("data", () => {
      if (maybeCancel()) return;
      if (onProgress) {
        const ratio = Math.max(0, Math.min(1, stream.bytesRead / stat.size));
        const pct = Math.floor(ratio * 100);
        if (pct !== lastPercent) {
          lastPercent = pct;
          onProgress(ratio);
        }
      }
    });
    stream.on("error", closeWithError);
    parser.on("error", closeWithError);

    parser.on("readable", () => {
      if (maybeCancel()) return;
      let record;
      while ((record = parser.read()) !== null) {
        rows.push({ id: uid(), values: { ...record } });
      }
    });

    parser.on("end", () => {
      if (finished) return;
      if (maybeCancel()) return;
      finished = true;
      if (onProgress) onProgress(1);
      resolve(rows);
    });

    stream.pipe(parser);
  });
}

function writeCsvTable(csvPath, rows, headers) {
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  const records = rows.map((row) => {
    const rec = {};
    headers.forEach((h) => {
      rec[h] = row.values?.[h] ?? "";
    });
    return rec;
  });
  const csv = stringifyCsv(records, { header: true, columns: headers });
  writeTextFileIfChanged(csvPath, csv);
}

function normalizeEol(text, eol = "\n") {
  return String(text || "").replace(/\r?\n/g, eol);
}

function writeTextFileIfChanged(filePath, text) {
  const exists = fs.existsSync(filePath);
  const prev = exists ? fs.readFileSync(filePath, "utf8") : null;
  const eol = prev && prev.includes("\r\n") ? "\r\n" : "\n";
  const next = normalizeEol(String(text || ""), eol);
  if (prev != null && prev === next) return false;
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, next, "utf8");
  fs.renameSync(temp, filePath);
  return true;
}

function splitColumns(input) {
  return String(input || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function collectChangeEntries(changelogPath, visited = new Set(), stack = new Set()) {
  const resolved = path.resolve(changelogPath);
  if (!fs.existsSync(resolved)) return [];
  if (stack.has(resolved)) {
    throw new AppError(`Circular include detected in changelog: ${resolved}`);
  }
  if (visited.has(resolved)) return [];

  visited.add(resolved);
  stack.add(resolved);

  const raw = fs.readFileSync(resolved, "utf8");
  const root = YAML.parse(raw) || {};
  const dbChangeLog = Array.isArray(root.databaseChangeLog) ? root.databaseChangeLog : [];
  const out = [];

  for (const entry of dbChangeLog) {
    if (entry?.changeSet) out.push(entry);

    const includeFile = entry?.include?.file;
    if (includeFile) {
      const childPath = path.resolve(path.dirname(resolved), String(includeFile));
      out.push(...collectChangeEntries(childPath, visited, stack));
    }

    const includeDir = entry?.includeAll?.path;
    if (includeDir) {
      const dirPath = path.resolve(path.dirname(resolved), String(includeDir));
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        const files = fs
          .readdirSync(dirPath)
          .filter((f) => /\.ya?ml$/i.test(f))
          .sort((a, b) => a.localeCompare(b))
          .map((f) => path.join(dirPath, f));
        for (const file of files) out.push(...collectChangeEntries(file, visited, stack));
      }
    }
  }

  stack.delete(resolved);
  return out;
}

function readSchema(changelogPath) {
  const dbChangeLog = collectChangeEntries(changelogPath);
  const builders = new Map();
  const seenFkSignaturesByTable = new Map();

  const ensureBuilder = (tableName) => {
    if (!builders.has(tableName)) {
      builders.set(tableName, {
        tableName,
        columns: [],
        primaryKeyName: "",
        primaryKey: [],
        foreignKeys: [],
        indexes: []
      });
    }
    return builders.get(tableName);
  };

  const ensureSeenFkSet = (tableName) => {
    if (!seenFkSignaturesByTable.has(tableName)) seenFkSignaturesByTable.set(tableName, new Set());
    return seenFkSignaturesByTable.get(tableName);
  };

  for (const csEntry of dbChangeLog) {
    const changeSet = csEntry?.changeSet;
    const changes = Array.isArray(changeSet?.changes) ? changeSet.changes : [];
    for (const change of changes) {
      const type = Object.keys(change || {})[0];
      const detail = change?.[type] || {};

      if (type === "createTable") {
        const tableName = String(detail.tableName || "");
        const b = ensureBuilder(tableName);
        const cols = Array.isArray(detail.columns) ? detail.columns : [];
        for (const w of cols) {
          const c = w?.column || {};
          const constraints = c.constraints || {};
          const name = String(c.name || "");
          b.columns.push({
            name,
            type: String(c.type || ""),
            nullable: constraints.nullable !== false,
            defaultValue: String(c.defaultValue || "")
          });
          if (constraints.primaryKey === true) b.primaryKey.push(name);
          if (constraints.primaryKeyName) b.primaryKeyName = String(constraints.primaryKeyName);
        }
      }

      if (type === "addPrimaryKey") {
        const tableName = String(detail.tableName || "");
        const b = ensureBuilder(tableName);
        b.primaryKeyName = String(detail.constraintName || "");
        b.primaryKey = splitColumns(detail.columnNames);
      }

      if (type === "addForeignKeyConstraint") {
        const baseTable = String(detail.baseTableName || "");
        const b = ensureBuilder(baseTable);
        const fk = {
          name: String(detail.constraintName || ""),
          childTable: baseTable,
          childColumns: splitColumns(detail.baseColumnNames),
          parentTable: String(detail.referencedTableName || ""),
          parentColumns: splitColumns(detail.referencedColumnNames)
        };
        const signature = JSON.stringify([
          fk.name,
          fk.childTable,
          fk.parentTable,
          fk.childColumns,
          fk.parentColumns
        ]);
        const seen = ensureSeenFkSet(baseTable);
        if (seen.has(signature)) continue;
        seen.add(signature);
        b.foreignKeys.push(fk);
      }

      if (type === "createIndex") {
        const tableName = String(detail.tableName || "");
        const b = ensureBuilder(tableName);
        const cols = (Array.isArray(detail.columns) ? detail.columns : [])
          .map((w) => w?.column?.name)
          .filter(Boolean)
          .map(String);
        if (detail.indexName && cols.length) {
          b.indexes.push({
            name: String(detail.indexName),
            columns: cols,
            unique: detail.unique === true
          });
        }
      }
    }
  }

  const out = new Map();
  for (const [k, b] of builders.entries()) out.set(k, b);
  return out;
}

function readSchemaFromChangelogDir(changelogDir) {
  const merged = new Map();
  if (!fs.existsSync(changelogDir) || !fs.statSync(changelogDir).isDirectory()) return merged;

  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.ya?ml$/i.test(name)) files.push(p);
    }
  };
  walk(changelogDir);
  files.sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    try {
      const parsed = readSchema(file);
      for (const [tableName, schema] of parsed.entries()) {
        const prev = merged.get(tableName);
        if (!prev) {
          merged.set(tableName, schema);
          continue;
        }

        const next = clone(prev);
        if ((schema.columns || []).length) next.columns = schema.columns;
        if ((schema.primaryKey || []).length) next.primaryKey = schema.primaryKey;
        if (schema.primaryKeyName) next.primaryKeyName = schema.primaryKeyName;
        if ((schema.indexes || []).length) next.indexes = schema.indexes;
        for (const fk of schema.foreignKeys || []) {
          const signature = JSON.stringify([fk.name, fk.childTable, fk.parentTable, fk.childColumns || [], fk.parentColumns || []]);
          const exists = (next.foreignKeys || []).some(
            (x) => JSON.stringify([x.name, x.childTable, x.parentTable, x.childColumns || [], x.parentColumns || []]) === signature
          );
          if (!exists) next.foreignKeys = [...(next.foreignKeys || []), fk];
        }
        merged.set(tableName, next);
      }
    } catch {
      // ignore broken or unrelated changelog fragments during fallback scan
    }
  }
  return merged;
}

function resolveDefaultMasterChangelogPath(workspacePath) {
  const root = path.resolve(workspacePath);
  const candidates = [];
  const skipDirs = new Set([".git", "node_modules", "dist", "build", "out", ".next"]);

  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      const p = path.join(dir, name);
      if (entry.isDirectory()) {
        if (skipDirs.has(name)) continue;
        walk(p);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.ya?ml$/i.test(name)) continue;
      const lower = name.toLowerCase();
      if (!lower.includes("master")) continue;
      candidates.push(p);
    }
  };

  walk(root);
  if (!candidates.length) return null;

  const rank = (p) => {
    const n = path.basename(p).toLowerCase();
    if (n === "generated-master.yaml" || n === "generated-master.yml") return 0;
    if (n === "db.changelog-master.yaml" || n === "db.changelog-master.yml") return 1;
    if (n.includes("generated")) return 2;
    return 3;
  };

  candidates.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
  return candidates[0];
}

function writeGeneratedChangelog(masterChangelogPath, schemaMap) {
  const requestedPath = path.resolve(masterChangelogPath);
  const requestedDir = path.dirname(requestedPath);
  const requestedBase = path.basename(requestedPath).toLowerCase();
  const requestedDirBase = path.basename(requestedDir).toLowerCase();

  // If user selected a fragment file (for example: .../tables/FOO.yaml),
  // normalize output to its parent changelog dir and write master as generated-master.yaml.
  const looksLikeMaster = /master/.test(requestedBase);
  const baseDir =
    requestedDirBase === "tables" || requestedDirBase === "data" || requestedDirBase === "constraints" || requestedDirBase === "fks"
      ? path.dirname(requestedDir)
      : requestedDir;
  const masterPath = looksLikeMaster ? requestedPath : path.join(baseDir, "generated-master.yaml");
  const dir = path.dirname(masterPath);
  fs.mkdirSync(dir, { recursive: true });
  const tablesDir = path.join(dir, "tables");
  const dataDir = path.join(dir, "data");
  const constraintsDir = path.join(dir, "constraints");
  const fksDir = path.join(dir, "fks");
  fs.mkdirSync(tablesDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(constraintsDir, { recursive: true });
  fs.mkdirSync(fksDir, { recursive: true });

  for (const file of fs.readdirSync(dir)) {
    if (/^generated-\d{14}\.ya?ml$/i.test(file)) {
      fs.rmSync(path.join(dir, file), { force: true });
    }
  }

  const sortedTables = Array.from(schemaMap.values()).sort((a, b) =>
    String(a.tableName || "").localeCompare(String(b.tableName || ""))
  );

  for (const table of sortedTables) {
    const createChanges = [];
    createChanges.push({
      createTable: {
        tableName: table.tableName,
        columns: (table.columns || []).map((c) => ({
          column: {
            name: c.name,
            type: c.type,
            ...(c.defaultValue ? { defaultValue: c.defaultValue } : {}),
            constraints: { nullable: !!c.nullable }
          }
        }))
      }
    });

    const constraintsChanges = [];
    if ((table.primaryKey || []).length) {
      constraintsChanges.push({
        addPrimaryKey: {
          tableName: table.tableName,
          columnNames: table.primaryKey.join(","),
          ...(table.primaryKeyName ? { constraintName: table.primaryKeyName } : {})
        }
      });
    }
    for (const index of table.indexes || []) {
      constraintsChanges.push({
        createIndex: {
          tableName: table.tableName,
          indexName: index.name,
          ...(index.unique ? { unique: true } : {}),
          columns: (index.columns || []).map((c) => ({ column: { name: c } }))
        }
      });
    }

    const tableFile = path.join(tablesDir, `${table.tableName}.yaml`);
    const tableDoc = {
      databaseChangeLog: [
        {
          changeSet: {
            id: `generated-${table.tableName}-create-v1`,
            author: "data-manager",
            changes: createChanges
          }
        }
      ]
    };
    writeTextFileIfChanged(tableFile, `${YAML.stringify(tableDoc).trimEnd()}\n`);

    const dataFile = path.join(dataDir, `${table.tableName}.yaml`);
    const dataDoc = {
      databaseChangeLog: [
        {
          changeSet: {
            id: `generated-${table.tableName}-load-v1`,
            author: "data-manager",
            changes: [
              {
                loadData: {
                  tableName: table.tableName,
                  file: `../../../../${table.tableName}.csv`,
                  relativeToChangelogFile: true,
                  encoding: "UTF-8"
                }
              }
            ]
          }
        }
      ]
    };
    writeTextFileIfChanged(dataFile, `${YAML.stringify(dataDoc).trimEnd()}\n`);

    const constraintsFile = path.join(constraintsDir, `${table.tableName}.yaml`);
    if (constraintsChanges.length) {
      const constraintsDoc = {
        databaseChangeLog: [
          {
            changeSet: {
              id: `generated-${table.tableName}-constraints-v1`,
              author: "data-manager",
              changes: constraintsChanges
            }
          }
        ]
      };
      writeTextFileIfChanged(constraintsFile, `${YAML.stringify(constraintsDoc).trimEnd()}\n`);
    } else if (fs.existsSync(constraintsFile)) {
      fs.rmSync(constraintsFile, { force: true });
    }

    const fkChanges = [];
    for (const fk of table.foreignKeys || []) {
      fkChanges.push({
        addForeignKeyConstraint: {
          constraintName: fk.name,
          baseTableName: fk.childTable,
          baseColumnNames: (fk.childColumns || []).join(","),
          referencedTableName: fk.parentTable,
          referencedColumnNames: (fk.parentColumns || []).join(",")
        }
      });
    }
    const fkFile = path.join(fksDir, `${table.tableName}.yaml`);
    if (fkChanges.length) {
      const fkDoc = {
        databaseChangeLog: [
          {
            changeSet: {
              id: `generated-${table.tableName}-fk-v1`,
              author: "data-manager",
              changes: fkChanges
            }
          }
        ]
      };
      writeTextFileIfChanged(fkFile, `${YAML.stringify(fkDoc).trimEnd()}\n`);
    } else if (fs.existsSync(fkFile)) {
      fs.rmSync(fkFile, { force: true });
    }
  }

  // Keep only currently managed table changelog files.
  const expectedTableFiles = new Set(sortedTables.map((t) => `${t.tableName}.yaml`));
  for (const file of fs.readdirSync(tablesDir)) {
    if (!/\.ya?ml$/i.test(file)) continue;
    if (!expectedTableFiles.has(file)) fs.rmSync(path.join(tablesDir, file), { force: true });
  }

  const expectedDataFiles = new Set(sortedTables.map((t) => `${t.tableName}.yaml`));
  for (const file of fs.readdirSync(dataDir)) {
    if (!/\.ya?ml$/i.test(file)) continue;
    if (!expectedDataFiles.has(file)) fs.rmSync(path.join(dataDir, file), { force: true });
  }

  const expectedConstraintFiles = new Set(
    sortedTables
      .filter((t) => (t.primaryKey || []).length || (t.indexes || []).length)
      .map((t) => `${t.tableName}.yaml`)
  );
  for (const file of fs.readdirSync(constraintsDir)) {
    if (!/\.ya?ml$/i.test(file)) continue;
    if (!expectedConstraintFiles.has(file)) fs.rmSync(path.join(constraintsDir, file), { force: true });
  }

  const expectedFkFiles = new Set(
    sortedTables
      .filter((t) => (t.foreignKeys || []).length > 0)
      .map((t) => `${t.tableName}.yaml`)
  );
  for (const file of fs.readdirSync(fksDir)) {
    if (!/\.ya?ml$/i.test(file)) continue;
    if (!expectedFkFiles.has(file)) fs.rmSync(path.join(fksDir, file), { force: true });
  }

  const masterDoc = {
    databaseChangeLog: sortedTables.flatMap((t) => {
      const includes = [
        {
          include: {
            file: `tables/${t.tableName}.yaml`,
            relativeToChangelogFile: true
          }
        },
        {
          include: {
            file: `data/${t.tableName}.yaml`,
            relativeToChangelogFile: true
          }
        }
      ];
      if ((t.primaryKey || []).length || (t.indexes || []).length) {
        includes.push({
          include: {
            file: `constraints/${t.tableName}.yaml`,
            relativeToChangelogFile: true
          }
        });
      }
      if ((t.foreignKeys || []).length) {
        includes.push({
          include: {
            file: `fks/${t.tableName}.yaml`,
            relativeToChangelogFile: true
          }
        });
      }
      return includes;
    })
  };
  writeTextFileIfChanged(masterPath, `${YAML.stringify(masterDoc).trimEnd()}\n`);
  return masterPath;
}

function sanitizeRow(schema, values = {}) {
  const out = {};
  for (const col of schema.columns || []) {
    const v = values[col.name];
    if (v == null) {
      if (col.defaultValue) out[col.name] = col.defaultValue;
      else if (col.nullable === false) throw new AppError(`Column is required: ${col.name}`);
      else out[col.name] = "";
    } else {
      validateType(String(v), col);
      out[col.name] = String(v);
    }
  }
  return out;
}

function saveAllToCsv() {
  ensureOpen();
  for (const [tableName, schema] of state.schemas.entries()) {
    const headers = (schema.columns || []).map((c) => c.name);
    const rows = state.rowsByTable.get(tableName) || [];
    writeCsvTable(path.join(state.workspacePath, `${tableName}.csv`), rows, headers);
  }
}

function validateAll() {
  const errors = [];
  const warnings = [];
  const isBlank = (v) => v == null || String(v).trim() === "";
  const prettyPairs = (cols, rowValues = {}) =>
    (cols || [])
      .map((c) => `${c}='${(rowValues?.[c] ?? "").toString()}'`)
      .join(", ");

  for (const table of state.schemas.values()) {
    if ((table.primaryKey || []).length) {
      const seen = new Set();
      const rows = state.rowsByTable.get(table.tableName) || [];
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const key = keyOf(row.values, table.primaryKey);
        if (seen.has(key)) {
          errors.push(`PK 중복: table=${table.tableName}, row=${i + 1}, key=[${prettyPairs(table.primaryKey, row.values)}]`);
        }
        seen.add(key);
      }
    }
  }

  for (const child of state.schemas.values()) {
    for (const fk of child.foreignKeys || []) {
      const parent = state.schemas.get(fk.parentTable);
      if (!parent) {
        warnings.push(`FK 경고: 부모 테이블이 없습니다. fk=${fk.name}, childTable=${child.tableName}, parentTable=${fk.parentTable}`);
        continue;
      }
      const parentKeys = new Set((state.rowsByTable.get(fk.parentTable) || []).map((r) => keyOf(r.values, fk.parentColumns)));
      const childRows = state.rowsByTable.get(child.tableName) || [];
      for (let i = 0; i < childRows.length; i += 1) {
        const row = childRows[i];
        // SQL FK semantics: for composite FK, if any child FK column is NULL/blank, skip validation.
        const hasAnyBlankChildFk = (fk.childColumns || []).some((c) => isBlank(row.values?.[c]));
        if (hasAnyBlankChildFk) continue;
        const childKey = keyOf(row.values, fk.childColumns);
        if (childKey.replace(/\|/g, "").trim() && !parentKeys.has(childKey)) {
          errors.push(
            `FK 위반: fk=${fk.name}, childTable=${child.tableName}, row=${i + 1}, childKey=[${prettyPairs(
              fk.childColumns,
              row.values
            )}], parentTable=${fk.parentTable}, parentColumns=[${(fk.parentColumns || []).join(", ")}]`
          );
        }
      }
    }
  }
  return { errors, warnings };
}

function detectPkCollisionAfterUpdate(table, rowId, newKey) {
  const schema = state.schemas.get(table);
  if (!schema || !(schema.primaryKey || []).length) return [];
  const candidate = keyOf(newKey, schema.primaryKey);
  const conflicts = [];
  for (const row of state.rowsByTable.get(table) || []) {
    if (row.id === rowId) continue;
    if (keyOf(row.values, schema.primaryKey) === candidate) {
      conflicts.push(`PK collision in ${table} key=${candidate}`);
    }
  }
  return conflicts;
}

function matchFk(childValues, childCols, parentKey, parentCols) {
  for (let i = 0; i < childCols.length; i += 1) {
    if ((childValues?.[childCols[i]] ?? "") !== (parentKey?.[parentCols[i]] ?? "")) return false;
  }
  return true;
}

function collectCascadeDeletePlan({ table, rowIds }) {
  const sourceSchema = state.schemas.get(table);
  if (!sourceSchema) throw new AppError(`Unknown table: ${table}`);
  const sourceRows = state.rowsByTable.get(table) || [];
  const targetIds = new Set((rowIds || []).filter(Boolean));
  if (!targetIds.size) throw new AppError("No rows selected for delete");

  const findRow = (t, id) => (state.rowsByTable.get(t) || []).find((r) => r.id === id);
  const queue = [];
  const visited = new Set();
  const deleteMap = new Map(); // table -> Set<rowId>

  const mark = (t, id) => {
    const key = `${t}\u0001${id}`;
    if (visited.has(key)) return;
    visited.add(key);
    if (!deleteMap.has(t)) deleteMap.set(t, new Set());
    deleteMap.get(t).add(id);
    queue.push({ tableName: t, rowId: id });
  };

  for (const rowId of targetIds) {
    const row = findRow(table, rowId);
    if (!row) throw new AppError(`Row not found: ${rowId}`);
    mark(table, rowId);
  }

  while (queue.length) {
    const { tableName, rowId } = queue.shift();
    const parentRow = findRow(tableName, rowId);
    if (!parentRow) continue;

    for (const childSchema of state.schemas.values()) {
      for (const fk of childSchema.foreignKeys || []) {
        if (fk.parentTable !== tableName) continue;
        const childRows = state.rowsByTable.get(childSchema.tableName) || [];
        for (const childRow of childRows) {
          if (!matchFk(childRow.values, fk.childColumns, parentRow.values, fk.parentColumns)) continue;
          mark(childSchema.tableName, childRow.id);
        }
      }
    }
  }

  const impacts = Array.from(deleteMap.entries())
    .map(([tableName, ids]) => ({ table: tableName, affectedRows: ids.size, rowIds: Array.from(ids) }))
    .sort((a, b) => a.table.localeCompare(b.table));

  return {
    sourceTable: table,
    sourceRowIds: Array.from(targetIds),
    impacts,
    totalDeletedRows: impacts.reduce((acc, i) => acc + i.affectedRows, 0)
  };
}

function previewKeyUpdate({ table, rowId, newKey }) {
  const sourceSchema = state.schemas.get(table);
  if (!sourceSchema) throw new AppError(`Unknown table: ${table}`);
  if (!(sourceSchema.primaryKey || []).length) throw new AppError(`Table has no PK: ${table}`);
  const sourceRows = state.rowsByTable.get(table) || [];
  const sourceRow = sourceRows.find((r) => r.id === rowId);
  if (!sourceRow) throw new AppError(`Row not found: ${rowId}`);

  const oldKey = {};
  for (const pk of sourceSchema.primaryKey) oldKey[pk] = sourceRow.values?.[pk] ?? "";
  const conflicts = [...detectPkCollisionAfterUpdate(table, rowId, newKey)];
  const impacts = [];

  for (const tableSchema of state.schemas.values()) {
    for (const fk of tableSchema.foreignKeys || []) {
      if (fk.parentTable !== table) continue;
      const impactedIds = (state.rowsByTable.get(tableSchema.tableName) || [])
        .filter((r) => matchFk(r.values, fk.childColumns, oldKey, fk.parentColumns))
        .map((r) => r.id);
      if (impactedIds.length) impacts.push({ table: tableSchema.tableName, affectedRows: impactedIds.length, rowIds: impactedIds });
    }
  }
  if (!impacts.length) impacts.push({ table, affectedRows: 1, rowIds: [] });

  const changeSetId = uid();
  const preview = { changeSetId, sourceTable: table, rowId, oldKey, newKey, impacts, conflicts };
  state.pendingChangeSets.set(changeSetId, preview);
  return preview;
}

function previewDeleteRows({ table, rowIds }) {
  const plan = collectCascadeDeletePlan({ table, rowIds });
  const changeSetId = uid();
  const preview = {
    kind: "cascade-delete",
    changeSetId,
    sourceTable: plan.sourceTable,
    sourceRowIds: plan.sourceRowIds,
    impacts: plan.impacts,
    totalDeletedRows: plan.totalDeletedRows,
    conflicts: []
  };
  state.pendingChangeSets.set(changeSetId, preview);
  return preview;
}

function applyChange({ changeSetId, userApproved }) {
  if (!userApproved) throw new AppError("User approval required");
  const preview = state.pendingChangeSets.get(changeSetId);
  if (!preview) throw new AppError(`Unknown change set: ${changeSetId}`);
  if ((preview.conflicts || []).length) throw new AppError("Conflicts detected. Apply is blocked");
  if (preview.kind === "cascade-delete") {
    const backup = clone(Object.fromEntries(state.rowsByTable.entries()));
    try {
      for (const impact of preview.impacts || []) {
        const idSet = new Set(impact.rowIds || []);
        const rows = state.rowsByTable.get(impact.table) || [];
        state.rowsByTable.set(
          impact.table,
          rows.filter((r) => !idSet.has(r.id))
        );
      }
      const report = validateAll();
      if (report.errors.length) throw new AppError("Validation failed after delete apply. Rolled back.");
      saveAllToCsv();
      state.pendingChangeSets.delete(changeSetId);
      return { status: "applied", kind: "cascade-delete", deletedRows: preview.totalDeletedRows || 0 };
    } catch (e) {
      state.rowsByTable.clear();
      for (const [k, rows] of Object.entries(backup)) state.rowsByTable.set(k, rows);
      throw e;
    }
  }
  const backup = clone(Object.fromEntries(state.rowsByTable.entries()));
  try {
    const sourceSchema = state.schemas.get(preview.sourceTable);
    const sourceRows = state.rowsByTable.get(preview.sourceTable) || [];
    const i = sourceRows.findIndex((r) => r.id === preview.rowId);
    if (i < 0) throw new AppError(`Source row not found: ${preview.rowId}`);
    const updatedSource = { ...sourceRows[i], values: { ...sourceRows[i].values } };
    for (const pk of sourceSchema.primaryKey || []) updatedSource.values[pk] = preview.newKey?.[pk] ?? "";
    sourceRows[i] = updatedSource;

    for (const tableSchema of state.schemas.values()) {
      for (const fk of tableSchema.foreignKeys || []) {
        if (fk.parentTable !== preview.sourceTable) continue;
        const rows = state.rowsByTable.get(tableSchema.tableName) || [];
        for (let r = 0; r < rows.length; r += 1) {
          if (!matchFk(rows[r].values, fk.childColumns, preview.oldKey, fk.parentColumns)) continue;
          const next = { ...rows[r], values: { ...rows[r].values } };
          for (let j = 0; j < fk.childColumns.length; j += 1) {
            next.values[fk.childColumns[j]] = preview.newKey?.[fk.parentColumns[j]] ?? "";
          }
          rows[r] = next;
        }
      }
    }

    const report = validateAll();
    if (report.errors.length) throw new AppError("Validation failed after apply. Rolled back.");
    saveAllToCsv();
    state.pendingChangeSets.delete(changeSetId);
    return { status: "applied" };
  } catch (e) {
    state.rowsByTable.clear();
    for (const [k, rows] of Object.entries(backup)) state.rowsByTable.set(k, rows);
    throw e;
  }
}

function quoteIdent(id) {
  return `[${String(id).replace(/]/g, "]]")}]`;
}

function defaultPkName(tableName) {
  return `PK_${String(tableName || "").trim()}`.toUpperCase();
}

function defaultFkName(tableName, order) {
  return `FK_${String(tableName || "").trim()}_${Number(order)}`.toUpperCase();
}

function refreshSqlRuntime() {
  alasql("DROP DATABASE IF EXISTS dmdb");
  alasql("CREATE DATABASE dmdb");
  alasql("USE dmdb");
  for (const schema of state.schemas.values()) {
    const colDefs = (schema.columns || []).map((c) => `${quoteIdent(c.name)} TEXT`);
    const pk = (schema.primaryKey || []).length ? `, PRIMARY KEY (${schema.primaryKey.map(quoteIdent).join(",")})` : "";
    alasql(`CREATE TABLE ${quoteIdent(schema.tableName)} (${colDefs.join(",")}${pk})`);
    const cols = (schema.columns || []).map((c) => c.name);
    if (!cols.length) continue;
    for (const row of state.rowsByTable.get(schema.tableName) || []) {
      alasql(
        `INSERT INTO ${quoteIdent(schema.tableName)} (${cols.map(quoteIdent).join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
        cols.map((c) => row.values?.[c] ?? "")
      );
    }
  }
}

const dm = {
  async openWorkspace({ path: workspacePath, changelogPath }) {
    startOpenJob("validating");
    try {
      const advanceFixedStep = (step, current, total, message = "") => {
        updateOpenJob({ step, current, total, message });
      };

      // 1) Validate workspace path
      advanceFixedStep("워크스페이스 경로 확인", 0, 1, "checking path");
      await yieldToEventLoop();
      if (!workspacePath || !fs.existsSync(workspacePath) || !fs.statSync(workspacePath).isDirectory()) {
        throw new AppError(`Workspace path does not exist: ${workspacePath}`);
      }
      advanceFixedStep("워크스페이스 경로 확인", 1, 1, "path ok");
      await yieldToEventLoop();
      ensureNotCanceled();

      // 2) Resolve changelog path
      advanceFixedStep("체인지로그 경로 결정", 0, 1, "resolving changelog");
      await yieldToEventLoop();
      const effectiveChangelog = (() => {
        if (changelogPath && String(changelogPath).trim()) {
          const input = String(changelogPath).trim();
          if (path.isAbsolute(input)) return path.resolve(input);
          return path.resolve(workspacePath, input);
        }
        const auto = resolveDefaultMasterChangelogPath(workspacePath);
        if (auto) return auto;
        throw new AppError("Changelog path is empty and no master YAML was found in workspace.");
      })();
      advanceFixedStep("체인지로그 경로 결정", 1, 1, path.relative(workspacePath, effectiveChangelog) || "resolved");
      await yieldToEventLoop();
      ensureNotCanceled();

      // 3) Load schema metadata
      advanceFixedStep("스키마 로딩", 0, 1, "parsing changelog");
      await yieldToEventLoop();
      let schemas = readSchema(effectiveChangelog);
      if (!schemas.size) {
        advanceFixedStep("스키마 로딩", 0, 1, "fallback scan changelog dir");
        await yieldToEventLoop();
        const changelogDir = path.dirname(effectiveChangelog);
        schemas = readSchemaFromChangelogDir(changelogDir);
      }
      advanceFixedStep("스키마 로딩", 1, 1, `tables=${schemas.size}`);
      await yieldToEventLoop();
      ensureNotCanceled();

      state.workspacePath = path.resolve(workspacePath);
      state.changelogPath = effectiveChangelog;
      state.schemas = new Map();
      state.rowsByTable = new Map();
      state.pendingChangeSets = new Map();

      if (!schemas.size) {
        const csvFiles = fs.readdirSync(state.workspacePath).filter((f) => f.endsWith(".csv"));
        const totalUnits = 3 + csvFiles.length * 100 + 1; // fixed steps + each file(0~100) + finalize
        updateOpenJob({ step: "CSV 전용 워크스페이스 로딩", current: 3, total: totalUnits, message: "loading csv files" });
        await yieldToEventLoop();
        for (let i = 0; i < csvFiles.length; i += 1) {
          const file = csvFiles[i];
          ensureNotCanceled();
          const tableName = file.replace(/\.csv$/i, "");
          const base = 3 + i * 100;
          const rows = await readCsvTableWithProgress(path.join(state.workspacePath, file), {
            isCanceled: () => state.openWorkspaceJob.canceled,
            onProgress: (ratio) => {
              updateOpenJob({
                step: "CSV 전용 워크스페이스 로딩",
                current: Math.max(base, Math.min(base + 100, base + Math.floor(ratio * 100))),
                total: totalUnits,
                message: `loading ${tableName}`
              });
            }
          });
          const first = rows[0]?.values || {};
          const columns = Object.keys(first).map((name) => ({ name, type: "varchar(255)", nullable: true, defaultValue: "" }));
          state.schemas.set(tableName, { tableName, columns, primaryKeyName: "", primaryKey: [], foreignKeys: [], indexes: [] });
          state.rowsByTable.set(tableName, rows);
          updateOpenJob({ current: base + 100, total: totalUnits, message: `loaded ${tableName}` });
          await yieldToEventLoop();
        }
        updateOpenJob({ step: "마무리", current: totalUnits, total: totalUnits, message: "finalizing" });
        await yieldToEventLoop();
        finishOpenJob(true, "completed");
        return { status: "ok" };
      }

      const totalUnits = 3 + schemas.size * 100 + 1; // fixed steps + each table(0~100) + finalize
      updateOpenJob({ step: "테이블 데이터 로딩", current: 3, total: totalUnits, message: `tables=${schemas.size}` });
      await yieldToEventLoop();
      let tableIdx = 0;
      for (const [tableName, schema] of schemas.entries()) {
        ensureNotCanceled();
        const base = 3 + tableIdx * 100;
        state.schemas.set(tableName, schema);
        const rows = await readCsvTableWithProgress(path.join(state.workspacePath, `${tableName}.csv`), {
          isCanceled: () => state.openWorkspaceJob.canceled,
          onProgress: (ratio) => {
            updateOpenJob({
              step: "테이블 데이터 로딩",
              current: Math.max(base, Math.min(base + 100, base + Math.floor(ratio * 100))),
              total: totalUnits,
              message: `loading ${tableName}`
            });
          }
        });
        state.rowsByTable.set(tableName, rows);
        updateOpenJob({ current: base + 100, total: totalUnits, message: `loaded ${tableName}` });
        tableIdx += 1;
        await yieldToEventLoop();
      }
      updateOpenJob({ step: "마무리", current: totalUnits, total: totalUnits, message: "finalizing" });
      await yieldToEventLoop();
      finishOpenJob(true, "completed");
      return { status: "ok" };
    } catch (e) {
      finishOpenJob(false, e?.code === "CANCELED" ? "canceled" : "failed");
      throw e;
    }
  },

  getOpenWorkspaceStatus() {
    return { ...state.openWorkspaceJob };
  },

  cancelOpenWorkspace() {
    if (!state.openWorkspaceJob.running) return { status: "idle" };
    state.openWorkspaceJob = {
      ...state.openWorkspaceJob,
      canceled: true,
      message: "cancel requested"
    };
    return { status: "cancel-requested" };
  },

  listTables() {
    ensureOpen();
    return Array.from(state.schemas.values()).map((s) => ({
      tableName: s.tableName,
      rowCount: (state.rowsByTable.get(s.tableName) || []).length,
      columnCount: (s.columns || []).length
    }));
  },

  getRows(table, page = 0, size = 200) {
    ensureOpen();
    const rows = state.rowsByTable.get(table);
    if (!rows) throw new AppError(`Unknown table: ${table}`);
    const from = Math.max(0, page * size);
    const to = Math.min(rows.length, from + size);
    return from >= rows.length ? [] : rows.slice(from, to);
  },

  commitTable(table, rows, options = {}) {
    ensureOpen();
    const schema = state.schemas.get(table);
    if (!schema) throw new AppError(`Unknown table: ${table}`);
    const backup = clone(state.rowsByTable.get(table) || []);
    try {
      const sanitized = (rows || []).map((row) => ({
        id: row?.id || uid(),
        values: sanitizeRow(schema, row?.values || {})
      }));
      state.rowsByTable.set(table, sanitized);
      if (!options?.skipValidation) {
        const report = validateAll();
        if (report.errors.length) throw new AppError(`Validation failed: ${report.errors[0]}`);
      }
      saveAllToCsv();
      return { status: "saved" };
    } catch (e) {
      state.rowsByTable.set(table, backup);
      throw e;
    }
  },

  createRow(table, values) {
    ensureOpen();
    const schema = state.schemas.get(table);
    if (!schema) throw new AppError(`Unknown table: ${table}`);
    const row = { id: uid(), values: sanitizeRow(schema, values || {}) };
    const rows = state.rowsByTable.get(table) || [];
    rows.push(row);
    state.rowsByTable.set(table, rows);
    return row;
  },

  updateRow(table, rowId, values) {
    ensureOpen();
    const rows = state.rowsByTable.get(table) || [];
    const i = rows.findIndex((r) => r.id === rowId);
    if (i < 0) throw new AppError(`Row not found: ${rowId}`);
    const schema = state.schemas.get(table);
    rows[i] = { id: rowId, values: sanitizeRow(schema, values || {}) };
    return rows[i];
  },

  deleteRow(table, rowId) {
    ensureOpen();
    const rows = state.rowsByTable.get(table) || [];
    state.rowsByTable.set(table, rows.filter((r) => r.id !== rowId));
    return { status: "deleted" };
  },

  validate() {
    ensureOpen();
    return validateAll();
  },

  previewKeyUpdate(payload) {
    ensureOpen();
    return previewKeyUpdate(payload);
  },

  previewDeleteRows(payload) {
    ensureOpen();
    return previewDeleteRows(payload || {});
  },

  applyChange(payload) {
    ensureOpen();
    return applyChange(payload);
  },

  getSchema() {
    ensureOpen();
    return Object.fromEntries(Array.from(state.schemas.entries()));
  },

  updateSchema(tables) {
    ensureOpen();
    const next = new Map();
    for (const t of tables || []) {
      if (!t?.tableName) throw new AppError("Table name is required");
      if (next.has(t.tableName)) throw new AppError(`Duplicate table name: ${t.tableName}`);
      if (!Array.isArray(t.columns) || !t.columns.length) throw new AppError(`Table must have at least one column: ${t.tableName}`);
      next.set(t.tableName, t);
      if (!state.rowsByTable.has(t.tableName)) state.rowsByTable.set(t.tableName, []);
    }
    state.schemas = next;
    return { status: "updated" };
  },

  renameTable({ oldName, newName }) {
    ensureOpen();
    const from = String(oldName || "").trim();
    const to = String(newName || "").trim();
    if (!from || !to) throw new AppError("Both oldName and newName are required");
    if (from === to) return { status: "renamed", tableName: to };
    if (!state.schemas.has(from)) throw new AppError(`Unknown table: ${from}`);
    if (state.schemas.has(to)) throw new AppError(`Table already exists: ${to}`);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(to)) throw new AppError("Invalid table name format");

    const nextSchemas = new Map();
    for (const [tableName, schema] of state.schemas.entries()) {
      const nextKey = tableName === from ? to : tableName;
      const nextSchema = clone(schema);
      nextSchema.tableName = nextKey;
      nextSchema.foreignKeys = (nextSchema.foreignKeys || []).map((fk) => ({
        ...fk,
        childTable: fk.childTable === from ? to : fk.childTable,
        parentTable: fk.parentTable === from ? to : fk.parentTable
      })).map((fk) => {
        if (fk.childTable !== to) return fk;
        const fkName = String(fk.name || "");
        const legacyPrefix = `fk_${from}_`;
        const upperPrefix = `FK_${from}_`;
        const suffix = fkName.startsWith(legacyPrefix) ? fkName.slice(legacyPrefix.length) : fkName.startsWith(upperPrefix) ? fkName.slice(upperPrefix.length) : "";
        if (!/^\d+$/.test(suffix)) return fk;
        return { ...fk, name: defaultFkName(to, Number(suffix)) };
      });
      const pkName = String(nextSchema.primaryKeyName || "");
      const legacyDefault = `PK_${from}`;
      const upperDefault = defaultPkName(from);
      if (pkName === legacyDefault || pkName === upperDefault) nextSchema.primaryKeyName = defaultPkName(to);
      nextSchemas.set(nextKey, nextSchema);
    }
    state.schemas = nextSchemas;

    const nextRows = new Map();
    for (const [tableName, rows] of state.rowsByTable.entries()) {
      nextRows.set(tableName === from ? to : tableName, rows);
    }
    if (!nextRows.has(to)) nextRows.set(to, []);
    state.rowsByTable = nextRows;

    const oldCsv = path.join(state.workspacePath, `${from}.csv`);
    const newCsv = path.join(state.workspacePath, `${to}.csv`);
    if (fs.existsSync(oldCsv)) {
      if (fs.existsSync(newCsv)) throw new AppError(`Target CSV already exists: ${to}.csv`);
      fs.renameSync(oldCsv, newCsv);
    }

    return { status: "renamed", tableName: to };
  },

  deleteTable({ tableName }) {
    ensureOpen();
    const target = String(tableName || "").trim();
    if (!target) throw new AppError("tableName is required");
    if (!state.schemas.has(target)) throw new AppError(`Unknown table: ${target}`);

    const blockers = [];
    for (const [tName, schema] of state.schemas.entries()) {
      if (tName === target) continue;
      for (const fk of schema.foreignKeys || []) {
        if (fk.parentTable === target) {
          blockers.push(`${tName}.${fk.name || "(unnamed fk)"}`);
        }
      }
    }
    if (blockers.length) {
      throw new AppError(`테이블이 참조 중이라 삭제할 수 없습니다: ${blockers.join(", ")}`);
    }

    state.schemas.delete(target);
    state.rowsByTable.delete(target);
    state.pendingChangeSets.clear();

    const csvPath = path.join(state.workspacePath, `${target}.csv`);
    if (fs.existsSync(csvPath)) fs.rmSync(csvPath, { force: true });

    return { status: "deleted", tableName: target };
  },

  generateChangelog() {
    ensureOpen();
    const out = writeGeneratedChangelog(state.changelogPath, state.schemas);
    return { status: "generated", path: out };
  },

  query(sql) {
    ensureOpen();
    if (!String(sql || "").trim().toLowerCase().startsWith("select")) {
      throw new AppError("Only SELECT query is allowed");
    }
    refreshSqlRuntime();
    return alasql(sql);
  }
};

function serializeError(error) {
  if (error instanceof AppError) return { error: error.message, code: error.code, details: error.details };
  return { error: error?.message || "Unknown error", code: "UNEXPECTED_ERROR" };
}

module.exports = {
  dm,
  serializeError
};
