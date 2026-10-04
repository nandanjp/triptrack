import { useState } from "react";
import { api, type TripSummary } from "./api.ts";
import { Button } from "@/ui/button.tsx";
import { Dialog } from "@/ui/dialog.tsx";
import { Field } from "@/ui/field.tsx";
import { Input, Select } from "@/ui/input.tsx";

const CURRENCIES = ["CAD", "USD", "EUR", "GBP", "KRW", "JPY"];

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
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New trip"
      description="Dates are optional — a trip you are only dreaming about still gets an itinerary."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="submit"
            form="new-trip"
            variant="primary"
            disabled={busy || name.trim() === ""}
          >
            {busy ? "Working" : "Create trip"}
          </Button>
        </>
      }
    >
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

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Ends">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>

        <Field label="Home currency" hint="What you think in. Spending abroad is recorded in its own currency.">
          <Select value={homeCurrency} onChange={(e) => setHomeCurrency(e.target.value)}>
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </Field>

        {error !== null && <p className="text-sm text-danger">{error}</p>}
      </form>
    </Dialog>
  );
}
