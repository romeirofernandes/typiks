import { useState } from "react";
import { EmailAuthProvider, linkWithCredential } from "firebase/auth";
import { auth } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { FiSave } from "react-icons/fi";
import { useProvisionUser } from "@/lib/users-api";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function GuestUpgradePrompt({ open, onOpenChange }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const provisionUser = useProvisionUser();

  const resetForm = () => {
    setDone(false);
    setError("");
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("No active session");

      const credential = EmailAuthProvider.credential(email, password);
      await linkWithCredential(user, credential);

      // Force a fresh ID token so the email claim is present and the
      // backend can reconcile the synthetic guest email with the real one.
      await provisionUser.mutateAsync({
        user: auth.currentUser,
        forceRefresh: true,
      });
      setDone(true);
    } catch (saveError) {
      console.error("Guest upgrade failed:", saveError);
      setError(
        saveError?.message ||
          "Could not save your progress. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetForm();
      }}
    >
      <AlertDialogContent className="max-w-md">
        {done ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Progress saved</AlertDialogTitle>
              <AlertDialogDescription>
                Your stats are now attached to your account.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Save your progress</AlertDialogTitle>
              <AlertDialogDescription>
                You're playing as a guest. Add an email and password to keep
                your rating and stats.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <form onSubmit={handleSave} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="upgrade-email">Email</Label>
                <Input
                  id="upgrade-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="upgrade-password">Password</Label>
                <Input
                  id="upgrade-password"
                  type="password"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full gap-1.5" disabled={loading}>
                {loading ? <Spinner className="size-4" /> : <FiSave className="h-4 w-4" />}
                {loading ? "Saving..." : "Save my progress"}
              </Button>
            </form>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
