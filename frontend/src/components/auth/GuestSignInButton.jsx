import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInAnonymously } from "firebase/auth";
import { PlayCircleIcon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { auth } from "@/firebase";
import { useProvisionUser } from "@/lib/users-api";

export default function GuestSignInButton({ className, ...props }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const provisionUser = useProvisionUser();

  const handleGuestLogin = async () => {
    setLoading(true);
    setError("");

    try {
      const userCredential = await signInAnonymously(auth);
      // Backend auto-provisions the profile (generated username + avatar).
      await provisionUser.mutateAsync({ user: userCredential.user });
      navigate("/dashboard");
    } catch (loginError) {
      console.error("Guest login error:", loginError);
      if (loginError?.code === "auth/operation-not-allowed") {
        setError(
          "Guest login is not enabled. Ask the site owner to enable Anonymous sign-in, or sign up with an account."
        );
      } else {
        setError(
          loginError?.message ||
            "Could not start a guest session. Please try again or sign up."
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleGuestLogin}
        disabled={loading}
        {...props}
      >
        {loading ? <Spinner className="size-4" /> : <PlayCircleIcon size={18} />}
        {loading ? "Starting guest session..." : "Play as Guest"}
      </Button>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
