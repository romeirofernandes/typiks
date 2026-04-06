import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FiClock } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";

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
  const [modeStats, setModeStats] = useState([]);
  const [isFastCardHovered, setIsFastCardHovered] = useState(false);
  const lightFastVideoRef = useRef(null);
  const darkFastVideoRef = useRef(null);

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
      (modeStats.length
        ? modeStats
        : RANKED_MODES.map((modeSeconds) => defaultModeStats(modeSeconds))
      ).map((mode) => ({
        ...mode,
        title: `${mode.modeSeconds}s Ranked`,
      })),
    [modeStats]
  );

  useEffect(() => {
    const lightVideo = lightFastVideoRef.current;
    const darkVideo = darkFastVideoRef.current;
    const isDarkTheme = document.documentElement.classList.contains("dark");
    const activeVideo = isDarkTheme ? darkVideo : lightVideo;
    const inactiveVideo = isDarkTheme ? lightVideo : darkVideo;

    if (inactiveVideo) {
      inactiveVideo.pause();
    }

    if (!activeVideo) return;

    activeVideo.defaultPlaybackRate = 1.04;
    activeVideo.playbackRate = 1.04;

    if (isFastCardHovered) {
      const playPromise = activeVideo.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          // ignore autoplay interruptions
        });
      }
    } else {
      activeVideo.pause();
    }
  }, [isFastCardHovered]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/70 pb-4">
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Ranked Match</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Choose Your Mode</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a timer. Each mode keeps separate rating and score average.
        </p>
      </div>

      <div className="mt-4 grid min-h-0 flex-1 auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-2">
        {loadingStats
          ? RANKED_MODES.map((modeSeconds, index) => (
              <article
                key={`skeleton-${modeSeconds}`}
                className="relative flex h-full min-h-[200px] flex-col rounded-md border border-border/70 bg-card/45 p-3 sm:min-h-[220px] sm:p-4"
              >
                <div className="flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    Mode {index + 1}
                  </p>
                  <span className="rounded-full border border-border/60 px-2 py-1 text-xs tabular-nums">
                    {modeSeconds}s
                  </span>
                </div>

                <Skeleton className="mt-3 h-6 w-36" />

                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded border border-border/60 bg-background/60 p-2.5">
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className="mt-2 h-6 w-16" />
                  </div>
                  <div className="rounded border border-border/60 bg-background/60 p-2.5">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="mt-2 h-6 w-14" />
                  </div>
                </div>

                <div className="mt-auto pt-4">
                  <Skeleton className="mb-3 h-3 w-24" />
                  <Skeleton className="h-11 w-full" />
                </div>
              </article>
            ))
          : null}

        {!loadingStats
          ? featuredModes.map((mode, index) => (
          <article
            key={mode.modeSeconds}
            className={`relative flex h-full min-h-[200px] flex-col overflow-hidden rounded-md border border-border/70 p-3 sm:min-h-[220px] sm:p-4 ${
              mode.modeSeconds === 15 ? "bg-card/20" : "bg-card/45"
            }`}
            onPointerEnter={mode.modeSeconds === 15 ? () => setIsFastCardHovered(true) : undefined}
            onPointerLeave={mode.modeSeconds === 15 ? () => setIsFastCardHovered(false) : undefined}
          >
            {mode.modeSeconds === 15 ? (
              <>
                <video
                  ref={lightFastVideoRef}
                  muted
                  loop
                  playsInline
                  preload="auto"
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover dark:hidden"
                >
                  <source src="/light-15.mp4" type="video/mp4" />
                </video>
                <video
                  ref={darkFastVideoRef}
                  muted
                  loop
                  playsInline
                  preload="auto"
                  className="pointer-events-none absolute inset-0 hidden h-full w-full object-cover dark:block"
                >
                  <source src="/dark-15.mp4" type="video/mp4" />
                </video>
                <div className="pointer-events-none absolute inset-0 bg-background/55 backdrop-blur-[1px] dark:bg-background/62" />
              </>
            ) : null}

            <div className="relative z-10 flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Mode {index + 1}
              </p>
              <span className="rounded-full border border-border/60 px-2 py-1 text-xs tabular-nums">
                {mode.modeSeconds}s
              </span>
            </div>

            <h2 className="mt-2 text-base font-semibold text-foreground sm:mt-3 sm:text-lg">{mode.title}</h2>

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
                className="h-10 w-full gap-2 text-xs sm:h-11 sm:text-sm"
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
            </div>
          </article>
        ))
          : null}
      </div>
    </div>
  );
}
