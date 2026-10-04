import { useEffect, useState } from "react";
import { api, type InvitePreview } from "./api.ts";
import { navigate } from "./routing.ts";
import { Button } from "@/ui/button.tsx";

const UNAVAILABLE: Record<Exclude<InvitePreview["state"], "valid">, string> = {
  revoked: "The trip owner has revoked this invite. Ask them for a new link.",
  claimed: "This invite has already been used. If that was you, sign in instead.",
  expired: "This invite has expired. Ask the trip owner for a new link.",
};

export function InvitePage({ token, signedIn }: { token: string; signedIn: boolean }) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .previewInvite(token)
      .then(setPreview)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [token]);

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="font-serif text-lg text-muted-foreground">TripTrack</p>

        {error !== null ? (
          <>
            <h1 className="mt-2 font-serif text-2xl text-foreground">This invite is not available</h1>
            <p className="mt-2 text-muted-foreground">{error}</p>
          </>
        ) : preview === null ? (
          <div className="mt-4" />
        ) : preview.state !== "valid" ? (
          <>
            <h1 className="mt-2 font-serif text-2xl text-foreground">This invite is not available</h1>
            <p className="mt-2 text-muted-foreground">{UNAVAILABLE[preview.state]}</p>
            <Button variant="outline" className="mt-6" onClick={() => navigate("/")}>
              Go to TripTrack
            </Button>
          </>
        ) : (
          <>
            <h1 className="mt-2 font-serif text-3xl text-foreground">Join {preview.tripName}</h1>
            <p className="mt-2 text-muted-foreground">
              You have been invited as <span className="text-foreground">{preview.seatName}</span>. You
              will be able to see the itinerary and add to the shared costs.
            </p>

            {signedIn || preview.signedIn ? (
              <Button
                variant="default"
                size="lg"
                className="mt-6"
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
                {busy ? "Joining" : `Join as ${preview.seatName}`}
              </Button>
            ) : (
              <>
                <Button variant="default" size="lg" className="mt-6" onClick={() => navigate("/")}>
                  Sign in to join
                </Button>
                {/* The link survives sign-in: this path is still here afterwards. */}
                <p className="mt-3 text-sm text-muted-foreground">
                  Come back to this link once you are signed in and the invite will still be here.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
