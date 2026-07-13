import * as React from "react";

/**
 * FitToWidth — scales its child down (never up) so it fits within the
 * available container width.
 *
 * To make this work for tables/blocks that use `w-full` (which would
 * otherwise always equal the container width and yield no scaling), the
 * inner wrapper is rendered at its *intrinsic* width (`width: max-content`,
 * `min-width: 100%`). Children then expand to their natural content width
 * (long rows, whitespace-nowrap cells, wide tables) and we scale that down
 * to fit the available space.
 */
export function FitToWidth({
  children,
  minScale = 0.5,
  className,
}: {
  children: React.ReactNode;
  minScale?: number;
  className?: string;
}) {
  const outerRef = React.useRef<HTMLDivElement | null>(null);
  const innerRef = React.useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(1);
  const [innerH, setInnerH] = React.useState<number | null>(null);

  React.useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const measure = () => {
      const available = outer.clientWidth;
      if (!available) return;
      // Reset transform to measure natural size.
      const prevTransform = inner.style.transform;
      inner.style.transform = "none";
      const natural = Math.max(inner.scrollWidth, inner.offsetWidth);
      inner.style.transform = prevTransform;

      if (!natural) return;
      const next = natural > available + 0.5 ? Math.max(minScale, available / natural) : 1;
      setScale(next);
      // After scale is applied, measure rendered height.
      requestAnimationFrame(() => {
        if (!innerRef.current) return;
        setInnerH(innerRef.current.getBoundingClientRect().height);
      });
    };

    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [children, minScale]);

  return (
    <div
      ref={outerRef}
      className={cn("fit-to-width-outer", className)}
      style={{ width: "100%", overflow: "hidden", height: innerH ?? undefined }}
    >
      <div
        ref={innerRef}
        className="fit-to-width-inner"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          // Render at intrinsic content width so w-full children don't
          // collapse to the container width. min-width keeps short content
          // filling the available space.
          width: "max-content",
          minWidth: "100%",
        }}
      >
        {children}
      </div>
    </div>
  );
}
