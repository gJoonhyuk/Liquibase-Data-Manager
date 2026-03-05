import { useEffect, useRef } from "react";
import { CircleAlert, Loader2, TriangleAlert } from "lucide-react";
import { GENERIC_TYPE_OPTIONS } from "../../lib/type-spec";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export function AppDialogs({
  unsavedSchemaOpen,
  onUnsavedSchemaOpenChange,
  columnModalOpen,
  onColumnModalOpenChange,
  newCol,
  onNewColChange,
  onConfirmAddColumn,
  validationOpen,
  onValidationOpenChange,
  validation,
  onValidationNavigate,
  actionDialogOpen,
  onActionDialogOpenChange,
  actionLogs,
  onClearActionLogs,
  errorDialogOpen,
  onErrorDialogOpenChange,
  errorLogs,
  onClearErrorLogs,
  openingWorkspace,
  openProgress,
  savingAll,
  saveProgress,
  onCancelOpenWorkspace
}) {
  const latestError = errorLogs?.[0];
  const latestErrorRef = useRef(null);
  const activeProgress = openingWorkspace ? openProgress : savingAll ? saveProgress : { current: 0, total: 0 };
  const progressPercent = (() => {
    const total = Number(activeProgress?.total || 0);
    const current = Number(activeProgress?.current || 0);
    if (total <= 0) return 0;
    const raw = (current / total) * 100;
    const clamped = Math.max(0, Math.min(100, raw));
    if (current > 0 && clamped < 1) return 1;
    return clamped;
  })();

  useEffect(() => {
    if (!errorDialogOpen) return;
    if (!latestErrorRef.current) return;
    latestErrorRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    latestErrorRef.current.focus();
  }, [errorDialogOpen, errorLogs]);

  const bugReportText = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      latest: latestError || null,
      logs: errorLogs || []
    },
    null,
    2
  );
  const parseValidationTarget = (line) => {
    const text = String(line || "");
    const tableMatch = text.match(/(?:childTable|table)=([A-Za-z0-9_]+)/);
    const rowMatch = text.match(/row=(\d+)/);
    if (!tableMatch || !rowMatch) return null;
    const row = Number.parseInt(rowMatch[1], 10);
    if (!Number.isFinite(row) || row < 1) return null;
    return { table: tableMatch[1], row };
  };

  return (
    <>
      {(openingWorkspace || savingAll) && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35">
          <div className="w-[min(560px,92vw)] rounded-lg border bg-background p-4 shadow-xl">
            <div className="mb-2 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <p className="text-sm font-medium">{openingWorkspace ? "워크스페이스 로딩 중..." : "전체 저장 중..."}</p>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              step: {activeProgress?.step || "-"} {activeProgress?.message ? ` / ${activeProgress.message}` : ""}
            </p>
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{
                  width: activeProgress?.total > 0 ? `${progressPercent.toFixed(2)}%` : "45%"
                }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {activeProgress?.current || 0} / {activeProgress?.total || 0}
              </span>
              {activeProgress?.total > 0 && <span>{progressPercent.toFixed(1)}%</span>}
              {openingWorkspace && (
                <Button variant="destructive" size="sm" onClick={onCancelOpenWorkspace}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <Dialog open={unsavedSchemaOpen} onOpenChange={onUnsavedSchemaOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>저장 차단</DialogTitle>
          </DialogHeader>
          <p className="text-sm">테이블 정보(Structure Editor) 변경 사항이 저장되지 않았습니다. 먼저 `Save All`을 실행한 뒤 다시 시도하세요.</p>
          <DialogFooter>
            <Button onClick={() => onUnsavedSchemaOpenChange(false)}>확인</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={columnModalOpen} onOpenChange={onColumnModalOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Column</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="name" value={newCol.name} onChange={(e) => onNewColChange({ ...newCol, name: e.target.value })} />
            <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={newCol.baseType || "STRING"} onChange={(e) => {
                const baseType = e.target.value;
                const base = { ...newCol, baseType };
                if (baseType === "STRING" && !base.length) base.length = "255";
                if (baseType === "BINARY" && !base.length) base.length = "16";
                if (baseType === "DECIMAL") {
                  if (!base.precision) base.precision = "18";
                  if (!base.scale) base.scale = "2";
                }
                onNewColChange(base);
              }}>
                {GENERIC_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
              <div className="min-w-0">
                {(newCol.baseType === "STRING" || newCol.baseType === "BINARY") && (
                  <Input placeholder="length" value={newCol.length || ""} onChange={(e) => onNewColChange({ ...newCol, length: e.target.value })} />
                )}
                {newCol.baseType === "DECIMAL" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="precision" value={newCol.precision || ""} onChange={(e) => onNewColChange({ ...newCol, precision: e.target.value })} />
                    <Input placeholder="scale" value={newCol.scale || ""} onChange={(e) => onNewColChange({ ...newCol, scale: e.target.value })} />
                  </div>
                )}
              </div>
            </div>
            <Input placeholder="default value" value={newCol.defaultValue} onChange={(e) => onNewColChange({ ...newCol, defaultValue: e.target.value })} />
            <Input placeholder="pk order" value={newCol.pkOrder} onChange={(e) => onNewColChange({ ...newCol, pkOrder: e.target.value })} />
          </div>
          <Label className="flex items-center gap-2">
            <Checkbox checked={newCol.nullable} onCheckedChange={(v) => onNewColChange({ ...newCol, nullable: !!v })} /> Nullable
          </Label>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onColumnModalOpenChange(false)}>
              취소
            </Button>
            <Button onClick={onConfirmAddColumn}>추가</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={validationOpen} onOpenChange={onValidationOpenChange}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Validation Result</DialogTitle>
          </DialogHeader>
          <div className="grid max-h-[62vh] grid-cols-2 gap-3 overflow-hidden text-sm">
            <div className="flex min-h-0 flex-col rounded-lg border border-red-300/70 bg-red-50/50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-red-700">
                  <CircleAlert className="h-5 w-5" />
                  <span className="font-semibold">Errors</span>
                </div>
                <span className="rounded-md bg-red-600 px-2 py-1 text-xs font-bold text-white">{validation?.errors?.length || 0}</span>
              </div>
              <div className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
                {(validation?.errors || []).length === 0 ? (
                  <p className="text-red-700/80">none</p>
                ) : (
                  validation.errors.map((e) => (
                    (() => {
                      const target = parseValidationTarget(e);
                      if (!target || !onValidationNavigate) {
                        return (
                          <p key={`e-${e}`} className="rounded border border-red-200 bg-white px-2 py-1">
                            - {e}
                          </p>
                        );
                      }
                      return (
                        <button
                          key={`e-${e}`}
                          type="button"
                          className="block w-full rounded border border-red-200 bg-white px-2 py-1 text-left hover:bg-red-50"
                          onClick={() => onValidationNavigate(target)}
                          title={`${target.table} row ${target.row} 로 이동`}
                        >
                          - {e}
                        </button>
                      );
                    })()
                  ))
                )}
              </div>
            </div>
            <div className="flex min-h-0 flex-col rounded-lg border border-amber-300/70 bg-amber-50/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-700">
                  <TriangleAlert className="h-5 w-5" />
                  <span className="font-semibold">Warnings</span>
                </div>
                <span className="rounded-md bg-amber-500 px-2 py-1 text-xs font-bold text-white">{validation?.warnings?.length || 0}</span>
              </div>
              <div className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
                {(validation?.warnings || []).length === 0 ? (
                  <p className="text-amber-700/80">none</p>
                ) : (
                  validation.warnings.map((w) => (
                    <p key={`w-${w}`} className="rounded border border-amber-200 bg-white px-2 py-1">
                      - {w}
                    </p>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => onValidationOpenChange(false)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={actionDialogOpen} onOpenChange={onActionDialogOpenChange}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Action Log</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-2 overflow-auto text-xs">
            {(!actionLogs || actionLogs.length === 0) && <p className="text-muted-foreground">no actions</p>}
            {(actionLogs || []).map((log, idx) => (
              <div key={`${log.timestamp}-${idx}`} className="rounded border bg-muted/20 p-2">
                <p>
                  <b>time:</b> {log.timestamp}
                </p>
                <p>
                  <b>context:</b> {log.context || "-"}
                </p>
                <p>
                  <b>message:</b> {log.message}
                </p>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={onClearActionLogs}>
              Clear Logs
            </Button>
            <Button onClick={() => onActionDialogOpenChange(false)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={errorDialogOpen} onOpenChange={onErrorDialogOpenChange}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Error Log</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-3 overflow-auto text-xs">
            {(!errorLogs || errorLogs.length === 0) && <p className="text-muted-foreground">no errors</p>}
            {(errorLogs || []).map((log, idx) => (
              <div
                key={`${log.timestamp}-${idx}`}
                ref={idx === 0 ? latestErrorRef : null}
                tabIndex={idx === 0 ? -1 : undefined}
                className={`rounded border bg-muted/20 p-2 outline-none ${idx === 0 ? "border-red-500 ring-2 ring-red-300/70" : ""}`}
              >
                {idx === 0 && <p className="mb-1 text-[10px] font-semibold text-red-500">CURRENT</p>}
                <p>
                  <b>time:</b> {log.timestamp}
                </p>
                <p>
                  <b>context:</b> {log.context || "-"}
                </p>
                <p>
                  <b>message:</b> {log.message}
                </p>
                {log.stack ? (
                  <pre className="mt-2 overflow-auto rounded border bg-background p-2 whitespace-pre-wrap break-all">{log.stack}</pre>
                ) : null}
                {log.raw ? (
                  <pre className="mt-2 overflow-auto rounded border bg-background p-2 whitespace-pre-wrap break-all">{log.raw}</pre>
                ) : null}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(bugReportText);
                } catch {
                  // ignore clipboard errors
                }
              }}
            >
              Copy Bug Report
            </Button>
            <Button variant="secondary" onClick={onClearErrorLogs}>
              Clear Logs
            </Button>
            <Button onClick={() => onErrorDialogOpenChange(false)}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
