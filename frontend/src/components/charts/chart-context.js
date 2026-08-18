import { createContext } from "react";

// CSS variable references for theming
export const chartCssVars = {
  background: "var(--chart-background)",
  linePrimary: "var(--chart-line-primary)",
  crosshair: "var(--chart-crosshair)",
  grid: "var(--chart-grid)",
};

export const ChartContext = createContext(null);
