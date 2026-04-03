import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { TypeGraph } from "@/components/charts/TypeGraph";
import { RatingGrowthChart } from "@/components/charts/RatingGrowthChart";

const MODE_ORDER = [15, 30, 60, 120];
const CONTRIBUTION_DAYS = 364; // 52 columns x 7 rows

export default function Dashboard() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [userStats, setUserStats] = useState(null);
  const [activityData, setActivityData] = useState([]);
  const [maxDailyCount, setMaxDailyCount] = useState(0);
  const [selectedMode, setSelectedMode] = useState(15);
  const [ratingTrend, setRatingTrend] = useState([]);

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
          fetch(`${fullUrl}/api/users/${currentUser.uid}/activity?days=${CONTRIBUTION_DAYS}`, {
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

  useEffect(() => {
    const fetchRatingTrend = async () => {
      if (!currentUser) return;

      try {
        const idToken = await currentUser.getIdToken();
        const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
        const fullUrl = serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;

        const response = await fetch(
          `${fullUrl}/api/users/${currentUser.uid}/rating-trend?modeSeconds=${selectedMode}&limit=120`,
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          setRatingTrend(data.points || []);
        } else {
          setRatingTrend([]);
        }
      } catch (error) {
        console.error("Failed to fetch rating trend:", error);
        setRatingTrend([]);
      }
    };

    fetchRatingTrend();
  }, [currentUser, selectedMode]);

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
      <div className="flex h-full min-h-[60svh] items-center justify-center text-foreground">
        <p className="font-mono text-sm text-muted-foreground">Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-4">
      <header className="border-b border-border/70 pb-4">
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Dashboard</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{greeting}, {username}</h1>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        <Button className="h-14 text-sm sm:h-16 sm:text-base" onClick={() => navigate("/start-game")}>Start Ranked Match</Button>
        <Button variant="outline" className="h-14 text-sm sm:h-16 sm:text-base" onClick={() => navigate("/create-room")}>Create Friendly Room</Button>
        <Button variant="secondary" className="h-14 text-sm sm:h-16 sm:text-base" onClick={() => navigate("/leaderboard")}>Open Leaderboard</Button>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {quickStats.map((stat) => (
          <div key={stat.label} className="rounded-md border border-border/70 bg-card/30 p-4 sm:p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{stat.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums sm:text-3xl">{stat.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_1.95fr]">
        <div className="rounded-md border border-border/70 bg-card/30 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Mode Ratings</p>
          </div>

          <div className="mt-3 space-y-2">
            {modeRows.map((mode) => (
              <div
                key={mode.modeSeconds}
                className="grid grid-cols-[56px_1fr_1fr_1fr] items-center rounded border border-border/70 bg-background/60 px-3 py-2 text-sm"
              >
                <span className="font-mono tabular-nums text-muted-foreground">{mode.modeSeconds}s</span>
                <span className="font-mono tabular-nums">{mode.rating}</span>
                <span className="font-mono tabular-nums text-muted-foreground">{mode.gamesPlayed} games</span>
                <span className="font-mono tabular-nums text-muted-foreground">avg {mode.averageScore.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>

        <TypeGraph
          title="Type Graph"
          activityData={activityData}
          maxDailyCount={maxDailyCount}
          days={CONTRIBUTION_DAYS}
        />
      </section>

      <section className="rounded-md border border-border/70 bg-card/30 p-4">
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
      </section>
    </div>
  );
}
