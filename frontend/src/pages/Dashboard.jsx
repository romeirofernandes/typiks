import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const MODE_ORDER = [15, 30, 60, 120];

export default function Dashboard() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [userStats, setUserStats] = useState(null);
  const [activityData, setActivityData] = useState([]);
  const [maxDailyCount, setMaxDailyCount] = useState(0);

  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!currentUser) {
        setLoading(false);
        return;
      }

      try {
        const idToken = await currentUser.getIdToken();
        const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
        const fullUrl = serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;

        const [statsResponse, activityResponse] = await Promise.all([
          fetch(`${fullUrl}/api/users/${currentUser.uid}/stats`, {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }),
          fetch(`${fullUrl}/api/users/${currentUser.uid}/activity?days=365`, {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }),
        ]);

        if (statsResponse.ok) {
          const data = await statsResponse.json();
          setUserStats(data);
        }

        if (activityResponse.ok) {
          const data = await activityResponse.json();
          setActivityData(data.activity || []);
          setMaxDailyCount(data.maxCount || 0);
        }
      } catch (error) {
        console.error("Failed to fetch dashboard data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [currentUser]);

  const currentHour = new Date().getHours();
  let greeting = "Good evening";
  if (currentHour < 12) greeting = "Good morning";
  else if (currentHour < 18) greeting = "Good afternoon";

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

  const calendarWeeks = useMemo(() => {
    const weeks = [];
    for (let index = 0; index < activityData.length; index += 7) {
      weeks.push(activityData.slice(index, index + 7));
    }
    return weeks;
  }, [activityData]);

  const totalYearGames = useMemo(
    () => activityData.reduce((sum, day) => sum + day.count, 0),
    [activityData]
  );

  const getContributionClass = (count) => {
    if (!maxDailyCount || count <= 0) return "bg-muted/40";
    const ratio = count / maxDailyCount;
    if (ratio < 0.25) return "bg-primary/25";
    if (ratio < 0.5) return "bg-primary/45";
    if (ratio < 0.75) return "bg-primary/70";
    return "bg-primary";
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-[60svh] items-center justify-center text-foreground">
        <p className="font-mono text-sm text-muted-foreground">Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/70 pb-5">
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Dashboard</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          {greeting}, {username}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review your ranked performance, then queue your next mode.
        </p>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {quickStats.map((stat) => (
          <div key={stat.label} className="rounded-md border border-border/70 bg-card/30 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.05fr_1.95fr]">
        <section className="rounded-md border border-border/70 bg-card/30 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Mode Ratings</p>
            <Button size="sm" onClick={() => navigate("/start-game")}>Play Ranked</Button>
          </div>

          <div className="mt-3 space-y-2">
            {modeRows.map((mode) => (
              <div
                key={mode.modeSeconds}
                className="grid grid-cols-[64px_1fr_1fr_1fr] items-center rounded border border-border/70 bg-background/60 px-3 py-2 text-sm"
              >
                <span className="font-mono tabular-nums text-muted-foreground">{mode.modeSeconds}s</span>
                <span className="font-mono tabular-nums">{mode.rating}</span>
                <span className="font-mono tabular-nums text-muted-foreground">{mode.gamesPlayed} games</span>
                <span className="font-mono tabular-nums text-muted-foreground">avg {mode.averageScore.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-md border border-border/70 bg-card/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Contribution Calendar</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {totalYearGames} games in last 365 days
            </p>
          </div>

          <div className="mt-3 overflow-x-auto pb-1">
            <div className="inline-flex min-w-max gap-1">
              {calendarWeeks.map((week, weekIndex) => (
                <div key={`week-${weekIndex}`} className="grid grid-rows-7 gap-1">
                  {week.map((day) => (
                    <div
                      key={day.date}
                      title={`${day.date}: ${day.count} game${day.count === 1 ? "" : "s"}`}
                      className={`h-3.5 w-3.5 rounded-[3px] border border-border/50 ${getContributionClass(day.count)}`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="tabular-nums">Peak day: {maxDailyCount} game{maxDailyCount === 1 ? "" : "s"}</span>
            <div className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-[2px] border border-border/50 bg-muted/40" />
              <span className="h-2.5 w-2.5 rounded-[2px] border border-border/50 bg-primary/25" />
              <span className="h-2.5 w-2.5 rounded-[2px] border border-border/50 bg-primary/45" />
              <span className="h-2.5 w-2.5 rounded-[2px] border border-border/50 bg-primary/70" />
              <span className="h-2.5 w-2.5 rounded-[2px] border border-border/50 bg-primary" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
