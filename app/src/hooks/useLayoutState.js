import { useEffect, useState } from "react";

/**
 * UI layout/splitter state.
 * @returns {{
 *  navPanelWidth: number,
 *  navCollapsed: boolean,
 *  setNavCollapsed: import("react").Dispatch<import("react").SetStateAction<boolean>>,
 *  setResizingNav: import("react").Dispatch<import("react").SetStateAction<boolean>>,
 *  rightPanelWidth: number,
 *  rightCollapsed: boolean,
 *  setRightCollapsed: import("react").Dispatch<import("react").SetStateAction<boolean>>,
 *  setResizingRight: import("react").Dispatch<import("react").SetStateAction<boolean>>,
 *  sqlPanelHeight: number,
 *  sqlCollapsed: boolean,
 *  setSqlCollapsed: import("react").Dispatch<import("react").SetStateAction<boolean>>,
 *  setResizingSql: import("react").Dispatch<import("react").SetStateAction<boolean>>
 * }}
 */
export function useLayoutState() {
  const [navPanelWidth, setNavPanelWidth] = useState(240);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [resizingNav, setResizingNav] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(560);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [resizingRight, setResizingRight] = useState(false);
  const [sqlPanelHeight, setSqlPanelHeight] = useState(220);
  const [sqlCollapsed, setSqlCollapsed] = useState(false);
  const [resizingSql, setResizingSql] = useState(false);

  useEffect(() => {
    const active = resizingNav || resizingRight || resizingSql;
    if (typeof document === "undefined") return;
    const cls = "dm-resizing";
    if (active) document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [resizingNav, resizingRight, resizingSql]);

  useEffect(() => {
    if (!resizingNav) return;
    const onMove = (e) => setNavPanelWidth(Math.max(180, Math.min(420, e.clientX)));
    const onUp = () => setResizingNav(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizingNav]);

  useEffect(() => {
    if (!resizingRight) return;
    const onMove = (e) => setRightPanelWidth(Math.max(380, Math.min(980, window.innerWidth - e.clientX)));
    const onUp = () => setResizingRight(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizingRight]);

  useEffect(() => {
    if (!resizingSql) return;
    const onMove = (e) => setSqlPanelHeight((prev) => Math.max(140, Math.min(420, prev - e.movementY)));
    const onUp = () => setResizingSql(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizingSql]);

  return {
    navPanelWidth,
    navCollapsed,
    setNavCollapsed,
    setResizingNav,
    rightPanelWidth,
    rightCollapsed,
    setRightCollapsed,
    setResizingRight,
    sqlPanelHeight,
    sqlCollapsed,
    setSqlCollapsed,
    setResizingSql
  };
}
