import { useState } from "react";
import { Check, Copy, Link2, Pencil, Trash2, UserPlus } from "lucide-react";
import { api, type Participant } from "./api.ts";
import { Badge } from "@/ui/badge.tsx";
import { Button } from "@/ui/button.tsx";
import { Input } from "@/ui/input.tsx";
import { Empty, Panel, PanelBody, PanelHeader } from "@/components/section.tsx";

export function People({
  tripId,
  participants,
  myParticipantId,
  isOwner,
  onChange,
}: {
  tripId: string;
  participants: Participant[];
  myParticipantId: string;
  isOwner: boolean;
  onChange: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  /** Keyed by seat. The token is shown once and cannot be fetched again. */
  const [links, setLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copy = async (seatId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(seatId);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access can be refused; the field is selectable either way.
      setError("Could not copy. Select the link and copy it manually.");
    }
  };

  return (
    <div className="grid gap-7">
      <Panel>
        <PanelHeader
          title="Who's coming"
          description="Someone can be on a trip without an account. Add them by name now and send a link later, or never."
        />

        <ul className="divide-y divide-border">
          {participants.map((person) => (
            <li key={person.id} className="group px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                {renaming?.id === person.id ? (
                  <form
                    className="flex flex-1 items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const next = renaming.value.trim();
                      setRenaming(null);
                      if (next !== "" && next !== person.displayName) {
                        void act(() => api.renameParticipant(tripId, person.id, next));
                      }
                    }}
                  >
                    <Input
                      value={renaming.value}
                      onChange={(e) => setRenaming({ id: person.id, value: e.target.value })}
                      autoFocus
                      className="h-8 max-w-56"
                    />
                    <Button type="submit" size="sm" variant="default">
                      Save
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setRenaming(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-foreground">{person.displayName}</span>
                      {person.id === myParticipantId && (
                        <Badge variant="default" className="ml-2">
                          you
                        </Badge>
                      )}
                      {person.role === "owner" && <Badge variant="secondary" className="ml-2">owner</Badge>}
                      {!person.hasAccount && (
                        <span className="ml-2 text-sm text-muted-foreground">no account yet</span>
                      )}
                    </span>

                    <span className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      {(isOwner || person.id === myParticipantId) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Rename ${person.displayName}`}
                          onClick={() => setRenaming({ id: person.id, value: person.displayName })}
                        >
                          <Pencil />
                        </Button>
                      )}
                      {isOwner && !person.hasAccount && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              act(async () => {
                                const { url } = await api.invite(tripId, person.id);
                                setLinks((prev) => ({ ...prev, [person.id]: url }));
                              })
                            }
                          >
                            <Link2 />
                            Invite link
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove ${person.displayName}`}
                            onClick={() => act(() => api.removeParticipant(tripId, person.id))}
                          >
                            <Trash2 />
                          </Button>
                        </>
                      )}
                    </span>
                  </>
                )}
              </div>

              {links[person.id] !== undefined && (
                <div className="mt-2.5 rounded-md border border-border bg-accent p-2.5">
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={links[person.id]}
                      onFocus={(e) => e.currentTarget.select()}
                      className="h-8 flex-1 font-mono text-xs"
                    />
                    <Button variant="outline" size="sm" onClick={() => copy(person.id, links[person.id] ?? "")}>
                      {copied === person.id ? <Check /> : <Copy />}
                      {copied === person.id ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Copy this now — it is shown once. Anyone holding it can join as{" "}
                    {person.displayName}, and it expires in 14 days.
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>

        {isOwner ? (
          <PanelBody className="border-t border-border">
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  await api.addParticipant(tripId, newName);
                  setNewName("");
                });
              }}
            >
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Add someone by name"
                className="h-8 max-w-56 flex-1"
              />
              <Button variant="outline" type="submit" size="sm" disabled={newName.trim() === ""}>
                <UserPlus />
                Add
              </Button>
            </form>
          </PanelBody>
        ) : (
          <Empty>Only an owner can add or remove people.</Empty>
        )}
      </Panel>

      {error !== null && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
