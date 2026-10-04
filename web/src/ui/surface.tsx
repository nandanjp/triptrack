import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * A bounded region. Deliberately flat — structure comes from the hairline
 * border, not a drop shadow, so the page does not read as a deck of identical
 * cards. Shadows are reserved for things that genuinely float.
 */
export const Panel = ({ className, ...props }: ComponentProps<"section">) => (
  <section
    className={cn("rounded-lg border border-line bg-raised", className)}
    {...props}
  />
);

export function PanelHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-base font-medium text-ink">{title}</h2>
        {description !== undefined && (
          <p className="max-w-prose text-sm text-muted">{description}</p>
        )}
      </div>
      {action}
    </header>
  );
}

export const PanelBody = ({ className, ...props }: ComponentProps<"div">) => (
  <div className={cn("px-4 py-3", className)} {...props} />
);

export const Separator = ({ className, ...props }: ComponentProps<"div">) => (
  <div role="separator" className={cn("h-px bg-line", className)} {...props} />
);

/**
 * An empty screen is an invitation to act, so it names the action rather than
 * reporting the absence.
 */
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid justify-items-start gap-3 px-4 py-8 text-sm text-muted">
      <p className="max-w-prose">{children}</p>
      {action}
    </div>
  );
}
