import { motion, useSpring } from "motion/react";
import { chartCssVars } from "../chart-context";

// Faster spring for crosshair - responsive to mouse movement
const crosshairSpringConfig = { stiffness: 300, damping: 30 };

function resolveWidth(width) {
  if (typeof width === "number") {
    return width;
  }
  switch (width) {
    case "line":
      return 1;
    case "thin":
      return 2;
    case "medium":
      return 4;
    case "thick":
      return 8;
    default:
      return 1;
  }
}

export function TooltipIndicator({
  x,
  height,
  visible,
  width = "line",
  span,
  columnWidth,
  colorEdge = chartCssVars.crosshair,
  colorMid = chartCssVars.crosshair,
  fadeEdges = true,
  gradientId = "tooltip-indicator-gradient"
}) {
  const pixelWidth =
    span !== undefined && columnWidth !== undefined
      ? span * columnWidth
      : resolveWidth(width);

  const animatedX = useSpring(x - pixelWidth / 2, crosshairSpringConfig);

  animatedX.set(x - pixelWidth / 2);

  if (!visible) {
    return null;
  }

  const edgeOpacity = fadeEdges ? 0 : 1;

  return (
    <g>
      <defs>
        <linearGradient id={gradientId} x1="0%" x2="0%" y1="0%" y2="100%">
          <stop offset="0%" style={{ stopColor: colorEdge, stopOpacity: edgeOpacity }} />
          <stop offset="10%" style={{ stopColor: colorEdge, stopOpacity: 1 }} />
          <stop offset="50%" style={{ stopColor: colorMid, stopOpacity: 1 }} />
          <stop offset="90%" style={{ stopColor: colorEdge, stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: colorEdge, stopOpacity: edgeOpacity }} />
        </linearGradient>
      </defs>
      <motion.rect
        fill={`url(#${gradientId})`}
        height={height}
        width={pixelWidth}
        x={animatedX}
        y={0} />
    </g>
  );
}

TooltipIndicator.displayName = "TooltipIndicator";

export default TooltipIndicator;
