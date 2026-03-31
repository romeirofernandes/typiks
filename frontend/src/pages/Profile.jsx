import { useAuth } from "@/context/AuthContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ViewIcon } from "hugeicons-react";

const Profile = () => {
  const { currentUser } = useAuth();

  const username =
    currentUser?.displayName ||
    currentUser?.email?.split("@")[0] ||
    "Player";

  return (
    <div className="flex h-full items-start">
      <Card className="w-full border-border/70 bg-card/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <ViewIcon size={20} />
            Profile
          </CardTitle>
          <CardDescription>
            Account details from your sign in provider.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-background px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Username
            </p>
            <p className="mt-1 text-base font-semibold">{username}</p>
          </div>

          <div className="rounded-lg border border-border bg-background px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Email
            </p>
            <p className="mt-1 break-all text-sm font-medium">
              {currentUser?.email || "No email available"}
            </p>
          </div>

          <div className="rounded-lg border border-border bg-background px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              User ID
            </p>
            <p className="mt-1 break-all text-sm text-muted-foreground">
              {currentUser?.uid || "Unavailable"}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Profile;
