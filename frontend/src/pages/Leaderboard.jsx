import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  StarIcon,
} from "@radix-ui/react-icons";
import { TbAward } from "react-icons/tb";

const Leaderboard = () => {
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);

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
        return <TbAward className="w-5 h-5 text-chart-1" />;
      case 2:
        return <TbAward className="w-5 h-5 text-chart-2" />;
      case 3:
        return <TbAward className="w-5 h-5 text-chart-3" />;
      default:
        return <span className="text-muted-foreground" />;
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
    if (rating >= 1600)
      return {
        label: "Expert",
        color: "bg-chart-5/15 text-chart-5",
      };
    if (rating >= 1400)
      return {
        label: "Advanced",
        color: "bg-chart-4/15 text-chart-4",
      };
    if (rating >= 1200)
      return {
        label: "Intermediate",
        color: "bg-chart-3/15 text-chart-3",
      };
    if (rating >= 1000)
      return {
        label: "Beginner",
        color: "bg-chart-2/15 text-chart-2",
      };
    return {
      label: "Novice",
      color: "bg-muted text-muted-foreground",
    };
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-[60svh] items-center justify-center text-foreground">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent"
        />
      </div>
    );
  }

  return (
    <div className="h-full min-h-[78svh] text-foreground font-mono">
      <div className="w-full">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-6"
        >
          <h2 className="text-xl font-semibold">Leaderboard</h2>
        </motion.div>

        {/* Leaderboard Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <StarIcon className="w-5 h-5 text-primary" />
                Rankings
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left p-4 font-medium text-muted-foreground">
                        Rank
                      </th>
                      <th className="text-left p-4 font-medium text-muted-foreground">
                        Player
                      </th>
                      <th className="text-left p-4 font-medium text-muted-foreground">
                        Rating
                      </th>
                      <th className="text-left p-4 font-medium text-muted-foreground">
                        Level
                      </th>
                      <th className="text-left p-4 font-medium text-muted-foreground">
                        Games
                      </th>
                      <th className="text-left p-4 font-medium text-muted-foreground">
                        Win Rate
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((player, index) => (
                      <motion.tr
                        key={player.username}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className={`border-b border-border hover:bg-muted/50 transition-colors ${
                          player.rank <= 3 ? "bg-primary/5" : ""
                        }`}
                      >
                        {/* Rank */}
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            {getRankIcon(player.rank)}
                            <span className="font-medium">{player.rank}</span>
                          </div>
                        </td>

                        {/* Player */}
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">
                              {player.username}
                            </span>
                          </div>
                        </td>

                        {/* Rating */}
                        <td className="p-4">
                          <span
                            className={`text-xl font-bold ${getRatingColor(
                              player.rating
                            )}`}
                          >
                            {player.rating}
                          </span>
                        </td>

                        {/* Level Badge */}
                        <td className="p-4">
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium ${
                              getRatingBadge(player.rating).color
                            }`}
                          >
                            {getRatingBadge(player.rating).label}
                          </span>
                        </td>

                        {/* Games */}
                        <td className="p-4">
                          <div className="flex items-center gap-1">
                            <span>{player.gamesPlayed}</span>
                          </div>
                        </td>

                        {/* Win Rate */}
                        <td className="p-4">
                          <div className="flex items-center gap-1">
                            <span className="font-medium">
                              {player.winRate}%
                            </span>
                          </div>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-8"
        >
          <Card>
            <CardHeader>
              <CardTitle>Rating Scale</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Mobile Layout - Stacked */}
              <div className="grid grid-cols-1 gap-3 sm:hidden">
                {[
                  {
                    label: "Expert",
                    range: "1600+",
                    color: "bg-chart-5/15 text-chart-5",
                  },
                  {
                    label: "Advanced",
                    range: "1400+",
                    color: "bg-chart-4/15 text-chart-4",
                  },
                  {
                    label: "Intermediate",
                    range: "1200+",
                    color: "bg-chart-3/15 text-chart-3",
                  },
                  {
                    label: "Beginner",
                    range: "1000+",
                    color: "bg-chart-2/15 text-chart-2",
                  },
                  {
                    label: "Novice",
                    range: "800+",
                    color: "bg-muted text-muted-foreground",
                  },
                ].map((tier) => (
                  <div
                    key={tier.label}
                    className="flex items-center justify-between p-3 rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`px-3 py-1 rounded-full text-sm font-medium ${tier.color}`}
                      >
                        {tier.label}
                      </div>
                    </div>
                    <div className="text-sm font-medium text-muted-foreground">
                      {tier.range}
                    </div>
                  </div>
                ))}
              </div>

              {/* Tablet Layout - 2 columns */}
              <div className="hidden sm:grid lg:hidden grid-cols-2 gap-3">
                {[
                  {
                    label: "Expert",
                    range: "1600+",
                    color: "bg-chart-5/15 text-chart-5",
                  },
                  {
                    label: "Advanced",
                    range: "1400+",
                    color: "bg-chart-4/15 text-chart-4",
                  },
                  {
                    label: "Intermediate",
                    range: "1200+",
                    color: "bg-chart-3/15 text-chart-3",
                  },
                  {
                    label: "Beginner",
                    range: "1000+",
                    color: "bg-chart-2/15 text-chart-2",
                  },
                  {
                    label: "Novice",
                    range: "800+",
                    color: "bg-muted text-muted-foreground",
                  },
                ].map((tier) => (
                  <div
                    key={tier.label}
                    className="text-center p-3 rounded-lg border border-border"
                  >
                    <div
                      className={`px-3 py-1 rounded-full text-sm font-medium ${tier.color} mb-2 inline-block`}
                    >
                      {tier.label}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {tier.range}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Layout - 5 columns */}
              <div className="hidden lg:grid grid-cols-5 gap-3">
                {[
                  {
                    label: "Expert",
                    range: "1600+",
                    color: "bg-chart-5/15 text-chart-5",
                  },
                  {
                    label: "Advanced",
                    range: "1400+",
                    color: "bg-chart-4/15 text-chart-4",
                  },
                  {
                    label: "Intermediate",
                    range: "1200+",
                    color: "bg-chart-3/15 text-chart-3",
                  },
                  {
                    label: "Beginner",
                    range: "1000+",
                    color: "bg-chart-2/15 text-chart-2",
                  },
                  {
                    label: "Novice",
                    range: "800+",
                    color: "bg-muted text-muted-foreground",
                  },
                ].map((tier) => (
                  <div
                    key={tier.label}
                    className="text-center p-3 rounded-lg border border-border"
                  >
                    <div
                      className={`px-3 py-1 rounded-full text-sm font-medium ${tier.color} mb-2 inline-block`}
                    >
                      {tier.label}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {tier.range}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
};

export default Leaderboard;
