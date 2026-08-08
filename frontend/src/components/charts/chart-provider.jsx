import { ChartContext } from "./chart-context";

export function ChartProvider({
  children,
  value
}) {
  return (<ChartContext.Provider value={value}>{children}</ChartContext.Provider>);
}
