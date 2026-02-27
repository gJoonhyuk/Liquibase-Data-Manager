import { useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { api } from "../../api";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Textarea } from "../ui/textarea";

export function SqlConsolePanel({ sqlPanelHeight, selectedTable, onError, workspaceReady }) {
  const [querySqlByTable, setQuerySqlByTable] = useState({});
  const [queryRowsByTable, setQueryRowsByTable] = useState({});
  const tableKey = selectedTable || "__global__";
  const defaultQuery = selectedTable ? `select * from ${selectedTable}` : "select * from users";
  const querySql = workspaceReady ? querySqlByTable[tableKey] ?? defaultQuery : "";
  const queryRows = workspaceReady ? queryRowsByTable[tableKey] || [] : [];

  const onRunQuery = async () => {
    try {
      const rows = await api.query(querySql);
      setQueryRowsByTable((prev) => ({ ...prev, [tableKey]: rows }));
    } catch (e) {
      onError(e, "sqlQuery");
    }
  };
  const onClearQueryResult = () => setQueryRowsByTable((prev) => ({ ...prev, [tableKey]: [] }));

  return (
    <Card className="min-h-0 border bg-background flex flex-col overflow-hidden" style={{ height: sqlPanelHeight }}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>SQL Console</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Rows: {queryRows.length}</span>
            <Button variant="outline" size="sm" onClick={onClearQueryResult} disabled={!workspaceReady || queryRows.length === 0}>
              <RotateCcw className="mr-1 h-4 w-4" />
              Clear Result
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex flex-1 flex-col gap-2 overflow-auto">
        <Textarea
          className="min-h-[90px] shrink-0"
          value={querySql}
          onChange={(e) => setQuerySqlByTable((prev) => ({ ...prev, [tableKey]: e.target.value }))}
          disabled={!workspaceReady}
          placeholder={workspaceReady ? "" : "Open workspace first"}
        />
        <Button onClick={onRunQuery} disabled={!workspaceReady}>
          <Play className="mr-1 h-4 w-4" />
          Run
        </Button>
        <div className="min-h-0 flex-1 space-y-1 overflow-auto text-xs">
          {(workspaceReady ? queryRows : []).map((r, i) => (
            <pre key={i} className="rounded border p-2 whitespace-pre-wrap break-all">
              {JSON.stringify(r, null, 2)}
            </pre>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
