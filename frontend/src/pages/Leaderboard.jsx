import React, { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StarIcon } from "@radix-ui/react-icons";
import { TbAward } from "react-icons/tb";

const RATING_TIERS = [
  {
    min: 1600,
    label: "Expert",
    color: "bg-chart-5/15 text-chart-5 border-chart-5/25",
  },
  {
    min: 1400,
    label: "Advanced",
    color: "bg-chart-4/15 text-chart-4 border-chart-4/25",
  },
  {
    min: 1200,
    label: "Intermediate",
    color: "bg-chart-3/15 text-chart-3 border-chart-3/25",
  },
  {
    min: 1000,
    label: "Beginner",
    color: "bg-chart-2/15 text-chart-2 border-chart-2/25",
  },
  {
    min: 0,
    label: "Novice",
    color: "bg-muted text-muted-foreground border-border",
  },
];

const Leaderboard = () => {
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
        const fullUrl = serverUrl.startsWith("http")
          ? serverUrl
          : `http://${serverUrl}`;

        const response = await fetch(`${fullUrl}/api/users/leaderboard/top`);

        if (response.ok) {
          const data = await response.json();
          setLeaderboard(data.leaderboard);
        }
      } catch (error) {
        console.error("Failed to fetch leaderboard:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
  }, []);

  const getRankIcon = (rank) => {
    switch (rank) {
      case 1:
        return <TbAward className="h-5 w-5 text-chart-1" />;
      case 2:
        return <TbAward className="h-5 w-5 text-chart-2" />;
      case 3:
        return <TbAward className="h-5 w-5 text-chart-3" />;
      default:
        return null;
    }
  };

  const getRatingColor = (rating) => {
    if (rating >= 1600) return "text-chart-5";
    if (rating >= 1400) return "text-chart-4";
    if (rating >= 1200) return "text-chart-3";
    if (rating >= 1000) return "text-chart-2";
    return "text-muted-foreground";
  };

  const getRatingBadge = (rating) => {
    return RATING_TIERS.find((tier) => rating >= tier.min) || RATING_TIERS.at(-1);
  };

  const topThree = useMemo(
    () => leaderboard.filter((player) => player.rank <= 3).sort((a, b) => a.rank - b.rank),
    [leaderboard]
  );

  const podium = useMemo(
    () => [2, 1, 3].map((rank) => topThree.find((player) => player.rank === rank)).filter(Boolean),
    [topThree]
  );

  const summary = useMemo(() => {
    if (!leaderboard.length) {
      return { players: 0, averageRating: 0, topWinRate: 0 };
    }

    const totalRating = leaderboard.reduce((sum, player) => sum + (player.rating || 0), 0);
    const topWinRate = Math.max(...leaderboard.map((player) => Number(player.winRate) || 0));

    return {
      players: leaderboard.length,
      averageRating: Math.round(totalRating / leaderboard.length),
      topWinRate,
    };
  }, [leaderboard]);

  if (loading) {
    return (
      <div className="flex min-h-[60svh] items-center justify-center">
        <div className="w-full max-w-3xl space-y-3">
          <div className="h-10 animate-pulse rounded-md bg-muted" />
          <div className="h-36 animate-pulse rounded-md bg-muted" />
          <div className="h-72 animate-pulse rounded-md bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[78svh] text-foreground">
      <div className="space-y-5">
        <motion.div
          initial={{ opacity: 0, y: reduceMotion ? 0 : -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="space-y-4"
        >
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/80 pb-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Season Ranking
              </p>
              <h1 className="mt-1 text-2xl font-sans font-semibold sm:text-3xl">
                Leaderboard
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-border bg-background/80 px-3 py-1 tabular-nums">
                {summary.players} players
              </span>
              <span className="rounded-full border border-border bg-background/80 px-3 py-1 tabular-nums">
                Avg {summary.averageRating}
              </span>
              <span className="rounded-full border border-border bg-background/80 px-3 py-1 tabular-nums">
                Best {summary.topWinRate}%
              </span>
            </div>
          </div>

          {podium.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-3 sm:items-end">
              {podium.map((player, index) => (
                <motion.div
                  key={player.username}
                  initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: index * 0.04 }}
                  className={`rounded-md border border-border/70 bg-card p-3 ${
                    player.rank === 1 ? "sm:min-h-[172px]" : player.rank === 2 ? "sm:min-h-[148px]" : "sm:min-h-[132px]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getRankIcon(player.rank)}
                      <p className="text-sm font-medium">#{player.rank}</p>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {player.winRate}% WR
                    </span>
                  </div>
                  <p className="mt-2 truncate text-lg font-semibold">{player.username}</p>
                  <p
                    className={`mt-1 text-sm font-medium tabular-nums ${getRatingColor(
                      player.rating
                    )}`}
                  >
                    {player.rating} rating
                  </p>
                </motion.div>
              ))}
            </div>
          ) : null}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.08 }}
        >
          <Card className="border-border/80 bg-card/85 backdrop-blur-[1px]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <StarIcon className="h-5 w-5 text-primary" />
                Rankings
              </CardTitle>
            </CardHeader>

            <CardContent className="p-0">
              {leaderboard.length === 0 ? (
                <div className="px-4 pb-6 pt-2 text-sm text-muted-foreground">
                  No players ranked yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px]">
                    <thead>
                      <tr className="border-y border-border/80 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3">Rank</th>
                        <th className="px-4 py-3">Player</th>
                        <th className="px-4 py-3">Tier</th>
                        <th className="px-4 py-3 text-right">Rating</th>
                        <th className="px-4 py-3 text-right">Games</th>
                        <th className="px-4 py-3 text-right">Win Rate</th>
                      </tr>
                    </thead>

                    <tbody>
                      {leaderboard.map((player, index) => {
                        const badge = getRatingBadge(player.rating);

                        return (
                          <motion.tr
                            key={player.username}
                            initial={{ opacity: 0, x: reduceMotion ? 0 : -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.2, delay: 0.1 + index * 0.03 }}
                            className={`border-b border-border/70 ${
                              player.rank <= 3 ? "bg-primary/5" : ""
                            }`}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2 font-medium tabular-nums">
                                <span className="inline-flex h-5 w-5 items-center justify-center">
                                  {getRankIcon(player.rank)}
                                </span>
                                <span className="w-5 text-right">{player.rank}</span>
                              </div>
                            </td>

                            <td className="px-4 py-3">
                              <span className="font-semibold">{player.username}</span>
                            </td>

                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badge.color}`}
                              >
                                {badge.label}
                              </span>
                            </td>

                            <td className="px-4 py-3 text-right">
                              <span
                                className={`text-base font-semibold tabular-nums ${getRatingColor(
                                  player.rating
                                )}`}
                              >
                                {player.rating}
                              </span>
                            </td>

                            <td className="px-4 py-3 text-right tabular-nums">{player.gamesPlayed}</td>
                            <td className="px-4 py-3 text-right font-medium tabular-nums">
                              {player.winRate}%
                            </td>
                          </motion.tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.14 }}
          className="flex flex-wrap gap-2"
        >
          {RATING_TIERS.map((tier) => (
            <span
              key={tier.label}
              className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${tier.color}`}
            >
              {tier.label}
            </span>
          ))}
        </motion.div>
      </div>
    </div>
  );
};

export default Leaderboard;
