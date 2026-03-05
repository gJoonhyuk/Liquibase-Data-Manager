import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { Braces, Database, Hash, PanelLeft, Plus, ScrollText, Trash2 } from "lucide-react";
import { AppDialogs } from "./components/layout/AppDialogs";
import { AppHeader } from "./components/layout/AppHeader";
import { DataGridPanel } from "./components/layout/DataGridPanel";
import { NavigatorPanel } from "./components/layout/NavigatorPanel";
import { HorizontalSplitter, LeftVerticalSplitter, VerticalSplitter } from "./components/layout/PanelSplitters";
import { SqlConsolePanel } from "./components/layout/SqlConsolePanel";
import { StructureEditorPanel } from "./components/layout/StructureEditorPanel";
import { useLayoutState, useSchemaEditorState, useSqlValidationState, useWorkspaceState } from "./hooks";
import { api } from "./api";
import { buildFkPairs } from "./lib/app-utils";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";

export default function App() {
  const { theme, setTheme } = useTheme();
  const [validationJump, setValidationJump] = useState(null);
  const [globalSaveBinding, setGlobalSaveBinding] = useState(null);
  const [savingAll, setSavingAll] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ running: false, current: 0, total: 0, step: "", message: "" });
  const [activeTab, setActiveTab] = useState("tables");
  const [selectedSequence, setSelectedSequence] = useState("");
  const [selectedFunction, setSelectedFunction] = useState("");
  const [selectedProcedure, setSelectedProcedure] = useState("");

  const workspace = useWorkspaceState();
  const persistedTableNames = useMemo(() => (workspace.tables || []).map((t) => t.tableName), [workspace.tables]);
  const schema = useSchemaEditorState({
    selectedTable: workspace.selectedTable,
    persistedTableNames,
    schemaMap: workspace.schemaMap,
    setSchemaMap: workspace.setSchemaMap,
    refreshMeta: workspace.refreshMeta,
    setMessage: workspace.setMessage,
    setError: workspace.setError
  });
  const sql = useSqlValidationState({ setError: workspace.setError });
  const layout = useLayoutState();
  const currentColumnDefs = schema.schemaDraft?.columns || workspace.schemaMap[workspace.selectedTable]?.columns || [];
  const currentForeignKeys = schema.schemaDraft?.foreignKeys || workspace.schemaMap[workspace.selectedTable]?.foreignKeys || [];
  const navigatorTables = useMemo(() => {
    const rowCountMap = new Map((workspace.tables || []).map((t) => [t.tableName, t.rowCount]));
    return Object.keys(workspace.schemaMap || {}).map((tableName) => ({ tableName, rowCount: rowCountMap.get(tableName) || 0 }));
  }, [workspace.tables, workspace.schemaMap]);
  const defaultPkName = (tableName) => `PK_${String(tableName || "").trim()}`.toUpperCase();
  const sequenceNames = useMemo(() => Object.keys(workspace.sequences || {}).sort((a, b) => a.localeCompare(b)), [workspace.sequences]);
  const functionNames = useMemo(() => Object.keys(workspace.functions || {}).sort((a, b) => a.localeCompare(b)), [workspace.functions]);
  const procedureNames = useMemo(() => Object.keys(workspace.procedures || {}).sort((a, b) => a.localeCompare(b)), [workspace.procedures]);

  useEffect(() => {
    if (!sequenceNames.length) setSelectedSequence("");
    else if (!sequenceNames.includes(selectedSequence)) setSelectedSequence(sequenceNames[0]);
  }, [sequenceNames, selectedSequence]);
  useEffect(() => {
    if (!functionNames.length) setSelectedFunction("");
    else if (!functionNames.includes(selectedFunction)) setSelectedFunction(functionNames[0]);
  }, [functionNames, selectedFunction]);
  useEffect(() => {
    if (!procedureNames.length) setSelectedProcedure("");
    else if (!procedureNames.includes(selectedProcedure)) setSelectedProcedure(procedureNames[0]);
  }, [procedureNames, selectedProcedure]);

  const validateTableName = (rawName) => {
    const name = (rawName || "").trim();
    if (!name) {
      workspace.setError("테이블명을 입력하세요.");
      return "";
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      workspace.setError("테이블명은 영문/숫자/언더스코어만 가능하며 숫자로 시작할 수 없습니다.");
      return "";
    }
    return name;
  };

  const onCreateTable = async (rawName) => {
    const name = validateTableName(rawName);
    if (!name) return false;
    if (workspace.schemaMap[name]) {
      workspace.setError(`이미 존재하는 테이블명입니다: ${name}`);
      return false;
    }
    workspace.setError("");
    workspace.setSchemaMap((prev) => ({
      ...prev,
      [name]: {
        tableName: name,
        columns: [{ name: "id", type: "STRING(64)", nullable: false, defaultValue: "" }],
        primaryKey: ["id"],
        primaryKeyName: defaultPkName(name),
        foreignKeys: [],
        indexes: []
      }
    }));
    workspace.setSelectedTable(name);
    workspace.setMessage(`테이블 초안을 추가했습니다: ${name} (Save All 필요)`);
    return true;
  };

  const onRenameTable = async (oldName, rawNewName) => {
    const newName = validateTableName(rawNewName);
    if (!newName) return false;
    if (oldName === newName) return true;
    try {
      await api.renameTable(oldName, newName);
      const result = await api.generateChangelog();
      await workspace.refreshMeta(newName);
      workspace.setMessage(`테이블명 변경 완료 (${oldName} -> ${newName}) / changelog: ${result.path}`);
      workspace.setError("");
      return true;
    } catch (e) {
      workspace.setError(e, "renameTable");
      return false;
    }
  };

  const onDeleteTable = async (tableName) => {
    const name = String(tableName || "").trim();
    if (!name) return false;
    try {
      await api.deleteTable(name);
      const result = await api.generateChangelog();
      await workspace.refreshMeta();
      workspace.setMessage(`테이블 삭제 완료 (${name}) / changelog: ${result.path}`);
      workspace.setError("");
      return true;
    } catch (e) {
      workspace.setError(e, "deleteTable");
      return false;
    }
  };

  const onSaveAll = async () => {
    if (savingAll) return;
    try {
      setSavingAll(true);
      setSaveProgress({ running: true, current: 0, total: 4, step: "저장 준비", message: "collecting payload" });
      const tables = schema.buildSchemaSavePayload();
      const dataByTable = {};
      let hasDataChanges = false;
      if (globalSaveBinding?.hasDataUnsavedChanges && globalSaveBinding?.buildDataSavePayload) {
        setSaveProgress({ running: true, current: 1, total: 4, step: "데이터 정리", message: "building data payload" });
        const payload = globalSaveBinding.buildDataSavePayload();
        if (payload?.table) {
          dataByTable[payload.table] = payload.rows || [];
          hasDataChanges = true;
        }
      }
      setSaveProgress({ running: true, current: 2, total: 4, step: "전체 저장", message: "saving schema/data/changelog" });
      const result = await api.saveAll({
        tables,
        dataByTable,
        sequences: workspace.sequences,
        functions: workspace.functions,
        procedures: workspace.procedures,
        options: { forceChangelog: true }
      });
      setSaveProgress({ running: true, current: 3, total: 4, step: "메타 갱신", message: "refreshing view" });
      await workspace.refreshMeta(workspace.selectedTable);
      if (hasDataChanges && globalSaveBinding?.reloadCurrentTable) await globalSaveBinding.reloadCurrentTable();
      const migrated = result?.migrated ? " / legacy->latest migrated" : "";
      const chgPath = result?.path ? ` / changelog: ${result.path}` : "";
      workspace.setMessage(`전체 저장 완료${migrated}${chgPath}`);
      workspace.setError("");
      setSaveProgress({ running: true, current: 4, total: 4, step: "완료", message: "completed" });
    } catch (e) {
      workspace.setError(e, "saveAll");
    } finally {
      setTimeout(() => {
        setSavingAll(false);
        setSaveProgress({ running: false, current: 0, total: 0, step: "", message: "" });
      }, 150);
    }
  };

  const addSequence = () => {
    const base = "SEQ_NEW";
    let i = 1;
    while ((workspace.sequences || {})[`${base}_${i}`]) i += 1;
    const name = `${base}_${i}`;
    workspace.setSequences((prev) => ({ ...prev, [name]: { name, startValue: "1", incrementBy: "1", cycle: false } }));
    setSelectedSequence(name);
  };
  const deleteSequence = (name) => workspace.setSequences((prev) => Object.fromEntries(Object.entries(prev || {}).filter(([k]) => k !== name)));
  const updateSequence = (name, patch) => workspace.setSequences((prev) => ({ ...prev, [name]: { ...(prev?.[name] || { name }), ...patch } }));

  const addRoutine = (kind) => {
    const source = kind === "function" ? workspace.functions : workspace.procedures;
    const setter = kind === "function" ? workspace.setFunctions : workspace.setProcedures;
    const base = kind === "function" ? "fn_new" : "sp_new";
    let i = 1;
    while ((source || {})[`${base}_${i}`]) i += 1;
    const name = `${base}_${i}`;
    setter((prev) => ({ ...prev, [name]: { name, sql: "", rollbackSql: "" } }));
    if (kind === "function") setSelectedFunction(name);
    else setSelectedProcedure(name);
  };
  const deleteRoutine = (kind, name) => {
    const setter = kind === "function" ? workspace.setFunctions : workspace.setProcedures;
    setter((prev) => Object.fromEntries(Object.entries(prev || {}).filter(([k]) => k !== name)));
  };
  const updateRoutine = (kind, name, patch) => {
    const setter = kind === "function" ? workspace.setFunctions : workspace.setProcedures;
    setter((prev) => ({ ...prev, [name]: { ...(prev?.[name] || { name }), ...patch } }));
  };

  const renderSequenceTab = () => {
    const seq = (workspace.sequences || {})[selectedSequence];
    return (
      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] gap-2 p-2">
        <Card className="min-h-0">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle>Sequences</CardTitle>
              <Button size="icon" onClick={addSequence}><Plus className="h-4 w-4" /></Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 overflow-auto">
            {sequenceNames.map((name) => (
              <div key={name} className="flex items-center gap-2">
                <Button className="w-full justify-start" variant={name === selectedSequence ? "default" : "secondary"} onClick={() => setSelectedSequence(name)}>{name}</Button>
                <Button size="icon" variant="ghost" onClick={() => deleteSequence(name)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="min-h-0">
          <CardHeader className="pb-2"><CardTitle>Sequence Editor</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 overflow-auto">
            {!seq ? <p className="col-span-2 text-sm text-muted-foreground">시퀀스를 선택하세요.</p> : (
              <>
                <Input value={seq.name || ""} onChange={(e) => {
                  const newName = e.target.value;
                  if (!newName || newName === selectedSequence) return updateSequence(selectedSequence, { name: newName });
                  workspace.setSequences((prev) => {
                    const next = { ...(prev || {}) };
                    const old = next[selectedSequence] || { name: selectedSequence };
                    delete next[selectedSequence];
                    next[newName] = { ...old, ...seq, name: newName };
                    return next;
                  });
                  setSelectedSequence(newName);
                }} placeholder="name" />
                <Input value={seq.startValue || ""} onChange={(e) => updateSequence(selectedSequence, { startValue: e.target.value })} placeholder="startValue" />
                <Input value={seq.incrementBy || ""} onChange={(e) => updateSequence(selectedSequence, { incrementBy: e.target.value })} placeholder="incrementBy" />
                <Input value={seq.minValue || ""} onChange={(e) => updateSequence(selectedSequence, { minValue: e.target.value })} placeholder="minValue" />
                <Input value={seq.maxValue || ""} onChange={(e) => updateSequence(selectedSequence, { maxValue: e.target.value })} placeholder="maxValue" />
                <Input value={seq.cacheSize || ""} onChange={(e) => updateSequence(selectedSequence, { cacheSize: e.target.value })} placeholder="cacheSize" />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderRoutineTab = (kind) => {
    const isFn = kind === "function";
    const names = isFn ? functionNames : procedureNames;
    const selected = isFn ? selectedFunction : selectedProcedure;
    const map = isFn ? workspace.functions : workspace.procedures;
    const routine = (map || {})[selected];
    return (
      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] gap-2 p-2">
        <Card className="min-h-0">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle>{isFn ? "Functions" : "Procedures"}</CardTitle>
              <Button size="icon" onClick={() => addRoutine(kind)}><Plus className="h-4 w-4" /></Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 overflow-auto">
            {names.map((name) => (
              <div key={name} className="flex items-center gap-2">
                <Button className="w-full justify-start" variant={name === selected ? "default" : "secondary"} onClick={() => (isFn ? setSelectedFunction(name) : setSelectedProcedure(name))}>{name}</Button>
                <Button size="icon" variant="ghost" onClick={() => deleteRoutine(kind, name)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="min-h-0">
          <CardHeader className="pb-2"><CardTitle>{isFn ? "Function Editor" : "Procedure Editor"}</CardTitle></CardHeader>
          <CardContent className="space-y-2 overflow-auto">
            {!routine ? <p className="text-sm text-muted-foreground">객체를 선택하세요.</p> : (
              <>
                <Input value={routine.name || ""} onChange={(e) => {
                  const newName = e.target.value;
                  if (!newName || newName === selected) return updateRoutine(kind, selected, { name: newName });
                  const setter = isFn ? workspace.setFunctions : workspace.setProcedures;
                  setter((prev) => {
                    const next = { ...(prev || {}) };
                    const old = next[selected] || { name: selected };
                    delete next[selected];
                    next[newName] = { ...old, ...routine, name: newName };
                    return next;
                  });
                  if (isFn) setSelectedFunction(newName);
                  else setSelectedProcedure(newName);
                }} placeholder="name" />
                <Textarea className="min-h-[220px] font-mono" value={routine.sql || ""} onChange={(e) => updateRoutine(kind, selected, { sql: e.target.value })} placeholder="SQL body" />
                <Textarea className="min-h-[140px] font-mono" value={routine.rollbackSql || ""} onChange={(e) => updateRoutine(kind, selected, { rollbackSql: e.target.value })} placeholder="Rollback SQL (optional)" />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  const mainCols = `${layout.navCollapsed ? 0 : layout.navPanelWidth}px ${layout.navCollapsed ? 0 : 10}px minmax(0,1fr) 10px ${layout.rightCollapsed ? 0 : layout.rightPanelWidth}px`;

  return (
    <div className="h-dvh overflow-hidden bg-background text-foreground">
      <div className="flex h-full flex-col">
        <AppHeader
          theme={theme}
          onThemeChange={(v) => setTheme(v ? "dark" : "light")}
          workspacePath={workspace.workspacePath}
          changelogPath={workspace.changelogPath}
          onWorkspacePathChange={workspace.setWorkspacePath}
          onChangelogPathChange={workspace.setChangelogPath}
          onPickWorkspace={async () => {
            const selected = await api.pickDirectory();
            if (selected) workspace.setWorkspacePath(selected);
          }}
          onPickChangelog={async () => {
            const selected = await api.pickFile();
            if (selected) workspace.setChangelogPath(selected);
          }}
          onOpenWorkspace={workspace.onOpenWorkspace}
          onSaveAll={onSaveAll}
          onCancelOpenWorkspace={workspace.cancelOpenWorkspace}
          onValidate={sql.onValidate}
          message={workspace.message}
          error={workspace.error}
          onErrorClick={() => workspace.setErrorDialogOpen(true)}
          workspaceOpened={workspace.workspaceOpened}
          openingWorkspace={workspace.openingWorkspace}
          savingAll={savingAll}
          onClearMessage={() => workspace.setMessage("")}
          onClearError={() => workspace.setError("")}
          onOpenActionLog={() => workspace.setActionDialogOpen(true)}
          onOpenErrorLog={() => workspace.setErrorDialogOpen(true)}
        />

        <div className="border-b px-2 py-2">
          <div className="flex w-full items-center gap-3 rounded-xl border bg-muted/30 p-1.5">
            <div className="grid w-full max-w-[980px] grid-cols-4 gap-1">
              {[
                { id: "tables", label: "테이블", icon: Database },
                { id: "sequences", label: "시퀀스", icon: Hash },
                { id: "functions", label: "함수", icon: Braces },
                { id: "procedures", label: "저장 프로시저", icon: ScrollText }
              ].map((t) => {
                const Icon = t.icon;
                const active = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTab(t.id)}
                    className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg border text-sm transition ${
                      active
                        ? "border-primary/25 bg-background text-foreground shadow-sm"
                        : "border-transparent text-muted-foreground hover:border-border hover:bg-background/70 hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="truncate">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {!workspace.workspaceOpened ? (
          <div className="m-2 grid min-h-0 flex-1 place-items-center rounded-xl border border-dashed bg-muted/20">
            <p className="text-sm text-muted-foreground">워크스페이스를 열면 선택한 탭의 편집 화면이 활성화됩니다.</p>
          </div>
        ) : activeTab === "tables" ? (
          <div className="relative grid min-h-0 flex-1" style={{ gridTemplateColumns: mainCols }}>
            {!layout.navCollapsed && (
              <div style={{ gridColumn: 1, minWidth: 0, minHeight: 0 }}>
                <NavigatorPanel
                  tables={navigatorTables}
                  selectedTable={workspace.selectedTable}
                  onSelectTable={workspace.setSelectedTable}
                  onCreateTable={onCreateTable}
                  onRenameTable={onRenameTable}
                  onDeleteTable={onDeleteTable}
                  workspaceReady={workspace.workspaceOpened}
                />
              </div>
            )}
            {!layout.navCollapsed && (
              <div style={{ gridColumn: 2, minWidth: 0, minHeight: 0 }}>
                <LeftVerticalSplitter collapsed={layout.navCollapsed} onResizeStart={() => layout.setResizingNav(true)} onToggle={() => layout.setNavCollapsed((v) => !v)} />
              </div>
            )}
            <div className="m-2 ml-1 min-h-0 flex flex-col" style={{ gridColumn: 3 }}>
              <DataGridPanel
                selectedTable={workspace.selectedTable}
                existingTableNames={persistedTableNames}
                columns={schema.columns}
                columnDefs={currentColumnDefs}
                foreignKeys={currentForeignKeys}
                pkCols={schema.pkCols}
                hasSchemaUnsavedChanges={schema.hasSchemaUnsavedChanges}
                onRequireSchemaSave={schema.setUnsavedSchemaOpen}
                refreshMeta={workspace.refreshMeta}
                setMessage={workspace.setMessage}
                setError={workspace.setError}
                workspaceReady={workspace.workspaceOpened}
                jumpToRowRequest={validationJump}
                onJumpToRowHandled={() => setValidationJump(null)}
                onGlobalSaveBindingChange={setGlobalSaveBinding}
              />
              <HorizontalSplitter collapsed={layout.sqlCollapsed} onResizeStart={() => layout.setResizingSql(true)} onToggle={() => layout.setSqlCollapsed((v) => !v)} />
              {!layout.sqlCollapsed && (
                <SqlConsolePanel
                  sqlPanelHeight={layout.sqlPanelHeight}
                  selectedTable={workspace.selectedTable}
                  onError={workspace.setError}
                  workspaceReady={workspace.workspaceOpened && !schema.isDraftTable}
                />
              )}
            </div>
            <div style={{ gridColumn: 4, minWidth: 0, minHeight: 0 }}>
              <VerticalSplitter collapsed={layout.rightCollapsed} onResizeStart={() => layout.setResizingRight(true)} onToggle={() => layout.setRightCollapsed((v) => !v)} />
            </div>
            {!layout.rightCollapsed && (
              <div className="h-full min-h-0" style={{ gridColumn: 5, minWidth: 0, minHeight: 0 }}>
                <StructureEditorPanel
                  schemaDraft={schema.schemaDraft}
                  columns={schema.columns}
                  schemaMap={workspace.schemaMap}
                  selectedTable={workspace.selectedTable}
                  onUpdateSchemaDraft={schema.updateSchemaDraft}
                  pkOrderOf={schema.pkOrderOf}
                  onSetPkOrderForColumn={schema.setPkOrderForColumn}
                  onMoveColumnTo={schema.moveColumnTo}
                  onRemoveColumn={schema.removeColumn}
                  onOpenColumnModal={() => schema.setColumnModalOpen(true)}
                  onAddIndex={schema.addIndex}
                  onUpdateIndex={schema.updateIndex}
                  onRemoveIndex={schema.removeIndex}
                  indexColumnOrderOf={schema.indexColumnOrderOf}
                  onSetIndexColumnOrder={schema.setIndexColumnOrder}
                  onAddForeignKey={schema.addForeignKey}
                  onUpdateForeignKey={schema.updateForeignKey}
                  buildFkPairs={buildFkPairs}
                  onUpdateFkPair={schema.updateFkPair}
                  onRemoveFkPair={schema.removeFkPair}
                  onAddFkPair={schema.addFkPair}
                  onRemoveForeignKey={schema.removeForeignKey}
                  onSaveSchema={schema.onSaveSchema}
                  hasSchemaUnsavedChanges={schema.hasSchemaUnsavedChanges}
                  onRevertSchema={schema.onRevertSchema}
                />
              </div>
            )}
            {layout.navCollapsed && (
              <Button
                size="icon"
                variant="outline"
                className="absolute left-1 top-1/2 z-20 h-6 w-6 -translate-y-1/2 rounded-full bg-background shadow-sm"
                onClick={() => layout.setNavCollapsed(false)}
                title="Open Navigator"
                aria-label="Open Navigator"
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
            )}
          </div>
        ) : activeTab === "sequences" ? renderSequenceTab() : activeTab === "functions" ? renderRoutineTab("function") : renderRoutineTab("procedure")}

        <AppDialogs
          unsavedSchemaOpen={schema.unsavedSchemaOpen}
          onUnsavedSchemaOpenChange={schema.setUnsavedSchemaOpen}
          columnModalOpen={schema.columnModalOpen}
          onColumnModalOpenChange={schema.setColumnModalOpen}
          newCol={schema.newCol}
          onNewColChange={schema.setNewCol}
          onConfirmAddColumn={schema.confirmAddColumn}
          validationOpen={sql.validationOpen}
          onValidationOpenChange={sql.setValidationOpen}
          validation={sql.validation}
          onValidationNavigate={({ table, row }) => {
            workspace.setSelectedTable(table);
            setValidationJump({ table, row, requestId: `${table}:${row}:${Date.now()}` });
          }}
          actionDialogOpen={workspace.actionDialogOpen}
          onActionDialogOpenChange={workspace.setActionDialogOpen}
          actionLogs={workspace.actionLogs}
          onClearActionLogs={() => workspace.setActionLogs([])}
          errorDialogOpen={workspace.errorDialogOpen}
          onErrorDialogOpenChange={workspace.setErrorDialogOpen}
          errorLogs={workspace.errorLogs}
          onClearErrorLogs={() => workspace.setErrorLogs([])}
          openingWorkspace={workspace.openingWorkspace}
          openProgress={workspace.openProgress}
          savingAll={savingAll}
          saveProgress={saveProgress}
          onCancelOpenWorkspace={workspace.cancelOpenWorkspace}
        />
      </div>
    </div>
  );
}
