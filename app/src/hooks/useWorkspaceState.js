import { useState } from "react";
import { api } from "../api";
import { useEffect } from "react";
import { toErrorDetail } from "../lib/app-utils";

const WORKSPACE_PATH_KEY = "data_manager.workspace_path";
const CHANGELOG_PATH_KEY = "data_manager.changelog_path";

/**
 * Workspace and global message/error state.
 * @returns {{
 *  workspacePath: string,
 *  setWorkspacePath: import("react").Dispatch<import("react").SetStateAction<string>>,
 *  changelogPath: string,
 *  setChangelogPath: import("react").Dispatch<import("react").SetStateAction<string>>,
 *  tables: Array<{tableName: string, rowCount: number}>,
 *  selectedTable: string,
 *  setSelectedTable: import("react").Dispatch<import("react").SetStateAction<string>>,
 *  schemaMap: Record<string, any>,
 *  setSchemaMap: import("react").Dispatch<import("react").SetStateAction<Record<string, any>>>,
 *  message: string,
 *  setMessage: import("react").Dispatch<import("react").SetStateAction<string>>,
 *  error: string,
 *  setError: import("react").Dispatch<import("react").SetStateAction<string>>,
 *  refreshMeta: (nextSelected?: string) => Promise<void>,
 *  onOpenWorkspace: () => Promise<void>
 * }}
 */
export function useWorkspaceState() {
  const [workspacePath, setWorkspacePath] = useState("");
  const [changelogPath, setChangelogPath] = useState("");
  const [tables, setTables] = useState([]);
  const [sequences, setSequences] = useState({});
  const [functions, setFunctions] = useState({});
  const [procedures, setProcedures] = useState({});
  const [selectedTable, setSelectedTable] = useState("");
  const [schemaMap, setSchemaMap] = useState({});
  const [workspaceOpened, setWorkspaceOpened] = useState(false);
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const [openProgress, setOpenProgress] = useState({ running: false, current: 0, total: 0, step: "", message: "" });
  const [message, setMessageState] = useState("");
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionLogs, setActionLogs] = useState([]);
  const [error, setErrorState] = useState("");
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [errorLogs, setErrorLogs] = useState([]);

  const setMessage = (msg, context = "") => {
    if (!msg) {
      setMessageState("");
      return;
    }
    const entry = { message: String(msg), context, timestamp: new Date().toISOString() };
    setMessageState(entry.message);
    setActionLogs((prev) => [entry, ...prev].slice(0, 500));
  };

  const setError = (err, context = "") => {
    if (!err) {
      setErrorState("");
      return;
    }
    const detail = toErrorDetail(err, context);
    setErrorState(detail.message);
    setErrorLogs((prev) => [detail, ...prev].slice(0, 200));
    setErrorDialogOpen(true);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedWorkspace = window.localStorage.getItem(WORKSPACE_PATH_KEY);
    const savedChangelog = window.localStorage.getItem(CHANGELOG_PATH_KEY);
    if (savedWorkspace) setWorkspacePath(savedWorkspace);
    if (savedChangelog) setChangelogPath(savedChangelog);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (workspacePath) window.localStorage.setItem(WORKSPACE_PATH_KEY, workspacePath);
    else window.localStorage.removeItem(WORKSPACE_PATH_KEY);
  }, [workspacePath]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (changelogPath) window.localStorage.setItem(CHANGELOG_PATH_KEY, changelogPath);
    else window.localStorage.removeItem(CHANGELOG_PATH_KEY);
  }, [changelogPath]);

  const refreshMeta = async (nextSelected = "") => {
    const [tableList, schema, objects] = await Promise.all([api.listTables(), api.getSchema(), api.getWorkspaceObjects().catch(() => ({}))]);
    setTables(tableList);
    setSchemaMap(schema);
    setSequences(objects?.sequences || {});
    setFunctions(objects?.functions || {});
    setProcedures(objects?.procedures || {});
    const available = new Set(Object.keys(schema || {}));
    let target = nextSelected || selectedTable || tableList[0]?.tableName || "";
    if (!available.has(target)) target = tableList[0]?.tableName || Object.keys(schema || {})[0] || "";
    setSelectedTable(target);
  };

  const onOpenWorkspace = async () => {
    if (openingWorkspace) return;
    setError("");
    setMessage("");
    setOpeningWorkspace(true);
    setOpenProgress({ running: true, current: 0, total: 1, step: "starting", message: "request sent" });
    let timer = null;
    try {
      timer = setInterval(async () => {
        try {
          const st = await api.getOpenWorkspaceStatus();
          setOpenProgress({
            running: !!st?.running,
            current: Number(st?.current || 0),
            total: Number(st?.total || 0),
            step: String(st?.step || ""),
            message: String(st?.message || "")
          });
        } catch {
          // ignore polling errors while loading
        }
      }, 150);
      await api.openWorkspace({ path: workspacePath, changelogPath });
      await refreshMeta();
      setWorkspaceOpened(true);
      const formatStatus = await api.getChangelogFormatStatus().catch(() => ({ format: "unknown", migrationNeeded: false }));
      if (formatStatus?.migrationNeeded) {
        setMessage("워크스페이스를 열었습니다. 구버전 changelog가 감지되었습니다. Save All로 최신 포맷으로 변환하세요.", "openWorkspace");
      } else {
        setMessage("워크스페이스를 열었습니다.", "openWorkspace");
      }
    } catch (e) {
      if (String(e?.code || "") === "CANCELED" || /canceled/i.test(String(e?.message || ""))) {
        setMessage("워크스페이스 열기를 취소했습니다.", "openWorkspace");
      } else {
        setError(e, "openWorkspace");
      }
    } finally {
      if (timer) clearInterval(timer);
      setOpeningWorkspace(false);
      try {
        const st = await api.getOpenWorkspaceStatus();
        setOpenProgress({
          running: !!st?.running,
          current: Number(st?.current || 0),
          total: Number(st?.total || 0),
          step: String(st?.step || ""),
          message: String(st?.message || "")
        });
      } catch {
        setOpenProgress({ running: false, current: 0, total: 0, step: "", message: "" });
      }
    }
  };

  const cancelOpenWorkspace = async () => {
    try {
      await api.cancelOpenWorkspace();
    } catch {
      // ignore
    }
  };

  return {
    workspacePath,
    setWorkspacePath,
    changelogPath,
    setChangelogPath,
    tables,
    setTables,
    sequences,
    setSequences,
    functions,
    setFunctions,
    procedures,
    setProcedures,
    workspaceOpened,
    openingWorkspace,
    openProgress,
    cancelOpenWorkspace,
    selectedTable,
    setSelectedTable,
    schemaMap,
    setSchemaMap,
    message,
    setMessage,
    actionDialogOpen,
    setActionDialogOpen,
    actionLogs,
    setActionLogs,
    error,
    setError,
    errorDialogOpen,
    setErrorDialogOpen,
    errorLogs,
    setErrorLogs,
    refreshMeta,
    onOpenWorkspace
  };
}
