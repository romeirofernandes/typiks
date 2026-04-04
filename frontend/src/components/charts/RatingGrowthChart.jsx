import { useMemo } from "react";
import { Grid } from "@/components/charts/grid";
import { LineChart } from "@/components/charts/line-chart";
import { Line } from "@/components/charts/line";
import { XAxis } from "@/components/charts/x-axis";
import { ChartTooltip } from "@/components/charts/tooltip";

function formatDateLabel(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function CustomTooltip({ point }) {
  if (!point) return null;

  return (
    <div className="rounded-md border border-border/70 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <p className="font-medium">{point.fullDate}</p>
      <p className="mt-1 tabular-nums">Rating: {point.rating}</p>
      <p className="tabular-nums text-muted-foreground">Score: {point.score}</p>
    </div>
  );
}

export function RatingGrowthChart({ points }) {
  const chartData = useMemo(
    () =>
      points.map((point, index) => ({
        ...point,
        index,
        gameNumber: Number(point.index) || index + 1,
        label: formatDateLabel(point.date),
        fullDate: new Date(`${point.date}T00:00:00`).toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      })),
    [points]
  );

  if (!chartData.length) {
    return (
      <div className="flex min-h-56 items-center justify-center rounded-md border border-border/60 bg-background/50 text-sm text-muted-foreground">
        Play games in selected mode to generate trend.
      </div>
    );
  }

  const first = chartData[0];
  const latest = chartData[chartData.length - 1];

  return (
    <div className="space-y-2">
      <div className="h-[22rem] w-full rounded-md border border-border/60 bg-background/50 p-2 sm:h-[22rem]">
        <LineChart
          data={chartData}
          xDataKey="gameNumber"
          xScaleType="linear"
          margin={{ top: 16, right: 16, bottom: 18, left: 16 }}
          className="h-full w-full"
          aspectRatio="auto"
        >
          <Grid horizontal />
          <Line dataKey="rating" stroke="var(--chart-line-primary)" strokeWidth={2.5} />
          <XAxis numTicks={6} formatTick={(value) => `${Math.round(value)}`} />
          <ChartTooltip content={(ctx) => <CustomTooltip {...ctx} />} showDatePill={false} />
        </LineChart>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
        <p>First: {first.rating} on {first.label}</p>
        <p>Latest: {latest.rating} on {latest.label}</p>
      </div>
    </div>
  );
}
