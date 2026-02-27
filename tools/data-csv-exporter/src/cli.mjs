#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import mysql from "mysql2/promise";
import oracledb from "oracledb";
import { stringify } from "csv-stringify/sync";

let oracleClientInitialized = false;

function ts() {
  return new Date().toISOString();
}

function logInfo(msg) {
  console.log(`[${ts()}] ${msg}`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      out[key] = "true";
      continue;
    }
    out[key] = value;
    i += 1;
  }
  return out;
}

function required(args, key) {
  const v = args[key];
  if (!v) throw new Error(`Missing required option: --${key}`);
  return v;
}

function splitCsv(v) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function qDouble(id) {
  return `"${String(id).replace(/"/g, "\"\"")}"`;
}

function qBacktick(id) {
  return `\`${String(id).replace(/`/g, "``")}\``;
}

function normalizeCell(v, nullToken) {
  if (v === null || v === undefined) return nullToken;
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return v.toString("hex");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeTableCsv(outDir, tableName, columns, rows, nullToken) {
  ensureDir(outDir);
  const filePath = path.join(outDir, `${tableName}.csv`);
  const records = rows.map((row) => columns.map((c) => normalizeCell(row[c], nullToken)));
  const csv = stringify(records, {
    header: true,
    columns,
    quoted: true
  });
  fs.writeFileSync(filePath, csv, "utf8");
  return filePath;
}

async function exportPostgres(args) {
  const client = new pg.Client({
    host: required(args, "host"),
    port: Number(args.port || 5432),
    user: required(args, "user"),
    password: args.password || "",
    database: required(args, "database")
  });
  logInfo("PostgreSQL: connecting...");
  await client.connect();
  logInfo("PostgreSQL: connected");
  try {
    const schema = args.schema || "public";
    const selected = new Set(splitCsv(args.tables));
    const tRes = await client.query(
      `
      select table_name
      from information_schema.tables
      where table_schema = $1 and table_type = 'BASE TABLE'
      order by table_name
      `,
      [schema]
    );
    const tables = tRes.rows.map((r) => r.table_name).filter((t) => !selected.size || selected.has(t));
    logInfo(`PostgreSQL: found ${tables.length} table(s)`);

    const out = [];
    for (let i = 0; i < tables.length; i += 1) {
      const table = tables[i];
      logInfo(`PostgreSQL: [${i + 1}/${tables.length}] exporting ${table}`);
      const cRes = await client.query(
        `
        select column_name
        from information_schema.columns
        where table_schema = $1 and table_name = $2
        order by ordinal_position
        `,
        [schema, table]
      );
      const columns = cRes.rows.map((r) => r.column_name);
      const sql = `select * from ${qDouble(schema)}.${qDouble(table)}`;
      const rRes = await client.query(sql);
      out.push({ tableName: table, columns, rows: rRes.rows });
      logInfo(`PostgreSQL: [${i + 1}/${tables.length}] done ${table} (${rRes.rows.length} rows)`);
    }
    return out;
  } finally {
    logInfo("PostgreSQL: disconnecting");
    await client.end();
  }
}

async function exportMariaDb(args) {
  const conn = await mysql.createConnection({
    host: required(args, "host"),
    port: Number(args.port || 3306),
    user: required(args, "user"),
    password: args.password || "",
    database: required(args, "database")
  });
  logInfo("MariaDB: connected");
  try {
    const schema = required(args, "database");
    const selected = new Set(splitCsv(args.tables));
    const [tRows] = await conn.execute(
      `
      select table_name
      from information_schema.tables
      where table_schema = ? and table_type = 'BASE TABLE'
      order by table_name
      `,
      [schema]
    );
    const tables = tRows.map((r) => r.table_name).filter((t) => !selected.size || selected.has(t));
    logInfo(`MariaDB: found ${tables.length} table(s)`);

    const out = [];
    for (let i = 0; i < tables.length; i += 1) {
      const table = tables[i];
      logInfo(`MariaDB: [${i + 1}/${tables.length}] exporting ${table}`);
      const [cRows] = await conn.execute(
        `
        select column_name
        from information_schema.columns
        where table_schema = ? and table_name = ?
        order by ordinal_position
        `,
        [schema, table]
      );
      const columns = cRows.map((r) => r.column_name);
      const [rRows] = await conn.query(`select * from ${qBacktick(table)}`);
      out.push({ tableName: table, columns, rows: rRows });
      logInfo(`MariaDB: [${i + 1}/${tables.length}] done ${table} (${rRows.length} rows)`);
    }
    return out;
  } finally {
    logInfo("MariaDB: disconnecting");
    await conn.end();
  }
}

async function exportOracle(args) {
  const oracleClientPath = (args.oracleClientPath || "").trim();
  if (oracleClientPath) {
    if (!fs.existsSync(oracleClientPath)) {
      throw new Error(`Oracle client path does not exist: ${oracleClientPath}`);
    }
    if (!oracleClientInitialized) {
      oracledb.initOracleClient({ libDir: oracleClientPath });
      oracleClientInitialized = true;
      logInfo(`Oracle: Instant Client initialized (${oracleClientPath})`);
    }
  }

  const host = required(args, "host");
  const port = Number(args.port || 1521);
  const user = required(args, "user");
  const password = args.password || "";
  const serviceName = args.serviceName || "";
  const sid = args.sid || "";
  const connectString = serviceName ? `${host}:${port}/${serviceName}` : `${host}:${port}:${required({ sid }, "sid")}`;
  const owner = (args.schema || user).toUpperCase();

  logInfo("Oracle: connecting...");
  const conn = await oracledb.getConnection({ user, password, connectString });
  logInfo("Oracle: connected");
  try {
    const selected = new Set(splitCsv(args.tables).map((t) => t.toUpperCase()));
    const tRes = await conn.execute(
      `
      select table_name
      from all_tables
      where owner = :owner
      order by table_name
      `,
      { owner },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const tables = (tRes.rows || []).map((r) => r.TABLE_NAME).filter((t) => !selected.size || selected.has(t));
    logInfo(`Oracle: found ${tables.length} table(s)`);

    const out = [];
    for (let i = 0; i < tables.length; i += 1) {
      const table = tables[i];
      logInfo(`Oracle: [${i + 1}/${tables.length}] exporting ${table}`);
      const cRes = await conn.execute(
        `
        select column_name
        from all_tab_columns
        where owner = :owner and table_name = :tableName
        order by column_id
        `,
        { owner, tableName: table },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const columns = (cRes.rows || []).map((r) => r.COLUMN_NAME);
      const sql = `select * from ${qDouble(owner)}.${qDouble(table)}`;
      const rRes = await conn.execute(sql, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const rows = (rRes.rows || []).map((r) => {
        const obj = {};
        for (const c of columns) obj[c] = r[c];
        return obj;
      });
      out.push({ tableName: table, columns, rows });
      logInfo(`Oracle: [${i + 1}/${tables.length}] done ${table} (${rows.length} rows)`);
    }
    return out;
  } finally {
    logInfo("Oracle: disconnecting");
    await conn.close();
  }
}

function printUsage() {
  console.log(`
data-csv-exporter

Required:
  --dbms postgres|mariadb|oracle
  --user <user>
  --password <password>
  --out <output directory>

DB specific:
  postgres: --host <host> --database <db> [--schema public]
  mariadb : --host <host> --database <db>
  oracle  : --host <host> [--schema <owner>] (--serviceName <svc> | --sid <sid>) [--oracleClientPath <instant-client-dir>]

Optional:
  --port <port>
  --tables <comma-separated table names>
  --nullToken <text>   default: "" (empty string)

Examples:
  node src/cli.mjs --dbms postgres --host 127.0.0.1 --port 5432 --user app --password pw --database sample --schema public --out ../../sample-data
  node src/cli.mjs --dbms mariadb --host 127.0.0.1 --port 3306 --user app --password pw --database sample --out ../../sample-data
  node src/cli.mjs --dbms oracle --host 127.0.0.1 --port 1521 --user APP --password pw --schema APP --serviceName XEPDB1 --oracleClientPath "C:\\oracle\\instantclient_23_5" --out ../../sample-data
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (String(args.help || "").toLowerCase() === "true") {
    printUsage();
    return;
  }

  const dbms = String(required(args, "dbms")).toLowerCase();
  const outDir = path.resolve(required(args, "out"));
  const nullToken = args.nullToken == null ? "" : String(args.nullToken);
  logInfo(`Start export (dbms=${dbms}, out=${outDir}, nullToken="${nullToken}")`);

  let tablesData = [];
  if (dbms === "postgres") tablesData = await exportPostgres(args);
  else if (dbms === "mariadb") tablesData = await exportMariaDb(args);
  else if (dbms === "oracle") tablesData = await exportOracle(args);
  else throw new Error(`Unsupported dbms: ${dbms}`);

  logInfo(`Writing CSV files to: ${outDir}`);
  for (let i = 0; i < tablesData.length; i += 1) {
    const t = tablesData[i];
    const filePath = writeTableCsv(outDir, t.tableName, t.columns, t.rows, nullToken);
    logInfo(`Write [${i + 1}/${tablesData.length}] ${filePath}`);
  }
  logInfo(`Completed: ${tablesData.length} table(s) exported`);
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exit(1);
});
