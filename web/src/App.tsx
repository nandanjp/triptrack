import { useEffect, useState } from "react";
import { api, type Account } from "./api.ts";
import { AuthForm } from "./AuthForm.tsx";
import { InvitePage } from "./InvitePage.tsx";
import { TripDetail } from "./TripDetail.tsx";
import { TripList } from "./TripList.tsx";
import { navigate, usePath } from "./routing.ts";

type Health = { status: string; version: string };

export function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [checked, setChecked] = useState(false);
  const path = usePath();

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

  const inviteToken = path.startsWith("/invite/") ? path.slice("/invite/".length) : null;
  const tripId = path.startsWith("/trips/") ? path.slice("/trips/".length) : null;

  const body = () => {
    // An invite is readable before signing in, so it is routed first.
    if (inviteToken !== null) return <InvitePage token={inviteToken} />;
    if (!checked) return <p>…</p>;
    if (account === null) return <AuthForm onSignedIn={setAccount} />;
    if (tripId !== null) return <TripDetail tripId={tripId} />;
    return <TripList />;
  };

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "2rem 1rem",
        lineHeight: 1.6,
        maxWidth: "44rem",
        margin: "0 auto",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem" }}>
        <button
          type="button"
          onClick={() => navigate("/")}
          style={{ background: "none", border: "none", font: "inherit", cursor: "pointer", padding: 0, textAlign: "left" }}
        >
          <h1 style={{ margin: 0, fontSize: "1.5rem" }}>TripTrack</h1>
        </button>

        {account !== null && (
          <span style={{ fontSize: ".9em", color: "#555" }}>
            {account.email}{" "}
            <button
              type="button"
              onClick={() => {
                void api.logout().then(() => {
                  setAccount(null);
                  navigate("/");
                });
              }}
              style={{ background: "none", border: "none", color: "#06c", cursor: "pointer" }}
            >
              sign out
            </button>
          </span>
        )}
      </header>

      {body()}

      <hr style={{ margin: "2.5rem 0 1rem", border: 0, borderTop: "1px solid #ddd" }} />
      <small style={{ color: "#888" }}>
        {health === null ? "health unavailable" : `${health.status} · build ${health.version}`}
      </small>
    </main>
  );
}
