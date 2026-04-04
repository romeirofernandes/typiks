import { useEffect, useMemo, useRef, useState } from "react";
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

function toLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getContributionClass(count, maxDailyCount) {
  if (!maxDailyCount || count <= 0) return "bg-muted/40";
  const ratio = count / maxDailyCount;
  if (ratio < 0.25) return "bg-primary/25";
  if (ratio < 0.5) return "bg-primary/45";
  if (ratio < 0.75) return "bg-primary/70";
  return "bg-primary";
}

// Adjust these values if you want different day ranges on phones/tablets.
const DAYS_BY_DEVICE = {
  mobile: 105,
  tablet: 259,
};

function getDaysForViewport(desktopDays) {
  if (typeof window === "undefined") return desktopDays;
  const width = window.innerWidth;
  if (width < 768) return DAYS_BY_DEVICE.mobile;
  if (width < 1024) return DAYS_BY_DEVICE.tablet;
  return desktopDays;
}

export function TypeGraph({
  activityData = [],
  maxDailyCount = 0,
  days = 364,
  title = "Type Graph",
}) {
  const scrollContainerRef = useRef(null);
  const [visibleDays, setVisibleDays] = useState(() => getDaysForViewport(days));

  useEffect(() => {
    const handleResize = () => {
      setVisibleDays(getDaysForViewport(days));
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [days]);

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
    start.setDate(today.getDate() - (visibleDays - 1));

    for (let i = 0; i < visibleDays; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const dateKey = toLocalDateKey(date);
      list.push({
        date: dateKey,
        count: activityByDate.get(dateKey) || 0,
      });
    }

    return list;
  }, [activityByDate, visibleDays]);

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

  useEffect(() => {
    const node = scrollContainerRef.current;
    if (!node) return;

    const frameId = requestAnimationFrame(() => {
      node.scrollLeft = node.scrollWidth;
    });

    return () => cancelAnimationFrame(frameId);
  }, [weeks.length]);

  return (
    <div className="rounded-md border border-border/70 bg-card/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{title}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {totalGames} games in last {visibleDays} days
        </p>
      </div>

      <TooltipProvider delayDuration={100}>
        <div
          ref={scrollContainerRef}
          className="scroll-container mt-3 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
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
