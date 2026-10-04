import { useCallback, useEffect, useState } from "react";
import { Menu as MenuIcon } from "lucide-react";
import { api, type Account, type TripSummary } from "./api.ts";
import { AuthScreen } from "./AuthScreen.tsx";
import { InvitePage } from "./InvitePage.tsx";
import { NewTripDialog } from "./NewTripDialog.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { TripDetail } from "./TripDetail.tsx";
import { TripsHome } from "./TripsHome.tsx";
import { navigate, usePath } from "./routing.ts";
import { Button } from "@/ui/button.tsx";
import { Sheet } from "@/components/sheet.tsx";

export function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [checked, setChecked] = useState(false);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [newTripOpen, setNewTripOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const path = usePath();

  const loadTrips = useCallback(() => {
    api
      .trips()
      .then(setTrips)
      .catch(() => setTrips([]));
  }, []);

  useEffect(() => {
    // A 401 here is the ordinary signed-out case, not an error to surface.
    api
      .me()
      .then((me) => {
        setAccount(me);
        loadTrips();
      })
      .catch(() => setAccount(null))
      .finally(() => setChecked(true));
  }, [loadTrips]);

  const inviteToken = path.startsWith("/invite/") ? path.slice("/invite/".length) : null;
  const tripId = path.startsWith("/trips/") ? path.slice("/trips/".length) : null;

  // An invite is readable before signing in, so it is routed ahead of the
  // auth gate and outside the shell.
  if (inviteToken !== null) {
    return <InvitePage token={inviteToken} signedIn={account !== null} />;
  }

  if (!checked) {
    // Nothing at all until the session check is slow enough to notice.
    return null;
  }

  if (account === null) {
    return (
      <AuthScreen
        onSignedIn={(me) => {
          setAccount(me);
          loadTrips();
        }}
      />
    );
  }

  const signOut = () => {
    void api.logout().then(() => {
      setAccount(null);
      setTrips([]);
      navigate("/");
    });
  };

  const sidebar = (
    <Sidebar
      account={account}
      trips={trips}
      currentTripId={tripId}
      onNewTrip={() => setNewTripOpen(true)}
      onSignOut={signOut}
      onNavigate={() => setNavOpen(false)}
    />
  );

  return (
    <div className="md:grid md:min-h-dvh md:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r border-border md:block">{sidebar}</aside>

      <Sheet open={navOpen} onOpenChange={setNavOpen} title="Trips">
        {sidebar}
      </Sheet>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/85 px-3 py-2 backdrop-blur md:hidden">
          <Button variant="ghost" size="icon" aria-label="Trips" onClick={() => setNavOpen(true)}>
            <MenuIcon />
          </Button>
          <span className="font-serif text-base text-foreground">TripTrack</span>
        </header>

        <main className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8 md:py-10">
          {tripId !== null ? (
            <TripDetail tripId={tripId} onTripChanged={loadTrips} />
          ) : (
            <TripsHome trips={trips} onNewTrip={() => setNewTripOpen(true)} />
          )}
        </main>
      </div>

      <NewTripDialog
        open={newTripOpen}
        onOpenChange={setNewTripOpen}
        onCreated={(trip) => {
          loadTrips();
          navigate(`/trips/${trip.id}`);
        }}
      />
    </div>
  );
}
