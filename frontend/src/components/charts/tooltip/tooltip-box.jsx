import { createPortal } from "react-dom";
import { m, useSpring } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Spring config for smooth tooltip movement
const springConfig = { stiffness: 100, damping: 20 };

export function TooltipBox({
  x,
  y,
  visible,
  containerRef,
  containerWidth,
  containerHeight,
  offset = 16,
  className = "",
  children,
  left: leftOverride,
  top: topOverride,
  flipped: flippedOverride
}) {
  const tooltipRef = useRef(null);
  const tooltipWidthRef = useRef(180);
  const tooltipHeightRef = useRef(80);
  const [mounted, setMounted] = useState(false);

  // react-doctor-disable-next-line rendering-hydration-no-flicker -- intentional mount gate: tooltip measures container size for flip positioning after layout, client-only SPA (no SSR)
  useEffect(() => {
    setMounted(true);
  }, []);

  const animatedLeft = useSpring(x + offset, springConfig);
  const animatedTop = useSpring(y, springConfig);

  const tw = tooltipWidthRef.current;
  const shouldFlipX = x + tw + offset > containerWidth;

  useLayoutEffect(() => {
    if (!(visible && tooltipRef.current)) {
      return;
    }
    const el = tooltipRef.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w > 0) {
      tooltipWidthRef.current = w;
    }
    if (h > 0) {
      tooltipHeightRef.current = h;
    }
    const w2 = tooltipWidthRef.current;
    const h2 = tooltipHeightRef.current;
    const flip = x + w2 + offset > containerWidth;
    const tx = flip ? x - offset - w2 : x + offset;
    const ty = Math.max(offset, Math.min(y - h2 / 2, containerHeight - h2 - offset));
    if (leftOverride === undefined) {
      animatedLeft.set(tx);
    }
    if (topOverride === undefined) {
      animatedTop.set(ty);
    }
  }, [
    visible,
    x,
    y,
    containerWidth,
    containerHeight,
    offset,
    leftOverride,
    topOverride,
    animatedLeft,
    animatedTop,
  ]);

  const prevFlipRef = useRef(shouldFlipX);
  const [flipKey, setFlipKey] = useState(0);

  useEffect(() => {
    if (prevFlipRef.current !== shouldFlipX) {
      setFlipKey((k) => k + 1);
      prevFlipRef.current = shouldFlipX;
    }
  }, [shouldFlipX]);

  const finalLeft = leftOverride ?? animatedLeft;
  const finalTop = topOverride ?? animatedTop;
  const isFlipped = flippedOverride ?? shouldFlipX;
  const transformOrigin = isFlipped ? "right top" : "left top";

  const container = containerRef.current;
  if (!(mounted && container)) {
    return null;
  }

  if (!visible) {
    return null;
  }

  return createPortal(<m.div
    animate={{ opacity: 1 }}
    className={cn("pointer-events-none absolute z-50", className)}
    exit={{ opacity: 0 }}
    initial={{ opacity: 0 }}
    ref={tooltipRef}
    style={{ left: finalLeft, top: finalTop }}
    transition={{ duration: 0.1 }}>
    <m.div
      animate={{ scale: 1, opacity: 1, x: 0 }}
      className="min-w-[140px] overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-lg backdrop-blur-md"
      initial={{ scale: 0.85, opacity: 0, x: isFlipped ? 20 : -20 }}
      key={flipKey}
      style={{ transformOrigin }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}>
      {children}
    </m.div>
  </m.div>, container);
}

TooltipBox.displayName = "TooltipBox";

export default TooltipBox;
