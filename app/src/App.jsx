import { useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { PanelLeft } from "lucide-react";
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

export default function App() {
  const { theme, setTheme } = useTheme();
  const [validationJump, setValidationJump] = useState(null);
  const [globalSaveBinding, setGlobalSaveBinding] = useState(null);
  const [savingAll, setSavingAll] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ running: false, current: 0, total: 0, step: "", message: "" });

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
        options: { forceChangelog: true }
      });
      setSaveProgress({ running: true, current: 3, total: 4, step: "메타 갱신", message: "refreshing view" });
      await workspace.refreshMeta(workspace.selectedTable);
      if (hasDataChanges && globalSaveBinding?.reloadCurrentTable) {
        await globalSaveBinding.reloadCurrentTable();
      }

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
