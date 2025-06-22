import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from "recharts";
import {
  FiPlay,
  FiTrendingUp,
  FiTarget,
  FiAward,
  FiActivity,
  FiLogOut,
} from "react-icons/fi";
import { auth } from "@/firebase";

const Dashboard = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [userStats, setUserStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUserStats = async () => {
      if (!currentUser) return;

      try {
        const serverUrl = import.meta.env.VITE_SERVER_URL || "localhost:8787";
        const fullUrl = serverUrl.startsWith('http') ? serverUrl : `http://${serverUrl}`;
        
        const response = await fetch(
          `${fullUrl}/api/users/${currentUser.uid}/stats`
        );

        if (response.ok) {
          const data = await response.json();
          setUserStats(data);
        }
      } catch (error) {
        console.error("Failed to fetch user stats:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchUserStats();
  }, [currentUser]);

  const chartData = userStats
    ? [
        {
          name: "Wins",
          value: userStats.gamesWon,
          fill: "hsl(var(--chart-1))",
        },
        {
          name: "Losses",
          value: userStats.gamesLost,
          fill: "hsl(var(--chart-2))",
        },
      ]
    : [];

  const performanceData = userStats
    ? [
        { month: "Week 1", games: Math.floor(userStats.gamesPlayed * 0.2) },
        { month: "Week 2", games: Math.floor(userStats.gamesPlayed * 0.3) },
        { month: "Week 3", games: Math.floor(userStats.gamesPlayed * 0.25) },
        { month: "Week 4", games: Math.floor(userStats.gamesPlayed * 0.25) },
      ]
    : [];

  const chartConfig = {
    games: {
      label: "Games",
      color: "hsl(var(--chart-1))",
    },
  };

  const pieConfig = {
    wins: {
      label: "Wins",
      color: "hsl(var(--chart-1))",
    },
    losses: {
      label: "Losses",
      color: "hsl(var(--chart-2))",
    },
  };

  const handleStartGame = () => {
    // Navigate to game page when implemented
    console.log("Starting game...");
  };

  const handleSignOut = async () => {
    try {
      await auth.signOut();
      navigate("/");
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
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
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center justify-between mb-8"
        >
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold">
                Welcome back, {userStats?.username || "Player"}
              </h1>
              <p className="text-muted-foreground">
                Ready for your next typing challenge?
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button onClick={handleStartGame} className="gap-2">
                <FiPlay className="w-4 h-4" />
                Start Playing
              </Button>
            </motion.div>

            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button
                variant="outline"
                onClick={handleSignOut}
                className="gap-2"
              >
                <FiLogOut className="w-4 h-4" />
                Sign Out
              </Button>
            </motion.div>
          </div>
        </motion.div>

        {/* Stats Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8"
        >
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Games</CardTitle>
              <FiActivity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {userStats?.gamesPlayed || 0}
              </div>
              <p className="text-xs text-muted-foreground">Games completed</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Games Won</CardTitle>
              <FiAward className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {userStats?.gamesWon || 0}
              </div>
              <p className="text-xs text-muted-foreground">
                Victories achieved
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
              <FiTarget className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {userStats?.winRate || 0}%
              </div>
              <p className="text-xs text-muted-foreground">
                Success percentage
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Performance</CardTitle>
              <FiTrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {userStats?.winRate >= 70
                  ? "Excellent"
                  : userStats?.winRate >= 50
                  ? "Good"
                  : "Improving"}
              </div>
              <p className="text-xs text-muted-foreground">Current level</p>
            </CardContent>
          </Card>
        </motion.div>

        {/* Charts - Fixed Height */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Performance Chart */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Card className="h-80">
              <CardHeader>
                <CardTitle>Weekly Activity</CardTitle>
              </CardHeader>
              <CardContent className="flex-1">
                <ChartContainer config={chartConfig} className="h-48">
                  <BarChart data={performanceData}>
                    <XAxis
                      dataKey="month"
                      tickLine={false}
                      tickMargin={10}
                      axisLine={false}
                      tickFormatter={(value) => value.slice(0, 3)}
                    />
                    <YAxis hide />
                    <ChartTooltip
                      cursor={false}
                      content={<ChartTooltipContent hideLabel />}
                    />
                    <Bar dataKey="games" fill="var(--color-games)" radius={8} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </motion.div>

          {/* Win/Loss Ratio */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <Card className="h-80">
              <CardHeader>
                <CardTitle>Win/Loss Ratio</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <ChartContainer config={pieConfig} className="h-40 flex-1">
                  <PieChart>
                    <ChartTooltip
                      cursor={false}
                      content={<ChartTooltipContent hideLabel />}
                    />
                    <Pie
                      data={chartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      strokeWidth={5}
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <div className="flex justify-center gap-4 mt-4">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-chart-1"></div>
                    <span className="text-sm text-muted-foreground">Wins</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-chart-2"></div>
                    <span className="text-sm text-muted-foreground">
                      Losses
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Recent Achievement Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-6"
        >
          <Card>
            <CardHeader>
              <CardTitle>Keep Going!</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">
                {userStats?.gamesPlayed === 0
                  ? "Start your typing journey by playing your first game!"
                  : `You've played ${userStats.gamesPlayed} games so far. ${
                      userStats.winRate >= 50
                        ? "Great job!"
                        : "Keep practicing to improve your skills!"
                    }`}
              </p>
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Button onClick={handleStartGame} className="w-full gap-2">
                  <FiPlay className="w-4 h-4" />
                  {userStats?.gamesPlayed === 0
                    ? "Play Your First Game"
                    : "Play Another Game"}
                </Button>
              </motion.div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
};

export default Dashboard;