import { useEffect, useState } from "react";
import { Ban, Check, Circle, CornerDownRight } from "lucide-react";
import { cn } from "cn";
import { api, type SharedEntry, type SharedTrip as Shared } from "./api.ts";
import { Deferred } from "@/components/loading.tsx";
import { Badge } from "@/ui/badge.tsx";
import { Skeleton } from "@/ui/skeleton.tsx";

const STATUS_ICON = {
  planned: Circle,
  done: Check,
  skipped: CornerDownRight,
  cancelled: Ban,
} as const;

const weekday = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const longDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/**
 * A trip as anyone holding the link sees it. Read-only, and deliberately
 * money-free: no expenses, balances, bookings or people travel with the link.
 */
export function SharedTrip({ token }: { token: string }) {
  const [trip, setTrip] = useState<Shared | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .sharedTrip(token)
      .then(setTrip)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [token]);

  if (error !== null) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-prose place-items-center px-4">
        <div>
          <h1 className="font-serif text-2xl">This itinerary is not available</h1>
          <p className="mt-2 text-muted-foreground">
            The link may have been turned off, or it was never quite right. Ask whoever sent it
            for a new one.
          </p>
        </div>
      </main>
    );
  }

  if (trip === null) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <Deferred>
          <div className="grid gap-4" aria-busy="true">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="mt-4 h-40 w-full" />
          </div>
        </Deferred>
      </main>
    );
  }

  const dates =
    trip.startDate === null
      ? null
      : trip.endDate === null
        ? longDate(trip.startDate)
        : `${longDate(trip.startDate)} – ${longDate(trip.endDate)}`;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 md:px-8">
      <header>
        <h1 className="font-serif text-3xl break-words">{trip.name}</h1>
        <p className="numeric mt-1 flex flex-wrap items-center gap-x-4 text-muted-foreground">
          {dates !== null && <span>{dates}</span>}
          {trip.areas.map((area) => (
            <span key={area.name}>{area.name}</span>
          ))}
        </p>
      </header>

      {trip.days.length === 0 ? (
        <p className="mt-8 text-muted-foreground">Nothing planned yet.</p>
      ) : (
        <ol className="mt-9 grid">
          {trip.days.map((day, index) => (
            <li
              key={day.dayNumber}
              className="relative grid grid-cols-[2rem_1fr] gap-x-4 pb-7"
            >
              {index < trip.days.length - 1 && (
                <span className="absolute top-8 bottom-0 left-4 -ml-px w-px bg-border" aria-hidden />
              )}

              <span className="numeric z-10 grid size-8 place-items-center self-start rounded-full border bg-card text-sm text-muted-foreground">
                {day.dayNumber}
              </span>

              <div className="min-w-0 pt-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <h2 className="numeric font-medium">
                    {day.date === null ? `Day ${day.dayNumber}` : weekday(day.date)}
                  </h2>
                  {day.locations.length > 0 && (
                    <span className="text-sm text-muted-foreground">
                      {day.locations.join(" → ")}
                    </span>
                  )}
                </div>

                {day.notes !== null && day.notes !== "" && (
                  <p className="mt-1 max-w-prose text-sm text-muted-foreground">{day.notes}</p>
                )}

                {day.entries.length === 0 ? (
                  <p className="mt-2 text-sm text-subtle">Nothing planned</p>
                ) : (
                  <ul className="mt-2.5 grid gap-1">
                    {day.entries.map((entry, i) => (
                      <SharedEntryRow key={i} entry={entry} />
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      <footer className="mt-6 border-t pt-5 text-sm text-muted-foreground">
        Shared from <span className="font-serif text-foreground">TripTrack</span>. This is a
        read-only copy of the itinerary — costs and who is going are not part of it.
      </footer>
    </main>
  );
}

function SharedEntryRow({ entry }: { entry: SharedEntry }) {
  const Icon = STATUS_ICON[entry.status];
  const struck = entry.status === "skipped" || entry.status === "cancelled";

  return (
    <li className="flex items-baseline gap-2">
      <Icon
        className={cn(
          "mt-0.5 size-3.5 shrink-0",
          entry.status === "done" ? "text-primary" : "text-subtle",
        )}
        strokeWidth={entry.status === "done" ? 3 : 2}
      />
      <span className="numeric w-11 shrink-0 text-sm text-muted-foreground">
        {entry.startsAt?.slice(0, 5) ?? ""}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn(struck && "text-subtle line-through")}>{entry.title}</span>
        {entry.placeName !== null && (
          <span className="ml-2 text-sm text-muted-foreground">{entry.placeName}</span>
        )}
        {entry.replaced && (
          <Badge variant="outline" className="ml-2 text-caution">
            replaced
          </Badge>
        )}
      </span>
    </li>
  );
}
