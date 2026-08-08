import { Suspense, lazy } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import ProtectedRoute from "@/components/layout/ProtectedRoute";
import AppShell from "./components/layout/app-shell";
import { Toaster } from "@/components/ui/sonner";

const NewLanding = lazy(() => import("./pages/NewLanding"));
const SignUp = lazy(() => import("./pages/auth/SignUp"));
const SignIn = lazy(() => import("./pages/auth/SignIn"));
const ForgotPassword = lazy(() => import("./pages/auth/ForgotPassword"));
const Dashboard = lazy(() => import("./pages/social/Dashboard"));
const Leaderboard = lazy(() => import("./pages/social/Leaderboard"));
const WaitingRoom = lazy(() => import("./pages/game/WaitingRoom"));
const Game = lazy(() => import("./pages/game/Game"));
const Profile = lazy(() => import("./pages/social/Profile"));
const StartGame = lazy(() => import("./pages/game/StartGame"));
const BotMode = lazy(() => import("./pages/game/BotMode"));
const Friends = lazy(() => import("./pages/social/Friends"));
const CreateRoom = lazy(() => import("./pages/game/CreateRoom"));
const TheGlobe = lazy(() => import("./pages/social/TheGlobe"));

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense
          fallback={
            <div className="flex min-h-dvh items-center justify-center bg-background text-muted-foreground">
              Loading…
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<NewLanding />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/start-game" element={<StartGame />} />
              <Route path="/bot-mode" element={<BotMode />} />
              <Route path="/friends" element={<Friends />} />
              <Route path="/the-globe" element={<TheGlobe />} />
              <Route path="/create-room" element={<CreateRoom />} />
              <Route path="/game/waiting" element={<WaitingRoom />} />
              <Route path="/game" element={<Game />} />
            </Route>
          </Routes>
          <Toaster />
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
