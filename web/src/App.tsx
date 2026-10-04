import { useEffect, useState } from "react";

type Health = { status: string; version: string };

/**
 * The walking skeleton's only job: show which build is being served, so a
 * deploy is observable from the browser as well as from curl.
 */
export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/health")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setHealth)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", lineHeight: 1.6 }}>
      <h1 style={{ margin: 0 }}>TripTrack</h1>
      <p style={{ color: "#555", marginTop: ".25rem" }}>
        Plan a trip, live it and log it in one place.
      </p>
      <p>
        {error !== null
          ? `health check failed: ${error}`
          : health === null
            ? "checking…"
            : `${health.status} · build ${health.version}`}
      </p>
    </main>
  );
}
