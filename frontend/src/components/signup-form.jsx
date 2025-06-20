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

export function SignUpForm({ className, ...props }) {
  const navigate = useNavigate();
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>Create an account</CardTitle>
          <CardDescription>
            Enter your email below to create your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form>
            <div className="flex flex-col gap-6">
              <div className="grid gap-3">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                />
              </div>
              <div className="grid gap-3">
                <div className="flex items-center">
                  <Label htmlFor="password">Password</Label>
                </div>
                <Input id="password" type="password" required />
              </div>
              <div className="flex flex-col gap-3">
                <Button type="submit" className="w-full">
                  Sign Up
                </Button>
                <Button variant="outline" className="w-full">
                  Sign Up with Google
                </Button>
              </div>
            </div>
            <div className="mt-4 text-center text-sm">
              Already have an account?{" "}
              <button
                onClick={() => {
                  navigate("/signin");
                }}
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
