import { Map, Plus } from "lucide-react";
import { api, type Account, type TripSummary } from "./api.ts";
import { navigate } from "./routing.ts";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/ui/button.tsx";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/ui/menu.tsx";
import { ThemeToggle } from "@/ui/theme-toggle.tsx";

/** Short form, because the sidebar is narrow: "12 Apr" beats "2027-04-12". */
const shortDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const range = (trip: TripSummary): string => {
  if (trip.startDate === null) return "No dates";
  return trip.endDate === null
    ? shortDate(trip.startDate)
    : `${shortDate(trip.startDate)} – ${shortDate(trip.endDate)}`;
};

export function Sidebar({
  account,
  trips,
  currentTripId,
  onNewTrip,
  onSignOut,
  onNavigate,
}: {
  account: Account;
  trips: TripSummary[];
  currentTripId: string | null;
  onNewTrip: () => void;
  onSignOut: () => void;
  onNavigate?: () => void;
}) {
  const go = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

  return (
    <div className="flex h-full flex-col bg-sunken">
      <div className="px-4 pt-4 pb-3">
        <button
          type="button"
          onClick={() => go("/")}
          className="font-serif text-lg text-ink transition-opacity hover:opacity-70"
        >
          TripTrack
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2">
        {trips.length === 0 ? (
          <p className="px-2 py-1 text-sm text-subtle">No trips yet</p>
        ) : (
          <ul className="grid gap-0.5">
            {trips.map((trip) => {
              const active = trip.id === currentTripId;
              return (
                <li key={trip.id}>
                  <button
                    type="button"
                    onClick={() => go(`/trips/${trip.id}`)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                      active ? "bg-raised font-medium text-ink shadow-sm" : "text-muted hover:bg-raised/60 hover:text-ink",
                    )}
                  >
                    <Map className={cn("size-4 shrink-0", active ? "text-accent" : "text-subtle")} />
                    <span className="min-w-0 flex-1 truncate">{trip.name}</span>
                    <span className="numeric shrink-0 text-xs text-subtle">{range(trip)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="mt-1 w-full justify-start"
          onClick={() => {
            onNewTrip();
            onNavigate?.();
          }}
        >
          <Plus />
          New trip
        </Button>
      </nav>

      <footer className="flex items-center gap-1 border-t border-line px-2 py-2">
        <Menu
          trigger={
            <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start font-normal">
              <span className="truncate">{account.email}</span>
            </Button>
          }
        >
          <MenuLabel>{account.email}</MenuLabel>
          <MenuSeparator />
          <MenuItem onSelect={onSignOut} tone="danger">
            Sign out
          </MenuItem>
        </Menu>
        <ThemeToggle />
      </footer>
    </div>
  );
}
