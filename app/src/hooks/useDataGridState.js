import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { isBlankValue, matchesWhere, newId, nowWithMs, toErrorMessage } from "../lib/app-utils";
import { parseTypeToSpec } from "../lib/type-spec";

/**
 * Data grid editing/saving state.
 * @param {{
 *  selectedTable: string,
 *  existingTableNames: string[],
 *  columns: string[],
 *  columnDefs: Array<{name: string, nullable?: boolean}>,
 *  pkCols: string[],
 *  hasSchemaUnsavedChanges: boolean,
 *  setUnsavedSchemaOpen: (open: boolean) => void,
 *  refreshMeta: (nextSelected?: string) => Promise<void>,
 *  setMessage: (msg: string) => void,
 *  setError: (msg: string) => void
 * }} deps
 * @returns {{
 *  selectedRowIds: Set<string>,
 *  whereClause: string,
 *  setWhereClause: (next: string | ((prev: string) => string)) => void,
 *  fetchSize: number,
 *  setFetchSize: import("react").Dispatch<import("react").SetStateAction<number>>,
 *  currentPage: number,
 *  setCurrentPage: import("react").Dispatch<import("react").SetStateAction<number>>,
 *  clearSortRules: () => void,
 *  onRevertTable: () => Promise<void>,
 *  totalPages: number,
 *  pagedRows: any[],
 *  isLoadingRows: boolean,
 *  sortRules: Array<{column: string, direction: "asc"|"desc"}>,
 *  filteredRows: any[],
 *  confirmSaveOpen: boolean,
 *  setConfirmSaveOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>,
 *  previewBundle: any,
 *  setPreviewBundle: import("react").Dispatch<import("react").SetStateAction<any>>,
 *  deletePreviewBundle: any,
 *  setDeletePreviewBundle: import("react").Dispatch<import("react").SetStateAction<any>>,
 *  isApplyingCascadeSave: boolean,
 *  isApplyingCascadeDelete: boolean,
 *  loadRows: (table: string) => Promise<void>,
 *  onRequestSaveTable: () => void,
 *  onSaveTable: () => Promise<void>,
 *  onApplyCascadeAndSave: () => Promise<void>,
 *  onRequestDeleteSelected: () => Promise<void>,
 *  onApplyCascadeDelete: () => Promise<void>,
 *  onCellChange: (rowId: string, col: string, value: string) => void,
 *  onAddRow: () => void,
 *  onRemoveRow: (rowId: string) => void,
 *  toggleRowSelection: (rowId: string) => void,
 *  toggleSelectAllPaged: () => void,
 *  deleteSelectedRows: () => void,
 *  toggleSort: (column: string) => void,
 *  removeSortRule: (column: string) => void,
 *  moveSortRule: (fromColumn: string, toColumn: string) => void,
 *  getCellTypeError: (row: any, col: string) => string
 * }}
 */
