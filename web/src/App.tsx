import { useEffect, useState } from "react";
import { api, type Account } from "./api.ts";
import { AuthForm } from "./AuthForm.tsx";

type Health = { status: string; version: string };

export function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    fetch("/health")
      .then((r) => (r.ok ? r.json() : null))
      .then(setHealth)
      .catch(() => setHealth(null));

    // A 401 here is the normal signed-out case, not an error worth surfacing.
    api
      .me()
      .then(setAccount)
      .catch(() => setAccount(null))
      .finally(() => setChecked(true));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", lineHeight: 1.6 }}>
      <h1 style={{ margin: 0 }}>TripTrack</h1>
      <p style={{ color: "#555", marginTop: ".25rem" }}>
        Plan a trip, live it and log it in one place.
      </p>

      {!checked ? (
        <p>…</p>
      ) : account === null ? (
        <AuthForm onSignedIn={setAccount} />
      ) : (
        <>
          <p>
            Signed in as <strong>{account.email}</strong>.
          </p>
          <button
            type="button"
            onClick={() => {
              void api.logout().then(() => setAccount(null));
            }}
          >
            Sign out
          </button>
          <p style={{ color: "#666" }}>Trips arrive in step 3.</p>
        </>
      )}

      <hr style={{ margin: "2rem 0 1rem", border: 0, borderTop: "1px solid #ddd" }} />
      <small style={{ color: "#888" }}>
        {health === null ? "health unavailable" : `${health.status} · build ${health.version}`}
      </small>
    </main>
  );
}
