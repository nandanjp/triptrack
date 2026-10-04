import { useState } from "react";
import { api, type TripSummary } from "./api.ts";
import { Field } from "@/components/field.tsx";
import { OptionSelect } from "@/components/option-select.tsx";
import { Button } from "@/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog.tsx";
import { Input } from "@/ui/input.tsx";

const CURRENCIES = ["CAD", "USD", "EUR", "GBP", "KRW", "JPY"].map((code) => ({
  value: code,
  label: code,
}));

export function NewTripDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (trip: TripSummary) => void;
}) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [homeCurrency, setHomeCurrency] = useState("CAD");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const trip = await api.createTrip({
        name,
        startDate: startDate === "" ? null : startDate,
        endDate: endDate === "" ? null : endDate,
        homeCurrency,
      });
      setName("");
      setStartDate("");
      setEndDate("");
      onCreated(trip);
      onOpenChange(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New trip</DialogTitle>
          <DialogDescription>
            Dates are optional — a trip you are only dreaming about still gets an itinerary.
          </DialogDescription>
        </DialogHeader>

        <form id="new-trip" onSubmit={submit} className="grid gap-4">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              placeholder="Korea"
            />
          </Field>

          {/* min-w-0 on each field, or the date inputs' intrinsic width
              refuses to shrink and pushes out of the dialog. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="Ends">
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>

          <Field
            label="Home currency"
            hint="What you think in. Spending abroad is still recorded in its own currency."
          >
            <OptionSelect value={homeCurrency} onValueChange={setHomeCurrency} options={CURRENCIES} />
          </Field>

          {error !== null && <p className="text-sm text-destructive">{error}</p>}
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-trip" disabled={busy || name.trim() === ""}>
            {busy ? "Working" : "Create trip"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
