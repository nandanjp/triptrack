import { useEffect, useState } from "react";
import { api, type InvitePreview } from "./api.ts";
import { navigate } from "./routing.ts";

const EXPLANATION: Record<InvitePreview["state"], string> = {
  valid: "",
  revoked: "This invite has been revoked by the trip owner.",
  claimed: "This invite has already been used.",
  expired: "This invite has expired. Ask the trip owner for a new one.",
};

export function InvitePage({ token }: { token: string }) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .previewInvite(token)
      .then(setPreview)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [token]);

  if (error !== null) return <p style={{ color: "#b00" }}>{error}</p>;
  if (preview === null) return <p>…</p>;

  if (preview.state !== "valid") {
    return (
      <section>
        <h2>Invite unavailable</h2>
        <p>{EXPLANATION[preview.state]}</p>
        <button type="button" onClick={() => navigate("/")}>
          Go to TripTrack
        </button>
      </section>
    );
  }

  return (
    <section>
      <h2>Join {preview.tripName}</h2>
      <p>
        You've been invited as <strong>{preview.seatName}</strong>.
      </p>

      {preview.signedIn ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            api
              .acceptInvite(token)
              .then(({ tripId }) => navigate(`/trips/${tripId}`))
              .catch((e: unknown) => {
                setError(e instanceof Error ? e.message : String(e));
                setBusy(false);
              });
          }}
        >
          {busy ? "…" : `Join as ${preview.seatName}`}
        </button>
      ) : (
        <>
          {/* The invite survives sign-in: this path is still here afterwards. */}
          <p style={{ color: "#666" }}>Sign in or create an account to accept.</p>
          <button type="button" onClick={() => navigate("/")}>
            Sign in
          </button>
        </>
      )}
    </section>
  );
}
