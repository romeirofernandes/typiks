import { motion, useSpring } from "motion/react";
import { chartCssVars } from "../chart-context";

// Faster spring to stay in sync with indicator
const crosshairSpringConfig = { stiffness: 300, damping: 30 };

export function TooltipDot({
  x,
  y,
  visible,
  color,
  size = 5,
  strokeColor = chartCssVars.background,
  strokeWidth = 2
}) {
  const animatedX = useSpring(x, crosshairSpringConfig);
  const animatedY = useSpring(y, crosshairSpringConfig);

  animatedX.set(x);
  animatedY.set(y);

  if (!visible) {
    return null;
  }

  return (
    <motion.circle
      cx={animatedX}
      cy={animatedY}
      fill={color}
      r={size}
      stroke={strokeColor}
      strokeWidth={strokeWidth} />
  );
}

TooltipDot.displayName = "TooltipDot";

export default TooltipDot;
