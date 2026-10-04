import { useEffect, useState } from "react";
import { BedDouble, CalendarCheck, Plane, Plus, Trash2 } from "lucide-react";
import { api, type Booking, type BookingKind, type NewBooking } from "./api.ts";
import { cn } from "cn";
import { Badge } from "@/ui/badge.tsx";
import { Button } from "@/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog.tsx";
import { Field } from "@/components/field.tsx";
import { Input } from "@/ui/input.tsx";
import { OptionSelect } from "@/components/option-select.tsx";
import { Empty, Panel, PanelHeader } from "@/components/section.tsx";
import { ListPlaceholder } from "@/components/placeholders.tsx";

const KINDS: { value: BookingKind; label: string; plural: string; icon: typeof Plane }[] = [
  { value: "lodging", label: "Stay", plural: "Stays", icon: BedDouble },
  { value: "transit", label: "Travel", plural: "Travel", icon: Plane },
  { value: "event", label: "Booked ahead", plural: "Booked ahead", icon: CalendarCheck },
];

const stamp = (iso: string): string =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const when = (booking: Booking): string => {
  if (booking.endsAt === null) return stamp(booking.startsAt);
  const sameDay = booking.startsAt.slice(0, 10) === booking.endsAt.slice(0, 10);
  const end = sameDay
    ? new Date(booking.endsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : stamp(booking.endsAt);
  return `${stamp(booking.startsAt)} – ${end}`;
};

/** Nights paid for, from the booking's own range. */
const nightsBooked = (booking: Booking): number | null => {
  if (booking.kind !== "lodging" || booking.endsAt === null) return null;
  const count = Math.round(
    (new Date(booking.endsAt).getTime() - new Date(booking.startsAt).getTime()) / 86_400_000,
  );
  return count < 1 ? null : count;
};

const emptyDraft: NewBooking = { kind: "lodging", title: "", startsAt: "" };

export function Bookings({
  tripId,
  version,
  onChange,
}: {
  tripId: string;
  version: number;
  onChange: () => void;
}) {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<NewBooking>(emptyDraft);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api
      .bookings(tripId)
      .then(setBookings)
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

  if (bookings === null) return <ListPlaceholder />;

  const lodging = draft.kind === "lodging";

  return (
    <div className="grid gap-7">
      <Panel>
        <PanelHeader
          title="Bookings"
          description="Stays, travel and anything booked ahead. Assign them to days on the Days tab — what you paid for and what you used are allowed to differ."
          action={
            <Button variant="default" size="sm" onClick={() => setOpen(true)}>
              <Plus />
              Add booking
            </Button>
          }
        />

        {bookings.length === 0 ? (
          <Empty>
            Nothing booked yet. Add a flight or a first night somewhere, and it will show up
            against the days you assign it to.
          </Empty>
        ) : (
          <div className="divide-y divide-border">
            {KINDS.filter((kind) => bookings.some((b) => b.kind === kind.value)).map((kind) => (
              <section key={kind.value}>
                <h3 className="flex items-center gap-2 px-4 pt-3 pb-1 text-sm font-medium text-muted-foreground">
                  <kind.icon className="size-3.5 text-subtle" />
                  {kind.plural}
                </h3>

                <ul>
                  {bookings
                    .filter((b) => b.kind === kind.value)
                    .map((booking) => {
                      const nights = nightsBooked(booking);
                      const partlyUsed =
                        nights !== null && booking.usedDayCount > 0 && booking.usedDayCount < nights;

                      return (
                        <li
                          key={booking.id}
                          className="group flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 transition-colors hover:bg-accent"
                        >
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                "font-medium",
                                booking.status === "cancelled" ? "text-subtle line-through" : "text-foreground",
                              )}
                            >
                              {booking.title}
                            </span>
                            {booking.status !== "booked" && (
                              <Badge variant="outline" className="ml-2 text-caution">
                                {booking.status}
                              </Badge>
                            )}
                            <span className="numeric mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                              <span>{when(booking)}</span>
                              {booking.provider !== null && <span>{booking.provider}</span>}
                              {booking.confirmationCode !== null && (
                                <span className="font-mono text-xs">{booking.confirmationCode}</span>
                              )}
                            </span>
                            {partlyUsed && (
                              // Information, not a correction: booking long and
                              // using briefly is a legitimate thing to have done.
                              <span className="numeric mt-0.5 block text-sm text-caution">
                                {nights} nights booked, {booking.usedDayCount} assigned to days
                              </span>
                            )}
                          </span>

                          <span className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            {booking.status === "booked" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => act(() => api.setBookingStatus(tripId, booking.id, "cancelled"))}
                              >
                                Cancel
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Delete ${booking.title}`}
                              onClick={() => act(() => api.removeBooking(tripId, booking.id))}
                            >
                              <Trash2 />
                            </Button>
                          </span>
                        </li>
                      );
                    })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Panel>

      {error !== null && <p className="text-sm text-destructive">{error}</p>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add booking</DialogTitle>
          </DialogHeader>
        <form
          id="new-booking"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void act(async () => {
              await api.addBooking(tripId, {
                ...draft,
                startsAt: new Date(draft.startsAt).toISOString(),
                endsAt:
                  draft.endsAt == null || draft.endsAt === "" ? null : new Date(draft.endsAt).toISOString(),
              });
              setDraft({ ...emptyDraft, kind: draft.kind });
              setOpen(false);
            }).finally(() => setBusy(false));
          }}
        >
          <Field label="Kind">
            <OptionSelect
              value={draft.kind}
              onValueChange={(value) => setDraft({ ...draft, kind: value as BookingKind })}
              options={KINDS.map((kind) => ({ value: kind.value, label: kind.label }))}
            />
          </Field>

          <Field label="What it is">
            <Input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder={lodging ? "Seoul apartment" : "Toronto to Seoul"}
              required
              autoFocus
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={lodging ? "Check in" : "Departs"}>
              <Input
                type="datetime-local"
                value={draft.startsAt}
                onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })}
                required
              />
            </Field>
            <Field label={lodging ? "Check out" : "Arrives"}>
              <Input
                type="datetime-local"
                value={draft.endsAt ?? ""}
                onChange={(e) => setDraft({ ...draft, endsAt: e.target.value === "" ? null : e.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Booked with">
              <Input
                value={draft.provider ?? ""}
                onChange={(e) => setDraft({ ...draft, provider: e.target.value === "" ? null : e.target.value })}
                placeholder="Airbnb"
              />
            </Field>
            <Field label="Confirmation">
              <Input
                value={draft.confirmationCode ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, confirmationCode: e.target.value === "" ? null : e.target.value })
                }
                className="font-mono text-sm"
              />
            </Field>
          </div>

            <p className="text-sm text-muted-foreground">
              What it cost goes on the Money tab, so a refund can be recorded against it later.
            </p>
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="new-booking"
              disabled={busy || draft.title.trim() === "" || draft.startsAt === ""}
            >
              {busy ? "Working" : "Add booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
