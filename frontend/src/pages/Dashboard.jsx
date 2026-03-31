import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";

import { CardTitle } from "@/components/ui/card";

export default function Dashboard() {
  const { currentUser } = useAuth();

  const [loading, setLoading] = useState(true);
  const [userStats, setUserStats] = useState(null);

  useEffect(() => {
    const fetchUserStats = async () => {
      if (!currentUser) {
        setLoading(false);
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
      label: "Games",
      value: userStats?.gamesPlayed || 0,
    },
    {
      label: "Wins",
      value: userStats?.gamesWon || 0,
    },
    {
      label: "Rating",
      value: userStats?.rating || 800,
    },
  ];

  if (loading) {
    return (
      <div className="flex h-full min-h-[60svh] items-center justify-center text-foreground">
        <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
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
          Pick an action from the sidebar to start your next match.
        </p>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {quickStats.map((stat) => (
          <div key={stat.label} className="rounded-md border border-border/70 bg-card/30 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 flex min-h-[40svh] flex-1 items-center justify-center rounded-lg border border-dashed border-border/70 px-4">
        <p className="max-w-md text-center text-sm text-muted-foreground">
          Main dashboard content area.
        </p>
      </div>
    </div>
  );
}
