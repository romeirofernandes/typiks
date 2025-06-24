import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeftIcon,
  StarIcon,
} from "@radix-ui/react-icons";
import { TbAward } from "react-icons/tb";

const Leaderboard = () => {
  const navigate = useNavigate();
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const serverUrl = import.meta.env.VITE_SERVER_URL || "localhost:8787";
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
        return <TbAward className="w-5 h-5 text-yellow-500" />;
      case 2:
        return <TbAward className="w-5 h-5 text-gray-400" />;
      case 3:
        return <TbAward className="w-5 h-5 text-amber-600" />;
      default:
        return <span className="text-muted-foreground" />;
    }
  };

  const getRatingColor = (rating) => {
    if (rating >= 1600) return "text-purple-500";
    if (rating >= 1400) return "text-blue-500";
    if (rating >= 1200) return "text-green-500";
    if (rating >= 1000) return "text-yellow-500";
    return "text-gray-500";
  };

  const getRatingBadge = (rating) => {
    if (rating >= 1600)
      return {
        label: "Expert",
        color:
          "bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300",
      };
    if (rating >= 1400)
      return {
        label: "Advanced",
        color:
          "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300",
      };
    if (rating >= 1200)
      return {
        label: "Intermediate",
        color:
          "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300",
      };
    if (rating >= 1000)
      return {
        label: "Beginner",
        color:
          "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300",
      };
    return {
      label: "Novice",
      color: "bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300",
    };
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex items-center gap-4 mb-8"
        >
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button
              variant="outline"
              onClick={() => navigate("/dashboard")}
              className="gap-2"
            >
              <ArrowLeftIcon className="w-4 h-4" />
            </Button>
          </motion.div>
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
                    color:
                      "bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300",
                  },
                  {
                    label: "Advanced",
                    range: "1400+",
                    color:
                      "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300",
                  },
                  {
                    label: "Intermediate",
                    range: "1200+",
                    color:
                      "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300",
                  },
                  {
                    label: "Beginner",
                    range: "1000+",
                    color:
                      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300",
                  },
                  {
                    label: "Novice",
                    range: "800+",
                    color:
                      "bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300",
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
                    color:
                      "bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300",
                  },
                  {
                    label: "Advanced",
                    range: "1400+",
                    color:
                      "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300",
                  },
                  {
                    label: "Intermediate",
                    range: "1200+",
                    color:
                      "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300",
                  },
                  {
                    label: "Beginner",
                    range: "1000+",
                    color:
                      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300",
                  },
                  {
                    label: "Novice",
                    range: "800+",
                    color:
                      "bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300",
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
                    color:
                      "bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300",
                  },
                  {
                    label: "Advanced",
                    range: "1400+",
                    color:
                      "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300",
                  },
                  {
                    label: "Intermediate",
                    range: "1200+",
                    color:
                      "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300",
                  },
                  {
                    label: "Beginner",
                    range: "1000+",
                    color:
                      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300",
                  },
                  {
                    label: "Novice",
                    range: "800+",
                    color:
                      "bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300",
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
