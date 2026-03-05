import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Save, Trash2, Search, Undo2, ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useDataGridState } from "../../hooks/useDataGridState";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

export function DataGridPanel({
  selectedTable,
  existingTableNames,
  columns,
  columnDefs,
  foreignKeys,
  pkCols,
  hasSchemaUnsavedChanges,
  onRequireSchemaSave,
  refreshMeta,
  setMessage,
  setError,
  workspaceReady,
  jumpToRowRequest,
  onJumpToRowHandled,
  onGlobalSaveBindingChange
}) {
  const [compactGridActions, setCompactGridActions] = useState(false);
  const [columnWidths, setColumnWidths] = useState({});
  const [largeEditor, setLargeEditor] = useState(null);
  const [dragSortFrom, setDragSortFrom] = useState("");
  const resizingRef = useRef(null);
  const gridActionsRef = useRef(null);
  const gridScrollRef = useRef(null);
  const orderScrollRef = useRef(null);
  const orderScrollHideTimerRef = useRef(null);
  const largeEditorCloseTimerRef = useRef(null);
  const textMeasureCtxRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [orderScrollState, setOrderScrollState] = useState({ visible: false, left: 0, width: 0 });
  const grid = useDataGridState({
    selectedTable,
    existingTableNames,
    columns,
    columnDefs,
    pkCols,
    hasSchemaUnsavedChanges,
    setUnsavedSchemaOpen: onRequireSchemaSave,
    refreshMeta,
    setMessage,
    setError
  });

  useEffect(() => {
    if (!onGlobalSaveBindingChange) return;
    onGlobalSaveBindingChange({
      hasDataUnsavedChanges: !!grid.hasDataUnsavedChanges,
      buildDataSavePayload: () => grid.buildDataSavePayload(),
      reloadCurrentTable: () => grid.reloadCurrentTable()
    });
    return () => onGlobalSaveBindingChange(null);
  }, [onGlobalSaveBindingChange, grid.hasDataUnsavedChanges, selectedTable, columns, columnDefs]);

  useEffect(() => {
    const el = gridActionsRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries?.[0]?.contentRect?.width || 0;
      setCompactGridActions(width > 0 && width < 520);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => {
    if (largeEditorCloseTimerRef.current) clearTimeout(largeEditorCloseTimerRef.current);
    if (orderScrollHideTimerRef.current) clearTimeout(orderScrollHideTimerRef.current);
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      const state = resizingRef.current;
      if (!state) return;
      const next = Math.max(100, state.startWidth + (e.clientX - state.startX));
      setColumnWidths((prev) => ({ ...prev, [state.column]: next }));
    };
    const onUp = () => {
      resizingRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);
  useEffect(() => {
    const el = gridScrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const onResize = () => setViewportHeight(el.clientHeight || 0);
    onResize();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  useEffect(() => {
    if (grid.sortRules.length === 0) {
      setOrderScrollState({ visible: false, left: 0, width: 0 });
      return;
    }
    const el = orderScrollRef.current;
    if (!el) return;
    const updateIndicator = (show = false) => {
      const clientWidth = el.clientWidth || 0;
      const scrollWidth = el.scrollWidth || 0;
      if (clientWidth <= 0 || scrollWidth <= clientWidth) {
        setOrderScrollState({ visible: false, left: 0, width: 0 });
        return;
      }
      const thumbWidth = Math.max(24, (clientWidth * clientWidth) / scrollWidth);
      const maxScroll = Math.max(1, scrollWidth - clientWidth);
      const maxTrack = Math.max(1, clientWidth - thumbWidth);
      const thumbLeft = (el.scrollLeft / maxScroll) * maxTrack;
      setOrderScrollState({ visible: show, left: thumbLeft, width: thumbWidth });
    };
    const onScroll = () => {
      updateIndicator(true);
      if (orderScrollHideTimerRef.current) clearTimeout(orderScrollHideTimerRef.current);
      orderScrollHideTimerRef.current = setTimeout(() => {
        updateIndicator(false);
      }, 700);
    };
    const onEnter = () => updateIndicator(true);
    const onLeave = () => updateIndicator(false);
    updateIndicator(false);
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    window.addEventListener("resize", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("resize", onScroll);
      if (orderScrollHideTimerRef.current) clearTimeout(orderScrollHideTimerRef.current);
    };
  }, [grid.sortRules]);

  const autoBaseWidths = useMemo(() => {
    const map = {};
    for (const c of columns || []) {
      // Keep header text fully visible by default: text width + sort button/padding.
      map[c] = Math.max(160, Math.ceil(String(c).length * 8 + 84));
    }
    return map;
  }, [columns]);

  useEffect(() => {
    setColumnWidths((prev) => {
      const next = { ...prev };
      for (const c of columns || []) {
        if (next[c] == null) next[c] = autoBaseWidths[c] || 160;
      }
      return next;
    });
  }, [columns, autoBaseWidths]);

  const getColWidthWithAuto = (col) => columnWidths[col] ?? autoBaseWidths[col] ?? 160;

  const notNullCols = useMemo(() => new Set((columnDefs || []).filter((c) => c.nullable === false).map((c) => c.name)), [columnDefs]);
  const requiredCols = useMemo(() => new Set([...(pkCols || []), ...Array.from(notNullCols)]), [pkCols, notNullCols]);
  const isBlank = (v) => String(v ?? "").trim() === "";
  const isRowCompletelyBlank = (row) => columns.every((c) => isBlank(row.values[c]));
  const isRequiredCellInvalid = (row, col) => {
    if (grid.isLoadingRows) return false;
    if (!requiredCols.has(col)) return false;
    if (isRowCompletelyBlank(row)) return false;
    return isBlank(row.values[col]);
  };
  const getTypeError = (row, col) => {
    if (grid.isLoadingRows) return "";
    return grid.getCellTypeError(row, col);
  };
  const requiredMissingCount = useMemo(
    () =>
      grid.pagedRows.reduce((acc, row) => {
        if (isRowCompletelyBlank(row)) return acc;
        return acc + columns.filter((col) => requiredCols.has(col) && isBlank(row.values[col])).length;
      }, 0),
    [grid.pagedRows, columns, requiredCols]
  );
  const typeInvalidCount = useMemo(
    () =>
      grid.pagedRows.reduce((acc, row) => {
        if (isRowCompletelyBlank(row)) return acc;
        return acc + columns.filter((col) => !isBlank(row.values[col]) && !!getTypeError(row, col)).length;
      }, 0),
    [grid.pagedRows, columns]
  );
  const fkLabelByColumn = useMemo(() => {
    const map = new Map();
    for (const fk of foreignKeys || []) {
      const parent = fk?.parentTable || "";
      for (const childCol of fk?.childColumns || []) {
        if (!childCol || !parent) continue;
        if (!map.has(childCol)) map.set(childCol, new Set());
        map.get(childCol).add(parent);
      }
    }
    const next = {};
    for (const col of columns) {
      const parents = Array.from(map.get(col) || []);
      if (parents.length) next[col] = `(FK - ${parents.join(", ")})`;
    }
    return next;
  }, [foreignKeys, columns]);
  const tableCoreMinWidth = useMemo(() => 40 + 40 + 56 + columns.reduce((sum, c) => sum + getColWidthWithAuto(c), 0), [columns, columnWidths, autoBaseWidths]);
  const rowHeight = 44;
  const overscan = 12;
  const virtualEnabled = grid.pagedRows.length > 120;
  const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowHeight) + overscan * 2);
  const virtualStart = virtualEnabled ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscan) : 0;
  const virtualEnd = virtualEnabled ? Math.min(grid.pagedRows.length, virtualStart + visibleCount) : grid.pagedRows.length;
  const renderRows = virtualEnabled ? grid.pagedRows.slice(virtualStart, virtualEnd) : grid.pagedRows;
  const topSpacer = virtualEnabled ? virtualStart * rowHeight : 0;
  const bottomSpacer = virtualEnabled ? Math.max(0, (grid.pagedRows.length - virtualEnd) * rowHeight) : 0;
  const totalColSpan = columns.length + 4;
  const isCellEllipsized = (text, colWidth) => {
    const valueText = String(text ?? "");
    if (!valueText) return false;
    if (valueText.includes("\n")) return true;
    const availablePx = Math.max(0, colWidth - 30); // input horizontal paddings/borders
    if (availablePx <= 0) return true;
    if (!textMeasureCtxRef.current) {
      const canvas = document.createElement("canvas");
      textMeasureCtxRef.current = canvas.getContext("2d");
    }
    const ctx = textMeasureCtxRef.current;
    if (!ctx) return valueText.length > 0;
    // shadcn input font (roughly 14px)
    ctx.font = "14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial";
    const textPx = ctx.measureText(valueText).width;
    return textPx > availablePx;
  };
  const activeLargeEditorRow = useMemo(() => {
    if (!largeEditor?.rowId) return null;
    return grid.pagedRows.find((r) => r.id === largeEditor.rowId) || null;
  }, [largeEditor, grid.pagedRows]);

  useEffect(() => {
    if (largeEditor && !activeLargeEditorRow) setLargeEditor(null);
  }, [largeEditor, activeLargeEditorRow]);
  useEffect(() => {
    if (!jumpToRowRequest) return;
    if (!selectedTable || jumpToRowRequest.table !== selectedTable) return;
    if (grid.isLoadingRows) return;
    const rowNum = Number(jumpToRowRequest.row || 0);
    if (!Number.isFinite(rowNum) || rowNum < 1) {
      onJumpToRowHandled?.();
      return;
    }
    grid.setWhereClause("");
    grid.clearSortRules();
    const targetPage = Math.max(1, Math.ceil(rowNum / Math.max(1, grid.fetchSize)));
    grid.setCurrentPage(targetPage);
    onJumpToRowHandled?.();
  }, [jumpToRowRequest, selectedTable, grid.isLoadingRows, grid.fetchSize]);

  const scheduleCloseLargeEditor = () => {
    if (largeEditorCloseTimerRef.current) clearTimeout(largeEditorCloseTimerRef.current);
    largeEditorCloseTimerRef.current = setTimeout(() => setLargeEditor(null), 120);
  };

  const openLargeEditor = (e, rowId, col) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setLargeEditor({
      rowId,
      col,
      top: Math.min(window.innerHeight - 220, rect.bottom + 6),
      left: Math.min(window.innerWidth - 580, Math.max(8, rect.left))
    });
  };

  return (
    <>
      <Card className="min-h-0 flex flex-1 flex-col bg-slate-100/45 dark:bg-slate-900/35">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle>{selectedTable || "Data"}</CardTitle>
            <div ref={gridActionsRef} className="flex items-center gap-2">
              <Button
                variant="default"
                size={compactGridActions ? "icon" : "default"}
              title="Save"
              aria-label="Save"
              disabled={!workspaceReady || !selectedTable || !grid.hasDataUnsavedChanges}
              onClick={grid.onRequestSaveTable}
            >
                <Save className={compactGridActions ? "h-4 w-4" : "mr-1 h-4 w-4"} />
                {!compactGridActions && "Save"}
              </Button>
              <Button
                variant="secondary"
                size={compactGridActions ? "icon" : "default"}
                title="Add"
              aria-label="Add"
              onClick={grid.onAddRow}
              disabled={!workspaceReady || !selectedTable}
              >
                <Plus className={compactGridActions ? "h-4 w-4" : "mr-1 h-4 w-4"} />
                {!compactGridActions && "Add"}
              </Button>
              <Button
                variant="secondary"
                size={compactGridActions ? "icon" : "default"}
              title="Delete Selected"
              aria-label="Delete Selected"
              disabled={!workspaceReady || !grid.selectedRowIds.size}
                onClick={grid.onRequestDeleteSelected}
              >
                <Trash2 className={compactGridActions ? "h-4 w-4" : "mr-1 h-4 w-4"} />
                {!compactGridActions && "Delete Selected"}
              </Button>
              <Button
                variant="outline"
                size={compactGridActions ? "icon" : "default"}
              title="Revert"
              aria-label="Revert"
              onClick={async () => {
                try {
                  await grid.onRevertTable();
                } catch (e) {
                  setError(e, "revertTable");
                }
              }}
              disabled={!workspaceReady || !selectedTable}
            >
              <Undo2 className={compactGridActions ? "h-4 w-4" : "mr-1 h-4 w-4"} />
              {!compactGridActions && "Revert"}
            </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex flex-1 flex-col gap-2">
          <div className="flex items-center gap-2 rounded-md border bg-background/70 p-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              className="h-9 w-[24%] min-w-[220px] text-sm"
              value={grid.whereClause}
              onChange={(e) => grid.setWhereClause(e.target.value)}
              placeholder="WHERE:"
              disabled={!workspaceReady}
            />
            <div className="relative h-9 min-w-0 flex-1 overflow-hidden rounded-md border bg-slate-200/55 dark:bg-slate-800/45 px-1">
              {grid.sortRules.length === 0 ? (
                <div className="flex h-full items-center px-1 text-sm text-muted-foreground">ORDER:</div>
              ) : (
                <div ref={orderScrollRef} className="hide-native-scrollbar absolute inset-0 z-10 overflow-x-auto overflow-y-hidden px-1">
                  <div className="flex h-full min-w-max items-center gap-1">
                    {grid.sortRules.map((r, idx) => (
                      <span
                        key={`${r.column}-${idx}`}
                        draggable
                        onDragStart={() => setDragSortFrom(r.column)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (!dragSortFrom || dragSortFrom === r.column) return;
                          grid.moveSortRule(dragSortFrom, r.column);
                          setDragSortFrom("");
                        }}
                        onDragEnd={() => setDragSortFrom("")}
                        className={`inline-flex h-7 items-center gap-1 rounded-md border bg-background pl-2 pr-1 text-[11px] whitespace-nowrap ${dragSortFrom === r.column ? "opacity-60" : ""}`}
                      >
                        <span>
                          {idx + 1}. {r.column} {r.direction === "asc" ? "ASC" : "DESC"}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => grid.removeSortRule(r.column)}
                          disabled={!workspaceReady}
                          title={`Remove ${r.column}`}
                          aria-label={`Remove ${r.column}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {grid.sortRules.length > 0 && orderScrollState.width > 0 ? (
                <div className={`pointer-events-none absolute bottom-[2px] left-1 right-1 z-20 h-1.5 rounded-full bg-muted/40 transition-opacity ${orderScrollState.visible ? "opacity-100" : "opacity-0"}`}>
                  <div
                    className="h-full rounded-full bg-slate-500/70 transition-[left,width]"
                    style={{ width: `${orderScrollState.width}px`, transform: `translateX(${orderScrollState.left}px)` }}
                  />
                </div>
              ) : null}
            </div>
            <Input
              className="w-24"
              type="number"
              min={1}
              value={grid.fetchSize}
              onChange={(e) => grid.setFetchSize(Math.max(1, Number.parseInt(e.target.value || "1", 10) || 1))}
              placeholder="fetch"
              title="Fetch Size / Page Size"
              disabled={!workspaceReady}
            />
            <Button size="icon" variant="outline" onClick={() => grid.setCurrentPage((p) => Math.max(1, p - 1))} disabled={!workspaceReady || grid.currentPage <= 1} title="Prev Page">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[62px] text-center text-xs text-muted-foreground">
              {grid.currentPage} / {grid.totalPages}
            </div>
            <Button
              size="icon"
              variant="outline"
              onClick={() => grid.setCurrentPage((p) => Math.min(grid.totalPages, p + 1))}
              disabled={!workspaceReady || grid.currentPage >= grid.totalPages}
              title="Next Page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                grid.setWhereClause("");
                grid.clearSortRules();
              }}
              disabled={!workspaceReady}
            >
              Clear
            </Button>
          </div>
          {grid.isLoadingRows && <p className="text-xs text-muted-foreground">데이터 로딩 중...</p>}
          {!grid.isLoadingRows && requiredMissingCount > 0 && <p className="text-xs text-red-500">필수값 누락 {requiredMissingCount}건 (현재 페이지)</p>}
          {!grid.isLoadingRows && typeInvalidCount > 0 && <p className="text-xs text-red-500">데이터 타입 오류 {typeInvalidCount}건 (현재 페이지)</p>}
          <div ref={gridScrollRef} className="min-h-0 flex-1 overflow-auto rounded-md border bg-background/80">
            <table className="table-fixed text-sm" style={{ width: "100%", minWidth: tableCoreMinWidth }}>
              <colgroup>
                <col style={{ width: 40, minWidth: 40 }} />
                <col style={{ width: 40, minWidth: 40 }} />
                {columns.map((c) => (
                  <col key={`col-size-${c}`} style={{ width: getColWidthWithAuto(c), minWidth: getColWidthWithAuto(c) }} />
                ))}
                <col />
                <col style={{ width: 56, minWidth: 56 }} />
              </colgroup>
              <thead className="sticky top-0 z-30 bg-slate-200/80 dark:bg-slate-800/75">
                <tr>
                  <th className="w-10 px-2 py-2 text-center align-middle">
                    <div className="flex items-center justify-center">
                    <Checkbox checked={grid.pagedRows.length > 0 && grid.pagedRows.every((r) => grid.selectedRowIds.has(r.id))} onCheckedChange={grid.toggleSelectAllPaged} disabled={!workspaceReady} />
                    </div>
                  </th>
                  <th className="w-10 px-2 py-2 text-center align-middle">#</th>
                  {columns.map((c) => {
                    const idx = grid.sortRules.findIndex((r) => r.column === c);
                    const icon = idx < 0 ? "-" : `${idx + 1}${grid.sortRules[idx].direction === "asc" ? "↑" : "↓"}`;
                    return (
                      <th key={c} className="relative px-2 py-2 text-left align-middle">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1 leading-tight">
                            <div className="truncate" title={c}>{c}</div>
                            {pkCols.includes(c) && <div className="truncate text-xs text-muted-foreground" title="(PK)">(PK)</div>}
                            {fkLabelByColumn[c] && <div className="truncate text-xs text-muted-foreground" title={fkLabelByColumn[c]}>{fkLabelByColumn[c]}</div>}
                          </div>
                          <Button size="sm" variant="outline" onClick={() => grid.toggleSort(c)} disabled={!workspaceReady}>
                            {icon}
                          </Button>
                        </div>
                        <div
                          className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            resizingRef.current = { column: c, startX: e.clientX, startWidth: getColWidthWithAuto(c) };
                          }}
                        />
                      </th>
                    );
                  })}
                  <th className="px-0 py-0"></th>
                  <th className="sticky right-0 z-40 w-14 bg-muted/80 px-2 py-2 align-middle"></th>
                </tr>
              </thead>
              <tbody>
                {topSpacer > 0 && (
                  <tr>
                    <td colSpan={totalColSpan} style={{ height: `${topSpacer}px` }} className="border-t p-0" />
                  </tr>
                )}
                {renderRows.map((r, idx) => (
                  <tr key={r.id} className="border-t">
                    <td className="w-10 px-2 py-2 text-center align-middle">
                      <div className="flex items-center justify-center">
                        <Checkbox checked={grid.selectedRowIds.has(r.id)} onCheckedChange={() => grid.toggleRowSelection(r.id)} disabled={!workspaceReady} />
                      </div>
                    </td>
                    <td className="w-10 px-2 py-2 text-center align-middle">{(grid.currentPage - 1) * grid.fetchSize + virtualStart + idx + 1}</td>
                    {columns.map((c) => (
                      <td key={`${r.id}-${c}`} className="px-2 py-2 align-middle">
                        {(() => {
                          const requiredError = isRequiredCellInvalid(r, c) ? "필수값(PK 또는 NOT NULL)이 비어 있습니다." : "";
                          const typeError = requiredError ? "" : getTypeError(r, c);
                          const invalid = !!requiredError || !!typeError;
                          const cellValue = r.values[c] || "";
                          const colWidth = getColWidthWithAuto(c);
                          const isEllipsized = isCellEllipsized(cellValue, colWidth);
                          return (
                        <div
                          className="relative"
                          onMouseLeave={() => isEllipsized && scheduleCloseLargeEditor()}
                        >
                          <Input
                            value={cellValue}
                            onChange={(e) => grid.onCellChange(r.id, c, e.target.value)}
                            onFocus={(e) => isEllipsized && openLargeEditor(e, r.id, c)}
                            disabled={!workspaceReady}
                            placeholder="[NULL]"
                            className={`${invalid ? "border-red-500 focus-visible:ring-red-500/50" : ""} placeholder:text-muted-foreground/60 overflow-hidden text-ellipsis whitespace-nowrap`}
                            title={requiredError || typeError || ""}
                          />
                        </div>
                          );
                        })()}
                      </td>
                    ))}
                    <td className="px-0 py-0"></td>
                    <td className="sticky right-0 z-10 bg-background px-2 py-2 align-middle">
                      <div className="flex justify-center">
                        <Button size="icon" variant="ghost" onClick={() => grid.onRemoveRow(r.id)} disabled={!workspaceReady}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {bottomSpacer > 0 && (
                  <tr>
                    <td colSpan={totalColSpan} style={{ height: `${bottomSpacer}px` }} className="border-t p-0" />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={grid.confirmSaveOpen} onOpenChange={grid.setConfirmSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>테이블 저장</DialogTitle>
          </DialogHeader>
          <p className="text-sm">현재 정렬/편집 상태로 저장합니다.</p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => grid.setConfirmSaveOpen(false)}>
              취소
            </Button>
            <Button onClick={grid.onSaveTable}>확인</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!grid.previewBundle} onOpenChange={(open) => !open && grid.setPreviewBundle(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>PK 변경 영향 미리보기</DialogTitle>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-auto text-sm">
            {(grid.previewBundle?.previews || []).map((p) => (
              <div key={p.changeSetId} className="rounded border p-2">
                <p className="font-medium">table: {p.sourceTable}</p>
                {(p.impacts || []).map((i) => (
                  <p key={`${p.changeSetId}-${i.table}`}>- {i.table}: {i.affectedRows} rows</p>
                ))}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => grid.setPreviewBundle(null)} disabled={grid.isApplyingCascadeSave}>
              취소
            </Button>
            {(() => {
              const hasCascadeImpact = (grid.previewBundle?.previews || []).some((p) => (p.impacts || []).some((i) => (i.affectedRows || 0) > 0));
              return (
                <Button onClick={grid.onApplyCascadeAndSave} disabled={grid.isApplyingCascadeSave}>
                  {grid.isApplyingCascadeSave ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                  {hasCascadeImpact ? "연쇄 저장" : "저장"}
                </Button>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!grid.deletePreviewBundle} onOpenChange={(open) => !open && grid.setDeletePreviewBundle(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>삭제 영향 미리보기</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 text-sm">
            <p>
              source table: <span className="font-medium">{grid.deletePreviewBundle?.sourceTable}</span>
            </p>
            <p>
              selected rows: <span className="font-medium">{(grid.deletePreviewBundle?.sourceRowIds || []).length}</span>
            </p>
            <p>
              total delete rows: <span className="font-medium text-red-500">{grid.deletePreviewBundle?.totalDeletedRows || 0}</span>
            </p>
          </div>
          <div className="max-h-[45vh] space-y-2 overflow-auto text-sm">
            {(grid.deletePreviewBundle?.impacts || []).map((i) => (
              <div key={`del-${i.table}`} className="rounded border p-2">
                <p className="font-medium">{i.table}</p>
                <p>- {i.affectedRows} rows</p>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => grid.setDeletePreviewBundle(null)} disabled={grid.isApplyingCascadeDelete}>
              취소
            </Button>
            {(() => {
              const sourceCount = (grid.deletePreviewBundle?.sourceRowIds || []).length;
              const totalDeleted = grid.deletePreviewBundle?.totalDeletedRows || 0;
              const hasCascadeImpact = totalDeleted > sourceCount;
              return (
            <Button variant="destructive" onClick={grid.onApplyCascadeDelete} disabled={grid.isApplyingCascadeDelete}>
              {grid.isApplyingCascadeDelete ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {hasCascadeImpact ? "연쇄 삭제 적용" : "삭제"}
            </Button>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {largeEditor && activeLargeEditorRow && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed z-[9999] w-[min(560px,72vw)] rounded-md border bg-background p-2 shadow-2xl"
              style={{ top: `${largeEditor.top}px`, left: `${largeEditor.left}px` }}
              onMouseEnter={() => {
                if (largeEditorCloseTimerRef.current) clearTimeout(largeEditorCloseTimerRef.current);
              }}
              onMouseLeave={scheduleCloseLargeEditor}
            >
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">
                  Large Editor - {largeEditor.col}
                </p>
                <Textarea
                  rows={8}
                  value={activeLargeEditorRow.values?.[largeEditor.col] || ""}
                  onChange={(e) => grid.onCellChange(activeLargeEditorRow.id, largeEditor.col, e.target.value)}
                  disabled={!workspaceReady}
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
