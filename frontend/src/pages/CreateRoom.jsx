import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

function getServerBaseUrl() {
  const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
  return serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;
}

function sanitizeRoomCode(rawCode) {
  if (typeof rawCode !== "string") return "";
  return rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function defaultSettings() {
  return {
    maxPlayers: 6,
    roundTimeSeconds: 60,
    wordCount: 30,
  };
}

const ROOM_SETTING_LIMITS = {
  maxPlayers: { min: 2, max: 6 },
  roundTimeSeconds: { min: 20, max: 300 },
  wordCount: { min: 10, max: 120 },
};

function clampSettingValue(rawValue, min, max, fallback) {
  const parsed = Number.parseInt(String(rawValue), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export default function CreateRoom() {
  const { currentUser } = useAuth();

  const wsRef = useRef(null);
  const manualDisconnectRef = useRef(false);
  const timerRef = useRef(null);

  const [wsStatus, setWsStatus] = useState("idle");
  const [roomState, setRoomState] = useState(null);
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [settingsForm, setSettingsForm] = useState(defaultSettings());
  const [userInfo, setUserInfo] = useState({ username: "Player", rating: 800 });
  const [roomError, setRoomError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [entryMode, setEntryMode] = useState("create");
  const [countdown, setCountdown] = useState(null);
  const [game, setGame] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [gameInput, setGameInput] = useState("");
  const [gameResult, setGameResult] = useState(null);

  const fetchUserInfo = useCallback(async () => {
    if (!currentUser) return;

    try {
      const idToken = await currentUser.getIdToken();
      const baseUrl = getServerBaseUrl();
      const response = await fetch(`${baseUrl}/api/users/${currentUser.uid}/stats`, {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Stats unavailable");
      }

      const payload = await response.json();
      setUserInfo({
        username:
          payload.username ||
          currentUser.displayName ||
          currentUser.email?.split("@")[0] ||
          "Player",
        rating: Number.isFinite(payload.rating) ? payload.rating : 800,
      });
    } catch {
      setUserInfo({
        username:
          currentUser.displayName || currentUser.email?.split("@")[0] || "Player",
        rating: 800,
      });
    }
  }, [currentUser]);

  useEffect(() => {
    fetchUserInfo();
  }, [fetchUserInfo]);

  const cleanupSocket = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // no-op
      }
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      manualDisconnectRef.current = true;
      cleanupSocket();
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [cleanupSocket]);

  const handleRoomMessage = useCallback((message) => {
    switch (message.type) {
      case "ROOM_STATE": {
        setRoomState(message);
        setRoomCode(message.roomCode || "");
        setSettingsForm((prev) => ({
          ...prev,
          ...message.settings,
        }));

        if (message.state === "lobby") {
          setCountdown(null);
          setGame(null);
          setTimeLeft(0);
        }

        if (message.state === "playing" && message.game) {
          setGame({
            words: message.game.words || [],
            progress: message.game.progress || [],
            endTime: message.game.endTime || null,
          });
          if (Number.isFinite(message.game.durationMs)) {
            setTimeLeft(Math.max(0, Math.ceil(message.game.durationMs / 1000)));
          }
        }
        break;
      }

      case "ROOM_COUNTDOWN":
        setCountdown(Number.isFinite(message.count) ? message.count : null);
        break;

      case "ROOM_GAME_START":
        setGame({
          words: Array.isArray(message.words) ? message.words : [],
          progress: [],
          endTime: message.endTime || null,
        });
        setCountdown(null);
        setGameResult(null);
        setTimeLeft(
          Number.isFinite(message.duration)
            ? Math.max(0, Math.ceil(message.duration / 1000))
            : 0
        );
        break;

      case "ROOM_PROGRESS":
        setGame((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            progress: Array.isArray(message.progress) ? message.progress : [],
          };
        });
        break;

      case "ROOM_GAME_END":
        setGameResult(message.results || null);
        setCountdown(null);
        setGameInput("");
        break;

      case "ROOM_ERROR":
        setRoomError(message.error || "Room operation failed");
        break;

      default:
        break;
    }
  }, []);

  const connectToRoom = useCallback(
    async (targetCode, initialSettings) => {
      if (!currentUser) return;

      const cleanCode = sanitizeRoomCode(targetCode);
      if (cleanCode.length !== 6) {
        setRoomError("Room code must be 6 characters.");
        return;
      }

      const idToken = await currentUser.getIdToken();
      const baseUrl = getServerBaseUrl();
      const wsBaseUrl = baseUrl
        .replace(/^http:/i, "ws:")
        .replace(/^https:/i, "wss:")
        .replace(/\/$/, "");

      manualDisconnectRef.current = true;
      cleanupSocket();
      manualDisconnectRef.current = false;
      setRoomError("");
      setFeedback("");
      setWsStatus("connecting");

      const ws = new WebSocket(new URL(`/ws/room/${cleanCode}`, wsBaseUrl));
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws) return;
        setWsStatus("connected");
        ws.send(
          JSON.stringify({
            type: "ROOM_JOIN",
            idToken,
            roomCode: cleanCode,
            settings: initialSettings,
            userInfo,
          })
        );
      };

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return;

        try {
          const message = JSON.parse(event.data);
          handleRoomMessage(message);
        } catch {
          setRoomError("Received malformed room message.");
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }

        if (!manualDisconnectRef.current) {
          setWsStatus("disconnected");
          setRoomError("Disconnected from room.");
        }
      };

      ws.onerror = () => {
        if (wsRef.current !== ws) return;
        setRoomError("Could not connect to room server.");
      };
    },
    [cleanupSocket, currentUser, handleRoomMessage, userInfo]
  );

  useEffect(() => {
    if (!game?.endTime || roomState?.state !== "playing") {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const update = () => {
      const remaining = Math.max(0, game.endTime - Date.now());
      setTimeLeft(Math.ceil(remaining / 1000));
    };

    update();
    timerRef.current = setInterval(update, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [game?.endTime, roomState?.state]);

  const createRoom = async () => {
    if (!currentUser) return;

    try {
      setBusy(true);
      setRoomError("");
      const normalizedSettings = {
        maxPlayers: clampSettingValue(
          settingsForm.maxPlayers,
          ROOM_SETTING_LIMITS.maxPlayers.min,
          ROOM_SETTING_LIMITS.maxPlayers.max,
          defaultSettings().maxPlayers
        ),
        roundTimeSeconds: clampSettingValue(
          settingsForm.roundTimeSeconds,
          ROOM_SETTING_LIMITS.roundTimeSeconds.min,
          ROOM_SETTING_LIMITS.roundTimeSeconds.max,
          defaultSettings().roundTimeSeconds
        ),
        wordCount: clampSettingValue(
          settingsForm.wordCount,
          ROOM_SETTING_LIMITS.wordCount.min,
          ROOM_SETTING_LIMITS.wordCount.max,
          defaultSettings().wordCount
        ),
      };
      setSettingsForm(normalizedSettings);

      const idToken = await currentUser.getIdToken();
      const baseUrl = getServerBaseUrl();

      const response = await fetch(`${baseUrl}/api/rooms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(normalizedSettings),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create room");
      }

      setGameResult(null);
      await connectToRoom(payload.roomCode, payload.settings);
      setFeedback("Room created. Share the code and wait for everyone to ready up.");
    } catch (error) {
      setRoomError(error.message || "Could not create room.");
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async () => {
    const code = sanitizeRoomCode(joinCode);
    if (code.length !== 6) {
      setRoomError("Enter a valid 6-character room code.");
      return;
    }

    setGameResult(null);
    await connectToRoom(code);
  };

  const sendSocketMessage = (payload) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setRoomError("Room connection is not open.");
      return;
    }

    wsRef.current.send(JSON.stringify(payload));
  };

  const leaveRoom = () => {
    manualDisconnectRef.current = true;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "ROOM_LEAVE" }));
    }
    cleanupSocket();
    setWsStatus("idle");
    setRoomState(null);
    setRoomCode("");
    setGame(null);
    setGameResult(null);
    setCountdown(null);
    setTimeLeft(0);
    setRoomError("");
  };

  const copyRoomCode = async () => {
    if (!roomCode) return;

    try {
      await navigator.clipboard.writeText(roomCode);
      setFeedback("Room code copied.");
    } catch {
      setFeedback("Could not copy room code automatically.");
    }
  };

  const me = useMemo(() => {
    if (!roomState?.members || !currentUser) return null;
    return roomState.members.find((member) => member.id === currentUser.uid) || null;
  }, [currentUser, roomState?.members]);

  const isLeader = Boolean(currentUser?.uid && roomState?.ownerId === currentUser.uid);
  const isInRoom = Boolean(roomState && roomCode);
  const isPlaying = roomState?.state === "playing";
  const settingsLocked = !isLeader || roomState?.state !== "lobby";

  const updateSettingsField = useCallback((field, rawValue) => {
    const limits = ROOM_SETTING_LIMITS[field];
    if (!limits) return;

    setSettingsForm((prev) => ({
      ...prev,
      [field]: clampSettingValue(rawValue, limits.min, limits.max, prev[field]),
    }));
  }, []);

  const myProgress = useMemo(() => {
    if (!game?.progress || !currentUser) {
      return { score: 0, currentWordIndex: 0 };
    }

    return (
      game.progress.find((entry) => entry.playerId === currentUser.uid) || {
        score: 0,
        currentWordIndex: 0,
      }
    );
  }, [currentUser, game?.progress]);

  const currentWord =
    isPlaying && Array.isArray(game?.words)
      ? game.words[myProgress.currentWordIndex] || ""
      : "";

  const submitWord = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();

    if (!isPlaying || !gameInput.trim()) return;
    sendSocketMessage({ type: "PLAYER_INPUT", input: gameInput.trim() });
    setGameInput("");
  };

  const updateLeaderSettings = () => {
    if (!isLeader) return;
    sendSocketMessage({ type: "ROOM_UPDATE_SETTINGS", settings: settingsForm });
  };

  return (
    <div className="flex h-full flex-col gap-5">
      <div className="border-b border-border/70 pb-5">
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Create Room</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Private Room Lobby</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a room, configure timing and player cap, and start only when everyone is ready.
        </p>
      </div>

      {roomError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {roomError}
        </p>
      ) : null}

      {feedback ? (
        <p className="rounded-md border border-border/70 bg-card/40 px-3 py-2 text-sm text-muted-foreground">
          {feedback}
        </p>
      ) : null}

      {!isInRoom ? (
        <div className="space-y-5">
          <div className="grid gap-3 lg:grid-cols-2">
            <button
              type="button"
              onClick={() => setEntryMode("create")}
              aria-pressed={entryMode === "create"}
              className="text-left"
            >
              <Card
                className={
                  entryMode === "create"
                    ? "border-chart-2/70 bg-chart-2/10"
                    : "border-border/70"
                }
              >
                <CardHeader className="gap-2 pb-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Create</p>
                  <CardTitle className="text-xl">Create a New Room</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    You host the lobby, tune settings, and start when everyone is ready.
                  </p>
                </CardContent>
              </Card>
            </button>

            <button
              type="button"
              onClick={() => setEntryMode("join")}
              aria-pressed={entryMode === "join"}
              className="text-left"
            >
              <Card
                className={
                  entryMode === "join"
                    ? "border-chart-3/70 bg-chart-3/10"
                    : "border-border/70"
                }
              >
                <CardHeader className="gap-2 pb-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Join</p>
                  <CardTitle className="text-xl">Join with Room Code</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Enter a 6-character code and hop into an active room instantly.
                  </p>
                </CardContent>
              </Card>
            </button>
          </div>

          {entryMode === "create" ? (
            <Card className="border-chart-2/25">
              <CardHeader className="pb-3">
                <CardTitle>Create Room</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="space-y-2 text-sm">
                    <span className="text-muted-foreground">Max Players</span>
                    <Input
                      type="number"
                      min={ROOM_SETTING_LIMITS.maxPlayers.min}
                      max={ROOM_SETTING_LIMITS.maxPlayers.max}
                      value={settingsForm.maxPlayers}
                      className="mt-1"
                      onChange={(event) => updateSettingsField("maxPlayers", event.target.value)}
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-muted-foreground">Round Time (seconds)</span>
                    <Input
                      type="number"
                      min={ROOM_SETTING_LIMITS.roundTimeSeconds.min}
                      max={ROOM_SETTING_LIMITS.roundTimeSeconds.max}
                      value={settingsForm.roundTimeSeconds}
                      className="mt-1"
                      onChange={(event) =>
                        updateSettingsField("roundTimeSeconds", event.target.value)
                      }
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-muted-foreground">Word Count</span>
                    <Input
                      type="number"
                      min={ROOM_SETTING_LIMITS.wordCount.min}
                      max={ROOM_SETTING_LIMITS.wordCount.max}
                      value={settingsForm.wordCount}
                      className="mt-1"
                      onChange={(event) => updateSettingsField("wordCount", event.target.value)}
                    />
                  </label>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-4">
                  <p className="text-xs text-muted-foreground">Defaults: 6 players, 60s round, 30 words.</p>
                  <Button className="w-full sm:w-auto" onClick={createRoom} disabled={busy}>
                    {busy ? "Creating..." : "Create Room"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-chart-3/25">
              <CardHeader className="pb-3">
                <CardTitle>Join Game</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Room Code</p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Input
                      value={joinCode}
                      onChange={(event) => setJoinCode(sanitizeRoomCode(event.target.value))}
                      placeholder="ABC123"
                      maxLength={6}
                      className="mt-1 font-mono uppercase tracking-[0.22em]"
                    />
                    <Button className="sm:w-auto" variant="default" onClick={joinRoom}>
                      Join Room
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Connection: {wsStatus === "idle" ? "Not connected" : wsStatus}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Room {roomCode}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={copyRoomCode}>
                Copy Code
              </Button>
              {!isLeader ? (
                <Button
                  variant={me?.ready ? "secondary" : "outline"}
                  onClick={() => sendSocketMessage({ type: "ROOM_SET_READY", ready: !me?.ready })}
                >
                  {me?.ready ? "Ready" : "Set Ready"}
                </Button>
              ) : null}
              <Button
                onClick={() => sendSocketMessage({ type: "ROOM_START_GAME" })}
                disabled={!isLeader || !roomState?.canStart}
              >
                Start Game
              </Button>
              <Button variant="outline" onClick={leaveRoom}>
                Leave Room
              </Button>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Members ({roomState?.memberCount || 0}/{roomState?.settings?.maxPlayers || 0})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(roomState?.members || []).map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between rounded-md border border-border/70 bg-card/30 p-3"
                  >
                    <div>
                      <p className="font-semibold">
                        {member.username} {member.isLeader ? "(Leader)" : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">Rating: {member.rating}</p>
                    </div>
                    <span
                      className={`rounded px-2 py-1 text-xs ${
                        member.ready
                          ? "bg-primary/20 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {member.ready ? "Ready" : "Not Ready"}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Room Settings {isLeader ? "(Leader Control)" : ""}</CardTitle>
              </CardHeader>
              <CardContent className={`space-y-3 ${settingsLocked ? "opacity-70" : ""}`}>
                {!isLeader ? (
                  <p className="text-xs text-muted-foreground">
                    Only the room leader can change settings.
                  </p>
                ) : null}
                <label className="block text-sm">
                  Max Players
                  <Input
                    type="number"
                    min={ROOM_SETTING_LIMITS.maxPlayers.min}
                    max={ROOM_SETTING_LIMITS.maxPlayers.max}
                    value={settingsForm.maxPlayers}
                    className="mt-1"
                    disabled={settingsLocked}
                    onChange={(event) => updateSettingsField("maxPlayers", event.target.value)}
                  />
                </label>

                <label className="block text-sm">
                  Round Time (seconds)
                  <Input
                    type="number"
                    min={ROOM_SETTING_LIMITS.roundTimeSeconds.min}
                    max={ROOM_SETTING_LIMITS.roundTimeSeconds.max}
                    value={settingsForm.roundTimeSeconds}
                    className="mt-1"
                    disabled={settingsLocked}
                    onChange={(event) =>
                      updateSettingsField("roundTimeSeconds", event.target.value)
                    }
                  />
                </label>

                <label className="block text-sm">
                  Word Count
                  <Input
                    type="number"
                    min={ROOM_SETTING_LIMITS.wordCount.min}
                    max={ROOM_SETTING_LIMITS.wordCount.max}
                    value={settingsForm.wordCount}
                    className="mt-1"
                    disabled={settingsLocked}
                    onChange={(event) => updateSettingsField("wordCount", event.target.value)}
                  />
                </label>

                <Button
                  variant="outline"
                  className="w-full"
                  disabled={settingsLocked}
                  onClick={updateLeaderSettings}
                >
                  Save Settings
                </Button>
              </CardContent>
            </Card>
          </div>

          {roomState?.state === "countdown" ? (
            <Card>
              <CardHeader>
                <CardTitle>Game starts in {countdown === 0 ? "GO!" : countdown}</CardTitle>
              </CardHeader>
            </Card>
          ) : null}

          {isPlaying ? (
            <Card>
              <CardHeader>
                <CardTitle>In Match • {timeLeft}s left</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Current word</p>
                <p className="text-3xl font-semibold">{currentWord || "Waiting..."}</p>
                <Input
                  value={gameInput}
                  onChange={(event) => setGameInput(event.target.value)}
                  onKeyDown={submitWord}
                  placeholder="Type and press Enter"
                  className="mt-1"
                />

                <div className="space-y-2">
                  {(game?.progress || []).map((entry) => (
                    <div
                      key={entry.playerId}
                      className="flex items-center justify-between rounded-md border border-border/70 bg-card/30 p-2 text-sm"
                    >
                      <span>{entry.username}</span>
                      <span>
                        Score {entry.score} • Word {entry.currentWordIndex + 1}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {gameResult ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  {gameResult.isDraw ? "Draw" : gameResult.winnerId === currentUser?.uid ? "You won" : "Match ended"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(gameResult.rankings || []).map((entry, index) => (
                  <div
                    key={entry.playerId}
                    className="flex items-center justify-between rounded-md border border-border/70 bg-card/30 p-2"
                  >
                    <span>
                      #{index + 1} {entry.username}
                    </span>
                    <span>
                      {entry.score} pts • {entry.progress} words
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
