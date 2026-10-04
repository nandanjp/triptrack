import { Deferred } from "./loading.tsx";
import { Skeleton } from "@/ui/skeleton.tsx";

/**
 * Wrapped in Deferred, so a load that finishes quickly — which is most of them
 * — shows nothing at all rather than flashing a placeholder in and straight
 * back out.
 */
export const ListPlaceholder = ({ rows = 3 }: { rows?: number }) => (
  <Deferred>
    <div className="grid gap-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  </Deferred>
);

export const PagePlaceholder = () => (
  <Deferred>
    <div className="grid gap-6" aria-busy="true" aria-live="polite">
      <div className="grid gap-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-9 w-full max-w-sm" />
      <div className="grid gap-2">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  </Deferred>
);