export function useDataGridState({
  selectedTable,
  existingTableNames,
  columns,
  columnDefs,
  pkCols,
  hasSchemaUnsavedChanges,
  setUnsavedSchemaOpen,
  refreshMeta,
  setMessage,
  setError
}) {
  const [baseRows, setBaseRows] = useState([]);
  const [draftRows, setDraftRows] = useState([]);
  const [selectedRowIds, setSelectedRowIds] = useState(new Set());
  const [whereClauseByTable, setWhereClauseByTable] = useState({});
  const [fetchSizeByTable, setFetchSizeByTable] = useState({});
  const [currentPage, setCurrentPage] = useState(1);
  const [sortRulesByTable, setSortRulesByTable] = useState({});
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [previewBundle, setPreviewBundle] = useState(null);
  const [deletePreviewBundle, setDeletePreviewBundle] = useState(null);
  const [isApplyingCascadeSave, setIsApplyingCascadeSave] = useState(false);
  const [isApplyingCascadeDelete, setIsApplyingCascadeDelete] = useState(false);
  const tableKey = selectedTable || "__global__";
  const whereClause = whereClauseByTable[tableKey] || "";
  const setWhereClause = (next) =>
    setWhereClauseByTable((prev) => {
      const current = prev[tableKey] || "";
      const value = typeof next === "function" ? next(current) : next;
      return { ...prev, [tableKey]: String(value ?? "") };
    });
  const fetchSize = fetchSizeByTable[tableKey] || 200;
  const setFetchSize = (next) =>
    setFetchSizeByTable((prev) => {
      const current = prev[tableKey] || 200;
      const value = typeof next === "function" ? next(current) : next;
      const safe = Math.max(1, Number.parseInt(String(value || "1"), 10) || 1);
      return { ...prev, [tableKey]: safe };
    });
  const sortRules = sortRulesByTable[tableKey] || [];
  const setSortRules = (next) =>
    setSortRulesByTable((prev) => {
      const current = prev[tableKey] || [];
      const value = typeof next === "function" ? next(current) : next;
      return { ...prev, [tableKey]: Array.isArray(value) ? value : [] };
    });
  const columnDefMap = useMemo(() => {
    const map = new Map();
    for (const col of columnDefs || []) map.set(col.name, col);
    return map;
  }, [columnDefs]);
  const columnTypeSpecMap = useMemo(() => {
    const map = new Map();
    for (const col of columnDefs || []) map.set(col.name, parseTypeToSpec(col.type || ""));
    return map;
  }, [columnDefs]);

  const validateTypeValue = (colName, rawValue) => {
    const colDef = columnDefMap.get(colName);
    const value = (rawValue ?? "").toString().trim();
    if (!colDef || isBlankValue(value)) return "";
    const spec = columnTypeSpecMap.get(colName) || parseTypeToSpec(colDef.type || "");
    const base = (spec.baseType || "").toUpperCase();
    if (!base) return "";

    const intPattern = /^[+-]?\d+$/;
    if (base === "INT32") {
      if (!intPattern.test(value)) return "INT32 정수 형식이 아닙니다.";
      const n = Number.parseInt(value, 10);
      if (!Number.isFinite(n) || n < -2147483648 || n > 2147483647) return "INT32 범위를 벗어났습니다.";
      return "";
    }
    if (base === "INT64") {
      if (!intPattern.test(value)) return "INT64 정수 형식이 아닙니다.";
      try {
        const n = BigInt(value);
        if (n < BigInt("-9223372036854775808") || n > BigInt("9223372036854775807")) return "INT64 범위를 벗어났습니다.";
      } catch {
        return "INT64 정수 형식이 아닙니다.";
      }
      return "";
    }
    if (base === "DECIMAL") {
      const m = value.match(/^[+-]?(\d+)(?:\.(\d+))?$/);
      if (!m) return "DECIMAL 숫자 형식이 아닙니다.";
      const integerPart = (m[1] || "").replace(/^0+/, "") || "0";
      const fracPart = m[2] || "";
      const precision = Number.parseInt(spec.precision || "", 10);
      const scale = Number.parseInt(spec.scale || "", 10);
      if (Number.isFinite(precision) && precision >= 0) {
        const digits = (integerPart === "0" ? 1 : integerPart.length) + fracPart.length;
        if (digits > precision) return `DECIMAL precision(${precision}) 초과입니다.`;
      }
      if (Number.isFinite(scale) && scale >= 0 && fracPart.length > scale) {
        return `DECIMAL scale(${scale}) 초과입니다.`;
      }
      return "";
    }
    if (base === "BOOLEAN") {
      if (!/^(true|false|1|0)$/i.test(value)) return "BOOLEAN은 true/false/1/0만 허용됩니다.";
      return "";
    }
    if (base === "DATE") {
      const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return "DATE 형식은 YYYY-MM-DD 입니다.";
      const y = Number.parseInt(m[1], 10);
      const mo = Number.parseInt(m[2], 10);
      const d = Number.parseInt(m[3], 10);
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== mo || dt.getUTCDate() !== d) return "유효하지 않은 DATE 입니다.";
      return "";
    }
    if (base === "TIMESTAMP") {
      if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?$/.test(value)) {
        return "TIMESTAMP 형식 예: YYYY-MM-DD HH:mm:ss(.SSS)";
      }
      const isoCandidate = value.includes("T") ? value : value.replace(" ", "T");
      const t = Date.parse(isoCandidate);
      if (Number.isNaN(t)) return "유효하지 않은 TIMESTAMP 입니다.";
      return "";
    }
    if (base === "UUID") {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return "UUID 형식이 아닙니다.";
      return "";
    }
    if (base === "JSON") {
      try {
        JSON.parse(value);
      } catch {
        return "JSON 형식이 아닙니다.";
      }
      return "";
    }
    if (base === "STRING" || base === "BINARY") {
      const len = Number.parseInt(spec.length || "", 10);
      if (Number.isFinite(len) && len > 0 && value.length > len) return `${base} 길이(${len})를 초과했습니다.`;
    }
    return "";
  };

  const orderedRows = useMemo(() => {
    if (!sortRules.length) return draftRows;
    const next = [...draftRows];
    next.sort((a, b) => {
      for (const rule of sortRules) {
        const av = (a.values[rule.column] || "").toString();
        const bv = (b.values[rule.column] || "").toString();
        const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
        if (cmp !== 0) return rule.direction === "asc" ? cmp : -cmp;
      }
      return 0;
    });
    return next;
  }, [draftRows, sortRules]);

  const filteredRows = useMemo(() => orderedRows.filter((r) => matchesWhere(r, whereClause)), [orderedRows, whereClause]);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(filteredRows.length / Math.max(1, fetchSize))), [filteredRows.length, fetchSize]);
  const pagedRows = useMemo(() => {
    const size = Math.max(1, fetchSize);
    const safePage = Math.min(Math.max(1, currentPage), totalPages);
    const from = (safePage - 1) * size;
    return filteredRows.slice(from, from + size);
  }, [filteredRows, fetchSize, currentPage, totalPages]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const isCompletelyEmptyRow = (row) => columns.every((c) => isBlankValue(row.values[c]));
  const withNotNullDefaults = (rows) => {
    const nextRows = rows.map((row) => ({ ...row, values: { ...row.values } }));
    const notNullCols = (columnDefs || []).filter((c) => c.nullable === false);
    for (const row of nextRows) {
      for (const col of notNullCols) {
        const def = (col.defaultValue ?? "").toString();
        if (isBlankValue(row.values[col.name]) && !isBlankValue(def)) {
          row.values[col.name] = def;
        }
      }
    }
    return nextRows;
  };
  const rowsToPersist = (rows) => withNotNullDefaults(rows.filter((row) => !isCompletelyEmptyRow(row)));
  const serializeRowsForCompare = (rows) =>
    rows.map((row) => ({
      values: columns.reduce((acc, col) => {
        acc[col] = (row.values[col] ?? "").toString();
        return acc;
      }, {})
    }));

  const validateRowsForSave = (rows) => {
    const notNullCols = (columnDefs || []).filter((c) => c.nullable === false).map((c) => c.name);
    const pkKeySeen = new Set();

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];

      for (const col of notNullCols) {
        if (isBlankValue(row.values[col])) {
          return `NOT NULL 컬럼 값이 비어 있습니다. row ${i + 1}, column ${col}`;
        }
      }

      if (pkCols.length > 0) {
        for (const pk of pkCols) {
          if (isBlankValue(row.values[pk])) {
            return `PK 컬럼 값이 비어 있습니다. row ${i + 1}, column ${pk}`;
          }
        }
        const pkKey = pkCols.map((pk) => (row.values[pk] ?? "").toString()).join("\u0001");
        if (pkKeySeen.has(pkKey)) {
          return `중복 PK가 있습니다. row ${i + 1}`;
        }
        pkKeySeen.add(pkKey);
      }

      for (const col of columns) {
        const typeErr = validateTypeValue(col, row.values[col]);
        if (typeErr) return `데이터 타입 오류. row ${i + 1}, column ${col}: ${typeErr}`;
      }
    }

    return "";
  };

  const hasDataUnsavedChanges = useMemo(() => {
    const current = serializeRowsForCompare(rowsToPersist(orderedRows));
    const base = serializeRowsForCompare(rowsToPersist(baseRows));
    return JSON.stringify(current) !== JSON.stringify(base);
  }, [orderedRows, baseRows, columns, columnDefs]);
  const isOrderOnlyChange = useMemo(() => {
    const currentRows = rowsToPersist(orderedRows);
    const basePersisted = rowsToPersist(baseRows);
    if (currentRows.length !== basePersisted.length) return false;
    const baseById = new Map(basePersisted.map((r) => [r.id, r]));
    for (const row of currentRows) {
      const old = baseById.get(row.id);
      if (!old) return false;
      for (const col of columns) {
        if ((old.values?.[col] ?? "").toString() !== (row.values?.[col] ?? "").toString()) return false;
      }
    }
    return true;
  }, [orderedRows, baseRows, columns]);

  const loadRows = async (table) => {
    if (!table) return;
    setIsLoadingRows(true);
    setBaseRows([]);
    setDraftRows([]);
    setSelectedRowIds(new Set());
    if (Array.isArray(existingTableNames) && !existingTableNames.includes(table)) {
      setIsLoadingRows(false);
      return;
    }
    try {
      const chunk = Math.max(1, fetchSize);
      const rows = [];
      for (let page = 0; page < 100000; page += 1) {
        const part = await api.getRows(table, page, chunk);
        rows.push(...part);
        if ((part || []).length < chunk) break;
      }
      if (rows.length > 0 && rows.length < fetchSize) {
        setFetchSize(rows.length);
      }
      setBaseRows(rows);
      setDraftRows(rows.map((r) => ({ ...r, values: { ...r.values } })));
      setSelectedRowIds(new Set());
      setCurrentPage(1);
    } catch (e) {
      const msg = toErrorMessage(e);
      if (/not\s*found|unknown\s*table|없습니다|존재하지/i.test(msg)) {
        setBaseRows([]);
        setDraftRows([]);
        setSelectedRowIds(new Set());
        setIsLoadingRows(false);
        return;
      }
      throw e;
    } finally {
      setIsLoadingRows(false);
    }
  };

  useEffect(() => {
    if (!selectedTable) return;
    loadRows(selectedTable).catch((e) => setError(e, "loadRows"));
  }, [selectedTable, existingTableNames, fetchSize]);

  const onRequestSaveTable = () => {
    if (!hasDataUnsavedChanges) return;
    if (hasSchemaUnsavedChanges) {
      setUnsavedSchemaOpen(true);
      return;
    }
    setConfirmSaveOpen(true);
  };

  const onSaveTable = async () => {
    try {
      const rowsToSave = rowsToPersist(orderedRows);
      const validationError = validateRowsForSave(rowsToSave);
      if (validationError) throw new Error(validationError);

      const byId = new Map(baseRows.map((r) => [r.id, r]));
      const pkChangedRows = rowsToSave.filter((row) => {
        const old = byId.get(row.id);
        if (!old) return false;
        return pkCols.some((pk) => (old.values[pk] || "") !== (row.values[pk] || ""));
      });

      if (pkChangedRows.length === 0) {
        await api.commitTable(selectedTable, rowsToSave, { skipValidation: isOrderOnlyChange });
        await loadRows(selectedTable);
        await refreshMeta(selectedTable);
        setConfirmSaveOpen(false);
        setMessage(`테이블 저장 완료 (${nowWithMs()})`);
        return;
      }

      const previews = [];
      for (const row of pkChangedRows) {
        const p = await api.previewKeyUpdate({ table: selectedTable, rowId: row.id, newKey: row.values });
        if (p.conflicts?.length) throw new Error(`키 충돌로 저장할 수 없습니다: ${p.conflicts[0]}`);
        previews.push(p);
      }
      setConfirmSaveOpen(false);
      setPreviewBundle({ previews, rowsToSave });
    } catch (e) {
      setError(e, "saveTable");
    }
  };

  const onApplyCascadeAndSave = async () => {
    if (isApplyingCascadeSave) return;
    try {
      setIsApplyingCascadeSave(true);
      const previews = previewBundle?.previews || [];
      const rowsToSave = previewBundle?.rowsToSave || rowsToPersist(orderedRows);
      for (const p of previews) {
        await api.applyChange({ changeSetId: p.changeSetId, userApproved: true });
      }
      await api.commitTable(selectedTable, rowsToSave);
      await loadRows(selectedTable);
      await refreshMeta(selectedTable);
      setPreviewBundle(null);
      setMessage(`연쇄 반영 후 테이블 저장 완료 (${nowWithMs()})`);
    } catch (e) {
      setError(e, "applyCascadeAndSave");
    } finally {
      setIsApplyingCascadeSave(false);
    }
  };

  const buildDataSavePayload = () => {
    if (!selectedTable) return null;
    const rowsToSave = rowsToPersist(orderedRows);
    const validationError = validateRowsForSave(rowsToSave);
    if (validationError) throw new Error(validationError);
    return {
      table: selectedTable,
      rows: rowsToSave
    };
  };

  const reloadCurrentTable = async () => {
    await loadRows(selectedTable);
  };

  const onRequestDeleteSelected = async () => {
    if (!selectedRowIds.size) return;
    if (hasDataUnsavedChanges) {
      setError("삭제 전에 데이터 변경사항을 먼저 저장하거나 되돌려 주세요.", "deleteSelectedRows");
      return;
    }
    try {
      const rowIds = Array.from(selectedRowIds);
      const preview = await api.previewDeleteRows({ table: selectedTable, rowIds });
      setDeletePreviewBundle(preview);
    } catch (e) {
      setError(e, "previewDeleteRows");
    }
  };

  const onApplyCascadeDelete = async () => {
    if (isApplyingCascadeDelete) return;
    try {
      if (!deletePreviewBundle?.changeSetId) return;
      setIsApplyingCascadeDelete(true);
      await api.applyChange({ changeSetId: deletePreviewBundle.changeSetId, userApproved: true });
      await loadRows(selectedTable);
      await refreshMeta(selectedTable);
      setSelectedRowIds(new Set());
      const deleted = deletePreviewBundle.totalDeletedRows || 0;
      setDeletePreviewBundle(null);
      setMessage(`삭제 완료 (${deleted} rows) (${nowWithMs()})`);
    } catch (e) {
      setError(e, "applyCascadeDelete");
    } finally {
      setIsApplyingCascadeDelete(false);
    }
  };

  const onCellChange = (rowId, col, value) =>
    setDraftRows((prev) => {
      const idx = prev.findIndex((r) => r.id === rowId);
      if (idx < 0) return prev;
      const current = prev[idx];
      if ((current.values?.[col] ?? "") === value) return prev;
      const next = [...prev];
      next[idx] = { ...current, values: { ...current.values, [col]: value } };
      return next;
    });

  const getCellTypeError = (row, col) => validateTypeValue(col, row?.values?.[col]);

  const onAddRow = () => {
    const blank = {};
    columns.forEach((c) => (blank[c] = ""));
    setDraftRows((prev) => [...prev, { id: newId(), values: blank }]);
  };

  const onRemoveRow = (rowId) => {
    setDraftRows((prev) => prev.filter((r) => r.id !== rowId));
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      next.delete(rowId);
      return next;
    });
  };

  const toggleRowSelection = (rowId) =>
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });

  const toggleSelectAllPaged = () =>
    setSelectedRowIds((prev) => {
      const ids = pagedRows.map((r) => r.id);
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });

  const deleteSelectedRows = () => {
    if (!selectedRowIds.size) return;
    setDraftRows((prev) => prev.filter((r) => !selectedRowIds.has(r.id)));
    setSelectedRowIds(new Set());
  };

  const toggleSort = (column) =>
    setSortRules((prev) => {
      const idx = prev.findIndex((r) => r.column === column);
      if (idx < 0) return [...prev, { column, direction: "asc" }];
      const cur = prev[idx];
      if (cur.direction === "asc") {
        const next = [...prev];
        next[idx] = { ...cur, direction: "desc" };
        return next;
      }
      return prev.filter((r) => r.column !== column);
    });
  const clearSortRules = () => setSortRules([]);
  const onRevertTable = async () => {
    clearSortRules();
    await loadRows(selectedTable);
  };
  const removeSortRule = (column) => setSortRules((prev) => prev.filter((r) => r.column !== column));
  const moveSortRule = (fromColumn, toColumn) =>
    setSortRules((prev) => {
      const fromIdx = prev.findIndex((r) => r.column === fromColumn);
      const toIdx = prev.findIndex((r) => r.column === toColumn);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });

  return {
    hasDataUnsavedChanges,
    selectedRowIds,
    whereClause,
    setWhereClause,
    fetchSize,
    setFetchSize,
    currentPage,
    setCurrentPage,
    clearSortRules,
    onRevertTable,
    totalPages,
    pagedRows,
    isLoadingRows,
    sortRules,
    filteredRows,
    confirmSaveOpen,
    setConfirmSaveOpen,
    previewBundle,
    setPreviewBundle,
    isApplyingCascadeSave,
    deletePreviewBundle,
    setDeletePreviewBundle,
    isApplyingCascadeDelete,
    loadRows,
    onRequestSaveTable,
    onSaveTable,
    buildDataSavePayload,
    reloadCurrentTable,
    onApplyCascadeAndSave,
    onRequestDeleteSelected,
    onApplyCascadeDelete,
    onCellChange,
    onAddRow,
    onRemoveRow,
    getCellTypeError,
    toggleRowSelection,
    toggleSelectAllPaged,
    deleteSelectedRows,
    toggleSort,
    removeSortRule,
    moveSortRule
  };
}
