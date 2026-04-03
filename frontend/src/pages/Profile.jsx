import { useAuth } from "@/context/AuthContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TypeGraph } from "@/components/charts/TypeGraph";
import { ViewIcon } from "hugeicons-react";
import { useEffect, useState } from "react";

const PROFILE_GRAPH_DAYS = 364;

const Profile = () => {
  const { currentUser } = useAuth();
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
          fetch(`${fullUrl}/api/users/${currentUser.uid}/activity?days=${PROFILE_GRAPH_DAYS}`, {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }),
        ]);

        if (statsResponse.ok) {
          await statsResponse.json();
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

          <section className="border-t border-border/60 pt-4">
            <TypeGraph
              title="Type Graph"
              activityData={activityData}
              maxDailyCount={maxCount}
              days={PROFILE_GRAPH_DAYS}
            />
          </section>
        </CardContent>
      </Card>
    </div>
  );
};

export default Profile;
