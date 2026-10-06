import { useState } from "react";

export function useCollapsedMenu(key: string) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(key) === "true"; } catch { return false; }
  });
  const toggle = () => setCollapsed((previous) => {
    const next = !previous;
    try { localStorage.setItem(key, String(next)); } catch { /* Storage may be disabled. */ }
    return next;
  });
  return { collapsed, toggle };
}
