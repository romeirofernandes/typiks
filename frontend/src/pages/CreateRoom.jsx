import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { UserAvatar } from "@/components/ui/user-avatar";
import { toast } from "sonner";
import Confetti from "react-confetti";
import {
  getSubmitKeyOptionById,
  loadPlayerPreferences,
  NEXT_WORD_CONDITIONS,
  PLAYER_PREFERENCES_STORAGE_KEY,
} from "@/lib/player-preferences";
import { FiCopy, FiCheck, FiUsers, FiClock, FiHash, FiLogOut, FiPlay, FiSettings, FiPlus, FiTrash2, FiSend } from "react-icons/fi";

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
    coopMode: "normal",
  };
}

const ROOM_SETTING_LIMITS = {
  maxPlayers: { min: 2, max: 8 },
  roundTimeSeconds: { min: 20, max: 300 },
  wordCount: { min: 10, max: 120 },
};

const GAME_MODES = [
  { id: "ffa", label: "Free For All", description: "Everyone competes individually" },
  { id: "coop", label: "Coop", description: "Team vs Team - join a team, set names, then ready up" },
];

const COOP_MODES = [
  { id: "normal", label: "Normal", description: "All teammates type in parallel" },
  { id: "switcher", label: "Switcher", description: "Turns rotate by word in each team" },
];

