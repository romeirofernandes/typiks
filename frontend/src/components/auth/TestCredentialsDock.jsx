import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { PlayIcon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { auth } from "@/firebase";

const TEST_EMAIL = "test@mail.com";
const TEST_PASSWORD = "123456";

export default function TestCredentialsDock() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loginWithTestCredentials = async () => {
    setLoading(true);
    setError("");

    try {
      await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
      navigate("/dashboard");
    } catch (loginError) {
      setError(loginError?.message || "Could not log in with test account.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(90vw,10.5rem)] rounded-xl border border-border/70 bg-background/95 p-2.5 shadow-lg backdrop-blur">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Quick access
      </p>
      <Button
        type="button"
        className="mt-1.5 h-7 w-full gap-1.5 rounded-lg px-2.5 text-[11px]"
        size="sm"
        onClick={loginWithTestCredentials}
        disabled={loading}
      >
        {loading ? <Spinner className="size-3" /> : <PlayIcon size={14} />}
        {loading ? "Loading..." : "Try now"}
      </Button>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
