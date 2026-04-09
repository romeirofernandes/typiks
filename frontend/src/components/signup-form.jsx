import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { createUserWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "@/firebase";
import { ViewIcon, ViewOffIcon } from "hugeicons-react";
import GoogleLogo from "@/components/icons/GoogleLogo";
import { getRandomDefaultAvatarId } from "@/lib/player-meta";

export function SignUpForm({ className, ...props }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [username, setUsername] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const createUserInDB = async (user, username) => {
    try {
      const idToken = await user.getIdToken();
      const response = await fetch(
        `${
          import.meta.env.VITE_SERVER_URL || "http://127.0.0.1:8787"
        }/api/users`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ username, avatarId: getRandomDefaultAvatarId() }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Failed to create user in DB:", error);
      throw error;
    }
  };

  const handleEmailSignUp = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (password !== confirmPassword) {
        alert("Passwords do not match");
        return;
      }
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
      await createUserInDB(userCredential.user, username);
      navigate("/dashboard");
    } catch (error) {
      console.error("Sign up error:", error);
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setLoading(true);

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const displayName =
        result.user.displayName || result.user.email.split("@")[0];

      await createUserInDB(result.user, displayName);
      navigate("/dashboard");
    } catch (error) {
      alert(`Google sign-up failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>Create an account</CardTitle>
          <CardDescription>
            Enter your details below to create your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleEmailSignUp}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-3">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="johndoe"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-3">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-3">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "hide password" : "show password"}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <ViewOffIcon size={18} /> : <ViewIcon size={18} />}
                  </button>
                </div>
              </div>
              <div className="grid gap-3">
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    aria-label={showConfirmPassword ? "hide password" : "show password"}
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showConfirmPassword ? (
                      <ViewOffIcon size={18} />
                    ) : (
                      <ViewIcon size={18} />
                    )}
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Creating Account..." : "Sign Up"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={handleGoogleSignUp}
                  disabled={loading}
                >
                  <GoogleLogo />
                  {loading
                    ? "Signing up with Google..."
                    : "Sign Up with Google"}
                </Button>
              </div>
            </div>
            <div className="mt-4 text-center text-sm">
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => navigate("/signin")}
                className="underline underline-offset-4"
              >
                Sign in
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
