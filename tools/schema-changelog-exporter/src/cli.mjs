#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import pg from "pg";
import mysql from "mysql2/promise";
import oracledb from "oracledb";
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
    const k = token.slice(2);
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) {
      out[k] = "true";
      continue;
    }
    out[k] = v;
    i += 1;
  }
  return out;
}

function required(args, key) {
  const v = args[key];
  if (!v) throw new Error(`Missing required option: --${key}`);
  return v;
}

function asBool(v) {
  return String(v || "").toLowerCase() === "true";
}

function splitCsv(v) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeYaml(filePath, obj) {
  fs.writeFileSync(filePath, `${YAML.stringify(obj).trimEnd()}\n`, "utf8");
}

function decodeSqlStringLiteral(v) {
  const s = String(v || "");
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

function stripOuterParens(v) {
  let s = String(v || "").trim();
  while (s.startsWith("(") && s.endsWith(")")) {
    let depth = 0;
    let balanced = true;
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i];
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (depth === 0 && i < s.length - 1) {
        balanced = false;
        break;
      }
      if (depth < 0) {
        balanced = false;
        break;
      }
    }
    if (!balanced || depth !== 0) break;
    s = s.slice(1, -1).trim();
  }
  return s;
}

function stripPostgresCast(v) {
  let s = String(v || "").trim();
  while (true) {
    const next = s.replace(/\s*::\s*[\w.\[\]"]+\s*$/u, "").trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

function toLiquibaseDefaultField(defaultValue) {
  const raw = String(defaultValue || "").trim();
  if (!raw) return {};

  const unwrapped = stripOuterParens(stripPostgresCast(raw));
  if (!unwrapped) return {};
  if (/^null$/i.test(unwrapped)) return {};
  if (/^'(?:[^']|'')*'$/u.test(unwrapped)) {
    return { defaultValue: decodeSqlStringLiteral(unwrapped) };
  }
  if (/^(true|false)$/i.test(unwrapped)) {
    return { defaultValueBoolean: /^true$/i.test(unwrapped) };
  }
  if (/^[+-]?\d+(?:\.\d+)?$/.test(unwrapped)) {
    return { defaultValueNumeric: Number(unwrapped) };
  }
  if (/[()]/.test(unwrapped) || /\b(current_|sysdate|systimestamp|now|nextval)\b/i.test(unwrapped)) {
    return { defaultValueComputed: unwrapped };
  }
  return { defaultValue: unwrapped };
}

function oracleTypeLiteral(c) {
  const t = String(c.data_type || "").toUpperCase();
  const precision = c.data_precision == null ? "" : String(c.data_precision);
  const scale = c.data_scale == null ? "" : String(c.data_scale);
  const charLen = c.char_col_decl_length == null ? "" : String(c.char_col_decl_length);

  if (["VARCHAR2", "NVARCHAR2", "CHAR", "NCHAR", "RAW"].includes(t)) {
    return charLen ? `${t}(${charLen})` : t;
  }
  if (t === "NUMBER") {
    if (precision && scale) return `${t}(${precision},${scale})`;
    if (precision) return `${t}(${precision})`;
    return t;
  }
  if (t === "FLOAT") return precision ? `${t}(${precision})` : t;
  return t;
}

async function exportPostgres(args) {
  logInfo("PostgreSQL: connecting...");
  const client = new pg.Client({
    host: required(args, "host"),
    port: Number(args.port || 5432),
    user: required(args, "user"),
    password: args.password || "",
    database: required(args, "database")
  });
  await client.connect();
  logInfo("PostgreSQL: connected");
  try {
    const schema = args.schema || "public";
    const selectedTables = new Set(splitCsv(args.tables));
    const tablesRes = await client.query(
      `
      select t.table_name
      from information_schema.tables t
      where t.table_schema = $1 and t.table_type = 'BASE TABLE'
      order by t.table_name
      `,
      [schema]
    );
    const tables = tablesRes.rows
      .map((r) => r.table_name)
      .filter((t) => !selectedTables.size || selectedTables.has(t));
    logInfo(`PostgreSQL: found ${tables.length} table(s) to export`);

    const tableSchemas = [];
    for (let ti = 0; ti < tables.length; ti += 1) {
      const tableName = tables[ti];
      logInfo(`PostgreSQL: [${ti + 1}/${tables.length}] reading ${tableName}`);
      const columnsRes = await client.query(
        `
        select
          a.attname as column_name,
          pg_catalog.format_type(a.atttypid, a.atttypmod) as type_literal,
          (not a.attnotnull) as is_nullable,
          pg_get_expr(ad.adbin, ad.adrelid) as default_value,
          a.attnum as ordinal_position
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
        where n.nspname = $1 and c.relname = $2 and a.attnum > 0 and not a.attisdropped
        order by a.attnum
        `,
        [schema, tableName]
      );
      const columns = columnsRes.rows.map((r) => ({
        name: r.column_name,
        type: String(r.type_literal || ""),
        nullable: !!r.is_nullable,
        defaultValue: r.default_value == null ? "" : String(r.default_value)
      }));

      const pkRes = await client.query(
        `
        select
          con.conname as constraint_name,
          att.attname as column_name,
          u.ord as position
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
        join pg_namespace n on n.oid = c.relnamespace
        join lateral unnest(con.conkey) with ordinality as u(attnum, ord) on true
        join pg_attribute att on att.attrelid = con.conrelid and att.attnum = u.attnum
        where con.contype = 'p' and n.nspname = $1 and c.relname = $2
        order by u.ord
        `,
        [schema, tableName]
      );
      const primaryKeyName = pkRes.rows[0]?.constraint_name || "";
      const primaryKey = pkRes.rows.map((r) => r.column_name);

      const fkRes = await client.query(
        `
        select
          con.conname as fk_name,
          c_child.relname as child_table,
          c_parent.relname as parent_table,
          att_child.attname as child_column,
          att_parent.attname as parent_column,
          src.ord as position
        from pg_constraint con
        join pg_class c_child on c_child.oid = con.conrelid
        join pg_namespace n_child on n_child.oid = c_child.relnamespace
        join pg_class c_parent on c_parent.oid = con.confrelid
        join lateral unnest(con.conkey) with ordinality as src(attnum, ord) on true
        join lateral unnest(con.confkey) with ordinality as dst(attnum, ord) on dst.ord = src.ord
        join pg_attribute att_child on att_child.attrelid = con.conrelid and att_child.attnum = src.attnum
        join pg_attribute att_parent on att_parent.attrelid = con.confrelid and att_parent.attnum = dst.attnum
        where con.contype = 'f' and n_child.nspname = $1 and c_child.relname = $2
        order by con.conname, src.ord
        `,
        [schema, tableName]
      );
      const fkMap = new Map();
      for (const r of fkRes.rows) {
        if (!fkMap.has(r.fk_name)) {
          fkMap.set(r.fk_name, {
            name: r.fk_name,
            childTable: r.child_table,
            parentTable: r.parent_table,
            childColumns: [],
            parentColumns: []
          });
        }
        const fk = fkMap.get(r.fk_name);
        fk.childColumns.push(r.child_column);
        fk.parentColumns.push(r.parent_column);
      }
      const foreignKeys = Array.from(fkMap.values()).sort((a, b) => a.name.localeCompare(b.name));

      const idxRes = await client.query(
        `
        select
          i.relname as index_name,
          ix.indisunique as is_unique,
          a.attname as column_name,
          s.ord as position
        from pg_index ix
        join pg_class t on t.oid = ix.indrelid
        join pg_namespace n on n.oid = t.relnamespace
        join pg_class i on i.oid = ix.indexrelid
        join lateral unnest(ix.indkey) with ordinality as s(attnum, ord) on true
        join pg_attribute a on a.attrelid = t.oid and a.attnum = s.attnum
        where n.nspname = $1 and t.relname = $2 and ix.indisprimary = false
        order by i.relname, s.ord
        `,
        [schema, tableName]
      );
      const idxMap = new Map();
      for (const r of idxRes.rows) {
        if (!idxMap.has(r.index_name)) {
          idxMap.set(r.index_name, { name: r.index_name, unique: !!r.is_unique, columns: [] });
        }
        idxMap.get(r.index_name).columns.push(r.column_name);
      }
      const indexes = Array.from(idxMap.values()).sort((a, b) => a.name.localeCompare(b.name));

      tableSchemas.push({
        tableName,
        columns,
        primaryKeyName,
        primaryKey,
        foreignKeys,
        indexes
      });
      logInfo(`PostgreSQL: [${ti + 1}/${tables.length}] done ${tableName} (cols=${columns.length}, pk=${primaryKey.length}, fk=${foreignKeys.length}, idx=${indexes.length})`);
    }
    return tableSchemas;
  } finally {
    logInfo("PostgreSQL: disconnecting");
    await client.end();
  }
}

async function exportMariaDb(args) {
  logInfo("MariaDB: connecting...");
  const conn = await mysql.createConnection({
    host: required(args, "host"),
    port: Number(args.port || 3306),
    user: required(args, "user"),
    password: args.password || "",
    database: required(args, "database")
  });
  try {
    logInfo("MariaDB: connected");
    const schema = required(args, "database");
    const selectedTables = new Set(splitCsv(args.tables));
    const [tablesRows] = await conn.execute(
      `
      select table_name
      from information_schema.tables
      where table_schema = ? and table_type = 'BASE TABLE'
      order by table_name
      `,
      [schema]
    );
    const tables = tablesRows.map((r) => r.table_name).filter((t) => !selectedTables.size || selectedTables.has(t));
    logInfo(`MariaDB: found ${tables.length} table(s) to export`);

    const tableSchemas = [];
    for (let ti = 0; ti < tables.length; ti += 1) {
      const tableName = tables[ti];
      logInfo(`MariaDB: [${ti + 1}/${tables.length}] reading ${tableName}`);
      const [columnsRows] = await conn.execute(
        `
        select
          column_name,
          column_type,
          is_nullable,
          column_default
        from information_schema.columns
        where table_schema = ? and table_name = ?
        order by ordinal_position
        `,
        [schema, tableName]
      );
      const columns = columnsRows.map((r) => ({
        name: r.column_name,
        type: String(r.column_type || ""),
        nullable: String(r.is_nullable).toUpperCase() === "YES",
        defaultValue: r.column_default == null ? "" : String(r.column_default)
      }));

      const [pkRows] = await conn.execute(
        `
        select
          tc.constraint_name,
          kcu.column_name,
          kcu.ordinal_position
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on kcu.constraint_schema = tc.constraint_schema
         and kcu.table_name = tc.table_name
         and kcu.constraint_name = tc.constraint_name
        where tc.constraint_schema = ?
          and tc.table_name = ?
          and tc.constraint_type = 'PRIMARY KEY'
        order by kcu.ordinal_position
        `,
        [schema, tableName]
      );
      const primaryKeyName = pkRows[0]?.constraint_name || "";
      const primaryKey = pkRows.map((r) => r.column_name);

      const [fkRows] = await conn.execute(
        `
        select
          rc.constraint_name as fk_name,
          kcu.table_name as child_table,
          kcu.referenced_table_name as parent_table,
          kcu.column_name as child_column,
          kcu.referenced_column_name as parent_column,
          kcu.position_in_unique_constraint as position_in_parent
        from information_schema.referential_constraints rc
        join information_schema.key_column_usage kcu
          on kcu.constraint_schema = rc.constraint_schema
         and kcu.constraint_name = rc.constraint_name
         and kcu.table_name = rc.table_name
        where rc.constraint_schema = ?
          and rc.table_name = ?
        order by rc.constraint_name, kcu.ordinal_position
        `,
        [schema, tableName]
      );
      const fkMap = new Map();
      for (const r of fkRows) {
        if (!fkMap.has(r.fk_name)) {
          fkMap.set(r.fk_name, {
            name: r.fk_name,
            childTable: r.child_table,
            parentTable: r.parent_table,
            childColumns: [],
            parentColumns: []
          });
        }
        const fk = fkMap.get(r.fk_name);
        fk.childColumns.push(r.child_column);
        fk.parentColumns.push(r.parent_column);
      }
      const foreignKeys = Array.from(fkMap.values()).sort((a, b) => a.name.localeCompare(b.name));

      const [idxRows] = await conn.execute(
        `
        select
          index_name,
          non_unique,
          column_name,
          seq_in_index
        from information_schema.statistics
        where table_schema = ?
          and table_name = ?
          and index_name <> 'PRIMARY'
        order by index_name, seq_in_index
        `,
        [schema, tableName]
      );
      const idxMap = new Map();
      for (const r of idxRows) {
        if (!idxMap.has(r.index_name)) {
          idxMap.set(r.index_name, { name: r.index_name, unique: Number(r.non_unique) === 0, columns: [] });
        }
        idxMap.get(r.index_name).columns.push(r.column_name);
      }
      const indexes = Array.from(idxMap.values()).sort((a, b) => a.name.localeCompare(b.name));

      tableSchemas.push({
        tableName,
        columns,
        primaryKeyName,
        primaryKey,
        foreignKeys,
        indexes
      });
      logInfo(`MariaDB: [${ti + 1}/${tables.length}] done ${tableName} (cols=${columns.length}, pk=${primaryKey.length}, fk=${foreignKeys.length}, idx=${indexes.length})`);
    }
    return tableSchemas;
  } finally {
    logInfo("MariaDB: disconnecting");
    await conn.end();
  }
}

async function exportOracle(args) {
  logInfo("Oracle: preparing client...");
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

  logInfo("Oracle: connecting...");
  const conn = await oracledb.getConnection({ user, password, connectString });
  try {
    logInfo("Oracle: connected");
    const owner = (args.schema || user).toUpperCase();
    const selectedTables = new Set(splitCsv(args.tables).map((t) => t.toUpperCase()));
    const tableRs = await conn.execute(
      `
      select table_name
      from all_tables
      where owner = :owner
      order by table_name
      `,
      { owner },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const tables = (tableRs.rows || [])
      .map((r) => r.TABLE_NAME)
      .filter((t) => !selectedTables.size || selectedTables.has(t));
    logInfo(`Oracle: found ${tables.length} table(s) to export`);

    const tableSchemas = [];
    for (let ti = 0; ti < tables.length; ti += 1) {
      const tableName = tables[ti];
      logInfo(`Oracle: [${ti + 1}/${tables.length}] reading ${tableName}`);
      const colRs = await conn.execute(
        `
        select
          column_name,
          data_type,
          data_precision,
          data_scale,
          char_col_decl_length,
          nullable,
          data_default
        from all_tab_columns
        where owner = :owner and table_name = :tableName
        order by column_id
        `,
        { owner, tableName },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const columns = (colRs.rows || []).map((r) => ({
        name: r.COLUMN_NAME,
        type: oracleTypeLiteral({
          data_type: r.DATA_TYPE,
          data_precision: r.DATA_PRECISION,
          data_scale: r.DATA_SCALE,
          char_col_decl_length: r.CHAR_COL_DECL_LENGTH
        }),
        nullable: String(r.NULLABLE || "").toUpperCase() === "Y",
        defaultValue: r.DATA_DEFAULT == null ? "" : String(r.DATA_DEFAULT).trim()
      }));

      const pkRs = await conn.execute(
        `
        select c.constraint_name, cc.column_name, cc.position
        from all_constraints c
        join all_cons_columns cc
          on cc.owner = c.owner
         and cc.constraint_name = c.constraint_name
         and cc.table_name = c.table_name
        where c.owner = :owner
          and c.table_name = :tableName
          and c.constraint_type = 'P'
        order by cc.position
        `,
        { owner, tableName },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const primaryKeyName = pkRs.rows?.[0]?.CONSTRAINT_NAME || "";
      const primaryKey = (pkRs.rows || []).map((r) => r.COLUMN_NAME);

      const fkRs = await conn.execute(
        `
        select
          c.constraint_name as fk_name,
          c.table_name as child_table,
          p.table_name as parent_table,
          cc.column_name as child_column,
          pcc.column_name as parent_column,
          cc.position as pos
        from all_constraints c
        join all_constraints p
          on p.owner = c.r_owner
         and p.constraint_name = c.r_constraint_name
        join all_cons_columns cc
          on cc.owner = c.owner
         and cc.constraint_name = c.constraint_name
         and cc.table_name = c.table_name
        join all_cons_columns pcc
          on pcc.owner = p.owner
         and pcc.constraint_name = p.constraint_name
         and pcc.table_name = p.table_name
         and pcc.position = cc.position
        where c.owner = :owner
          and c.table_name = :tableName
          and c.constraint_type = 'R'
        order by c.constraint_name, cc.position
        `,
        { owner, tableName },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const fkMap = new Map();
      for (const r of fkRs.rows || []) {
        if (!fkMap.has(r.FK_NAME)) {
          fkMap.set(r.FK_NAME, {
            name: r.FK_NAME,
            childTable: r.CHILD_TABLE,
            parentTable: r.PARENT_TABLE,
            childColumns: [],
            parentColumns: []
          });
        }
        const fk = fkMap.get(r.FK_NAME);
        fk.childColumns.push(r.CHILD_COLUMN);
        fk.parentColumns.push(r.PARENT_COLUMN);
      }
      const foreignKeys = Array.from(fkMap.values()).sort((a, b) => a.name.localeCompare(b.name));

      const idxRs = await conn.execute(
        `
        select
          i.index_name,
          i.uniqueness,
          ic.column_name,
          ic.column_position
        from all_indexes i
        join all_ind_columns ic
          on ic.index_owner = i.owner
         and ic.index_name = i.index_name
         and ic.table_owner = i.table_owner
         and ic.table_name = i.table_name
        where i.table_owner = :owner
          and i.table_name = :tableName
          and i.generated = 'N'
          and not exists (
            select 1
            from all_constraints c
            where c.owner = i.owner
              and c.index_name = i.index_name
              and c.constraint_type = 'P'
          )
        order by i.index_name, ic.column_position
        `,
        { owner, tableName },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const idxMap = new Map();
      for (const r of idxRs.rows || []) {
        if (!idxMap.has(r.INDEX_NAME)) {
          idxMap.set(r.INDEX_NAME, { name: r.INDEX_NAME, unique: String(r.UNIQUENESS) === "UNIQUE", columns: [] });
        }
        idxMap.get(r.INDEX_NAME).columns.push(r.COLUMN_NAME);
      }
      const indexes = Array.from(idxMap.values()).sort((a, b) => a.name.localeCompare(b.name));

      tableSchemas.push({
        tableName,
        columns,
        primaryKeyName,
        primaryKey,
        foreignKeys,
        indexes
      });
      logInfo(`Oracle: [${ti + 1}/${tables.length}] done ${tableName} (cols=${columns.length}, pk=${primaryKey.length}, fk=${foreignKeys.length}, idx=${indexes.length})`);
    }
    return tableSchemas;
  } finally {
    logInfo("Oracle: disconnecting");
    await conn.close();
  }
}

function tableToYaml(table, author) {
  const changes = [];
  changes.push({
    createTable: {
      tableName: table.tableName,
      columns: (table.columns || []).map((c) => ({
        column: {
          name: c.name,
          type: c.type,
          ...toLiquibaseDefaultField(c.defaultValue),
          constraints: { nullable: !!c.nullable }
        }
      }))
    }
  });

  if ((table.primaryKey || []).length) {
    changes.push({
      addPrimaryKey: {
        tableName: table.tableName,
        columnNames: table.primaryKey.join(","),
        ...(table.primaryKeyName ? { constraintName: table.primaryKeyName } : {})
      }
    });
  }

  for (const idx of table.indexes || []) {
    changes.push({
      createIndex: {
        tableName: table.tableName,
        indexName: idx.name,
        ...(idx.unique ? { unique: true } : {}),
        columns: (idx.columns || []).map((name) => ({ column: { name } }))
      }
    });
  }

  return {
    databaseChangeLog: [
      {
        changeSet: {
          id: `generated-${table.tableName}-create-v1`,
          author,
          changes
        }
      }
    ]
  };
}

function dataToYaml(table, author) {
  return {
    databaseChangeLog: [
      {
        changeSet: {
          id: `generated-${table.tableName}-load-v1`,
          author,
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
}

function constraintsToYaml(table, author) {
  const changes = [];
  if ((table.primaryKey || []).length) {
    changes.push({
      addPrimaryKey: {
        tableName: table.tableName,
        columnNames: table.primaryKey.join(","),
        ...(table.primaryKeyName ? { constraintName: table.primaryKeyName } : {})
      }
    });
  }
  for (const idx of table.indexes || []) {
    changes.push({
      createIndex: {
        tableName: table.tableName,
        indexName: idx.name,
        ...(idx.unique ? { unique: true } : {}),
        columns: (idx.columns || []).map((name) => ({ column: { name } }))
      }
    });
  }
  if (!changes.length) return null;
  return {
    databaseChangeLog: [
      {
        changeSet: {
          id: `generated-${table.tableName}-constraints-v1`,
          author,
          changes
        }
      }
    ]
  };
}

function fkToYaml(table, author) {
  const changes = (table.foreignKeys || []).map((fk) => ({
    addForeignKeyConstraint: {
      constraintName: fk.name,
      baseTableName: fk.childTable,
      baseColumnNames: (fk.childColumns || []).join(","),
      referencedTableName: fk.parentTable,
      referencedColumnNames: (fk.parentColumns || []).join(",")
    }
  }));

  if (!changes.length) return null;
  return {
    databaseChangeLog: [
      {
        changeSet: {
          id: `generated-${table.tableName}-fk-v1`,
          author,
          changes
        }
      }
    ]
  };
}

function writeGeneratedLayout(baseOutDir, tables, author) {
  const outDir = path.resolve(baseOutDir);
  const tablesDir = path.join(outDir, "tables");
  const dataDir = path.join(outDir, "data");
  const constraintsDir = path.join(outDir, "constraints");
  const fksDir = path.join(outDir, "fks");
  ensureDir(tablesDir);
  ensureDir(dataDir);
  ensureDir(constraintsDir);
  ensureDir(fksDir);
  logInfo(`Writing changelog files to: ${outDir}`);

  const sorted = [...tables].sort((a, b) => String(a.tableName).localeCompare(String(b.tableName)));
  for (let i = 0; i < sorted.length; i += 1) {
    const table = sorted[i];
    const filePath = path.join(tablesDir, `${table.tableName}.yaml`);
    writeYaml(filePath, tableToYaml(table, author));
    logInfo(`Write table file [${i + 1}/${sorted.length}]: ${filePath}`);

    const dataPath = path.join(dataDir, `${table.tableName}.yaml`);
    writeYaml(dataPath, dataToYaml(table, author));
    logInfo(`Write data file  [${i + 1}/${sorted.length}]: ${dataPath}`);

    const constraintsPath = path.join(constraintsDir, `${table.tableName}.yaml`);
    const constraintsDoc = constraintsToYaml(table, author);
    if (constraintsDoc) {
      writeYaml(constraintsPath, constraintsDoc);
      logInfo(`Write cst file   [${i + 1}/${sorted.length}]: ${constraintsPath}`);
    } else if (fs.existsSync(constraintsPath)) {
      fs.rmSync(constraintsPath, { force: true });
    }

    const fkPath = path.join(fksDir, `${table.tableName}.yaml`);
    const fkDoc = fkToYaml(table, author);
    if (fkDoc) {
      writeYaml(fkPath, fkDoc);
      logInfo(`Write fk file    [${i + 1}/${sorted.length}]: ${fkPath}`);
    } else if (fs.existsSync(fkPath)) {
      fs.rmSync(fkPath, { force: true });
    }
  }

  const expectedTableFiles = new Set(sorted.map((t) => `${t.tableName}.yaml`));
  for (const file of fs.readdirSync(tablesDir)) {
    if (!/\.ya?ml$/i.test(file)) continue;
    if (!expectedTableFiles.has(file)) fs.rmSync(path.join(tablesDir, file), { force: true });
  }

  const expectedDataFiles = new Set(sorted.map((t) => `${t.tableName}.yaml`));
  for (const file of fs.readdirSync(dataDir)) {
    if (!/\.ya?ml$/i.test(file)) continue;
    if (!expectedDataFiles.has(file)) fs.rmSync(path.join(dataDir, file), { force: true });
  }

  const expectedConstraintsFiles = new Set(
    sorted
      .filter((t) => (t.primaryKey || []).length || (t.indexes || []).length)
      .map((t) => `${t.tableName}.yaml`)
  );
  for (const file of fs.readdirSync(constraintsDir)) {
    if (!/\.ya?ml$/i.test(file)) continue;
    if (!expectedConstraintsFiles.has(file)) fs.rmSync(path.join(constraintsDir, file), { force: true });
  }

  const expectedFkFiles = new Set(
    sorted
      .filter((t) => (t.foreignKeys || []).length > 0)
      .map((t) => `${t.tableName}.yaml`)
  );
  for (const file of fs.readdirSync(fksDir)) {
    if (!/\.ya?ml$/i.test(file)) continue;
    if (!expectedFkFiles.has(file)) fs.rmSync(path.join(fksDir, file), { force: true });
  }

  const masterDoc = {
    databaseChangeLog: [
      {
        include: {
          file: "tables.yaml",
          relativeToChangelogFile: true
        }
      },
      {
        include: {
          file: "data.yaml",
          relativeToChangelogFile: true
        }
      },
      {
        include: {
          file: "constraints.yaml",
          relativeToChangelogFile: true
        }
      }
    ]
  };
  const tablesDoc = {
    databaseChangeLog: sorted.map((t) => ({
      include: {
        file: `tables/${t.tableName}.yaml`,
        relativeToChangelogFile: true
      }
    }))
  };
  const dataDoc = {
    databaseChangeLog: sorted.map((t) => ({
      include: {
        file: `data/${t.tableName}.yaml`,
        relativeToChangelogFile: true
      }
    }))
  };
  const constraintsDoc = {
    databaseChangeLog: sorted.flatMap((t) => {
      const entries = [];
      if ((t.primaryKey || []).length || (t.indexes || []).length) {
        entries.push({
          include: {
            file: `constraints/${t.tableName}.yaml`,
            relativeToChangelogFile: true
          }
        });
      }
      if ((t.foreignKeys || []).length) {
        entries.push({
          include: {
            file: `fks/${t.tableName}.yaml`,
            relativeToChangelogFile: true
          }
        });
      }
      return entries;
    })
  };
  writeYaml(path.join(outDir, "tables.yaml"), tablesDoc);
  writeYaml(path.join(outDir, "data.yaml"), dataDoc);
  writeYaml(path.join(outDir, "constraints.yaml"), constraintsDoc);
  writeYaml(path.join(outDir, "generated-master.yaml"), masterDoc);
  logInfo("Write master file: generated-master.yaml");
}

function printUsage() {
  console.log(`
schema-changelog-exporter

Required:
  --dbms postgres|mariadb|oracle
  --user <user>
  --password <password>

DB specific:
  postgres: --host <host> --database <db> [--schema public]
  mariadb : --host <host> --database <db>
  oracle  : --host <host> [--schema <owner>] (--serviceName <svc> | --sid <sid>) [--oracleClientPath <instant-client-dir>]

Optional:
  --port <port>
  --tables <comma-separated table names>
  --out <output dir>               default: ./generated
  --author <changeset author>      default: data-manager

Example:
  node src/cli.mjs --dbms postgres --host 127.0.0.1 --port 5432 --user app --password pw --database sample --schema public --out ./generated
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (asBool(args.help) || asBool(args.h)) {
    printUsage();
    return;
  }

  const dbms = String(required(args, "dbms")).toLowerCase();
  const out = args.out || "./generated";
  const author = args.author || "data-manager";
  logInfo(`Start export (dbms=${dbms}, out=${path.resolve(out)}, author=${author})`);

  let tables = [];
  if (dbms === "postgres") tables = await exportPostgres(args);
  else if (dbms === "mariadb") tables = await exportMariaDb(args);
  else if (dbms === "oracle") tables = await exportOracle(args);
  else throw new Error(`Unsupported dbms: ${dbms}`);

  writeGeneratedLayout(out, tables, author);
  logInfo(`Completed: generated changelog for ${tables.length} table(s) at ${path.resolve(out)}`);
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exit(1);
});
