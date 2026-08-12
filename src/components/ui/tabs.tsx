import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, onKeyDown, ...props }, ref) => {
  // Radix Tabs handles ArrowLeft/ArrowRight natively for horizontal orientation.
  // For wrapping tablists (multi-row), users also expect ArrowUp/ArrowDown to
  // move between rows. We augment the list with a geometry-based handler that
  // finds the closest trigger above/below the currently focused one.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const list = e.currentTarget;
    const triggers = Array.from(
      list.querySelectorAll<HTMLElement>('[role="tab"]:not([data-disabled])'),
    );
    const current = document.activeElement as HTMLElement | null;
    if (!current || !triggers.includes(current)) return;
    const cur = current.getBoundingClientRect();
    const wantBelow = e.key === "ArrowDown";
    let best: { el: HTMLElement; dy: number; dx: number } | null = null;
    for (const el of triggers) {
      if (el === current) continue;
      const r = el.getBoundingClientRect();
      const dy = r.top - cur.top;
      if (wantBelow ? dy <= 2 : dy >= -2) continue;
      const dx = Math.abs(r.left - cur.left);
      const absDy = Math.abs(dy);
      if (!best || absDy < Math.abs(best.dy) || (absDy === Math.abs(best.dy) && dx < best.dx)) {
        best = { el, dy, dx };
      }
    }
    // No row above/below → wrap to first/last trigger.
    const target = best?.el ?? (wantBelow ? triggers[0] : triggers[triggers.length - 1]);
    if (target) {
      e.preventDefault();
      target.focus();
      target.click();
    }
  };
  return (
    <TabsPrimitive.List
      ref={ref}
      onKeyDown={handleKeyDown}
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;


const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
