import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { signInAnonymously } from "firebase/auth";
import { auth } from "@/firebase";
import { useAuth } from "@/hooks/useAuth";
import { useProvisionUser } from "@/lib/users-api";
import { fetchRoomStatus, sanitizeRoomCode } from "@/lib/links";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ArrowLeft01Icon, PlayCircleIcon } from "hugeicons-react";
import BackgroundGrid from "@/components/landing/BackgroundGrid";

const STATUS_LOADING = "loading";
const STATUS_READY = "ready";
const STATUS_UNAVAILABLE = "unavailable";
const STATUS_ERROR = "error";

export default function JoinLink() {
  const navigate = useNavigate();
  const { code: rawCode = "" } = useParams();
  const {
    state: { currentUser },
  } = useAuth();
  const provisionUser = useProvisionUser();

  const roomCode = sanitizeRoomCode(rawCode);
  const isValidCode = roomCode.length === 6;

  const [status, setStatus] = useState(STATUS_LOADING);
  const [joining, setJoining] = useState(false);
  const [guestError, setGuestError] = useState("");

  const checkRoom = useCallback(async () => {
    setStatus(STATUS_LOADING);

    try {
      const payload = await fetchRoomStatus(roomCode);
      const available = Boolean(payload?.exists) && !payload?.full;
      setStatus(available ? STATUS_READY : STATUS_UNAVAILABLE);
    } catch {
      setStatus(STATUS_ERROR);
    }
  }, [roomCode]);

  useEffect(() => {
    if (!isValidCode) {
      setStatus(STATUS_UNAVAILABLE);
      return;
    }
    checkRoom();
  }, [checkRoom, isValidCode]);

  const joinAsGuest = async () => {
    setJoining(true);
    setGuestError("");

    try {
      const userCredential = await signInAnonymously(auth);
      await provisionUser.mutateAsync({ user: userCredential.user });
      navigate("/create-room", {
        state: { joinRoomCode: roomCode, fromInvite: true },
      });
    } catch (loginError) {
      console.error("Guest join error:", loginError);
      if (loginError?.code === "auth/operation-not-allowed") {
        setGuestError(
          "Guest login is not enabled. Ask the site owner to enable Anonymous sign-in, or sign in with an account."
        );
      } else {
        setGuestError(
          loginError?.message ||
            "Could not start a guest session. Please try again or sign in."
        );
      }
    } finally {
      setJoining(false);
    }
  };

  // Authenticated visitor with a live room: go straight in.
  useEffect(() => {
    if (currentUser && status === STATUS_READY) {
      navigate("/create-room", {
        state: { joinRoomCode: roomCode, fromInvite: true },
      });
    }
  }, [currentUser, status, roomCode, navigate]);

  return (
    <BackgroundGrid>
      <div className="relative text-foreground">
        <div className="absolute left-0 right-0 top-0 z-10 mx-auto flex w-full max-w-7xl items-center justify-between p-6">
          <Button onClick={() => navigate("/")} variant="secondary" aria-label="Go back">
            <ArrowLeft01Icon size={18} />
          </Button>
        </div>

        <div className="flex min-h-svh w-full items-center justify-center p-6 pt-20 md:p-10">
          <div className="w-full max-w-md">
            {status === STATUS_LOADING && isValidCode && (
              <RoomDetailCard code={roomCode} loading title="Joining room">
                <div className="flex justify-center py-4">
                  <Spinner className="size-5 text-primary" />
                </div>
              </RoomDetailCard>
            )}

            {status === STATUS_UNAVAILABLE && (
              <RoomDetailCard code={roomCode} title="Room no longer available">
                <div className="space-y-6">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {isValidCode
                      ? "This room doesn’t exist or is full. It may have ended when the last player left."
                      : "This invite link is invalid."}
                  </p>
                  <Button className="w-full" onClick={() => navigate("/")}>
                    Create your own room
                  </Button>
                </div>
              </RoomDetailCard>
            )}

            {status === STATUS_ERROR && (
              <RoomDetailCard code={roomCode} title="Couldn’t check this room">
                <div className="space-y-6">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Something went wrong reaching the room. Check your connection
                    and try again.
                  </p>
                  <Button className="w-full" onClick={checkRoom}>
                    Try again
                  </Button>
                </div>
              </RoomDetailCard>
            )}

            {status === STATUS_READY && !currentUser && (
              <RoomDetailCard code={roomCode} title="Join this room">
                <div className="flex flex-col gap-3">
                  <Button
                    className="w-full"
                    onClick={joinAsGuest}
                    disabled={joining}
                  >
                    {joining ? (
                      <Spinner className="size-4" />
                    ) : (
                      <PlayCircleIcon size={18} />
                    )}
                    {joining ? "Joining room..." : "Join as guest"}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      navigate("/signin", { state: { from: `/join/${roomCode}` } })
                    }
                    disabled={joining}
                  >
                    Sign in to join
                  </Button>
                  {guestError ? (
                    <p className="mt-1 text-xs text-destructive">{guestError}</p>
                  ) : null}
                </div>
              </RoomDetailCard>
            )}

            {status === STATUS_READY && currentUser && (
              <RoomDetailCard code={roomCode} title="Joining room" loading>
                <div className="flex justify-center py-4">
                  <Spinner className="size-5 text-primary" />
                </div>
              </RoomDetailCard>
            )}
          </div>
        </div>
      </div>
    </BackgroundGrid>
  );
}

function RoomDetailCard({ code, title, loading = false, children }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 p-6 text-center shadow-sm backdrop-blur">
      {code ? (
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Room {code}
        </p>
      ) : null}
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-4">{children}</div>
      {loading ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Room is live — getting you in…
        </p>
      ) : null}
    </div>
  );
}