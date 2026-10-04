import type { ReactNode } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * Label above control, hint and error below. Sentence case, never all caps —
 * a form label is a sentence fragment, not a heading.
 */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      {label !== undefined && <span className="text-sm font-medium text-ink">{label}</span>}
      {children}
      {error != null ? (
        <span className="text-sm text-danger">{error}</span>
      ) : (
        hint !== undefined && <span className="text-sm text-muted">{hint}</span>
      )}
    </label>
  );
}
