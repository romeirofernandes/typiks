import { useMemo } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function formatDateForTooltip(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getContributionClass(count, maxDailyCount) {
  if (!maxDailyCount || count <= 0) return "bg-muted/40";
  const ratio = count / maxDailyCount;
  if (ratio < 0.25) return "bg-primary/25";
  if (ratio < 0.5) return "bg-primary/45";
  if (ratio < 0.75) return "bg-primary/70";
  return "bg-primary";
}

export function TypeGraph({
  activityData = [],
  maxDailyCount = 0,
  days = 364,
  title = "Type Graph",
}) {
  const activityByDate = useMemo(() => {
    const map = new Map();
    for (const day of activityData) {
      map.set(day.date, day.count);
    }
    return map;
  }, [activityData]);

  const graphDays = useMemo(() => {
    const list = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(today.getDate() - (days - 1));

    for (let i = 0; i < days; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const dateKey = date.toISOString().slice(0, 10);
      list.push({
        date: dateKey,
        count: activityByDate.get(dateKey) || 0,
      });
    }

    return list;
  }, [activityByDate, days]);

  const weeks = useMemo(() => {
    const list = [];
    for (let index = 0; index < graphDays.length; index += 7) {
      list.push(graphDays.slice(index, index + 7));
    }
    return list;
  }, [graphDays]);

  const totalGames = useMemo(
    () => graphDays.reduce((sum, day) => sum + day.count, 0),
    [graphDays]
  );

  const resolvedMax = useMemo(() => {
    if (maxDailyCount > 0) return maxDailyCount;
    return graphDays.reduce((max, day) => Math.max(max, day.count), 0);
  }, [graphDays, maxDailyCount]);

  return (
    <div className="rounded-md border border-border/70 bg-card/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{title}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {totalGames} games in last {days} days
        </p>
      </div>

      <TooltipProvider delayDuration={100}>
        <div className="mt-3 overflow-x-auto pb-1">
          <div className="inline-flex min-w-max gap-1">
            {weeks.map((week, weekIndex) => (
              <div key={`week-${weekIndex}`} className="grid grid-rows-7 gap-1">
                {week.map((day) => (
                  <Tooltip key={day.date}>
                    <TooltipTrigger asChild>
                      <div
                        aria-label={`${formatDateForTooltip(day.date)}: ${day.count} game${day.count === 1 ? "" : "s"}`}
                        className={`h-3.5 w-3.5 rounded-[3px] border border-border/50 ${getContributionClass(
                          day.count,
                          resolvedMax
                        )}`}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={8}>
                      {formatDateForTooltip(day.date)}: {day.count} game{day.count === 1 ? "" : "s"}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            ))}
          </div>
        </div>
      </TooltipProvider>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="uppercase tracking-wide">Legend</span>
        <span className="tabular-nums">0</span>
        <span className="h-2.5 w-2.5 rounded-[2px] border border-border/50 bg-muted/40" />
        <span className="h-2.5 w-2.5 rounded-[2px] border border-border/50 bg-primary/25" />
        <span className="h-2.5 w-2.5 rounded-[2px] border border-border/50 bg-primary/45" />
        <span className="h-2.5 w-2.5 rounded-[2px] border border-border/50 bg-primary/70" />
        <span className="h-2.5 w-2.5 rounded-[2px] border border-border/50 bg-primary" />
        <span className="tabular-nums">{resolvedMax || 0}+</span>
      </div>
    </div>
  );
}