function clampSettingValue(rawValue, min, max, fallback) {
  const parsed = Number.parseInt(String(rawValue), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const TypingWordDisplay = memo(function TypingWordDisplay({ word, input }) {
  const activeWord = String(word || "");
  const activeInput = String(input || "");

  return (
    <div className="relative inline-block font-mono text-4xl font-medium leading-none tracking-wider sm:text-5xl">
      {activeWord.split("").map((char, charIndex) => {
        const typedChar = activeInput[charIndex];
        const isCurrentPosition = charIndex === activeInput.length;
        const isTyped = charIndex < activeInput.length;
        const isCorrect = isTyped && typedChar === char;
        const isWrong = isTyped && typedChar !== char;
        const renderedChar = char === " " ? "\u00A0" : char;
        const renderedTypedChar = isWrong && typedChar === " " ? "_" : typedChar;

        return (
          <span
            key={charIndex}
            className={`relative inline-block min-w-[0.45em] align-baseline transition-colors duration-75 ${
              isCorrect
                ? "text-primary"
                : isWrong
                  ? "text-destructive"
                  : "text-muted-foreground/50"
            }`}
          >
            {isCurrentPosition ? (
              <span
                className="absolute -left-[2px] top-0 h-full w-[3px] bg-primary"
                style={{ animation: "blink 1s ease-in-out infinite" }}
              />
            ) : null}
            {isWrong ? renderedTypedChar : renderedChar}
          </span>
        );
      })}
      {activeInput.length === activeWord.length && activeWord ? (
        <span
          className="absolute -right-[2px] top-0 h-full w-[3px] bg-primary"
          style={{ animation: "blink 1s ease-in-out infinite" }}
        />
      ) : null}
    </div>
  );
});

export default function CreateRoom() {
  const { currentUser } = useAuth();
  const location = useLocation();

  const wsRef = useRef(null);
  const manualDisconnectRef = useRef(false);
  const timerRef = useRef(null);
   const typingSyncRef = useRef({
    timeoutId: null,
    pendingInput: "",
    lastSentInput: "",
  });
  const inputRef = useRef(null);
  const autoJoinHandledRef = useRef(false);
  const userInfoRef = useRef({ username: "Player", rating: 800, avatarId: "avatar1" });

  const [wsStatus, setWsStatus] = useState("idle");
  const [roomState, setRoomState] = useState(null);
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [settingsForm, setSettingsForm] = useState(defaultSettings());
  const [userInfo, setUserInfo] = useState({ username: "Player", rating: 800, avatarId: "avatar1" });
  const [busy, setBusy] = useState(false);
  const [entryMode, setEntryMode] = useState("create");
  const [countdown, setCountdown] = useState(null);
  const [game, setGame] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [gameInput, setGameInput] = useState("");
  const [teamTypingInput, setTeamTypingInput] = useState("");
  const [gameResult, setGameResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [friendsForInvite, setFriendsForInvite] = useState([]);
  const [invitingFriendIds, setInvitingFriendIds] = useState([]);
  const [pendingInviteFriendIds, setPendingInviteFriendIds] = useState([]);
  const [teamNameDrafts, setTeamNameDrafts] = useState({});
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [playerPreferences, setPlayerPreferences] = useState(() => loadPlayerPreferences());
  const friendsRefreshRef = useRef({
    intervalId: null,
    timeoutId: null,
    inFlight: false,
  });

  useEffect(() => {
    const updateViewport = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => {
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(pointer: coarse)");
    const updatePointerType = () => {
      setIsCoarsePointer(mediaQuery.matches);
    };

    updatePointerType();
    mediaQuery.addEventListener("change", updatePointerType);
    return () => {
      mediaQuery.removeEventListener("change", updatePointerType);
    };
  }, []);

  useEffect(() => {
    const syncPreferences = () => {
      setPlayerPreferences(loadPlayerPreferences());
    };

    syncPreferences();
    window.addEventListener("storage", syncPreferences);

    return () => {
      window.removeEventListener("storage", syncPreferences);
    };
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      const stored = window.localStorage.getItem(PLAYER_PREFERENCES_STORAGE_KEY);
      if (stored) {
        setPlayerPreferences(loadPlayerPreferences());
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

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
        avatarId: payload.avatarId || "avatar1",
      });
    } catch {
      setUserInfo({
        username:
          currentUser.displayName || currentUser.email?.split("@")[0] || "Player",
        rating: 800,
        avatarId: "avatar1",
      });
    } finally {
      setIsLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    fetchUserInfo();
  }, [fetchUserInfo]);

  useEffect(() => {
    userInfoRef.current = userInfo;
  }, [userInfo]);

  const fetchFriendsForInvite = useCallback(async () => {
    if (!currentUser) return;
    if (friendsRefreshRef.current.inFlight) return;

    try {
      friendsRefreshRef.current.inFlight = true;
      const idToken = await currentUser.getIdToken();
      const baseUrl = getServerBaseUrl();
      const response = await fetch(`${baseUrl}/api/users/me/friends`, {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to load friends");
      }

      const payload = await response.json();
      setFriendsForInvite(Array.isArray(payload?.friends) ? payload.friends : []);
    } catch (error) {
      console.error("Failed to fetch friends for invite:", error);
      setFriendsForInvite([]);
    } finally {
      friendsRefreshRef.current.inFlight = false;
    }
  }, [currentUser]);

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
    const typingSync = typingSyncRef.current;
    return () => {
      manualDisconnectRef.current = true;
      cleanupSocket();
      if (typingSync.timeoutId) {
        window.clearTimeout(typingSync.timeoutId);
        typingSync.timeoutId = null;
      }
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
          coopMode: message.settings?.coopMode === "switcher" ? "switcher" : "normal",
        }));

        if (message.state === "lobby") {
          setCountdown(null);
          setGame(null);
          setTimeLeft(0);
          setGameInput("");
          setTeamTypingInput("");
        }

        if (message.state === "playing" && message.game) {
          setGame({
            words: message.game.words || [],
            progress: message.game.progress || [],
            teamTurnState: message.game.teamTurnState || {},
            coopMode: message.game.coopMode || "normal",
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
          teamTurnState: message.teamTurnState || {},
          coopMode: message.coopMode || "normal",
          endTime: message.endTime || null,
        });
        setCountdown(null);
        setGameResult(null);
        setGameInput("");
        setTeamTypingInput("");
        setTimeLeft(
          Number.isFinite(message.duration)
            ? Math.max(0, Math.ceil(message.duration / 1000))
            : 0
        );
        break;

      case "ROOM_PROGRESS":
        setGame((prev) => {
          if (!prev) return prev;

          const nextProgress = Array.isArray(message.progress) ? message.progress : [];
          const nextTeamTurnState = message.teamTurnState || prev.teamTurnState || {};

          const sameProgressRef = prev.progress === nextProgress;
          const sameTurnRef = prev.teamTurnState === nextTeamTurnState;
          if (sameProgressRef && sameTurnRef) return prev;

          return {
            ...prev,
            progress: nextProgress,
            teamTurnState: nextTeamTurnState,
          };
        });
        break;

      case "ROOM_TEAM_TYPING":
        setTeamTypingInput((prev) => {
          const next = String(message.currentInput || "");
          return prev === next ? prev : next;
        });
        break;

      case "ROOM_GAME_END":
        setGameResult(message.results || null);
        setCountdown(null);
        setGameInput("");
        setTeamTypingInput("");
        if (typingSyncRef.current.timeoutId) {
          window.clearTimeout(typingSyncRef.current.timeoutId);
          typingSyncRef.current.timeoutId = null;
        }
        typingSyncRef.current.pendingInput = "";
        typingSyncRef.current.lastSentInput = "";
        break;

      case "ROOM_ERROR":
        toast.error(message.error || "Room operation failed");
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
        toast.error("Room code must be 6 characters.");
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
            userInfo: userInfoRef.current,
          })
        );
      };

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return;

        try {
          const message = JSON.parse(event.data);
          handleRoomMessage(message);
        } catch {
          toast.error("Received malformed room message.");
        }
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) {
          return;
        }

        wsRef.current = null;

        if (!manualDisconnectRef.current) {
          setWsStatus("disconnected");
          toast.error("Disconnected from room.");
        }
      };

      ws.onerror = () => {
        if (wsRef.current !== ws) return;
        toast.error("Could not connect to room server.");
      };
    },
    [cleanupSocket, currentUser, handleRoomMessage]
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
        gameMode: settingsForm.gameMode === "coop" ? "coop" : "ffa",
        coopMode: settingsForm.coopMode === "switcher" ? "switcher" : "normal",
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
    } catch (error) {
      toast.error(error.message || "Could not create room.");
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async () => {
    const code = sanitizeRoomCode(joinCode);
    setJoinCode("");

    if (code.length !== 6) {
      toast.error("Enter a valid 6-character room code.");
      return;
    }

    setGameResult(null);
    await connectToRoom(code);
  };

  const sendSocketMessage = (payload) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      toast.error("Room connection is not open.");
      return;
    }

    wsRef.current.send(JSON.stringify(payload));
  };

  const sendSocketMessageSilently = useCallback((payload) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return false;
    }

    wsRef.current.send(JSON.stringify(payload));
    return true;
  }, []);

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
    setGameInput("");
    setTeamTypingInput("");
    setJoinCode("");
  };

  const copyRoomCode = async () => {
    if (!roomCode || copied) return;

    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy room code automatically.");
    }
  };

  const me = useMemo(() => {
    if (!roomState?.members || !currentUser) return null;
    return roomState.members.find((member) => member.id === currentUser.uid) || null;
  }, [currentUser, roomState?.members]);

  const isLeader = Boolean(currentUser?.uid && roomState?.ownerId === currentUser.uid);
  const isInRoom = Boolean(roomState && roomCode);
  const isPlaying = roomState?.state === "playing";
  const isLobbyState = roomState?.state === "lobby";
  const settingsLocked = !isLeader || roomState?.state !== "lobby";

  const coopTeams = useMemo(() => {
    if (!Array.isArray(roomState?.teams)) return [];
    return roomState.teams;
  }, [roomState?.teams]);

  const getTeamPlayers = useCallback((teamId) => {
    if (!roomState?.members) return [];
    return roomState.members.filter((member) => member.teamId === teamId);
  }, [roomState?.members]);

  const getUnassignedPlayers = useCallback(() => {
    if (!roomState?.members) return [];
    return roomState.members.filter((member) => !member.teamId);
  }, [roomState?.members]);

  const myTeamId = me?.teamId || null;

  const teamsValid = useMemo(() => {
    if (settingsForm.gameMode !== "coop") return true;
    if (!roomState?.members?.length || coopTeams.length < 2) return false;
    const activeTeams = coopTeams.filter((team) => getTeamPlayers(team.id).length > 0);
    const everyoneAssigned = roomState.members.every((member) => Boolean(member.teamId));
    return activeTeams.length >= 2 && everyoneAssigned;
  }, [settingsForm.gameMode, roomState?.members, coopTeams, getTeamPlayers]);

  const assignMeToTeam = (teamId) => {
    if (!isInRoom || settingsForm.gameMode !== "coop") return;
    sendSocketMessage({ type: "ROOM_ASSIGN_TEAM", teamId });
  };

  const updateTeamName = (teamId, value) => {
    setTeamNameDrafts((prev) => ({
      ...prev,
      [teamId]: value,
    }));
  };

  const commitTeamName = (teamId) => {
    if (!isInRoom || settingsForm.gameMode !== "coop") return;
    const nextValue = (teamNameDrafts[teamId] ?? "").slice(0, 24);
    sendSocketMessage({ type: "ROOM_SET_TEAM_NAME", teamId, name: nextValue });
  };

  const canStartGame = useMemo(() => {
    if (!isLeader || !roomState?.members || roomState.members.length < 2) return false;
    const otherMembers = roomState.members.filter((m) => m.id !== currentUser?.uid);
    const allReady = otherMembers.length > 0 && otherMembers.every((m) => m.ready);
    if (settingsForm.gameMode === "coop") {
      return allReady && teamsValid;
    }
    return allReady;
  }, [isLeader, roomState?.members, currentUser?.uid, settingsForm.gameMode, teamsValid]);

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

  const myTeamTurnState = useMemo(() => {
    if (!game?.teamTurnState || !myTeamId) return null;
    return game.teamTurnState[myTeamId] || null;
  }, [game?.teamTurnState, myTeamId]);
  const myTeamMembers = useMemo(() => {
    if (!myTeamId || !Array.isArray(roomState?.members)) return [];
    return roomState.members.filter((member) => member.teamId === myTeamId);
  }, [myTeamId, roomState?.members]);
  const isSwitcherCoopActive =
    settingsForm.gameMode === "coop" && (game?.coopMode || settingsForm.coopMode) === "switcher";
  const isMyTurnInSwitcher = Boolean(myTeamTurnState?.activePlayerId === currentUser?.uid);
  const activeTeammate = useMemo(() => {
    if (!isSwitcherCoopActive || !myTeamTurnState?.activePlayerId) return null;
    return myTeamMembers.find((member) => member.id === myTeamTurnState.activePlayerId) || null;
  }, [isSwitcherCoopActive, myTeamMembers, myTeamTurnState?.activePlayerId]);
  const nextTeammate = useMemo(() => {
    if (!isSwitcherCoopActive || !myTeamTurnState?.activePlayerId || myTeamMembers.length < 2) {
      return null;
    }
    const currentIndex = myTeamMembers.findIndex(
      (member) => member.id === myTeamTurnState.activePlayerId
    );
    if (currentIndex < 0) return null;
    return myTeamMembers[(currentIndex + 1) % myTeamMembers.length] || null;
  }, [isSwitcherCoopActive, myTeamMembers, myTeamTurnState?.activePlayerId]);
  const nextTeammateLabel =
    nextTeammate?.id === currentUser?.uid ? "You're next" : nextTeammate?.username || "";

  const currentWord =
    isPlaying && Array.isArray(game?.words)
      ? game.words[(isSwitcherCoopActive ? myTeamTurnState?.currentWordIndex : myProgress.currentWordIndex) || 0] || ""
      : "";
  const isAutoAdvanceEnabled =
    playerPreferences.nextWordCondition === NEXT_WORD_CONDITIONS.auto;
  const activeSubmitKeyIds = Array.isArray(playerPreferences.submitKeyIds)
    ? playerPreferences.submitKeyIds
    : [playerPreferences.submitKeyId].filter(Boolean);
  const activeSubmitKeys = activeSubmitKeyIds.map((id) => getSubmitKeyOptionById(id));
  const activeSubmitKeySet = new Set(activeSubmitKeys.map((option) => option.key));
  const activeSubmitLabel = activeSubmitKeys.map((option) => option.label).join(" / ");

  const rivalProgress = useMemo(() => {
    if (!game?.progress || !currentUser) {
      return { username: "Opponent", score: 0, currentWordIndex: 0, avatarId: "avatar1" };
    }

    const others = game.progress.filter((entry) => entry.playerId !== currentUser.uid);
    const filteredOthers =
      settingsForm.gameMode === "coop" && myTeamId && Array.isArray(roomState?.members)
        ? others.filter((entry) => {
            const member = roomState.members.find((item) => item.id === entry.playerId);
            return member?.teamId && member.teamId !== myTeamId;
          })
        : others;

    const candidateProgress = filteredOthers.length > 0 ? filteredOthers : others;
    if (candidateProgress.length === 0) {
      return { username: "Opponent", score: 0, currentWordIndex: 0, avatarId: "avatar1" };
    }

    return [...candidateProgress].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.currentWordIndex - a.currentWordIndex;
    })[0];
  }, [currentUser, game?.progress, myTeamId, roomState?.members, settingsForm.gameMode]);

  const coopProgress = useMemo(() => {
    if (settingsForm.gameMode !== "coop" || !Array.isArray(game?.progress) || !Array.isArray(roomState?.members)) {
      return null;
    }

    const teamByPlayerId = new Map(
      roomState.members.map((member) => [member.id, member.teamId || null])
    );

    const aggregates = new Map();
    for (const entry of game.progress) {
      const teamId = teamByPlayerId.get(entry.playerId);
      if (!teamId) continue;

      if (!aggregates.has(teamId)) {
        aggregates.set(teamId, {
          teamId,
          score: 0,
          correctChars: 0,
          currentWordIndex: 0,
        });
      }

      const bucket = aggregates.get(teamId);
      bucket.score += Number(entry.score || 0);
      bucket.correctChars += Number(entry.correctChars || 0);
      bucket.currentWordIndex = Math.max(
        bucket.currentWordIndex,
        Number(entry.currentWordIndex || 0)
      );
    }

    const myTeam = myTeamId ? aggregates.get(myTeamId) || null : null;
    let rivalTeam = null;
    for (const bucket of aggregates.values()) {
      if (bucket.teamId === myTeamId) continue;
      if (!rivalTeam) {
        rivalTeam = bucket;
        continue;
      }
      if (bucket.currentWordIndex > rivalTeam.currentWordIndex) {
        rivalTeam = bucket;
      }
    }

    return { myTeam, rivalTeam };
  }, [game?.progress, myTeamId, roomState?.members, settingsForm.gameMode]);

  const myTeamName =
    settingsForm.gameMode === "coop"
      ? coopTeams.find((team) => team.id === myTeamId)?.name || "Your Team"
      : "Your Progress";
  const rivalTeamName =
    settingsForm.gameMode === "coop"
      ? coopTeams.find((team) => team.id === coopProgress?.rivalTeam?.teamId)?.name || "Rival Team"
      : "Opponent Progress";

  const myProgressValue =
    settingsForm.gameMode === "coop"
      ? Number(coopProgress?.myTeam?.currentWordIndex || 0)
      : Number(myProgress.currentWordIndex || 0);
  const rivalProgressValue =
    settingsForm.gameMode === "coop"
      ? Number(coopProgress?.rivalTeam?.currentWordIndex || 0)
      : Number(rivalProgress.currentWordIndex || 0);

  const isCoopResult = gameResult?.mode === "coop";
  const winningTeam = useMemo(() => {
    if (!isCoopResult || !Array.isArray(gameResult?.teamResults)) return null;
    return (
      gameResult.teamResults.find((team) => team.teamId === gameResult.winningTeamId) || null
    );
  }, [isCoopResult, gameResult?.teamResults, gameResult?.winningTeamId]);
  const myResultTeamId = useMemo(() => {
    if (!isCoopResult || !Array.isArray(gameResult?.rankings) || !currentUser?.uid) return null;
    const mine = gameResult.rankings.find((entry) => entry.playerId === currentUser.uid);
    return mine?.teamId || null;
  }, [currentUser?.uid, gameResult?.rankings, isCoopResult]);
  const shouldCelebrate = Boolean(
    gameResult && (
      (!isCoopResult && gameResult.winnerId === currentUser?.uid) ||
      (isCoopResult && myResultTeamId && gameResult.winningTeamId === myResultTeamId)
    )
  );

  const liveSwitcherInput =
    isSwitcherCoopActive && !isMyTurnInSwitcher
      ? String(teamTypingInput !== "" ? teamTypingInput : myTeamTurnState?.currentInput ?? "")
      : gameInput;

  const submitWordIfCorrect = useCallback((rawInput) => {
    if (!isPlaying) return;
    if (isSwitcherCoopActive && !isMyTurnInSwitcher) return;

    const normalizedInput = String(rawInput || "").trim();
    if (!normalizedInput || !currentWord) return;
    if (normalizedInput !== currentWord) return;

    if (currentUser?.uid) {
      setGame((prev) => {
        if (!prev || !Array.isArray(prev.progress)) return prev;

        return {
          ...prev,
          progress: prev.progress.map((entry) => {
            if (entry.playerId !== currentUser.uid) return entry;
            return {
              ...entry,
              score: Number(entry.score || 0) + 1,
              currentWordIndex: Number(entry.currentWordIndex || 0) + 1,
            };
          }),
        };
      });
    }

    sendSocketMessage({ type: "PLAYER_INPUT", input: normalizedInput });
    if (typingSyncRef.current.timeoutId) {
      window.clearTimeout(typingSyncRef.current.timeoutId);
      typingSyncRef.current.timeoutId = null;
    }
    typingSyncRef.current.pendingInput = "";
    typingSyncRef.current.lastSentInput = "";
    setGameInput("");
    setTeamTypingInput("");
  }, [currentUser?.uid, currentWord, isMyTurnInSwitcher, isPlaying, isSwitcherCoopActive]);

  const submitWord = (event) => {
    if (event.key === " ") {
      event.preventDefault();
      return;
    }

    if (isAutoAdvanceEnabled) return;
    if (!activeSubmitKeySet.has(event.key)) return;
    event.preventDefault();
    submitWordIfCorrect(gameInput);
  };

  const handleGameInputChange = (event) => {
    if (isSwitcherCoopActive && !isMyTurnInSwitcher) {
      return;
    }

    const maxLength = currentWord.length;
    const nextValue = String(event.target.value || "").replace(/\s/g, "").slice(0, maxLength);
    if (nextValue === gameInput) return;
    setGameInput(nextValue);

    if (isSwitcherCoopActive) {
      const typingSync = typingSyncRef.current;
      typingSync.pendingInput = nextValue;

      if (!typingSync.timeoutId) {
        typingSync.timeoutId = window.setTimeout(() => {
          typingSync.timeoutId = null;
          const payloadInput = typingSync.pendingInput;
          if (payloadInput === typingSync.lastSentInput) return;
          const sent = sendSocketMessageSilently({ type: "PLAYER_TYPING", input: payloadInput });
          if (sent) {
            typingSync.lastSentInput = payloadInput;
          }
        }, 45);
      }
    }

    if (isAutoAdvanceEnabled) {
      submitWordIfCorrect(nextValue);
    }
  };

  const submitCurrentWord = () => {
    submitWordIfCorrect(gameInput);
  };

  useEffect(() => {
    if (!isPlaying || !isSwitcherCoopActive) return;

    if (!isMyTurnInSwitcher) {
      if (typingSyncRef.current.timeoutId) {
        window.clearTimeout(typingSyncRef.current.timeoutId);
        typingSyncRef.current.timeoutId = null;
      }
      typingSyncRef.current.pendingInput = "";
      typingSyncRef.current.lastSentInput = "";
      setGameInput("");
      return;
    }

    setGameInput(String(myTeamTurnState?.currentInput || ""));
  }, [isMyTurnInSwitcher, isPlaying, isSwitcherCoopActive, myTeamTurnState?.currentInput]);

  useEffect(() => {
    if (!isPlaying || !isSwitcherCoopActive || isMyTurnInSwitcher) return;
    setTeamTypingInput("");
  }, [
    isMyTurnInSwitcher,
    isPlaying,
    isSwitcherCoopActive,
    myTeamTurnState?.currentWordIndex,
    myTeamTurnState?.activePlayerId,
  ]);

  useEffect(() => {
    if (!isPlaying) return;
    if (isCoarsePointer) return;
    if (isSwitcherCoopActive && !isMyTurnInSwitcher) return;

    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 0);

    return () => clearTimeout(timer);
  }, [isCoarsePointer, isMyTurnInSwitcher, isPlaying, isSwitcherCoopActive]);

  const updateLeaderSettings = () => {
    if (!isLeader) return;
    sendSocketMessage({ type: "ROOM_UPDATE_SETTINGS", settings: settingsForm });
  };

  const sendFriendInvite = async (friendId) => {
    if (!currentUser || !roomCode || !friendId) return;

    try {
      setInvitingFriendIds((prev) => [...prev, friendId]);
      const idToken = await currentUser.getIdToken();
      const baseUrl = getServerBaseUrl();

      const response = await fetch(`${baseUrl}/api/users/me/room-invites`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ roomCode, inviteeId: friendId }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to send invite");
      }

      setPendingInviteFriendIds((prev) => Array.from(new Set([...prev, friendId])));
    } catch (error) {
      toast.error(error.message || "Failed to send invite");
    } finally {
      setInvitingFriendIds((prev) => prev.filter((id) => id !== friendId));
    }
  };

  useEffect(() => {
    if (!isInRoom || !isLeader || !isLobbyState) return;
    fetchFriendsForInvite();
  }, [fetchFriendsForInvite, isInRoom, isLeader, isLobbyState]);

  useEffect(() => {
    if (!isInRoom || !isLobbyState || friendsForInvite.length === 0) return;

    const userIds = friendsForInvite.map((friend) => friend.id).filter(Boolean);
    if (userIds.length > 0) {
      window.dispatchEvent(
        new CustomEvent("typiks:presence-subscribe", {
          detail: { userIds },
        })
      );
    }

    const handlePresenceUpdate = (event) => {
      const userId = event?.detail?.userId;
      const online = Boolean(event?.detail?.online);
      if (!userId) return;

      setFriendsForInvite((prev) =>
        prev.map((friend) => (friend.id === userId ? { ...friend, online } : friend))
      );
    };

    const handlePresenceSnapshot = (event) => {
      const onlineMap = event?.detail?.onlineMap;
      if (!onlineMap || typeof onlineMap !== "object") return;

      setFriendsForInvite((prev) =>
        prev.map((friend) =>
          friend.id in onlineMap ? { ...friend, online: Boolean(onlineMap[friend.id]) } : friend
        )
      );
    };

    window.addEventListener("typiks:presence-update", handlePresenceUpdate);
    window.addEventListener("typiks:presence-snapshot", handlePresenceSnapshot);

    return () => {
      window.removeEventListener("typiks:presence-update", handlePresenceUpdate);
      window.removeEventListener("typiks:presence-snapshot", handlePresenceSnapshot);
    };
  }, [friendsForInvite, isInRoom, isLobbyState]);

  useEffect(() => {
    if (!isInRoom || !isLobbyState || !currentUser) return;
    const refreshState = friendsRefreshRef.current;

    const refreshFriends = () => {
      fetchFriendsForInvite();
    };

    if (refreshState.intervalId) {
      window.clearInterval(refreshState.intervalId);
      refreshState.intervalId = null;
    }

    if (refreshState.timeoutId) {
      window.clearTimeout(refreshState.timeoutId);
      refreshState.timeoutId = null;
    }

    refreshState.timeoutId = window.setTimeout(() => {
      refreshFriends();
      refreshState.timeoutId = null;
    }, 300);

    refreshState.intervalId = window.setInterval(refreshFriends, 10000);
    window.addEventListener("focus", refreshFriends);
    document.addEventListener("visibilitychange", refreshFriends);

    return () => {
      if (refreshState.intervalId) {
        window.clearInterval(refreshState.intervalId);
        refreshState.intervalId = null;
      }
      if (refreshState.timeoutId) {
        window.clearTimeout(refreshState.timeoutId);
        refreshState.timeoutId = null;
      }
      window.removeEventListener("focus", refreshFriends);
      document.removeEventListener("visibilitychange", refreshFriends);
    };
  }, [currentUser, fetchFriendsForInvite, isInRoom, isLobbyState]);

  useEffect(() => {
    if (!Array.isArray(coopTeams) || coopTeams.length === 0) {
      setTeamNameDrafts({});
      return;
    }

    setTeamNameDrafts((prev) => {
      const next = {};
      for (const team of coopTeams) {
        next[team.id] = prev[team.id] ?? team.name;
      }
      return next;
    });
  }, [coopTeams]);

  useEffect(() => {
    if (autoJoinHandledRef.current || !currentUser || isInRoom || isLoading) return;

    const inviteCode = sanitizeRoomCode(location.state?.joinRoomCode || "");
    if (inviteCode.length !== 6) return;

    autoJoinHandledRef.current = true;
    setEntryMode("join");
    setJoinCode(inviteCode);
    connectToRoom(inviteCode, settingsForm);
  }, [connectToRoom, currentUser, isInRoom, isLoading, location.state?.joinRoomCode, settingsForm]);

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
      {gameResult && shouldCelebrate && viewport.width > 0 && viewport.height > 0 ? (
        <Confetti width={viewport.width} height={viewport.height} recycle={false} numberOfPieces={160} gravity={0.2} tweenDuration={1800} />
      ) : null}

      {isPlaying ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="space-y-6"
        >
          <div className="grid grid-cols-2 gap-4">
            <Card className="border-primary/30 bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                  <UserAvatar avatarId={userInfo.avatarId} username={userInfo.username} size="sm" />
                  {userInfo.username} (You)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-sans text-3xl font-bold text-primary">{myProgress.score}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  Word {(isSwitcherCoopActive ? myTeamTurnState?.currentWordIndex : myProgress.currentWordIndex) + 1} / {game?.words?.length || 0}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                  <UserAvatar avatarId={rivalProgress.avatarId} username={rivalProgress.username} size="sm" />
                  {rivalProgress.username}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-sans text-3xl font-bold">{rivalProgress.score}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  Word {rivalProgress.currentWordIndex + 1} / {game?.words?.length || 0}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className={isSwitcherCoopActive && isMyTurnInSwitcher ? "border-primary/60 ring-1 ring-primary/20" : ""}>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="font-sans">In Match</CardTitle>
                <div className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 font-mono text-lg font-bold tabular-nums text-primary">
                  <FiClock className="h-4 w-4" />
                  {timeLeft}s
                </div>
              </div>
              {isSwitcherCoopActive ? (
                <div className="mt-2 flex items-center justify-between">
                  <span className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-mono uppercase tracking-[0.08em] ${
                    isMyTurnInSwitcher
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    {isMyTurnInSwitcher ? "Your Turn" : "Teammate Turn"}
                  </span>
                  {!isMyTurnInSwitcher && activeTeammate ? (
                    <span className="text-xs text-muted-foreground">
                      Next: {nextTeammateLabel || "-"}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="text-center">
                <p className="mb-2 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  Type This Word
                </p>
                <TypingWordDisplay word={currentWord} input={liveSwitcherInput} />
              </div>
              {isSwitcherCoopActive ? (
                <p className="-mt-2 text-center text-xs text-muted-foreground">
                  {isMyTurnInSwitcher
                    ? `Your turn${nextTeammateLabel ? ` • ${nextTeammateLabel} next` : ""}`
                    : `${activeTeammate?.username || "Teammate"} typing${nextTeammateLabel ? ` • ${nextTeammateLabel} next` : ""}`}
                </p>
              ) : null}

              <input
                ref={inputRef}
                value={gameInput}
                onChange={handleGameInputChange}
                onKeyDown={submitWord}
                className={isCoarsePointer ? "h-11 w-full rounded-md border border-border/70 bg-background px-3 text-base" : "pointer-events-none absolute opacity-0"}
                disabled={isSwitcherCoopActive && !isMyTurnInSwitcher}
                autoFocus={!isCoarsePointer}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
                enterKeyHint="go"
              />

              <div
                onClick={() => inputRef.current?.focus()}
                className="cursor-text rounded-md border border-border/50 bg-muted/30 p-4 text-center"
              >
                <p className="font-mono text-sm text-muted-foreground">
                  {liveSwitcherInput.length > 0 ? (
                    <span>
                      Typing: <span className="text-foreground">{liveSwitcherInput}</span>
                    </span>
                  ) : (
                    isAutoAdvanceEnabled
                      ? "Type the full word correctly to auto-advance..."
                      : `Type the word, then press ${activeSubmitLabel} to submit...`
                  )}
                </p>
              </div>
              {isCoarsePointer && !isAutoAdvanceEnabled ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={submitCurrentWord}
                  disabled={isSwitcherCoopActive && !isMyTurnInSwitcher}
                >
                  Submit Word
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                  {myTeamName}
                </span>
                <span className="font-mono text-xs text-primary">
                  {Math.round((myProgressValue / (game?.words?.length || 1)) * 100)}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: `${(myProgressValue / (game?.words?.length || 1)) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                  {rivalTeamName}
                </span>
                <span className="font-mono text-xs text-destructive">
                  {Math.round((rivalProgressValue / (game?.words?.length || 1)) * 100)}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <motion.div
                  className="h-full rounded-full bg-destructive"
                  initial={{ width: 0 }}
                  animate={{ width: `${(rivalProgressValue / (game?.words?.length || 1)) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}

      {gameResult ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <Card className="border-primary/30 bg-card/80">
            <CardHeader className="text-center">
              <CardTitle className="font-sans text-2xl">
                {gameResult.isDraw
                  ? "It's a Draw!"
                  : isCoopResult && winningTeam
                  ? `${winningTeam.name} Wins!`
                  : gameResult.winnerId === currentUser?.uid
                  ? "You Won"
                  : "Better Luck Next Time!"}
              </CardTitle>
              <p className="text-sm text-muted-foreground">Private match summary</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {isCoopResult ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {(gameResult.teamResults || []).map((team) => {
                    const isWinningTeam = team.teamId === gameResult.winningTeamId && !gameResult.isDraw;
                    return (
                      <div
                        key={team.teamId}
                        className={`rounded-md border ${
                          isWinningTeam ? "border-primary/60 bg-primary/5" : "border-border/60 bg-card/40"
                        }`}
                      >
                        <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
                          <p className="font-semibold">{team.name}</p>
                          <div className="text-right">
                            <p className="font-mono text-sm font-bold">{team.score} pts</p>
                            <p className="font-mono text-[11px] text-muted-foreground">{team.correctChars} chars</p>
                          </div>
                        </div>
                        <div className="space-y-1 p-2">
                          {(team.members || []).map((member) => (
                            <div
                              key={member.playerId}
                              className="grid grid-cols-[minmax(0,1fr)_64px_70px] items-center gap-2 rounded border border-border/40 px-2 py-1.5"
                            >
                              <span className="inline-flex items-center gap-2 truncate text-sm font-medium">
                                <UserAvatar avatarId={member.avatarId} username={member.username} size="sm" />
                                <span className="truncate">{member.username}</span>
                              </span>
                              <span className="text-right font-mono text-xs text-muted-foreground">
                                {member.score} pts
                              </span>
                              <span className="text-right font-mono text-xs text-muted-foreground">
                                {member.correctChars} ch
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                (gameResult.rankings || []).map((entry, index) => (
                  <div
                    key={entry.playerId}
                    className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                      index === 0 ? "border-primary/50 bg-primary/5" : "border-border/60"
                    }`}
                  >
                    <div>
                      <p className="inline-flex items-center gap-2 font-semibold">
                        <UserAvatar avatarId={entry.avatarId} username={entry.username} size="sm" />
                        <span>#{index + 1} {entry.username}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">{entry.correctChars ?? 0} chars</p>
                    </div>
                    <p className="font-mono text-lg font-bold">{entry.score}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </motion.div>
      ) : null}

      {!isPlaying ? (
      <>
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
                    ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                    : "border-border/50 hover:border-border"
                }`}
              >
                <CardHeader className="gap-2 pb-3">
                  <div className="flex items-center gap-2">
                    <div className={`rounded-md p-2 ${entryMode === "join" ? "bg-primary/20" : "bg-muted"}`}>
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
                  <CardHeader>
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
                                ? "border-primary bg-primary/10 text-foreground dark:text-primary"
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

                    {settingsForm.gameMode === "coop" ? (
                      <div className="space-y-3">
                        <p className="font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
                          Coop Mode
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {COOP_MODES.map((mode) => (
                            <button
                              key={mode.id}
                              type="button"
                              onClick={() =>
                                setSettingsForm((prev) => ({
                                  ...prev,
                                  coopMode: mode.id,
                                }))
                              }
                              className={`rounded-md border px-3 py-2 text-left text-sm transition-all ${
                                settingsForm.coopMode === mode.id
                                  ? "border-primary bg-primary/10 text-foreground dark:text-primary"
                                  : "border-border/50 hover:border-border hover:bg-muted/50"
                              }`}
                            >
                              <p className="font-semibold">{mode.label}</p>
                              <p className="mt-1 text-xs text-muted-foreground">{mode.description}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="flex flex-col gap-3 border-t border-border/50 pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-muted-foreground">
                        Private games don't affect your rating.
                      </p>
                      <Button onClick={createRoom} disabled={busy} className="w-full sm:w-auto">
                        {busy ? (
                          <span className="flex items-center gap-2">
                            <Spinner className="size-4 text-current" />
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
                <Card className="border-primary/20">
                  <CardHeader>
                    <CardTitle className="font-sans text-lg">Enter Room Code</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row">
                    <Input
                      value={joinCode}
                      onChange={(e) => setJoinCode(sanitizeRoomCode(e.target.value))}
                      placeholder="ABC123"
                      maxLength={6}
                      autoComplete="off"
                      spellCheck={false}
                      autoCapitalize="characters"
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
            <CardHeader className="pb-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
                    Room Code
                  </p>
                  <div className="flex items-center gap-3">
                    <h2 className="font-mono text-3xl font-bold tracking-[0.2em] text-primary">
                      {roomCode}
                    </h2>
                    {isLobbyState && (
                      <>
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
                                <FiCheck className="h-4 w-4 text-foreground" />
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
                              className="text-xs text-foreground"
                            >
                              Copied!
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!isLeader && isLobbyState && (
                    <Button
                      variant={me?.ready ? "default" : "outline"}
                      onClick={() => sendSocketMessage({ type: "ROOM_SET_READY", ready: !me?.ready })}
                      disabled={settingsForm.gameMode === "coop" && !myTeamId}
                      className="gap-2"
                    >
                      {me?.ready ? <FiCheck className="h-4 w-4" /> : null}
                      {me?.ready ? "Ready" : settingsForm.gameMode === "coop" && !myTeamId ? "Join Team First" : "Set Ready"}
                    </Button>
                  )}
                  {isLeader && isLobbyState && (
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
          </Card>

          {isLeader && isLobbyState ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 font-sans text-base">
                  <FiSend className="h-4 w-4" />
                  Invite Friends
                </CardTitle>
              </CardHeader>
              <CardContent>
                {friendsForInvite.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No friends available to invite.</p>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    {friendsForInvite.map((friend) => {
                      const isOnline = Boolean(friend.online);
                      const isInviting = invitingFriendIds.includes(friend.id);
                      const alreadyInvited = pendingInviteFriendIds.includes(friend.id);
                      const cannotInvite = !isOnline || isInviting || alreadyInvited;

                      return (
                        <div
                          key={friend.id}
                          className="flex items-center justify-between rounded-md border border-border/60 bg-card/40 px-3 py-2"
                        >
                          <div>
                            <p className="inline-flex items-center gap-2 font-semibold">
                              <UserAvatar avatarId={friend.avatarId} username={friend.username} size="sm" />
                              <span>{friend.username}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {friend.rating} rating • {isOnline ? "Online" : "Offline"}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant={cannotInvite ? "outline" : "default"}
                            disabled={cannotInvite}
                            onClick={() => sendFriendInvite(friend.id)}
                          >
                            {alreadyInvited ? "Invited" : isInviting ? "Sending..." : "Invite"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {/* Members & Settings Grid */}
          {isLobbyState && (
            <div className="grid gap-6 lg:grid-cols-2">
            {/* Members Card - Different UI for FFA vs Coop */}
            {settingsForm.gameMode === "ffa" ? (
              /* FFA Mode - Simple player list */
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
                          <UserAvatar avatarId={member.avatarId} username={member.username} size="sm" />
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
            ) : (
              /* Coop Mode - Team selection UI */
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center justify-between font-sans text-lg">
                    <span className="flex items-center gap-2">
                      <FiUsers className="h-4 w-4" />
                      Teams
                    </span>
                    <span className="font-mono text-sm text-muted-foreground">
                      {roomState?.memberCount || 0} players
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isLeader ? (
                    <div className="flex items-center justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => sendSocketMessage({ type: "ROOM_ADD_TEAM" })}
                        disabled={coopTeams.length >= (roomState?.members?.length || 0)}
                      >
                        <FiPlus className="h-4 w-4" />
                        Add Team
                      </Button>
                    </div>
                  ) : null}

                  <div className="grid gap-2 sm:grid-cols-2">
                    {coopTeams.map((team) => {
                      const players = getTeamPlayers(team.id);
                      const isMyTeam = myTeamId === team.id;
                      return (
                        <div key={team.id} className="space-y-2 rounded-md border border-border/60 bg-card/60 p-3">
                          <div className="space-y-2">
                            <p className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                              {team.id}
                            </p>
                            {isLeader ? (
                              <Input
                                value={teamNameDrafts[team.id] ?? team.name}
                                onChange={(event) => updateTeamName(team.id, event.target.value)}
                                onBlur={() => commitTeamName(team.id)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    commitTeamName(team.id);
                                  }
                                }}
                                placeholder="Team name"
                                maxLength={24}
                                className="h-8 font-mono text-sm"
                              />
                            ) : (
                              <p className="font-semibold">{team.name}</p>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant={isMyTeam ? "default" : "outline"}
                            className="w-full"
                            onClick={() => assignMeToTeam(team.id)}
                          >
                            {isMyTeam ? "Joined" : `Join ${team.name}`}
                          </Button>
                          {isLeader && coopTeams.length > 2 ? (
                            <Button
                              type="button"
                              variant="ghost"
                              className="w-full gap-2 text-destructive hover:text-destructive"
                              disabled={players.length > 0}
                              onClick={() => sendSocketMessage({ type: "ROOM_REMOVE_TEAM", teamId: team.id })}
                            >
                              <FiTrash2 className="h-4 w-4" />
                              Remove Team
                            </Button>
                          ) : null}
                          <div className="min-h-[90px] space-y-1 rounded-md border border-border/40 p-2">
                            {players.length === 0 ? (
                              <p className="py-2 text-center text-xs text-muted-foreground">No players yet</p>
                            ) : (
                              players.map((member) => (
                                <div key={member.id} className="flex items-center justify-between rounded bg-muted/40 px-2 py-1.5">
                                  <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center gap-2 text-sm font-medium">
                                      <UserAvatar avatarId={member.avatarId} username={member.username} size="sm" />
                                      <span>{member.username}</span>
                                    </span>
                                    {member.isLeader && (
                                      <span className="font-mono text-xs text-primary">LEADER</span>
                                    )}
                                  </div>
                                  {!member.isLeader && (
                                    <span className={`font-mono text-xs ${member.ready ? "text-primary" : "text-muted-foreground"}`}>
                                      {member.ready ? "Ready" : "Waiting"}
                                    </span>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {getUnassignedPlayers().length > 0 && (
                    <p className="text-center text-xs text-muted-foreground">
                      Unassigned: {getUnassignedPlayers().map((member) => member.username).join(", ")}
                    </p>
                  )}

                  {/* Team validation message */}
                  {!teamsValid && (
                    <p className="text-center text-xs text-destructive">
                      Coop requires every player assigned and each team to have at least one player.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

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

                  {settingsForm.gameMode === "coop" ? (
                    <label className="space-y-2">
                      <span className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                        Coop Mode
                      </span>
                      <select
                        className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                        value={settingsForm.coopMode}
                        disabled={settingsLocked}
                        onChange={(event) =>
                          setSettingsForm((prev) => ({
                            ...prev,
                            coopMode: event.target.value === "switcher" ? "switcher" : "normal",
                          }))
                        }
                      >
                        <option value="normal">Normal</option>
                        <option value="switcher">Switcher</option>
                      </select>
                    </label>
                  ) : null}
                </div>
                {isLeader && !settingsLocked && (
                  <Button variant="outline" className="w-full" onClick={updateLeaderSettings}>
                    Save Settings
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
          )}

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
                    <div className="mb-4 flex justify-center">
                      <Spinner className="size-6 text-primary" />
                    </div>
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
                className="space-y-6"
              >
                <div className="grid grid-cols-2 gap-4">
                  <Card className="border-primary/30 bg-primary/5">
                    <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                        <UserAvatar avatarId={userInfo.avatarId} username={userInfo.username} size="sm" />
                        {userInfo.username} (You)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="font-sans text-3xl font-bold text-primary">{myProgress.score}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        Word {(isSwitcherCoopActive ? myTeamTurnState?.currentWordIndex : myProgress.currentWordIndex) + 1} / {game?.words?.length || 0}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                        <UserAvatar avatarId={rivalProgress.avatarId} username={rivalProgress.username} size="sm" />
                        {rivalProgress.username}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="font-sans text-3xl font-bold">{rivalProgress.score}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        Word {rivalProgress.currentWordIndex + 1} / {game?.words?.length || 0}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card className={isSwitcherCoopActive && isMyTurnInSwitcher ? "border-primary/60 ring-1 ring-primary/20" : ""}>
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="font-sans">In Match</CardTitle>
                      <div className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 font-mono text-lg font-bold tabular-nums text-primary">
                        <FiClock className="h-4 w-4" />
                        {timeLeft}s
                      </div>
                    </div>
                    {isSwitcherCoopActive ? (
                      <div className="mt-2 flex items-center justify-between">
                        <span className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-mono uppercase tracking-[0.08em] ${
                          isMyTurnInSwitcher
                            ? "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground"
                        }`}>
                          {isMyTurnInSwitcher ? "Your Turn" : "Teammate Turn"}
                        </span>
                        {!isMyTurnInSwitcher && activeTeammate ? (
                          <span className="text-xs text-muted-foreground">
                            Next: {nextTeammateLabel || "-"}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="text-center">
                      <p className="mb-2 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
                        Type This Word
                      </p>
                      <div
                        className="relative inline-block font-mono text-4xl font-medium tracking-wider leading-none sm:text-5xl"
                      >
                        {(currentWord || "").split("").map((char, charIndex) => {
                          const typedChar = liveSwitcherInput[charIndex];
                          const isCurrentPosition = charIndex === liveSwitcherInput.length;
                          const isTyped = charIndex < liveSwitcherInput.length;
                          const isCorrect = isTyped && typedChar === char;
                          const isWrong = isTyped && typedChar !== char;
                          const renderedChar = char === " " ? "\u00A0" : char;
                          const renderedTypedChar = isWrong && typedChar === " " ? "_" : typedChar;

                          return (
                            <span
                              key={charIndex}
                              className={`relative inline-block min-w-[0.45em] align-baseline transition-colors duration-75 ${
                                isCorrect
                                  ? "text-primary"
                                  : isWrong
                                  ? "text-destructive"
                                  : "text-muted-foreground/50"
                              }`}
                            >
                              {isCurrentPosition && (
                                <motion.span
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  className="absolute -left-[2px] top-0 h-full w-[3px] bg-primary"
                                  style={{ animation: "blink 1s ease-in-out infinite" }}
                                />
                              )}
                              {isWrong ? renderedTypedChar : renderedChar}
                            </span>
                          );
                        })}
                        {liveSwitcherInput.length === (currentWord || "").length && currentWord ? (
                          <motion.span
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="absolute -right-[2px] top-0 h-full w-[3px] bg-primary"
                            style={{ animation: "blink 1s ease-in-out infinite" }}
                          />
                        ) : null}
                      </div>
                    </div>
                    {isSwitcherCoopActive ? (
                      <p className="-mt-2 text-center text-xs text-muted-foreground">
                        {isMyTurnInSwitcher
                          ? `Your turn${nextTeammateLabel ? ` • ${nextTeammateLabel} next` : ""}`
                          : `${activeTeammate?.username || "Teammate"} typing${nextTeammateLabel ? ` • ${nextTeammateLabel} next` : ""}`}
                      </p>
                    ) : null}

                    <input
                      ref={inputRef}
                      value={gameInput}
                      onChange={handleGameInputChange}
                      onKeyDown={submitWord}
                      className={isCoarsePointer ? "h-11 w-full rounded-md border border-border/70 bg-background px-3 text-base" : "pointer-events-none absolute opacity-0"}
                      disabled={isSwitcherCoopActive && !isMyTurnInSwitcher}
                      autoFocus={!isCoarsePointer}
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="off"
                      spellCheck={false}
                      inputMode="text"
                      enterKeyHint="go"
                    />

                    <div
                      onClick={() => inputRef.current?.focus()}
                      className="cursor-text rounded-md border border-border/50 bg-muted/30 p-4 text-center"
                    >
                      <p className="font-mono text-sm text-muted-foreground">
                        {liveSwitcherInput.length > 0 ? (
                          <span>
                            Typing: <span className="text-foreground">{liveSwitcherInput}</span>
                          </span>
                        ) : (
                          isAutoAdvanceEnabled
                            ? "Type the full word correctly to auto-advance..."
                            : `Type the word, then press ${activeSubmitLabel} to submit...`
                        )}
                      </p>
                    </div>
                    {isCoarsePointer && !isAutoAdvanceEnabled ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full"
                        onClick={submitCurrentWord}
                        disabled={isSwitcherCoopActive && !isMyTurnInSwitcher}
                      >
                        Submit Word
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                        {myTeamName}
                      </span>
                      <span className="font-mono text-xs text-primary">
                        {Math.round((myProgressValue / (game?.words?.length || 1)) * 100)}%
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                      <motion.div
                        className="h-full rounded-full bg-primary"
                        initial={{ width: 0 }}
                        animate={{ width: `${(myProgressValue / (game?.words?.length || 1)) * 100}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                        {rivalTeamName}
                      </span>
                      <span className="font-mono text-xs text-destructive">
                        {Math.round((rivalProgressValue / (game?.words?.length || 1)) * 100)}%
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                      <motion.div
                        className="h-full rounded-full bg-destructive"
                        initial={{ width: 0 }}
                        animate={{ width: `${(rivalProgressValue / (game?.words?.length || 1)) * 100}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </motion.div>
      )}
      </>
      ) : null}
    </div>
  );
}
