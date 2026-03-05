import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { applyOneBasedOrder, clone, nowWithMs } from "../lib/app-utils";
import { buildTypeFromSpec, defaultTypeSpec, parseTypeToSpec, validateTypeSpec } from "../lib/type-spec";

/**
 * Structure editor draft and mutation state.
 * @param {{
 *  selectedTable: string,
 *  persistedTableNames: string[],
 *  schemaMap: Record<string, any>,
 *  setSchemaMap: import("react").Dispatch<import("react").SetStateAction<Record<string, any>>>,
 *  refreshMeta: (nextSelected?: string) => Promise<void>,
 *  setMessage: (msg: string) => void,
 *  setError: (msg: string) => void
 * }} deps
 * @returns {Record<string, any>}
 */
export function useSchemaEditorState({ selectedTable, persistedTableNames, schemaMap, setSchemaMap, refreshMeta, setMessage, setError }) {
  const [schemaDraft, setSchemaDraft] = useState(null);
  const [unsavedSchemaOpen, setUnsavedSchemaOpen] = useState(false);
  const [columnModalOpen, setColumnModalOpen] = useState(false);
  const [newCol, setNewCol] = useState({ name: "", ...defaultTypeSpec("STRING"), defaultValue: "", nullable: true, pkOrder: "" });
  const defaultPkName = (tableName) => `PK_${String(tableName || "").trim()}`.toUpperCase();
  const defaultFkName = (tableName, n) => `FK_${String(tableName || "").trim()}_${Number(n)}`.toUpperCase();

  const selectedSchema = schemaMap[selectedTable];
  const normalizeSchema = (schema) => {
    const normalized = clone(schema);
    normalized.primaryKey = normalized.primaryKey || [];
    normalized.primaryKeyName = normalized.primaryKeyName || (normalized.primaryKey.length ? defaultPkName(selectedTable) : "");
    normalized.foreignKeys = (normalized.foreignKeys || []).map((fk) => ({
      ...fk,
      name: String(fk?.name || ""),
      childTable: String(fk?.childTable || selectedTable),
      childColumns: Array.isArray(fk?.childColumns) ? fk.childColumns : [],
      parentTable: String(fk?.parentTable || ""),
      parentColumns: Array.isArray(fk?.parentColumns) ? fk.parentColumns : []
    }));
    normalized.indexes = normalized.indexes || [];
    normalized.columns = (normalized.columns || []).map((c) => ({ ...c, defaultValue: c.defaultValue || "" }));
    return normalized;
  };
  const columns = useMemo(() => schemaDraft?.columns?.map((c) => c.name) || selectedSchema?.columns?.map((c) => c.name) || [], [schemaDraft, selectedSchema]);
  const pkCols = schemaDraft?.primaryKey || selectedSchema?.primaryKey || [];

  const hasSchemaUnsavedChanges = useMemo(() => {
    if (!selectedSchema || !schemaDraft) return false;
    const isDraftTable = selectedTable && !(persistedTableNames || []).includes(selectedTable);
    if (isDraftTable) return true;
    return JSON.stringify(normalizeSchema(selectedSchema)) !== JSON.stringify(normalizeSchema(schemaDraft));
  }, [selectedSchema, schemaDraft, selectedTable, persistedTableNames]);

  const isDraftTable = useMemo(() => !!selectedTable && !(persistedTableNames || []).includes(selectedTable), [selectedTable, persistedTableNames]);

  useEffect(() => {
    if (!selectedSchema) {
      setSchemaDraft(null);
      return;
    }
    setSchemaDraft(normalizeSchema(selectedSchema));
  }, [selectedSchema, selectedTable]);

  const onRevertSchema = () => {
    if (!selectedSchema) return;
    setSchemaDraft(normalizeSchema(selectedSchema));
  };

  const updateSchemaDraft = (fn) =>
    setSchemaDraft((prev) => {
      if (!prev) return prev;
      return fn(clone(prev));
    });

  const moveColumnTo = (from, to) =>
    updateSchemaDraft((s) => {
      if (from < 0 || from >= s.columns.length || to < 0 || to >= s.columns.length || from === to) return s;
      const next = [...s.columns];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      s.columns = next;
      return s;
    });

  const removeColumn = (idx) =>
    updateSchemaDraft((s) => {
      const col = s.columns[idx]?.name;
      s.columns.splice(idx, 1);
      s.primaryKey = s.primaryKey.filter((p) => p !== col);
      s.indexes = (s.indexes || []).map((ix) => ({ ...ix, columns: (ix.columns || []).filter((c) => c !== col) }));
      s.foreignKeys = (s.foreignKeys || []).map((fk) => {
        const child = fk.childColumns || [];
        const parent = fk.parentColumns || [];
        const kept = [];
        for (let i = 0; i < child.length; i += 1) {
          if (child[i] !== col) kept.push({ child: child[i], parent: parent[i] });
        }
        return { ...fk, childColumns: kept.map((p) => p.child), parentColumns: kept.map((p) => p.parent) };
      });
      return s;
    });

  const pkOrderOf = (name) => {
    const idx = (schemaDraft?.primaryKey || []).indexOf(name);
    return idx >= 0 ? String(idx + 1) : "";
  };

  const setPkOrderForColumn = (name, raw) =>
    updateSchemaDraft((s) => {
      s.primaryKey = applyOneBasedOrder(s.primaryKey || [], name, raw);
      return s;
    });

  const confirmAddColumn = () => {
    const name = (newCol.name || "").trim();
    if (!name) return setError("컬럼명을 입력하세요.");
    if ((schemaDraft?.columns || []).some((c) => c.name === name)) return setError(`이미 존재하는 컬럼명입니다: ${name}`);
    const typeValidationError = validateTypeSpec(newCol);
    if (typeValidationError) return setError(typeValidationError);
    const builtType = buildTypeFromSpec(newCol);
    if (!builtType) return setError("데이터 타입을 선택하세요.");
    updateSchemaDraft((s) => {
      s.columns.push({ name, type: builtType, defaultValue: newCol.defaultValue || "", nullable: !!newCol.nullable });
      s.primaryKey = applyOneBasedOrder(s.primaryKey || [], name, newCol.pkOrder);
      return s;
    });
    setColumnModalOpen(false);
    setNewCol({ name: "", ...defaultTypeSpec("STRING"), defaultValue: "", nullable: true, pkOrder: "" });
  };

  const addIndex = () =>
    updateSchemaDraft((s) => {
      const n = (s.indexes || []).length + 1;
      s.indexes = [...(s.indexes || []), { name: `idx_${selectedTable}_${n}`, columns: [], unique: false }];
      return s;
    });

  const updateIndex = (idx, patch) =>
    updateSchemaDraft((s) => {
      s.indexes[idx] = { ...s.indexes[idx], ...patch };
      return s;
    });

  const indexColumnOrderOf = (index, colName) => {
    const pos = (index?.columns || []).indexOf(colName);
    return pos >= 0 ? String(pos + 1) : "";
  };

  const setIndexColumnOrder = (idx, colName, raw) =>
    updateSchemaDraft((s) => {
      const ix = s.indexes[idx];
      const nextCols = applyOneBasedOrder(ix.columns || [], colName, raw);
      s.indexes[idx] = { ...ix, columns: nextCols };
      return s;
    });

  const removeIndex = (idx) =>
    updateSchemaDraft((s) => {
      s.indexes.splice(idx, 1);
      return s;
    });

  const addForeignKey = () =>
    updateSchemaDraft((s) => {
      const n = (s.foreignKeys || []).length + 1;
      const firstParent = Object.keys(schemaMap).find((t) => t !== selectedTable) || selectedTable;
      s.foreignKeys = [
        ...(s.foreignKeys || []),
        { name: defaultFkName(selectedTable, n), childTable: selectedTable, childColumns: [""], parentTable: firstParent, parentColumns: [""] }
      ];
      return s;
    });

  const updateForeignKey = (fkIdx, patch) =>
    updateSchemaDraft((s) => {
      const list = [...(s.foreignKeys || [])];
      if (!list[fkIdx]) return s;
      list[fkIdx] = { ...list[fkIdx], ...patch };
      s.foreignKeys = list;
      return s;
    });

  const updateFkPair = (fkIdx, pairIdx, side, value) =>
    updateSchemaDraft((s) => {
      const fk = s.foreignKeys[fkIdx];
      const child = [...(fk.childColumns || [])];
      const parent = [...(fk.parentColumns || [])];
      if (side === "child") child[pairIdx] = value;
      else parent[pairIdx] = value;
      s.foreignKeys[fkIdx] = { ...fk, childColumns: child, parentColumns: parent };
      return s;
    });

  const addFkPair = (fkIdx) =>
    updateSchemaDraft((s) => {
      const fk = s.foreignKeys[fkIdx];
      s.foreignKeys[fkIdx] = { ...fk, childColumns: [...(fk.childColumns || []), ""], parentColumns: [...(fk.parentColumns || []), ""] };
      return s;
    });

  const removeFkPair = (fkIdx, pairIdx) =>
    updateSchemaDraft((s) => {
      const fk = s.foreignKeys[fkIdx];
      const child = [...(fk.childColumns || [])];
      const parent = [...(fk.parentColumns || [])];
      child.splice(pairIdx, 1);
      parent.splice(pairIdx, 1);
      s.foreignKeys[fkIdx] = { ...fk, childColumns: child, parentColumns: parent };
      return s;
    });

  const removeForeignKey = (fkIdx) =>
    updateSchemaDraft((s) => {
      s.foreignKeys.splice(fkIdx, 1);
      return s;
    });

  const validateSchemaDraft = (draft) => {
    if (!draft) return "스키마가 비어 있습니다.";
    if (!draft.columns?.length) return "최소 1개 컬럼이 필요합니다.";
    const colNames = draft.columns.map((c) => (c.name || "").trim());
    if (colNames.some((n) => !n)) return "빈 컬럼명이 있습니다.";
    const colSet = new Set();
    for (const c of colNames) {
      if (colSet.has(c)) return `중복 컬럼명: ${c}`;
      colSet.add(c);
    }
    for (const col of draft.columns) {
      const spec = parseTypeToSpec(col.type || "");
      const typeErr = validateTypeSpec(spec);
      if (typeErr) return `컬럼 타입 오류(${col.name}): ${typeErr}`;
    }
    const pk = draft.primaryKey || [];
    const pkSet = new Set();
    for (const p of pk) {
      if (!colSet.has(p)) return `PK 컬럼이 존재하지 않습니다: ${p}`;
      if (pkSet.has(p)) return `PK 컬럼 중복: ${p}`;
      pkSet.add(p);
    }
    if (pk.length > 0 && !(draft.primaryKeyName || "").trim()) return "PK가 있으면 PK 이름이 필요합니다.";
    const idxNameSet = new Set();
    for (const idx of draft.indexes || []) {
      const idxName = (idx.name || "").trim();
      if (!idxName) return "인덱스 이름이 비어 있습니다.";
      if (idxNameSet.has(idxName)) return `중복 인덱스명: ${idxName}`;
      idxNameSet.add(idxName);
      if (!(idx.columns || []).length) return `인덱스 컬럼이 필요합니다: ${idxName}`;
      const idxColSet = new Set();
      for (const c of idx.columns || []) {
        if (!colSet.has(c)) return `인덱스 컬럼이 존재하지 않습니다(${idxName}): ${c}`;
        if (idxColSet.has(c)) return `인덱스 컬럼 중복(${idxName}): ${c}`;
        idxColSet.add(c);
      }
    }
    const fkNameSet = new Set();
    for (const fk of draft.foreignKeys || []) {
      const fkName = (fk.name || "").trim();
      if (!fkName) return "FK 이름이 비어 있습니다.";
      if (fkNameSet.has(fkName)) return `중복 FK명: ${fkName}`;
      fkNameSet.add(fkName);
      if ((fk.childTable || "") !== selectedTable) return `FK childTable은 ${selectedTable} 이어야 합니다: ${fkName}`;
      const parentSchema = schemaMap[fk.parentTable || ""];
      if (!parentSchema) return `FK 부모 테이블이 없습니다(${fkName}): ${fk.parentTable}`;
      const childCols = fk.childColumns || [];
      const parentCols = fk.parentColumns || [];
      if (!childCols.length || !parentCols.length) return `FK 컬럼 매핑이 필요합니다: ${fkName}`;
      if (childCols.length !== parentCols.length) return `FK 매핑 개수 불일치: ${fkName}`;
      const childSet = new Set();
      const parentSet = new Set((parentSchema.columns || []).map((c) => c.name));
      for (let i = 0; i < childCols.length; i += 1) {
        const cc = childCols[i];
        const pc = parentCols[i];
        if (!colSet.has(cc)) return `FK child 컬럼이 없습니다(${fkName}): ${cc}`;
        if (!parentSet.has(pc)) return `FK parent 컬럼이 없습니다(${fkName}): ${pc}`;
        if (childSet.has(cc)) return `FK child 컬럼 중복(${fkName}): ${cc}`;
        childSet.add(cc);
      }
    }
    return "";
  };

  const onSaveSchema = async () => {
    try {
      const validationError = validateSchemaDraft(schemaDraft);
      if (validationError) throw new Error(validationError);
      const nextMap = { ...schemaMap, [selectedTable]: schemaDraft };
      await api.updateSchema(Object.values(nextMap));
      const result = await api.generateChangelog();
      setSchemaMap(nextMap);
      await refreshMeta(selectedTable);
      setMessage(`테이블 정보 저장 + changelog 생성 완료 (${nowWithMs()}): ${result.path}`);
    } catch (e) {
      setError(e, "saveSchema");
    }
  };

  return {
    schemaDraft,
    columns,
    pkCols,
    hasSchemaUnsavedChanges,
    isDraftTable,
    unsavedSchemaOpen,
    setUnsavedSchemaOpen,
    columnModalOpen,
    setColumnModalOpen,
    newCol,
    setNewCol,
    updateSchemaDraft,
    moveColumnTo,
    removeColumn,
    pkOrderOf,
    setPkOrderForColumn,
    confirmAddColumn,
    addIndex,
    updateIndex,
    indexColumnOrderOf,
    setIndexColumnOrder,
    removeIndex,
    addForeignKey,
    updateForeignKey,
    updateFkPair,
    addFkPair,
    removeFkPair,
    removeForeignKey,
    onSaveSchema,
    onRevertSchema
  };
}
