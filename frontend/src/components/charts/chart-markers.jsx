import { useMemo } from "react";
import { chartCssVars, useChart } from "./chart-context";

export function ChartMarkers({
  items = [],
  size = 12,
  showLines = true,
}) {
  const { data, xScale, yScale, xAccessor, margin, innerHeight, lines } = useChart();

  const primaryLineKey = lines[0]?.dataKey;

  const toComparableX = (value) => {
    if (value instanceof Date) return value.getTime();
    return Number(value);
  };

  const markers = useMemo(() => {
    if (!items.length || !data.length || !primaryLineKey) {
      return [];
    }

    return items
      .map((item) => {
        const hasNumericTarget = Number.isFinite(item.xValue);
        const markerDate = item.date instanceof Date ? item.date : new Date(item.date);
        const hasDateTarget = !Number.isNaN(markerDate.getTime());

        if (!hasNumericTarget && !hasDateTarget) {
          return null;
        }

        const targetX = hasNumericTarget ? item.xValue : markerDate;
        const targetComparable = toComparableX(targetX);

        const nearest = data.reduce((prev, curr) => {
          if (!prev) return curr;
          const prevDelta = Math.abs(toComparableX(xAccessor(prev)) - targetComparable);
          const currDelta = Math.abs(toComparableX(xAccessor(curr)) - targetComparable);
          return currDelta < prevDelta ? curr : prev;
        }, null);

        if (!nearest) {
          return null;
        }

        const value = nearest[primaryLineKey];
        if (typeof value !== "number") {
          return null;
        }

        return {
          x: xScale(xAccessor(nearest)) ?? 0,
          y: yScale(value) ?? 0,
        };
      })
      .filter(Boolean);
  }, [items, data, primaryLineKey, xAccessor, xScale, yScale]);

  if (!markers.length) {
    return null;
  }

  return (
    <g className="chart-markers" transform={`translate(${margin.left},${margin.top})`}>
      {markers.map((marker, index) => (
        <g key={`chart-marker-${index}`}>
          {showLines ? (
            <line
              x1={marker.x}
              y1={0}
              x2={marker.x}
              y2={innerHeight}
              stroke={chartCssVars.grid}
              strokeOpacity={0.45}
              strokeDasharray="3 4"
            />
          ) : null}
          <circle
            cx={marker.x}
            cy={marker.y}
            r={size / 2}
            fill={chartCssVars.markerBackground}
            stroke={chartCssVars.markerBorder}
            strokeWidth={1.5}
          />
        </g>
      ))}
    </g>
  );
}

ChartMarkers.displayName = "ChartMarkers";
ChartMarkers.__isChartMarkers = true;

export default ChartMarkers;
