import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import { api, type TripDetail as Trip } from "./api.ts";
import { Bookings } from "./Bookings.tsx";
import { Expenses } from "./Expenses.tsx";
import { Itinerary } from "./Itinerary.tsx";
import { People } from "./People.tsx";
import { Settlement } from "./Settlement.tsx";
import { navigate } from "./routing.ts";
import { Badge } from "@/ui/badge.tsx";
import { Button } from "@/ui/button.tsx";
import { Menu, MenuItem } from "@/ui/menu.tsx";
import { Tab, TabList, TabPanel, Tabs } from "@/ui/tabs.tsx";

const longDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export function TripDetail({ tripId, onTripChanged }: { tripId: string; onTripChanged: () => void }) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped when a change in one tab alters what another one shows. */
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const load = useCallback(() => {
    api
      .trip(tripId)
      .then(setTrip)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [tripId]);

  useEffect(load, [load, version]);

  if (error !== null && trip === null) {
    return (
      <div className="max-w-prose">
        <h1 className="font-serif text-2xl text-ink">This trip is not available</h1>
        <p className="mt-2 text-muted">{error}</p>
        <Button className="mt-5" onClick={() => navigate("/")}>
          <ChevronLeft />
          All trips
        </Button>
      </div>
    );
  }

  if (trip === null) return <p className="text-sm text-subtle">Loading</p>;

  const isOwner = trip.role === "owner";
  const dates =
    trip.startDate === null
      ? "No dates yet"
      : trip.endDate === null
        ? longDate(trip.startDate)
        : `${longDate(trip.startDate)} – ${longDate(trip.endDate)}`;

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl break-words text-ink">{trip.name}</h1>
          <p className="numeric mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
            <span>{dates}</span>
            <span>{trip.homeCurrency}</span>
            {trip.status !== "planning" && <Badge>{trip.status}</Badge>}
          </p>
        </div>

        {isOwner && (
          <Menu
            trigger={
              <Button variant="ghost" size="icon" aria-label="Trip options">
                <MoreHorizontal />
              </Button>
            }
          >
            <MenuItem
              tone="danger"
              onSelect={() => {
                void api.deleteTrip(trip.id).then(() => {
                  onTripChanged();
                  navigate("/");
                });
              }}
            >
              Delete trip
            </MenuItem>
          </Menu>
        )}
      </div>

      <Tabs defaultValue="days" className="mt-7">
        <TabList>
          <Tab value="days">Days</Tab>
          <Tab value="bookings">Bookings</Tab>
          <Tab value="money">Money</Tab>
          <Tab value="people">People</Tab>
        </TabList>

        <TabPanel value="days">
          <Itinerary
            tripId={trip.id}
            participants={trip.participants}
            version={version}
            onChange={bump}
          />
        </TabPanel>

        <TabPanel value="bookings">
          <Bookings tripId={trip.id} version={version} onChange={bump} />
        </TabPanel>

        <TabPanel value="money">
          <div className="grid gap-8">
            <Expenses
              tripId={trip.id}
              participants={trip.participants}
              myParticipantId={trip.myParticipantId}
              version={version}
              onChange={bump}
            />
            <Settlement tripId={trip.id} isOwner={isOwner} version={version} onChange={bump} />
          </div>
        </TabPanel>

        <TabPanel value="people">
          <People
            tripId={trip.id}
            participants={trip.participants}
            myParticipantId={trip.myParticipantId}
            isOwner={isOwner}
            onChange={bump}
          />
        </TabPanel>
      </Tabs>
    </div>
  );
}
