import { Bug, File, FolderOpen, ListChecks, Loader2, Moon, ShieldCheck, Sun, X } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";

export function AppHeader({
  theme,
  onThemeChange,
  workspacePath,
  changelogPath,
  onWorkspacePathChange,
  onChangelogPathChange,
  onPickWorkspace,
  onPickChangelog,
  onOpenWorkspace,
  onSaveAll,
  onCancelOpenWorkspace,
  onValidate,
  message,
  error,
  onErrorClick,
  workspaceOpened,
  onClearMessage,
  onClearError,
  onOpenActionLog,
  onOpenErrorLog,
  openingWorkspace,
  savingAll
}) {
  const busy = openingWorkspace || savingAll;
  return (
    <Card className="rounded-none border-x-0 border-t-0 bg-slate-100/80 dark:bg-slate-900/70 backdrop-blur">
      <CardHeader className="py-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Data Manager</CardTitle>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" title="Action Logs" aria-label="Action Logs" onClick={onOpenActionLog}>
              <ListChecks className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" title="Error Logs" aria-label="Error Logs" onClick={onOpenErrorLog}>
              <Bug className="h-4 w-4" />
            </Button>
            <Sun className="h-4 w-4" />
            <Switch checked={theme === "dark"} onCheckedChange={onThemeChange} />
            <Moon className="h-4 w-4" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_110px_110px_40px] items-end gap-2">
          <div className="grid grid-cols-[minmax(0,1fr)_40px] items-end gap-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Data</Label>
              <Input value={workspacePath} onChange={(e) => onWorkspacePathChange(e.target.value)} placeholder="CSV root directory" disabled={busy} />
            </div>
            <Button className="h-9" variant="outline" size="icon" onClick={onPickWorkspace} disabled={busy}>
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_40px] items-end gap-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Changelog</Label>
              <Input value={changelogPath} onChange={(e) => onChangelogPathChange(e.target.value)} placeholder="Changelog path" disabled={busy} />
            </div>
            <Button className="h-9" variant="outline" size="icon" onClick={onPickChangelog} disabled={busy}>
              <File className="h-4 w-4" />
            </Button>
          </div>
          {openingWorkspace ? (
            <Button className="h-9" variant="destructive" onClick={onCancelOpenWorkspace}>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              Cancel
            </Button>
          ) : (
            <Button className="h-9" onClick={onOpenWorkspace} disabled={savingAll}>Open</Button>
          )}
          <Button className="h-9" variant="secondary" onClick={onSaveAll} disabled={!workspaceOpened || busy}>
            Save All
          </Button>
          <Button className="h-9" variant="outline" size="icon" onClick={onValidate} disabled={!workspaceOpened || busy}>
            <ShieldCheck className="h-4 w-4" />
          </Button>
        </div>
        {message && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-sm text-emerald-500">{message}</p>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClearMessage} aria-label="Clear message" title="Clear message">
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
        {error && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <button type="button" onClick={onErrorClick} className="text-left text-sm text-red-500 underline-offset-2 hover:underline">
              {error}
            </button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-red-500 hover:text-red-500"
              onClick={onClearError}
              aria-label="Clear error"
              title="Clear error"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
