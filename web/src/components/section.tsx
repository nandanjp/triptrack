import type { ComponentProps, ReactNode } from "react";
import { cn } from "cn";
import { Card } from "@/ui/card.tsx";

/**
 * A bounded region, built on shadcn's Card but deliberately flat: structure
 * comes from the hairline border, not a drop shadow, so the page does not read
 * as a deck of identical cards. Shadows stay with things that actually float.
 */
export const Panel = ({ className, ...props }: ComponentProps<typeof Card>) => (
  <Card className={cn("gap-0 py-0 shadow-none", className)} {...props} />
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
    <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
      <div className="min-w-0">
        <h2 className="font-medium">{title}</h2>
        {description !== undefined && (
          <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </header>
  );
}

export const PanelBody = ({ className, ...props }: ComponentProps<"div">) => (
  <div className={cn("px-4 py-3", className)} {...props} />
);

/** An empty screen is an invitation to act, so it names the action. */
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid justify-items-start gap-3 px-4 py-8 text-sm text-muted-foreground">
      <p className="max-w-prose">{children}</p>
      {action}
    </div>
  );
}
