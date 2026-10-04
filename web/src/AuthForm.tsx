import { useState } from "react";
import { api, type Account } from "./api.ts";

const MIN_PASSWORD_LENGTH = 12;

export function AuthForm({ onSignedIn }: { onSignedIn: (account: Account) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onSignedIn(await (mode === "login" ? api.login : api.register)(email, password));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: ".75rem", maxWidth: "22rem" }}>
      <label style={{ display: "grid", gap: ".25rem" }}>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </label>

      <label style={{ display: "grid", gap: ".25rem" }}>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
        {mode === "register" && (
          <small style={{ color: "#666" }}>At least {MIN_PASSWORD_LENGTH} characters.</small>
        )}
      </label>

      <button type="submit" disabled={busy}>
        {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
      </button>

      {error !== null && <p style={{ color: "#b00", margin: 0 }}>{error}</p>}

      <button
        type="button"
        onClick={() => {
          setMode(mode === "login" ? "register" : "login");
          setError(null);
        }}
        style={{ background: "none", border: "none", color: "#06c", cursor: "pointer", padding: 0, textAlign: "left" }}
      >
        {mode === "login" ? "Create an account instead" : "I already have an account"}
      </button>
    </form>
  );
}
