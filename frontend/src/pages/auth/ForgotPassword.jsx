import React, { useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { ArrowLeft01Icon, Moon02Icon, Sun03Icon } from "hugeicons-react";
import { auth } from "@/firebase";
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
import { Spinner } from "@/components/ui/spinner";
import { useTheme } from "@/hooks/useTheme";
import BackgroundGrid from "@/components/landing/BackgroundGrid";

const ForgotPassword = () => {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const handleSendReset = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      await sendPasswordResetEmail(auth, email, {
        url: `${window.location.origin}/signin`,
      });
      setSent(true);
    } catch (sendError) {
      if (sendError?.code === "auth/invalid-email") {
        setError("Please enter a valid email address.");
      } else if (sendError?.code === "auth/too-many-requests") {
        setError("Too many requests. Please wait a bit and try again.");
      } else {
        console.error("Password reset request failed:", sendError);
        setError(
          "Something went wrong sending the reset link. Please try again."
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <BackgroundGrid>
      <div className="relative text-foreground">
        <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-10 w-full max-w-7xl mx-auto">
          <Button
            onClick={() => navigate(-1)}
            variant="secondary"
            aria-label="Go back"
          >
            <ArrowLeft01Icon size={18} />
          </Button>
          <Button
            onClick={toggleTheme}
            aria-label="toggle theme"
            variant="default"
          >
            {theme === "light" ? (
              <Moon02Icon size={18} />
            ) : (
              <Sun03Icon size={18} />
            )}
          </Button>
        </div>
        <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10 pt-20">
          <div className="w-full max-w-sm">
            <Card>
              <CardHeader>
                <CardTitle>Forgot your password?</CardTitle>
                <CardDescription>
                  {sent
                    ? "Check your inbox for the reset link"
                    : "Enter your email and we'll send you a link to reset your password"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {sent ? (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      If an account exists for{" "}
                      <span className="font-semibold text-foreground">
                        {email}
                      </span>
                      , a password reset link is on its way. Click the link in
                      the email to set a new password, then sign in.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Didn&apos;t see it? Check your spam or junk folder too.
                    </p>
                    <Button
                      type="button"
                      className="w-full"
                      onClick={() => navigate("/signin")}
                    >
                      Back to login
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleSendReset} className="space-y-4">
                    <div className="grid gap-3">
                      <Label htmlFor="forgot-email">Email</Label>
                      <Input
                        id="forgot-email"
                        type="email"
                        placeholder="m@example.com"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          setError("");
                        }}
                        required
                      />
                    </div>
                    {error ? (
                      <p className="text-xs text-destructive">{error}</p>
                    ) : null}
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={loading}
                    >
                      {loading ? <Spinner className="size-4" /> : null}
                      {loading ? "Sending..." : "Send reset link"}
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </BackgroundGrid>
  );
};

export default ForgotPassword;
