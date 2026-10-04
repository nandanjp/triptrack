import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { api, type TripShare } from "./api.ts";
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

export function ShareDialog({
  tripId,
  share,
  open,
  onOpenChange,
  onChange,
}: {
  tripId: string;
  share: TripShare | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      onChange();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (share === null) return;
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Select the link and copy it manually.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share this itinerary</DialogTitle>
          <DialogDescription>
            Anyone with the link can read the day-by-day plan without an account. What it cost,
            who is going and what is booked stay private.
          </DialogDescription>
        </DialogHeader>

        {share === null ? (
          <p className="text-sm text-muted-foreground">
            Sharing is off. Turning it on creates a link you can send to anyone.
          </p>
        ) : (
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={share.url}
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono text-xs"
              />
              <Button variant="outline" onClick={copy}>
                {copied ? <Check /> : <Copy />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Anyone who has this link keeps access until you turn sharing off or make a new
              link.
            </p>
          </div>
        )}

        {error !== null && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          {share !== null && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive"
              disabled={busy}
              onClick={() => act(() => api.stopSharing(tripId))}
            >
              Stop sharing
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
          <Button disabled={busy} onClick={() => act(() => api.startSharing(tripId))}>
            {share === null ? "Create link" : "Make a new link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
