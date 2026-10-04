import { ArrowRight, Plus } from "lucide-react";
import type { TripSummary } from "./api.ts";
import { navigate } from "./routing.ts";
import { Button } from "@/ui/button.tsx";
import { Badge } from "@/ui/badge.tsx";

const longDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const range = (trip: TripSummary): string => {
  if (trip.startDate === null) return "No dates yet";
  if (trip.endDate === null) return longDate(trip.startDate);
  return `${longDate(trip.startDate)} – ${longDate(trip.endDate)}`;
};

const nights = (trip: TripSummary): string | null => {
  if (trip.startDate === null || trip.endDate === null) return null;
  const count = Math.round(
    (new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime()) / 86_400_000,
  );
  return count <= 0 ? null : `${count} ${count === 1 ? "night" : "nights"}`;
};

export function TripsHome({
  trips,
  onNewTrip,
}: {
  trips: TripSummary[];
  onNewTrip: () => void;
}) {
  if (trips.length === 0) {
    return (
      <div className="max-w-prose">
        <h1 className="font-serif text-3xl text-foreground">Start a trip</h1>
        <p className="mt-2 text-muted-foreground">
          Name somewhere you are going, then build it up day by day. The plan becomes the record
          as you go, so there is nothing to write up afterwards.
        </p>
        <Button variant="default" size="lg" className="mt-6" onClick={onNewTrip}>
          <Plus />
          New trip
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-serif text-3xl text-foreground">Trips</h1>
      <p className="mt-1 text-muted-foreground">Soonest first. Past trips follow, then the undated ones.</p>

      <ul className="mt-7 grid gap-px overflow-hidden rounded-lg border border-border bg-border">
        {trips.map((trip) => (
          <li key={trip.id}>
            <button
              type="button"
              onClick={() => navigate(`/trips/${trip.id}`)}
              className="group flex w-full items-center gap-4 bg-card px-4 py-3.5 text-left transition-colors hover:bg-accent"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">{trip.name}</span>
                <span className="numeric mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                  <span>{range(trip)}</span>
                  {nights(trip) !== null && <span>{nights(trip)}</span>}
                </span>
              </span>

              {trip.status !== "planning" && <Badge variant="secondary">{trip.status}</Badge>}
              {trip.role === "owner" && <Badge variant="default">owner</Badge>}

              <ArrowRight className="size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
