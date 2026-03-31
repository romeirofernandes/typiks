import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { ZapIcon } from "hugeicons-react";
import { useNavigate } from "react-router-dom";

export default function StartGame() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const currentHour = new Date().getHours();
  let greeting = "Good evening";
  if (currentHour < 12) greeting = "Good morning";
  else if (currentHour < 18) greeting = "Good afternoon";

  const username =
    currentUser?.displayName ||
    currentUser?.email?.split("@")[0] ||
    "Player";

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/70 pb-4">
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Start Game</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          {greeting}, {username}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Queue for a ranked match and launch into the game panel.</p>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-sm">
          <Button
            size="lg"
            className="w-full h-14 text-lg bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md transition-transform active:scale-95"
            onClick={() => navigate("/game", { state: { fromDashboard: true } })}
          >
            <ZapIcon size={22} className="mr-2 fill-current" />
            Start Game
          </Button>
        </div>
      </div>
    </div>
  );
}
