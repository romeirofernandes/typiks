import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useChart } from "./chart-context";

function XAxisLabel({
  label,
  x,
  crosshairX,
  isHovering,
  tickerHalfWidth
}) {
  const fadeBuffer = 20;
  const fadeRadius = tickerHalfWidth + fadeBuffer;

  let opacity = 1;
  if (isHovering && crosshairX !== null) {
    const distance = Math.abs(x - crosshairX);
    if (distance < tickerHalfWidth) {
      opacity = 0;
    } else if (distance < fadeRadius) {
      opacity = (distance - tickerHalfWidth) / fadeBuffer;
    }
  }

  // Zero-width container approach for perfect centering
  // The wrapper is positioned exactly at x with width:0
  // The inner span overflows and is centered via text-align
  return (
    <div
      className="absolute"
      style={{
        left: x,
        bottom: 12,
        width: 0,
        display: "flex",
        justifyContent: "center",
      }}>
      <span
        className={cn("whitespace-nowrap text-chart-label text-xs")}
        style={{
          opacity,
          transition: "opacity 0.4s ease-in-out",
        }}>
        {label}
      </span>
    </div>
  );
}

export function XAxis({
  numTicks = 5,
  tickerHalfWidth = 50,
  formatTick,
}) {
  const { xScale, margin, tooltipData, containerRef } = useChart();
  const [mounted, setMounted] = useState(false);

  // Only render on client side after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Generate evenly spaced tick values, always including first and last domain values.
  const labelsToShow = useMemo(() => {
    const domain = xScale.domain();
    const start = domain[0];
    const end = domain[1];

    if (!(start !== undefined && end !== undefined)) {
      return [];
    }

    const isDateDomain = start instanceof Date && end instanceof Date;
    const startValue = isDateDomain ? start.getTime() : Number(start);
    const endValue = isDateDomain ? end.getTime() : Number(end);

    if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) {
      return [];
    }

    const valueRange = endValue - startValue;

    const tickCount = Math.max(2, numTicks); // At least first and last
    const ticks = [];

    for (let i = 0; i < tickCount; i++) {
      const t = i / (tickCount - 1); // 0 to 1
      const tickValue = startValue + t * valueRange;
      const rawValue = isDateDomain ? new Date(tickValue) : tickValue;
      const defaultLabel = isDateDomain
        ? rawValue.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })
        : `${Math.round(rawValue)}`;

      ticks.push({
        rawValue,
        x: (xScale(rawValue) ?? 0) + margin.left,
        label: formatTick ? formatTick(rawValue, i) : defaultLabel,
      });
    }

    return ticks;
  }, [xScale, margin.left, numTicks, formatTick]);

  const isHovering = tooltipData !== null;
  const crosshairX = tooltipData ? tooltipData.x + margin.left : null;

  // Use portal to render into the chart container
  // Only render after mount on client side
  const container = containerRef.current;
  if (!(mounted && container)) {
    return null;
  }


  return createPortal(<div className="pointer-events-none absolute inset-0">
    {labelsToShow.map((item) => (
      <XAxisLabel
        crosshairX={crosshairX}
        isHovering={isHovering}
        key={`${item.label}-${item.x}`}
        label={item.label}
        tickerHalfWidth={tickerHalfWidth}
        x={item.x} />
    ))}
  </div>, container);
}

XAxis.displayName = "XAxis";

export default XAxis;
