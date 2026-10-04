import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils.ts";

export function Menu({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          sideOffset={6}
          align="end"
          className="z-50 min-w-44 rounded-lg border border-line bg-raised p-1 shadow-lg shadow-black/10 dark:shadow-black/40"
        >
          {children}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

export function MenuItem({
  onSelect,
  children,
  tone = "default",
  checked,
}: {
  onSelect: () => void;
  children: ReactNode;
  tone?: "default" | "danger";
  checked?: boolean;
}) {
  return (
    <RadixMenu.Item
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm outline-none select-none",
        tone === "danger" ? "text-danger data-highlighted:bg-danger-soft" : "text-ink data-highlighted:bg-sunken",
      )}
    >
      {children}
      {checked === true && <span className="text-accent">✓</span>}
    </RadixMenu.Item>
  );
}

export const MenuSeparator = () => <RadixMenu.Separator className="my-1 h-px bg-line" />;

export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <RadixMenu.Label className="px-2 py-1 text-xs text-subtle">{children}</RadixMenu.Label>
);
