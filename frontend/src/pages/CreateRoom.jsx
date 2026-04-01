import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DotLoader } from "@/components/ui/dot-loader";
import { FiCopy, FiCheck, FiUsers, FiClock, FiHash, FiUser, FiLogOut, FiPlay, FiSettings } from "react-icons/fi";

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
    gameMode: "ffa",
  };
}

const ROOM_SETTING_LIMITS = {
  maxPlayers: { min: 2, max: 8 },
  roundTimeSeconds: { min: 20, max: 300 },
  wordCount: { min: 10, max: 120 },
};

const GAME_MODES = [
  { id: "ffa", label: "Free For All", description: "Everyone competes individually" },
  { id: "1v1", label: "1v1", description: "Two players head-to-head" },
  { id: "2v2", label: "2v2", description: "Two teams of two" },
  { id: "1v2", label: "1v2", description: "One versus two" },
  { id: "2v3", label: "2v3", description: "Two versus three" },
  { id: "3v3", label: "3v3", description: "Three versus three" },
];

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
  const inputRef = useRef(null);

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
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUserInfo = useCallback(async () => {
    if (!currentUser) return;

    try {
      setIsLoading(true);
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
    } finally {
      setIsLoading(false);
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
    if (!roomCode || copied) return;

    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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

  // Leader is always considered ready - check if all OTHER members are ready
  const canStartGame = useMemo(() => {
    if (!isLeader || !roomState?.members || roomState.members.length < 2) return false;
    const otherMembers = roomState.members.filter((m) => m.id !== currentUser?.uid);
    return otherMembers.length > 0 && otherMembers.every((m) => m.ready);
  }, [isLeader, roomState?.members, currentUser?.uid]);

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

  // Skeleton loading state
  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-6 p-4 md:p-6">
        <div className="space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6">
      {/* Header */}
      <motion.div 
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="border-b border-border/50 pb-6"
      >
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
          Private Game
        </p>
        <h1 className="mt-2 font-sans text-2xl font-semibold tracking-tight sm:text-3xl">
          Room Lobby
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a room, invite friends, and compete without affecting ratings.
        </p>
      </motion.div>

      {/* Error/Feedback Messages */}
      <AnimatePresence>
        {roomError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {roomError}
          </motion.div>
        )}
        {feedback && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-primary"
          >
            {feedback}
          </motion.div>
        )}
      </AnimatePresence>

      {!isInRoom ? (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-6"
        >
          {/* Mode Selection Cards */}
          <div className="grid gap-4 md:grid-cols-2">
            <motion.button
              type="button"
              onClick={() => setEntryMode("create")}
              aria-pressed={entryMode === "create"}
              className="text-left"
            >
              <Card
                className={`h-full transition-all duration-200 ${
                  entryMode === "create"
                    ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                    : "border-border/50 hover:border-border"
                }`}
              >
                <CardHeader className="gap-2 pb-3">
                  <div className="flex items-center gap-2">
                    <div className={`rounded-md p-2 ${entryMode === "create" ? "bg-primary/20" : "bg-muted"}`}>
                      <FiSettings className="h-4 w-4" />
                    </div>
                    <p className="font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
                      Create
                    </p>
                  </div>
                  <CardTitle className="font-sans text-lg">Create a New Room</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Host the lobby, configure settings, and start when everyone's ready.
                  </p>
                </CardContent>
              </Card>
            </motion.button>

            <motion.button
              type="button"
              onClick={() => setEntryMode("join")}
              aria-pressed={entryMode === "join"}
              className="text-left"
            >
              <Card
                className={`h-full transition-all duration-200 ${
                  entryMode === "join"
                    ? "border-chart-3/50 bg-chart-3/5 ring-1 ring-chart-3/20"
                    : "border-border/50 hover:border-border"
                }`}
              >
                <CardHeader className="gap-2 pb-3">
                  <div className="flex items-center gap-2">
                    <div className={`rounded-md p-2 ${entryMode === "join" ? "bg-chart-3/20" : "bg-muted"}`}>
                      <FiUsers className="h-4 w-4" />
                    </div>
                    <p className="font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
                      Join
                    </p>
                  </div>
                  <CardTitle className="font-sans text-lg">Join with Code</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Enter a 6-character code and join an active room instantly.
                  </p>
                </CardContent>
              </Card>
            </motion.button>
          </div>

          {/* Create/Join Forms */}
          <AnimatePresence mode="wait">
            {entryMode === "create" ? (
              <motion.div
                key="create"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <Card className="border-primary/20">
                  <CardHeader className="pb-4">
                    <CardTitle className="font-sans text-lg">Room Settings</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Game Mode Selection */}
                    <div className="space-y-3">
                      <p className="font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
                        Game Mode
                      </p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
                        {GAME_MODES.map((mode) => (
                          <button
                            key={mode.id}
                            type="button"
                            onClick={() => setSettingsForm((prev) => ({ ...prev, gameMode: mode.id }))}
                            className={`rounded-md border px-3 py-2 text-center text-sm transition-all ${
                              settingsForm.gameMode === mode.id
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border/50 hover:border-border hover:bg-muted/50"
                            }`}
                          >
                            <span className="font-semibold">{mode.label}</span>
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {GAME_MODES.find((m) => m.id === settingsForm.gameMode)?.description}
                      </p>
                    </div>

                    {/* Settings Grid */}
                    <div className="grid gap-4 sm:grid-cols-3">
                      <label className="space-y-2">
                        <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                          <FiUsers className="h-3 w-3" /> Max Players
                        </span>
                        <Input
                          type="number"
                          min={ROOM_SETTING_LIMITS.maxPlayers.min}
                          max={ROOM_SETTING_LIMITS.maxPlayers.max}
                          value={settingsForm.maxPlayers}
                          onChange={(e) => updateSettingsField("maxPlayers", e.target.value)}
                        />
                      </label>

                      <label className="space-y-2">
                        <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                          <FiClock className="h-3 w-3" /> Round Time (s)
                        </span>
                        <Input
                          type="number"
                          min={ROOM_SETTING_LIMITS.roundTimeSeconds.min}
                          max={ROOM_SETTING_LIMITS.roundTimeSeconds.max}
                          value={settingsForm.roundTimeSeconds}
                          onChange={(e) => updateSettingsField("roundTimeSeconds", e.target.value)}
                        />
                      </label>

                      <label className="space-y-2">
                        <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                          <FiHash className="h-3 w-3" /> Word Count
                        </span>
                        <Input
                          type="number"
                          min={ROOM_SETTING_LIMITS.wordCount.min}
                          max={ROOM_SETTING_LIMITS.wordCount.max}
                          value={settingsForm.wordCount}
                          onChange={(e) => updateSettingsField("wordCount", e.target.value)}
                        />
                      </label>
                    </div>

                    <div className="flex flex-col gap-3 border-t border-border/50 pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-muted-foreground">
                        Private games don't affect your rating.
                      </p>
                      <Button onClick={createRoom} disabled={busy} className="w-full sm:w-auto">
                        {busy ? (
                          <span className="flex items-center gap-2">
                            <DotLoader className="scale-75" duration={80} />
                            Creating...
                          </span>
                        ) : (
                          "Create Room"
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ) : (
              <motion.div
                key="join"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <Card className="border-chart-3/20">
                  <CardHeader className="pb-4">
                    <CardTitle className="font-sans text-lg">Enter Room Code</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Input
                        value={joinCode}
                        onChange={(e) => setJoinCode(sanitizeRoomCode(e.target.value))}
                        placeholder="ABC123"
                        maxLength={6}
                        className="flex-1 text-center font-mono text-xl uppercase tracking-[0.3em]"
                      />
                      <Button onClick={joinRoom} className="sm:w-auto">
                        Join Room
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Status: {wsStatus === "idle" ? "Ready to connect" : wsStatus}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-6"
        >
          {/* Room Header Card */}
          <Card className="overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-primary/10 to-transparent pb-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
                    Room Code
                  </p>
                  <div className="flex items-center gap-3">
                    <h2 className="font-mono text-3xl font-bold tracking-[0.2em] text-primary">
                      {roomCode}
                    </h2>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={copyRoomCode}
                      className="relative h-8 w-8 p-0"
                    >
                      <AnimatePresence mode="wait">
                        {copied ? (
                          <motion.div
                            key="check"
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0 }}
                          >
                            <FiCheck className="h-4 w-4 text-primary" />
                          </motion.div>
                        ) : (
                          <motion.div
                            key="copy"
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0 }}
                          >
                            <FiCopy className="h-4 w-4" />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </Button>
                    <AnimatePresence>
                      {copied && (
                        <motion.span
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 10 }}
                          className="text-xs text-primary"
                        >
                          Copied!
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!isLeader && (
                    <Button
                      variant={me?.ready ? "default" : "outline"}
                      onClick={() => sendSocketMessage({ type: "ROOM_SET_READY", ready: !me?.ready })}
                      className="gap-2"
                    >
                      {me?.ready ? <FiCheck className="h-4 w-4" /> : null}
                      {me?.ready ? "Ready" : "Set Ready"}
                    </Button>
                  )}
                  {isLeader && (
                    <Button
                      onClick={() => sendSocketMessage({ type: "ROOM_START_GAME" })}
                      disabled={!canStartGame}
                      className="gap-2"
                    >
                      <FiPlay className="h-4 w-4" />
                      Start Game
                    </Button>
                  )}
                  <Button variant="outline" onClick={leaveRoom} className="gap-2">
                    <FiLogOut className="h-4 w-4" />
                    Leave
                  </Button>
                </div>
              </div>
            </CardHeader>
            {isLeader && !canStartGame && roomState?.members?.length > 1 && (
              <CardContent className="border-t border-border/50 bg-muted/30 py-3">
                <p className="text-center text-sm text-muted-foreground">
                  Waiting for all players to ready up...
                </p>
              </CardContent>
            )}
            {isLeader && roomState?.members?.length === 1 && (
              <CardContent className="border-t border-border/50 bg-muted/30 py-3">
                <p className="text-center text-sm text-muted-foreground">
                  Share the room code with friends to start playing!
                </p>
              </CardContent>
            )}
          </Card>

          {/* Members & Settings Grid */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Members Card */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center justify-between font-sans text-lg">
                  <span className="flex items-center gap-2">
                    <FiUsers className="h-4 w-4" />
                    Players
                  </span>
                  <span className="font-mono text-sm text-muted-foreground">
                    {roomState?.memberCount || 0}/{roomState?.settings?.maxPlayers || 0}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(roomState?.members || []).map((member, index) => (
                  <motion.div
                    key={member.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="flex items-center justify-between rounded-md border border-border/50 bg-card/50 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
                        member.isLeader ? "bg-primary/20 text-primary" : "bg-muted"
                      }`}>
                        <FiUser className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-semibold">
                          {member.username}
                          {member.isLeader && (
                            <span className="ml-2 font-mono text-xs text-primary">LEADER</span>
                          )}
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {member.rating} rating
                        </p>
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 font-mono text-xs ${
                        member.ready || member.isLeader
                          ? "bg-primary/20 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {member.isLeader ? "Ready" : member.ready ? "Ready" : "Waiting"}
                    </span>
                  </motion.div>
                ))}
              </CardContent>
            </Card>

            {/* Settings Card */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 font-sans text-lg">
                  <FiSettings className="h-4 w-4" />
                  Room Settings
                  {isLeader && <span className="font-mono text-xs text-primary">(Leader)</span>}
                </CardTitle>
              </CardHeader>
              <CardContent className={`space-y-4 ${settingsLocked ? "opacity-60" : ""}`}>
                {!isLeader && (
                  <p className="text-xs text-muted-foreground">
                    Only the room leader can change settings.
                  </p>
                )}
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="space-y-2">
                    <span className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                      Max Players
                    </span>
                    <Input
                      type="number"
                      min={ROOM_SETTING_LIMITS.maxPlayers.min}
                      max={ROOM_SETTING_LIMITS.maxPlayers.max}
                      value={settingsForm.maxPlayers}
                      disabled={settingsLocked}
                      onChange={(e) => updateSettingsField("maxPlayers", e.target.value)}
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                      Round Time (s)
                    </span>
                    <Input
                      type="number"
                      min={ROOM_SETTING_LIMITS.roundTimeSeconds.min}
                      max={ROOM_SETTING_LIMITS.roundTimeSeconds.max}
                      value={settingsForm.roundTimeSeconds}
                      disabled={settingsLocked}
                      onChange={(e) => updateSettingsField("roundTimeSeconds", e.target.value)}
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                      Word Count
                    </span>
                    <Input
                      type="number"
                      min={ROOM_SETTING_LIMITS.wordCount.min}
                      max={ROOM_SETTING_LIMITS.wordCount.max}
                      value={settingsForm.wordCount}
                      disabled={settingsLocked}
                      onChange={(e) => updateSettingsField("wordCount", e.target.value)}
                    />
                  </label>
                </div>
                {isLeader && !settingsLocked && (
                  <Button variant="outline" className="w-full" onClick={updateLeaderSettings}>
                    Save Settings
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Countdown State */}
          <AnimatePresence>
            {roomState?.state === "countdown" && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                <Card className="border-primary/50 bg-primary/5">
                  <CardContent className="py-12 text-center">
                    <p className="mb-4 font-mono text-sm uppercase tracking-[0.2em] text-muted-foreground">
                      Game Starting In
                    </p>
                    <motion.div
                      key={countdown}
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="font-sans text-7xl font-bold text-primary"
                    >
                      {countdown === 0 ? "GO!" : countdown}
                    </motion.div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Playing State */}
          <AnimatePresence>
            {isPlaying && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <Card>
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-3 font-sans">
                        <DotLoader duration={80} />
                        In Match
                      </CardTitle>
                      <div className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 font-mono text-lg font-bold tabular-nums text-primary">
                        <FiClock className="h-4 w-4" />
                        {timeLeft}s
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Current Word */}
                    <div className="text-center">
                      <p className="mb-2 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
                        Type This Word
                      </p>
                      <motion.p
                        key={currentWord}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="font-sans text-4xl font-bold sm:text-5xl"
                      >
                        {currentWord || "Waiting..."}
                      </motion.p>
                    </div>

                    {/* Input */}
                    <Input
                      ref={inputRef}
                      value={gameInput}
                      onChange={(e) => setGameInput(e.target.value)}
                      onKeyDown={submitWord}
                      placeholder="Type and press Enter or Space"
                      className="text-center font-mono text-xl"
                      autoFocus
                    />

                    {/* Progress */}
                    <div className="space-y-2">
                      <p className="font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
                        Scoreboard
                      </p>
                      {(game?.progress || [])
                        .sort((a, b) => b.score - a.score)
                        .map((entry, index) => (
                          <div
                            key={entry.playerId}
                            className={`flex items-center justify-between rounded-md border p-3 ${
                              entry.playerId === currentUser?.uid
                                ? "border-primary/50 bg-primary/5"
                                : "border-border/50"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-sm text-muted-foreground">
                                #{index + 1}
                              </span>
                              <span className="font-semibold">{entry.username}</span>
                            </div>
                            <div className="flex items-center gap-4 font-mono text-sm">
                              <span>{entry.score} pts</span>
                              <span className="text-muted-foreground">
                                Word {entry.currentWordIndex + 1}
                              </span>
                            </div>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Game Result */}
          <AnimatePresence>
            {gameResult && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                <Card className="overflow-hidden">
                  <CardHeader className={`text-center ${
                    gameResult.winnerId === currentUser?.uid
                      ? "bg-gradient-to-r from-primary/20 to-primary/5"
                      : gameResult.isDraw
                      ? "bg-gradient-to-r from-muted to-muted/50"
                      : "bg-gradient-to-r from-destructive/10 to-transparent"
                  }`}>
                    <CardTitle className="font-sans text-2xl">
                      {gameResult.isDraw
                        ? "It's a Draw!"
                        : gameResult.winnerId === currentUser?.uid
                        ? "🎉 You Won!"
                        : "Match Complete"}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      This was a private game - no rating changes.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3 py-6">
                    {(gameResult.rankings || []).map((entry, index) => (
                      <motion.div
                        key={entry.playerId}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.1 }}
                        className={`flex items-center justify-between rounded-md border p-4 ${
                          index === 0 ? "border-primary/50 bg-primary/5" : "border-border/50"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`font-mono text-lg font-bold ${
                            index === 0 ? "text-primary" : "text-muted-foreground"
                          }`}>
                            #{index + 1}
                          </span>
                          <span className="font-semibold">{entry.username}</span>
                        </div>
                        <div className="text-right font-mono">
                          <span className="text-lg font-bold">{entry.score}</span>
                          <span className="text-muted-foreground"> pts</span>
                          <p className="text-xs text-muted-foreground">
                            {entry.progress} words
                          </p>
                        </div>
                      </motion.div>
                    ))}
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
