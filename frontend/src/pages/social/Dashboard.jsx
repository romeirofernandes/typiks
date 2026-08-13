import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { useStats } from "@/hooks/useStats";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { TypeGraph } from "@/components/charts/TypeGraph";
import { RatingGrowthChart } from "@/components/charts/RatingGrowthChart";
import { apiFetch } from "@/lib/api-client";
import { userKeys } from "@/lib/query-keys";

const MODE_ORDER = [15, 30, 60];
const CONTRIBUTION_DAYS = 364; // 52 columns x 7 rows
const TYPEGRAPH_REDUCED_DAYS = 0;

export default function Dashboard() {
  const { state: { currentUser } } = useAuth();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  const { stats: userStats, loading: statsLoading } = useStats();
  const [selectedMode, setSelectedMode] = useState(15);

  const activityQuery = useQuery({
    queryKey: userKeys.activity(currentUser?.uid, CONTRIBUTION_DAYS),
    queryFn: () =>
      apiFetch(
        currentUser,
        `/api/users/${currentUser.uid}/activity?days=${CONTRIBUTION_DAYS}`
      ).then(({ data }) => ({ activity: data.activity || [], maxCount: data.maxCount || 0 })),
    enabled: Boolean(currentUser),
    staleTime: 60 * 1000,
  });

  const ratingTrendQuery = useQuery({
    queryKey: userKeys.ratingTrend(currentUser?.uid, selectedMode),
    queryFn: () =>
      apiFetch(
        currentUser,
        `/api/users/${currentUser.uid}/rating-trend?modeSeconds=${selectedMode}&limit=120`
      ).then(({ data }) => data.points || []),
    enabled: Boolean(currentUser),
    staleTime: 60 * 1000,
  });

  const activityData = activityQuery.data?.activity ?? [];
  const maxDailyCount = activityQuery.data?.maxCount ?? 0;
  const ratingTrend = ratingTrendQuery.data ?? [];
  const typeGraphDays = Math.max(28, CONTRIBUTION_DAYS - TYPEGRAPH_REDUCED_DAYS);
  const loading = statsLoading || activityQuery.isPending || ratingTrendQuery.isPending;

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  let greeting = "Good evening";
  if (currentHour < 12) greeting = "Good morning";
  else if (currentHour < 17 || (currentHour === 17 && currentMinute === 0)) greeting = "Good afternoon";

  const username =
    userStats?.username ||
    currentUser?.displayName ||
    currentUser?.email?.split("@")[0] ||
    "username";

  const quickStats = [
    {
      label: "Games Played",
      value: userStats?.gamesPlayed || 0,
    },
    {
      label: "Wins",
      value: userStats?.gamesWon || 0,
    },
    {
      label: "Win Rate",
      value: `${userStats?.winRate || 0}%`,
    },
    {
      label: "Global Rating",
      value: userStats?.rating || 800,
    },
  ];

  const modeRows = useMemo(() => {
    const byMode = new Map((userStats?.modeStats || []).map((mode) => [mode.modeSeconds, mode]));
    return MODE_ORDER.map((modeSeconds) => {
      const mode = byMode.get(modeSeconds);
      return {
        modeSeconds,
        rating: mode?.rating || 800,
        gamesPlayed: mode?.gamesPlayed || 0,
        averageScore: Number(mode?.averageScore || 0),
      };
    });
  }, [userStats]);

  if (loading) {
    return (
      <div className="flex min-h-full min-w-0 flex-col gap-4 xl:h-full">
        <header className="border-b border-border/70 pb-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-8 w-64" />
        </header>

        <section className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-14 sm:h-16" />
          <Skeleton className="h-14 sm:h-16" />
          <Skeleton className="h-14 sm:h-16" />
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="rounded-md border border-border/70 bg-card/30 p-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-7 w-20" />
            </div>
          ))}
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.05fr_1.95fr]">
          <div className="rounded-md border border-border/70 bg-card/30 p-3">
            <Skeleton className="h-3 w-28" />
            <div className="mt-2 space-y-2">
              {Array.from({ length: 4 }).map((_, idx) => (
                <Skeleton key={idx} className="h-9 w-full" />
              ))}
            </div>
          </div>
          <div className="rounded-md border border-border/70 bg-card/30 p-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-4 h-[110px] w-full" />
          </div>
        </section>

        <section className="flex flex-1 flex-col rounded-md border border-border/70 bg-card/30 p-4">
          <div className="mb-2 flex items-center justify-between">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-7 w-20" />
          </div>
          <Skeleton className="h-[130px] w-full" />
        </section>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: reduceMotion ? 0 : -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="flex min-h-full min-w-0 flex-col gap-4 xl:h-full"
    >
      <motion.header
        initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.06 }}
        className="border-b border-border/70 pb-4"
      >
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Dashboard</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{greeting}, {username}</h1>
      </motion.header>

      <motion.section
        initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.12 }}
        className="grid gap-3 md:grid-cols-3"
      >
        <Button className="h-14 text-sm sm:h-16 sm:text-base" onClick={() => navigate("/start-game")}>Start Ranked Match</Button>
        <Button variant="outline" className="h-14 text-sm sm:h-16 sm:text-base" onClick={() => navigate("/create-room")}>Create Friendly Room</Button>
        <Button variant="secondary" className="h-14 text-sm sm:h-16 sm:text-base" onClick={() => navigate("/leaderboard")}>Open Leaderboard</Button>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.18 }}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {quickStats.map((stat) => (
          <div key={stat.label} className="rounded-md border border-border/70 bg-card/30 p-3 sm:p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{stat.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums sm:text-3xl">{stat.value}</p>
          </div>
        ))}
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.24 }}
        className="grid min-w-0 gap-4 xl:grid-cols-[1.05fr_1.95fr]"
      >
        <div className="rounded-md border border-border/70 bg-card/30 p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Mode Ratings</p>
          </div>

          <div className="mt-3 space-y-2">
            {modeRows.map((mode) => (
              <div
                key={mode.modeSeconds}
                className="rounded border border-border/70 bg-background/60 px-3 py-2"
              >
                <div className="grid grid-cols-2 gap-2 text-xs sm:hidden">
                  <div className="flex flex-col gap-1">
                    <span className="font-mono tabular-nums text-muted-foreground">{mode.modeSeconds}s</span>
                    <span className="font-mono tabular-nums">{mode.rating}</span>
                  </div>
                  <div className="flex flex-col gap-1 text-muted-foreground">
                    <span className="font-mono tabular-nums">{mode.gamesPlayed} games</span>
                    <span className="font-mono tabular-nums">avg {mode.averageScore.toFixed(1)}</span>
                  </div>
                </div>
                <div className="hidden grid-cols-[56px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 text-sm sm:grid">
                  <span className="font-mono tabular-nums text-muted-foreground">{mode.modeSeconds}s</span>
                  <span className="font-mono tabular-nums">{mode.rating}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">{mode.gamesPlayed} games</span>
                  <span className="font-mono tabular-nums text-muted-foreground">avg {mode.averageScore.toFixed(1)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <TypeGraph
          title="Type Graph"
          activityData={activityData}
          maxDailyCount={maxDailyCount}
          days={typeGraphDays}
        />
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.3 }}
        className="flex min-w-0 flex-1 flex-col rounded-md border border-border/70 bg-card/30 p-3 sm:p-4 xl:min-h-0"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Rating Growth</p>
          <label className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">
            Mode
            <select
              className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
              value={selectedMode}
              onChange={(event) => setSelectedMode(Number(event.target.value))}
            >
              {MODE_ORDER.map((mode) => (
                <option key={mode} value={mode}>{mode}s</option>
              ))}
            </select>
          </label>
        </div>

        <RatingGrowthChart points={ratingTrend} />
      </motion.section>
    </motion.div>
  );
}
