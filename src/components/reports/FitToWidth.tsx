import * as React from "react";

/**
 * FitToWidth — scales its child down (never up) so it fits within the
 * available container width. Used to keep wide reports on screen without
 * a horizontal scrollbar.
 */
export function FitToWidth({
  children,
  minScale = 0.55,
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
      // Temporarily reset to natural width to measure
      const prev = inner.style.transform;
      inner.style.transform = "none";
      inner.style.width = "max-content";
      const natural = inner.scrollWidth;
      inner.style.width = "";
      inner.style.transform = prev;

      if (!available || !natural) return;
      const next = natural > available ? Math.max(minScale, available / natural) : 1;
      setScale(next);
      setInnerH(inner.getBoundingClientRect().height * next);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [children, minScale]);

  return (
    <div
      ref={outerRef}
      className={className}
      style={{ width: "100%", overflow: "hidden", height: innerH ?? undefined }}
    >
      <div
        ref={innerRef}
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          width: scale < 1 ? `${100 / scale}%` : "100%",
        }}
      >
        {children}
      </div>
    </div>
  );
}
