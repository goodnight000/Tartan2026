import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: "right" | "left" | "bottom" | "top";
  }
>(({ className, side = "right", ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(28,35,43,0.38)] backdrop-blur-sm" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 bg-[color:var(--cp-surface)] p-6 shadow-[0_30px_60px_rgba(29,20,10,0.26)]",
        "border border-[color:var(--cp-line)]",
        side === "right" && "inset-y-0 right-0 h-full w-full max-w-xl rounded-l-[30px] border-r-0",
        side === "left" && "inset-y-0 left-0 h-full w-full max-w-xl rounded-r-[30px] border-l-0",
        side === "bottom" && "inset-x-0 bottom-0 rounded-t-[30px] border-b-0",
        side === "top" && "inset-x-0 top-0 rounded-b-[30px] border-t-0",
        className
      )}
      {...props}
    />
  </DialogPrimitive.Portal>
));
SheetContent.displayName = DialogPrimitive.Content.displayName;
