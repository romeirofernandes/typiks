import { useAuth } from "@/context/AuthContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ViewIcon } from "hugeicons-react";
import { useEffect, useMemo, useState } from "react";

const DEFAULT_ACTIVITY_DAYS = 91;

function buildBlankActivity(days = DEFAULT_ACTIVITY_DAYS) {
  const today = new Date();
  const points = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    points.push({
      date: date.toISOString().slice(0, 10),
      count: 0,
    });
  }

  return points;
}

const Profile = () => {
  const { currentUser } = useAuth();
  const [stats, setStats] = useState(null);
  const [activityData, setActivityData] = useState([]);
  const [maxCount, setMaxCount] = useState(0);

  const username =
    currentUser?.displayName ||
    currentUser?.email?.split("@")[0] ||
    "Player";

  useEffect(() => {
    const fetchProfileData = async () => {
      if (!currentUser) return;

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
          fetch(`${fullUrl}/api/users/${currentUser.uid}/activity?days=91`, {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }),
        ]);

        if (statsResponse.ok) {
          const payload = await statsResponse.json();
          setStats(payload);
        }

        if (activityResponse.ok) {
          const payload = await activityResponse.json();
          setActivityData(payload.activity || []);
          setMaxCount(payload.maxCount || 0);
        }
      } catch (error) {
        console.error("Failed to fetch profile data:", error);
      }
    };

    fetchProfileData();
  }, [currentUser]);

  const timelineData = useMemo(() => {
    if (activityData.length > 0) return activityData;
    return buildBlankActivity(DEFAULT_ACTIVITY_DAYS);
  }, [activityData]);

  const groupedWeeks = useMemo(() => {
    const weeks = [];

    for (let index = 0; index < timelineData.length; index += 7) {
      weeks.push(timelineData.slice(index, index + 7));
    }

    return weeks;
  }, [timelineData]);

  const getContributionLevel = (count) => {
    if (!maxCount || count <= 0) return "bg-muted/40";

    const ratio = count / maxCount;
    if (ratio < 0.25) return "bg-primary/25";
    if (ratio < 0.5) return "bg-primary/45";
    if (ratio < 0.75) return "bg-primary/70";
    return "bg-primary";
  };

  return (
    <div className="flex h-full items-start">
      <Card className="w-full border-border/70 bg-card/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-sans text-xl">
            <ViewIcon size={20} />
            Profile
          </CardTitle>
          <CardDescription>
            Account details from your sign in provider.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <section className="space-y-1">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Username
            </p>
            <p className="font-sans text-lg font-semibold">{username}</p>
          </section>

          <section className="space-y-1 border-t border-border/60 pt-4">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
              Email
            </p>
            <p className="break-all text-sm text-foreground">
              {currentUser?.email || "No email available"}
            </p>
          </section>

          <section className="space-y-3 border-t border-border/60 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
                Contribution Graph
              </p>
              <p className="font-mono text-xs text-muted-foreground tabular-nums">
                {stats?.gamesPlayed || 0} total games
              </p>
            </div>

            <div className="mt-3 overflow-x-auto pb-2">
              <div className="inline-flex min-w-max gap-1">
                {groupedWeeks.map((week, weekIndex) => (
                  <div key={`week-${weekIndex}`} className="grid grid-rows-7 gap-1">
                    {week.map((day) => (
                      <div
                        key={day.date}
                        title={`${day.date}: ${day.count} game${day.count === 1 ? "" : "s"}`}
                        className={`h-3.5 w-3.5 rounded-[3px] border border-border/50 ${getContributionLevel(day.count)}`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
              <span>Less</span>
              <div className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-[2px] border border-border/50 bg-muted/40" />
                <span className="h-2.5 w-2.5 rounded-[2px] border border-border/50 bg-primary/25" />
                <span className="h-2.5 w-2.5 rounded-[2px] border border-border/50 bg-primary/45" />
                <span className="h-2.5 w-2.5 rounded-[2px] border border-border/50 bg-primary/70" />
                <span className="h-2.5 w-2.5 rounded-[2px] border border-border/50 bg-primary" />
              </div>
              <span>More</span>
            </div>
          </section>
        </CardContent>
      </Card>
    </div>
  );
};

export default Profile;
