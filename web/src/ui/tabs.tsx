import * as RadixTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

/**
 * A trip has four distinct concerns — days, bookings, money, settling up —
 * and stacking them all vertically buries the last two. Tabs keep the day
 * spine as the thing you land on.
 */
export const Tabs = RadixTabs.Root;

export const TabList = ({ children }: { children: ReactNode }) => (
  <RadixTabs.List className="flex gap-1 overflow-x-auto border-b border-line">
    {children}
  </RadixTabs.List>
);

export const Tab = ({ value, children }: { value: string; children: ReactNode }) => (
  <RadixTabs.Trigger
    value={value}
    className="-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-ink data-[state=active]:border-accent data-[state=active]:text-ink"
  >
    {children}
  </RadixTabs.Trigger>
);

export const TabPanel = ({ value, children }: { value: string; children: ReactNode }) => (
  <RadixTabs.Content value={value} className="pt-5 outline-none">
    {children}
  </RadixTabs.Content>
);
