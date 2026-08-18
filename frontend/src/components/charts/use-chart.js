import { useContext } from "react";
import { ChartContext } from "./chart-context";

export function useChart() {
  const context = useContext(ChartContext);
  if (!context) {
    throw new Error("useChart must be used within a ChartProvider. " +
      "Make sure your component is wrapped in <LineChart>.");
  }
  return context;
}
