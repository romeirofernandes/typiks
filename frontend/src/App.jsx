import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import NewLanding from "./pages/NewLanding";
import SignUp from "./pages/SignUp";
import SignIn from "./pages/SignIn";
import Dashboard from "./pages/Dashboard";
import Leaderboard from "./pages/Leaderboard";
import WaitingRoom from "./pages/WaitingRoom";
import Game from "./pages/Game";
import Profile from "./pages/Profile";
import AppShell from "./components/app-shell";
import StartGame from "./pages/StartGame";
import BotMode from "./pages/BotMode";
import Friends from "./pages/Friends";
import CreateRoom from "./pages/CreateRoom";
import TheGlobe from "./pages/TheGlobe";
import { Toaster } from "@/components/ui/sonner";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<NewLanding />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/signin" element={<SignIn />} />
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
      </BrowserRouter>
    </AuthProvider>
  );
}
