import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/ui/dialog.tsx";

/**
 * The sidebar on a phone. shadcn's Dialog primitive, anchored to the edge
 * rather than centred, so there is one overlay implementation rather than two.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-0 left-0 h-dvh w-72 max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-y-0 border-l-0 p-0 sm:max-w-none md:hidden"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
