import { useMemo } from "react";
import { useStats } from "@/hooks/useStats";
import { m, useReducedMotion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { SharedLayoutBg } from "@/components/motion/shared-layout-bg";
import { useNavigate } from "react-router-dom";

const RANKED_MODES = [15, 30, 60];

const MODE_BACKGROUNDS = {
  15: {
    light: "/ranked_bgs/15seconds-light.png",
    dark: "/ranked_bgs/15seconds-dark.png",
  },
  30: {
    light: "/ranked_bgs/30seconds-light.png",
    dark: "/ranked_bgs/30seconds-dark.png",
  },
  60: {
    light: "/ranked_bgs/60seconds-light.png",
    dark: "/ranked_bgs/60seconds-dark.png",
  },
};

const defaultModeStats = (modeSeconds) => ({
  modeSeconds,
  rating: 800,
  gamesPlayed: 0,
  averageScore: 0,
});

export default function StartGame() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const { stats, loading: loadingStats } = useStats();

  const modeStats = useMemo(() => {
    if (!stats) return [];
    const byMode = new Map((stats.modeStats || []).map((entry) => [entry.modeSeconds, entry]));
    return RANKED_MODES.map((modeSeconds) => {
      const entry = byMode.get(modeSeconds);
      if (!entry) return defaultModeStats(modeSeconds);
      return {
        modeSeconds,
        rating: entry.rating || 800,
        gamesPlayed: entry.gamesPlayed || 0,
        averageScore: Number(entry.averageScore || 0),
      };
    });
  }, [stats]);

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

  return (
    <m.div
      initial={{ opacity: 0, y: reduceMotion ? 0 : -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="flex min-h-full min-w-0 flex-col"
    >
      <m.div
        initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.06 }}
        className="border-b border-border/70 pb-4"
      >
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Ranked Match</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Choose Your Mode</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a timer. Each mode keeps separate rating and score average.
        </p>
      </m.div>

      <SharedLayoutBg
        inset={1}
        className="mt-6 grid min-h-0 grid-cols-1 gap-6 sm:flex-1 sm:grid-cols-2 lg:grid-cols-3"
        pillClassName="rounded-md"
      >
        {loadingStats
          ? RANKED_MODES.map((modeSeconds) => (
              <article
                key={`skeleton-${modeSeconds}`}
                className="flex h-full flex-col overflow-hidden rounded-md border border-border/70 bg-card/45"
              >
                <Skeleton className="absolute inset-0" />
                <div className="relative z-10 mt-auto flex items-center gap-4 p-3 sm:p-4">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="ml-auto h-3 w-20" />
                </div>
              </article>
            ))
          : null}

        {!loadingStats
          ? featuredModes.map((mode, index) => {
              const backgrounds = MODE_BACKGROUNDS[mode.modeSeconds];
              return (
                <ModeCard
                  key={mode.modeSeconds}
                  mode={mode}
                  backgrounds={backgrounds}
                  delay={0.12 + index * 0.06}
                  reduceMotion={reduceMotion}
                  onStart={() =>
                    navigate("/game", {
                      state: {
                        fromDashboard: true,
                        modeSeconds: mode.modeSeconds,
                      },
                    })
                  }
                />
              );
            })
          : null}
      </SharedLayoutBg>
    </m.div>
  );
}

function ModeCard({ mode, backgrounds, onStart, delay = 0, reduceMotion = false }) {
  return (
    <m.article
      onClick={onStart}
      role="button"
      tabIndex={0}
      aria-label={`Start ${mode.label} game`}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onStart();
        }
      }}
      initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
      className="group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-md bg-transparent max-sm:aspect-[2/3]"
    >
      {backgrounds ? (
        <>
          <div className="pointer-events-none absolute inset-2 overflow-hidden rounded-sm">
            <img
              src={backgrounds.light}
              alt=""
              loading="eager"
              decoding="async"
              className="ranked-bg h-full w-full object-cover object-top sm:object-fill dark:hidden"
            />
            <img
              src={backgrounds.dark}
              alt=""
              loading="eager"
              decoding="async"
              className="ranked-bg hidden h-full w-full object-cover object-top sm:object-fill dark:block"
            />
          </div>
        </>
      ) : null}

      <div
        className="relative z-10 mt-auto p-3 sm:p-4"
      >
        <div className="ml-auto flex w-fit items-center gap-3 rounded-md border border-border/50 bg-background/80 px-3 py-2 backdrop-blur-sm">
          <div className="text-right">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Rating</p>
            <p className="text-base font-bold leading-none tabular-nums text-foreground">{mode.rating}</p>
          </div>
          <div className="h-7 w-px bg-border/60" />
          <div className="text-right">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Avg</p>
            <p className="text-base font-bold leading-none tabular-nums text-foreground">{mode.averageScore.toFixed(1)}</p>
          </div>
        </div>
        <p className="mt-1.5 text-right text-[11px] text-muted-foreground tabular-nums">
          {mode.gamesPlayed} games played
        </p>
      </div>
    </m.article>
  );
}
