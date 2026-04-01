import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { FiClock } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

const RANKED_MODES = [15, 30, 60, 120];

const defaultModeStats = (modeSeconds) => ({
  modeSeconds,
  rating: 800,
  gamesPlayed: 0,
  averageScore: 0,
});

export default function StartGame() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [loadingStats, setLoadingStats] = useState(true);
  const [modeStats, setModeStats] = useState(
    RANKED_MODES.map((modeSeconds) => defaultModeStats(modeSeconds))
  );

  const currentHour = new Date().getHours();
  let greeting = "Good evening";
  if (currentHour < 12) greeting = "Good morning";
  else if (currentHour < 18) greeting = "Good afternoon";

  const username =
    currentUser?.displayName ||
    currentUser?.email?.split("@")[0] ||
    "Player";

  useEffect(() => {
    const fetchStats = async () => {
      if (!currentUser) {
        setLoadingStats(false);
        return;
      }

      try {
        const idToken = await currentUser.getIdToken();
        const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
        const fullUrl = serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;

        const response = await fetch(`${fullUrl}/api/users/${currentUser.uid}/stats`, {
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        });

        if (response.ok) {
          const payload = await response.json();
          const byMode = new Map((payload.modeStats || []).map((entry) => [entry.modeSeconds, entry]));
          setModeStats(
            RANKED_MODES.map((modeSeconds) => {
              const entry = byMode.get(modeSeconds);
              if (!entry) return defaultModeStats(modeSeconds);
              return {
                modeSeconds,
                rating: entry.rating || 800,
                gamesPlayed: entry.gamesPlayed || 0,
                averageScore: Number(entry.averageScore || 0),
              };
            })
          );
        }
      } catch (error) {
        console.error("Failed to fetch mode stats:", error);
      } finally {
        setLoadingStats(false);
      }
    };

    fetchStats();
  }, [currentUser]);

  const featuredModes = useMemo(
    () =>
      modeStats.map((mode) => ({
        ...mode,
        title: `${mode.modeSeconds}s Ranked`,
      })),
    [modeStats]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/70 pb-4">
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Ranked Match</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          {greeting}, {username}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a timer. Each mode keeps separate rating and score average.
        </p>
      </div>

      <div className="mt-4 grid min-h-0 flex-1 auto-rows-fr grid-cols-1 gap-3 lg:grid-cols-2">
        {featuredModes.map((mode, index) => (
          <article
            key={mode.modeSeconds}
            className="relative flex h-full min-h-[220px] flex-col rounded-md border border-border/70 bg-card/45 p-4"
          >
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Mode {index + 1}
              </p>
              <span className="rounded-full border border-border/60 px-2 py-1 text-xs tabular-nums">
                {mode.modeSeconds}s
              </span>
            </div>

            <h2 className="mt-3 text-lg font-semibold text-foreground">{mode.title}</h2>

            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-border/60 bg-background/60 p-2.5">
                <p className="uppercase tracking-wide text-muted-foreground">Rating</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{mode.rating}</p>
              </div>
              <div className="rounded border border-border/60 bg-background/60 p-2.5">
                <p className="uppercase tracking-wide text-muted-foreground">Avg Score</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{mode.averageScore.toFixed(1)}</p>
              </div>
            </div>

            <div className="mt-auto pt-4">
              <p className="mb-3 text-xs text-muted-foreground tabular-nums">
                {mode.gamesPlayed} games played
              </p>

              <Button
                size="sm"
                className="h-11 w-full gap-2 text-sm"
                onClick={() =>
                  navigate("/game", {
                    state: {
                      fromDashboard: true,
                      modeSeconds: mode.modeSeconds,
                    },
                  })
                }
              >
                <FiClock size={16} className="shrink-0" />
                Queue {mode.modeSeconds}s
              </Button>
            </div>
          </article>
        ))}

        {loadingStats ? (
          <div className="col-span-full flex items-center justify-center py-4 text-muted-foreground">
            <span className="font-mono text-sm">Loading stats...</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
