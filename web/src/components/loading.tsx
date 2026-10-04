import { useEffect, useState, type ReactNode } from "react";

/**
 * Most loads here finish in a few tens of milliseconds, so showing a spinner
 * immediately produced a flash of "Loading" that appeared and vanished — worse
 * than showing nothing at all.
 *
 * Nothing renders for the first `delayMs`. Past that the load is slow enough
 * that a person has noticed, and the placeholder is reassurance rather than
 * noise.
 */
export function Deferred({
  delayMs = 300,
  children,
}: {
  delayMs?: number;
  children: ReactNode;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setShow(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  return show ? <>{children}</> : null;
}
