import { useEffect, useState } from "react";

/**
 * Three routes do not justify a router dependency. History is driven directly;
 * `navigate` is exported so links and redirects share one path.
 */
export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    window.addEventListener("triptrack:navigate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("triptrack:navigate", onPop);
    };
  }, []);

  return path;
}

export function navigate(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event("triptrack:navigate"));
}
