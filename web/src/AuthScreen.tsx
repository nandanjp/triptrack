import { useState } from "react";
import { api, type Account } from "./api.ts";
import { Button } from "@/ui/button.tsx";
import { Field } from "@/components/field.tsx";
import { Input } from "@/ui/input.tsx";

const MIN_PASSWORD_LENGTH = 12;

export function AuthScreen({ onSignedIn }: { onSignedIn: (account: Account) => void }) {
  const [mode, setMode] = useState<"signIn" | "create">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const creating = mode === "create";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onSignedIn(await (creating ? api.register : api.login)(email, password));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-3xl text-foreground">TripTrack</h1>
        <p className="mt-1 mb-7 text-muted-foreground">
          Plan a trip, live it, and keep the record in one place.
        </p>

        <form onSubmit={submit} className="grid gap-4">
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </Field>

          <Field
            label="Password"
            hint={creating ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
          >
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete={creating ? "new-password" : "current-password"}
            />
          </Field>

          {/* The button says what happens, and keeps that name through the flow. */}
          <Button type="submit" variant="default" size="lg" disabled={busy}>
            {busy ? "Working" : creating ? "Create account" : "Sign in"}
          </Button>

          {error !== null && <p className="text-sm text-destructive">{error}</p>}
        </form>

        <Button
          variant="link"
          size="sm"
          className="mt-5 px-0"
          onClick={() => {
            setMode(creating ? "signIn" : "create");
            setError(null);
          }}
        >
          {creating ? "I already have an account" : "Create an account"}
        </Button>
      </div>
    </main>
  );
}
