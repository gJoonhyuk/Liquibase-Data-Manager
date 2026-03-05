import { useEffect, useState } from "react";
import { Edit3, Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";

export function NavigatorPanel({ tables, selectedTable, onSelectTable, onCreateTable, onRenameTable, onDeleteTable, workspaceReady }) {
  const [openAdd, setOpenAdd] = useState(false);
  const [openRename, setOpenRename] = useState(false);
  const [openDelete, setOpenDelete] = useState(false);
  const [tableName, setTableName] = useState("");
  const [renameTo, setRenameTo] = useState("");
  const [keyword, setKeyword] = useState("");
  const sortedTables = [...tables].sort((a, b) => a.tableName.localeCompare(b.tableName, undefined, { sensitivity: "base" }));
  const filteredTables = sortedTables.filter((t) => !keyword.trim() || t.tableName.toLowerCase().includes(keyword.trim().toLowerCase()));

  useEffect(() => {
    if (!openRename) return;
    setRenameTo(selectedTable || "");
  }, [openRename, selectedTable]);

  return (
    <>
      <Card className="m-2 mr-1 flex h-full min-h-0 flex-col overflow-hidden bg-slate-100/50 dark:bg-slate-900/40">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle>Table</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                title="Rename Table"
                aria-label="Rename Table"
                disabled={!workspaceReady || !selectedTable}
                onClick={() => setOpenRename(true)}
              >
                <Edit3 className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                title="Delete Table"
                aria-label="Delete Table"
                disabled={!workspaceReady || !selectedTable}
                onClick={() => setOpenDelete(true)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button size="icon" title="Add Table" aria-label="Add Table" disabled={!workspaceReady} onClick={() => setOpenAdd(true)}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <div className="relative min-w-0 flex-1">
              <Input className="h-9 pr-8" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Search table..." disabled={!workspaceReady} />
              {keyword ? (
                <Button
                  size="icon"
                  variant="ghost"
                  title="Clear Search"
                  aria-label="Clear Search"
                  disabled={!workspaceReady}
                  onClick={() => setKeyword("")}
                  className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                >
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-2 overflow-auto">
          {filteredTables.map((t) => (
            <Button
              key={t.tableName}
              variant={selectedTable === t.tableName ? "default" : "secondary"}
              className="w-full"
              disabled={!workspaceReady}
              onClick={() => onSelectTable(t.tableName)}
            >
              <span className="flex min-w-0 w-full items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-left" title={t.tableName}>
                  {t.tableName}
                </span>
                <span className="shrink-0 tabular-nums">{t.rowCount}</span>
              </span>
            </Button>
          ))}
          {/* {filteredTables.length === 0 && <p className="px-1 text-xs text-muted-foreground">no tables</p>} */}
        </CardContent>
      </Card>

      <Dialog open={openAdd} onOpenChange={setOpenAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>테이블 추가</DialogTitle>
          </DialogHeader>
          <Input placeholder="table_name" value={tableName} onChange={(e) => setTableName(e.target.value)} />
          <p className="text-xs text-muted-foreground">기본 컬럼 `id`(PK, NOT NULL)가 포함된 초안 테이블이 생성됩니다.</p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpenAdd(false)}>
              취소
            </Button>
            <Button
              disabled={!workspaceReady}
              onClick={async () => {
                const ok = await onCreateTable(tableName);
                if (ok) {
                  setTableName("");
                  setOpenAdd(false);
                }
              }}
            >
              추가
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openRename} onOpenChange={setOpenRename}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>테이블명 변경</DialogTitle>
          </DialogHeader>
          <Input value={selectedTable || ""} disabled />
          <Input placeholder="new_table_name" value={renameTo} onChange={(e) => setRenameTo(e.target.value)} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpenRename(false)}>
              취소
            </Button>
            <Button
              disabled={!workspaceReady || !selectedTable}
              onClick={async () => {
                const ok = await onRenameTable(selectedTable, renameTo);
                if (ok) setOpenRename(false);
              }}
            >
              변경
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openDelete} onOpenChange={setOpenDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>테이블 삭제</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            `{selectedTable || ""}` 테이블을 삭제합니다. 관련 CSV 파일도 함께 삭제됩니다.
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpenDelete(false)}>
              취소
            </Button>
            <Button
              variant="destructive"
              disabled={!workspaceReady || !selectedTable}
              onClick={async () => {
                const ok = await onDeleteTable(selectedTable);
                if (ok) setOpenDelete(false);
              }}
            >
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
