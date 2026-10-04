import { useEffect, useState } from "react";
import {
  BedDouble,
  Ban,
  CalendarPlus,
  Check,
  Circle,
  CornerDownRight,
  Plane,
  Plus,
  Trash2,
} from "lucide-react";
import {
  api,
  type Booking,
  type Day,
  type Entry,
  type EntryKind,
  type ItineraryLocation,
  type Participant,
} from "./api.ts";
import { cn } from "cn";
import { Badge } from "@/ui/badge.tsx";
import { Button } from "@/ui/button.tsx";
import { LabeledCheckbox } from "@/components/labeled-checkbox.tsx";
import { OptionSelect } from "@/components/option-select.tsx";
import { Input } from "@/ui/input.tsx";
import { Empty, Panel, PanelBody, PanelHeader } from "@/components/section.tsx";
import { ListPlaceholder } from "@/components/placeholders.tsx";

const KIND_LABEL: Record<EntryKind, string> = { activity: "Activity", meal: "Meal", place: "Place" };

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

type Draft = { title: string; kind: EntryKind; startsAt: string };
const emptyDraft: Draft = { title: "", kind: "activity", startsAt: "" };

/** Radix forbids an empty-string option value, so absence needs a name. */
const NOWHERE = "__nowhere__";

export function Itinerary({
  tripId,
  participants,
  version,
  onChange,
}: {
  tripId: string;
  participants: Participant[];
  version: number;
  onChange: () => void;
}) {
  const [days, setDays] = useState<Day[] | null>(null);
  const [locations, setLocations] = useState<ItineraryLocation[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newArea, setNewArea] = useState("");
  const [newDayDate, setNewDayDate] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const load = () => {
    Promise.all([api.days(tripId), api.locations(tripId), api.bookings(tripId)])
      .then(([d, l, b]) => {
        setDays(d);
        setLocations(l);
        setBookings(b);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(load, [tripId, version]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
      onChange();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const draftFor = (dayId: string) => drafts[dayId] ?? emptyDraft;
  const lodgings = bookings.filter((b) => b.kind === "lodging");
  const travel = bookings.filter((b) => b.kind !== "lodging");

  if (days === null) return <ListPlaceholder rows={4} />;

  return (
    <div className="grid gap-7">
      <Panel>
        <PanelHeader
          title="Where"
          description="Rough areas, not addresses. Day counts come from the itinerary, so nothing here commits you to anything."
        />
        <PanelBody className="flex flex-wrap items-center gap-2">
          {locations.map((area) => (
            <span
              key={area.id}
              className="group inline-flex items-center gap-2 rounded-md border border-border bg-accent py-1 pr-1 pl-2.5 text-sm"
            >
              <span className="text-foreground">{area.name}</span>
              <span className="numeric text-xs text-muted-foreground">
                {area.dayCount} {area.dayCount === 1 ? "day" : "days"}
              </span>
              {area.dayCount === 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5 opacity-0 group-hover:opacity-100"
                  aria-label={`Remove ${area.name}`}
                  onClick={() => act(() => api.removeLocation(tripId, area.id))}
                >
                  <Trash2 className="size-3" />
                </Button>
              )}
            </span>
          ))}

          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await api.addLocation(tripId, newArea);
                setNewArea("");
              });
            }}
          >
            <Input
              value={newArea}
              onChange={(e) => setNewArea(e.target.value)}
              placeholder={locations.length === 0 ? "Seoul" : "Add an area"}
              className="h-7 w-32 py-0.5 text-sm"
            />
            <Button type="submit" size="icon" variant="ghost" aria-label="Add area" disabled={newArea.trim() === ""}>
              <Plus />
            </Button>
          </form>
        </PanelBody>
      </Panel>

      <section>
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-medium text-foreground">Day by day</h2>
          {days.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Trip moved?</span>
              <div className="flex overflow-hidden rounded-md border border-border">
                {[
                  { label: "−1w", by: -7 },
                  { label: "−1d", by: -1 },
                  { label: "+1d", by: 1 },
                  { label: "+1w", by: 7 },
                ].map((shift) => (
                  <button
                    key={shift.label}
                    type="button"
                    onClick={() => act(() => api.shiftDays(tripId, shift.by))}
                    className="numeric border-r border-border px-2 py-1 text-xs text-muted-foreground transition-colors last:border-r-0 hover:bg-accent hover:text-foreground"
                  >
                    {shift.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </header>

        {days.length === 0 ? (
          <Panel>
            <Empty
              action={
                <Button variant="default" onClick={() => act(() => api.addDay(tripId, { date: null }))}>
                  <CalendarPlus />
                  Add the first day
                </Button>
              }
            >
              Days are the backbone of a trip. Add one for each day you will be away — a date is
              optional, so an unscheduled trip still gets an itinerary.
            </Empty>
          </Panel>
        ) : (
          <ol className="grid">
            {days.map((day, index) => {
              const draft = draftFor(day.id);
              const last = index === days.length - 1;

              return (
                <li key={day.id} className="group/day relative grid grid-cols-[2rem_1fr] gap-x-4 pb-7">
                  {/* The spine: a continuous rule that stops at the last day. */}
                  {!last && (
                    <span className="absolute top-8 bottom-0 left-4 -ml-px w-px bg-border" aria-hidden />
                  )}

                  <span className="numeric z-10 grid size-8 place-items-center self-start rounded-full border border-border bg-card text-sm text-muted-foreground">
                    {day.dayNumber}
                  </span>

                  <div className="min-w-0 pt-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <h3 className="numeric font-medium text-foreground">
                        {day.date === null ? `Day ${day.dayNumber}` : weekday(day.date)}
                      </h3>
                      <div className="flex items-center gap-1">
                        {day.locations.length > 0 && (
                          <span className="text-sm text-muted-foreground">
                            {day.locations.map((l) => l.name).join(" → ")}
                          </span>
                        )}
                        <div className="flex opacity-0 transition-opacity group-hover/day:opacity-100 focus-within:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Insert a day before this one"
                            title="Insert a day before this one"
                            onClick={() => act(() => api.addDay(tripId, { atDayNumber: day.dayNumber }))}
                          >
                            <Plus />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete day ${day.dayNumber}`}
                            onClick={() => act(() => api.removeDay(tripId, day.id))}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 grid gap-1.5 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <BedDouble className="size-3.5 shrink-0 text-subtle" />
                        <OptionSelect
                          aria-label="Where you sleep tonight"
                          size="sm"
                          className="w-auto min-w-44"
                          value={day.lodging?.id ?? NOWHERE}
                          onValueChange={(value) =>
                            act(() => api.setDayLodging(tripId, day.id, value === NOWHERE ? null : value))
                          }
                          options={[
                            { value: NOWHERE, label: "Nowhere booked" },
                            ...lodgings.map((b) => ({
                              value: b.id,
                              label: b.status === "booked" ? b.title : `${b.title} (${b.status})`,
                            })),
                          ]}
                        />
                      </div>

                      {travel.length > 0 && (
                        <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                          <Plane className="size-3.5 shrink-0 text-subtle" />
                          {travel.map((b) => {
                            const on = day.bookings.some((d) => d.id === b.id);
                            return (
                              <LabeledCheckbox
                                key={b.id}
                                checked={on}
                                onCheckedChange={() =>
                                  act(() =>
                                    api.setDayBookings(
                                      tripId,
                                      day.id,
                                      on
                                        ? day.bookings.filter((d) => d.id !== b.id).map((d) => d.id)
                                        : [...day.bookings.map((d) => d.id), b.id],
                                    ),
                                  )
                                }
                              >
                                <span className={on ? "text-foreground" : "text-muted-foreground"}>{b.title}</span>
                              </LabeledCheckbox>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <ul className="mt-3 grid gap-0.5">
                      {day.entries.map((entry) => (
                        <EntryRow
                          key={entry.id}
                          entry={entry}
                          participantCount={participants.length}
                          onDone={() => act(() => api.setEntryStatus(tripId, entry.id, "done"))}
                          onSkip={() => act(() => api.setEntryStatus(tripId, entry.id, "skipped"))}
                          onDelete={() => act(() => api.removeEntry(tripId, entry.id))}
                        />
                      ))}
                    </ul>

                    <form
                      className="mt-2 flex flex-wrap items-center gap-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act(async () => {
                          await api.addEntry(tripId, day.id, {
                            kind: draft.kind,
                            title: draft.title,
                            startsAt: draft.startsAt === "" ? null : draft.startsAt,
                          });
                          setDrafts((prev) => ({ ...prev, [day.id]: { ...emptyDraft, kind: draft.kind } }));
                        });
                      }}
                    >
                      <OptionSelect
                        aria-label="Kind"
                        size="sm"
                        className="w-auto"
                        value={draft.kind}
                        onValueChange={(value) =>
                          setDrafts((prev) => ({ ...prev, [day.id]: { ...draft, kind: value as EntryKind } }))
                        }
                        options={(Object.keys(KIND_LABEL) as EntryKind[]).map((k) => ({
                          value: k,
                          label: KIND_LABEL[k],
                        }))}
                      />
                      <Input
                        type="time"
                        value={draft.startsAt}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [day.id]: { ...draft, startsAt: e.target.value } }))
                        }
                        className="numeric h-7 w-24 py-0.5 text-sm"
                        aria-label="Time"
                      />
                      <Input
                        value={draft.title}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [day.id]: { ...draft, title: e.target.value } }))
                        }
                        placeholder="What are you doing?"
                        className="h-7 min-w-44 flex-1 py-0.5 text-sm"
                      />
                      <Button type="submit" size="sm" variant="ghost" disabled={draft.title.trim() === ""}>
                        Add
                      </Button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {days.length > 0 && (
          <form
            className="ml-[3rem] flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await api.addDay(tripId, { date: newDayDate === "" ? null : newDayDate });
                setNewDayDate("");
              });
            }}
          >
            <Input
              type="date"
              value={newDayDate}
              onChange={(e) => setNewDayDate(e.target.value)}
              className="numeric h-8 w-40 text-sm"
              aria-label="Date for the new day"
            />
            <Button variant="outline" type="submit" size="sm">
              <Plus />
              Add day
            </Button>
          </form>
        )}
      </section>

      {error !== null && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function EntryRow({
  entry,
  participantCount,
  onDone,
  onSkip,
  onDelete,
}: {
  entry: Entry;
  participantCount: number;
  onDone: () => void;
  onSkip: () => void;
  onDelete: () => void;
}) {
  const Icon = STATUS_ICON[entry.status];
  const struck = entry.status === "skipped" || entry.status === "cancelled";
  /** Only worth naming people when the group split up for this. */
  const partial = entry.attendees.length > 0 && entry.attendees.length < participantCount;

  return (
    <li className="group/entry flex items-baseline gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-accent">
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
        <span className={cn("text-foreground", struck && "text-subtle line-through")}>{entry.title}</span>
        {entry.placeName !== null && (
          <span className="ml-2 text-sm text-muted-foreground">{entry.placeName}</span>
        )}
        {partial && (
          <span className="ml-2 text-sm text-muted-foreground">
            {entry.attendees.map((a) => a.displayName).join(", ")}
          </span>
        )}
        {entry.replacedByEntryId !== null && (
          <Badge variant="outline" className="ml-2 text-caution">
            replaced
          </Badge>
        )}
      </span>

      <span className="flex shrink-0 opacity-0 transition-opacity group-hover/entry:opacity-100 focus-within:opacity-100">
        {entry.status !== "done" && (
          <Button variant="ghost" size="sm" onClick={onDone}>
            Done
          </Button>
        )}
        {entry.status === "planned" && (
          <Button variant="ghost" size="sm" onClick={onSkip}>
            Skip
          </Button>
        )}
        <Button variant="ghost" size="icon" aria-label={`Delete ${entry.title}`} onClick={onDelete}>
          <Trash2 />
        </Button>
      </span>
    </li>
  );
}
