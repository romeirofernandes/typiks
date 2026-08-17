import { useMemo } from "react";
import { Grid } from "@/components/charts/grid";
import { LineChart, Line } from "@/components/charts/line-chart";
import { XAxis } from "@/components/charts/x-axis";
import { ChartTooltip } from "@/components/charts/tooltip";

function formatTimeLabel(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

const EMPTY_SAMPLES = [];

function CustomTooltip({ point }) {
  if (!point) return null;

  return (
    <div className="rounded-md border border-border/70 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <p className="tabular-nums text-muted-foreground">+{formatTimeLabel(Math.round(point.t))}</p>
      <p className="mt-1 font-medium tabular-nums">{Math.round(point.wpm)} WPM</p>
    </div>
  );
}

export function SessionWpmChart({ samples = EMPTY_SAMPLES, title = "WPM" }) {
  const chartData = useMemo(
    () => samples.map((sample, index) => ({ ...sample, index: index + 1 })),
    [samples]
  );

  if (!chartData.length) {
    return (
      <div className="flex h-24 items-center justify-center rounded-md border border-border/60 bg-background/50 text-sm text-muted-foreground">
        Not enough data to draw a graph.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border/60 bg-background/50 p-3">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{title}</p>
      <div className="mt-2 h-28 w-full">
        <LineChart
          data={chartData}
          xDataKey="t"
          xScaleType="linear"
          margin={{ top: 16, right: 16, bottom: 18, left: 16 }}
          aspectRatio="auto"
          animationDuration={600}
          className="h-full w-full"
        >
          <Grid horizontal />
          <Line dataKey="wpm" stroke="var(--chart-line-primary)" strokeWidth={2.5} />
          <XAxis numTicks={6} formatTick={(value) => formatTimeLabel(Math.round(value))} />
          <ChartTooltip showDatePill={false} content={(ctx) => <CustomTooltip {...ctx} />} />
        </LineChart>
      </div>
    </div>
  );
}