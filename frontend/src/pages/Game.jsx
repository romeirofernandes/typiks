import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  motion,
  AnimatePresence,
} from "framer-motion";
import Confetti from "react-confetti";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DotLoader } from "@/components/ui/dot-loader";
import {
  getSubmitKeyOptionById,
  loadPlayerPreferences,
  NEXT_WORD_CONDITIONS,
  PLAYER_PREFERENCES_STORAGE_KEY,
} from "@/lib/player-preferences";
import { FiUser, FiClock, FiArrowLeft, FiZap, FiTrendingUp, FiCheck, FiX } from "react-icons/fi";

const Game = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const initialModeSeconds = [15, 30, 60, 120].includes(Number(location.state?.modeSeconds))
    ? Number(location.state.modeSeconds)
    : 60;
  const [gameState, setGameState] = useState("waiting");
  const [connectionError, setConnectionError] = useState(null);
  const [opponent, setOpponent] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [words, setWords] = useState([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [opponentWordIndex, setOpponentWordIndex] = useState(0);
  const [myScore, setMyScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [input, setInput] = useState("");
  const [gameResults, setGameResults] = useState(null);
  const [postMatchRating, setPostMatchRating] = useState(null);
  const [modeSeconds, setModeSeconds] = useState(initialModeSeconds);
  const [activeGameId, setActiveGameId] = useState(null);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [rematchState, setRematchState] = useState("idle");
  const [incomingRematch, setIncomingRematch] = useState(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [playerPreferences, setPlayerPreferences] = useState(() =>
    loadPlayerPreferences()
  );
  const [userStatsLoaded, setUserStatsLoaded] = useState(false);
  const [userStats, setUserStats] = useState(() => ({
    username:
      currentUser?.displayName || currentUser?.email?.split("@")[0] || "Player",
    rating: 800,
    gamesPlayed: 0,
    gamesWon: 0,
  }));
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const wsRef = useRef(null);
  const isConnectingRef = useRef(false);
  const connectAttemptRef = useRef(0);
  const gameEndedRef = useRef(false);
  const resultPersistedRef = useRef(false);
  const selectedModeStats = Array.isArray(userStats?.modeStats)
    ? userStats.modeStats.find((mode) => Number(mode.modeSeconds) === Number(modeSeconds))
    : null;
  const queueRating = selectedModeStats?.rating ?? userStats.rating;
  const currentWord = words[currentWordIndex] || "";
  const isAutoAdvanceEnabled =
    playerPreferences.nextWordCondition === NEXT_WORD_CONDITIONS.auto;
  const activeSubmitKeyIds = Array.isArray(playerPreferences.submitKeyIds)
    ? playerPreferences.submitKeyIds
    : [playerPreferences.submitKeyId].filter(Boolean);
  const activeSubmitKeys = activeSubmitKeyIds.map((id) => getSubmitKeyOptionById(id));
  const activeSubmitKeySet = new Set(activeSubmitKeys.map((option) => option.key));
  const activeSubmitLabel = activeSubmitKeys.map((option) => option.label).join(" / ");
  

  const cleanup = () => {
    connectAttemptRef.current += 1;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    isConnectingRef.current = false;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    if (!currentUser) return;

    setUserStats((prev) => ({
      ...prev,
      username:
        prev?.username && prev.username !== "Player"
          ? prev.username
          : currentUser.displayName || currentUser.email?.split("@")[0] || "Player",
    }));
  }, [currentUser]);

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

  const submitWordIfCorrect = useCallback(
    (rawInput) => {
      if (gameState !== "playing" || !wsRef.current) return false;
      if (wsRef.current.readyState !== WebSocket.OPEN) return false;

      const normalizedInput = String(rawInput || "").trim();
      if (!normalizedInput || !currentWord) return false;

      if (normalizedInput !== currentWord) {
        return false;
      }

      try {
        wsRef.current.send(
          JSON.stringify({
            type: "PLAYER_INPUT",
            input: normalizedInput,
          })
        );
      } catch (error) {
        console.error("Failed to send player input:", error);
        return false;
      }

      setMyScore((prev) => prev + 1);
      setCurrentWordIndex((prev) => Math.min(prev + 1, words.length));
      setInput("");
      return true;
    },
    [currentWord, gameState, words.length]
  );

  const fetchUserStats = useCallback(async () => {
    if (!currentUser) return;

    try {
      const idToken = await currentUser.getIdToken();
      const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
      const fullUrl = serverUrl.startsWith("http")
        ? serverUrl
        : `http://${serverUrl}`;

      const response = await fetch(
        `${fullUrl}/api/users/${currentUser.uid}/stats`,
        {
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setUserStats(data);
      } else {
        setUserStats({
          username: currentUser.displayName || currentUser.email?.split("@")[0] || "Player",
          rating: 800,
          gamesPlayed: 0,
          gamesWon: 0,
        });
      }
    } catch (error) {
      console.error("Failed to fetch user stats:", error);
      setUserStats({
        username: currentUser.displayName || currentUser.email?.split("@")[0] || "Player",
        rating: 800,
        gamesPlayed: 0,
        gamesWon: 0,
      });
    } finally {
      setUserStatsLoaded(true);
    }
  }, [currentUser]);

  const connectWebSocket = useCallback(async () => {
    if (!userStats || !currentUser) return;
    if (isConnectingRef.current) return;
    
    // In React 18 strict mode, this might be called twice quickly.
    // We only want to proceed if we don't have an active or connecting socket.
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    isConnectingRef.current = true;
    const attemptId = ++connectAttemptRef.current;

    try {
      setConnectionError(null);
      const idToken = await currentUser.getIdToken();

      if (attemptId !== connectAttemptRef.current) {
        isConnectingRef.current = false;
        return;
      }

      const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
      const httpUrl = serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`;
      const wsBaseUrl = httpUrl
        .replace(/^http:/i, "ws:")
        .replace(/^https:/i, "wss:")
        .replace(/\/$/, "");

      const websocket = new WebSocket(new URL("/ws", wsBaseUrl));
      wsRef.current = websocket;

      websocket.onopen = () => {
        if (attemptId !== connectAttemptRef.current || wsRef.current !== websocket) {
          websocket.close();
          return;
        }

        isConnectingRef.current = false;
        setGameState("waiting");

        // Join the matchmaking queue with proper user info
        websocket.send(
          JSON.stringify({
            type: "JOIN_QUEUE",
            idToken,
            modeSeconds,
            userInfo: {
              username: userStats.username,
              rating: Number.isFinite(Number(queueRating)) ? Number(queueRating) : 800,
            },
          })
        );
      };

      websocket.onmessage = (event) => {
        if (wsRef.current !== websocket) return;
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      };

      websocket.onclose = (event) => {
        if (wsRef.current !== websocket) {
          return; // Was intentionally closed or replaced
        }
        wsRef.current = null;
        isConnectingRef.current = false;

        console.warn("WebSocket closed:", {
          url: websocket.url,
          code: event?.code,
          reason: event?.reason,
          wasClean: event?.wasClean,
        });

        if (gameEndedRef.current) {
          return;
        }

        const reason = String(event?.reason || "");
        if (event?.code === 1000 && /replaced by newer session/i.test(reason)) {
          setConnectionError({
            title: "Session Replaced",
            message:
              "This session was replaced by a newer one (another tab/device). Close other sessions and try again.",
          });
          setGameState("error");
          return;
        }

        setConnectionError({
          title: "Connection Lost",
          message: "Could not connect to the game server.",
        });
        setGameState("error");
      };

      websocket.onerror = (error) => {
        if (wsRef.current !== websocket) return;
        isConnectingRef.current = false;
        console.error("WebSocket error:", error);
      };
    } catch (error) {
      isConnectingRef.current = false;
      console.error("Failed to connect WebSocket:", error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, modeSeconds, navigate, queueRating, userStats]); // note: handleWebSocketMessage is omitted as it's structurally bound to the latest render by design or handled

  useEffect(() => {
    fetchUserStats();

    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount! fetchUserStats uses latest refs or is stable enough.

  useEffect(() => {
    if (
      userStatsLoaded &&
      userStats &&
      gameState === "waiting" &&
      !wsRef.current &&
      !isConnectingRef.current
    ) {
      connectWebSocket();
    }
  }, [connectWebSocket, gameState, userStats, userStatsLoaded]);

  const handleWebSocketMessage = (message) => {
    switch (message.type) {
      case "MATCH_FOUND":
        setRematchState("idle");
        setIncomingRematch(null);
        setPostMatchRating(null);
        setActiveGameId(message.gameId || null);
        setModeSeconds(Number(message.modeSeconds) || modeSeconds);
        setOpponent(message.opponent);
        setInput("");
        setGameState("countdown");
        break;

      case "COUNTDOWN":
        setCountdown(message.count);
        break;

      case "GAME_START": {
        gameEndedRef.current = false;
        resultPersistedRef.current = false;
        setModeSeconds(Number(message.modeSeconds) || modeSeconds);
        setWords(Array.isArray(message.words) ? message.words : []);
        setTimeLeft(
          Number.isFinite(message.duration)
            ? Math.max(0, Math.round(message.duration / 1000))
            : 60
        );

        setGameState("playing");
        setCountdown(null);
        startTimer();
        // Reset scores and progress
        setMyScore(0);
        setOpponentScore(0);
        setCurrentWordIndex(0);
        setOpponentWordIndex(0);
        setInput("");
        setTimeout(() => inputRef.current?.focus(), 100);
        break;
      }

      case "PLAYER_PROGRESS":
      {
        // Handle the corrected progress data structure
        const myData =
          message.player1.id === currentUser.uid
            ? message.player1
            : message.player2;
        const opponentData =
          message.player1.id === currentUser.uid
            ? message.player2
            : message.player1;

        setMyScore(myData.score);
        setCurrentWordIndex(myData.currentWordIndex);
        setOpponentScore(opponentData.score);
        setOpponentWordIndex(opponentData.currentWordIndex);
        break;
      }

      case "GAME_RESUMED": {
        setModeSeconds(Number(message.modeSeconds) || modeSeconds);
        setOpponent(message.opponent || null);
        setWords(Array.isArray(message.words) ? message.words : []);

        const myData =
          message.player1?.id === currentUser.uid
            ? message.player1
            : message.player2;
        const opponentData =
          message.player1?.id === currentUser.uid
            ? message.player2
            : message.player1;

        setMyScore(Number.isFinite(myData?.score) ? myData.score : 0);
        setCurrentWordIndex(
          Number.isFinite(myData?.currentWordIndex)
            ? myData.currentWordIndex
            : 0
        );
        setOpponentScore(
          Number.isFinite(opponentData?.score) ? opponentData.score : 0
        );
        setOpponentWordIndex(
          Number.isFinite(opponentData?.currentWordIndex)
            ? opponentData.currentWordIndex
            : 0
        );

        if (message.status === "playing") {
          const resumedDuration = Number.isFinite(message.duration)
            ? Math.max(0, Math.round(message.duration / 1000))
            : 60;
          setCountdown(null);
          setTimeLeft(resumedDuration);
          setGameState("playing");
          startTimer();
          setTimeout(() => inputRef.current?.focus(), 100);
        } else if (message.status === "countdown") {
          setGameState("countdown");
        } else {
          setGameState("waiting");
        }

        break;
      }

      case "WRONG_WORD":
        break;

      case "GAME_END":
        gameEndedRef.current = true;
        setRematchState("idle");
        setIncomingRematch(null);
        setActiveGameId(message.results?.gameId || activeGameId);
        setModeSeconds(Number(message.results?.modeSeconds) || modeSeconds);
        setGameResults(message.results);
        setInput("");
        setGameState("finished");
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        // Update ratings after game ends
        updateGameResults(message.results);
        break;

      case "OPPONENT_DISCONNECTED":
        gameEndedRef.current = true;
        setRematchState("idle");
        setIncomingRematch(null);
        setPostMatchRating(null);
        setInput("");
        setGameState("finished");
        {
          const fallbackResults = {
          gameId: activeGameId,
          modeSeconds,
          player1: {
            id: currentUser.uid,
            username: userStats.username,
            score: myScore,
            won: true,
          },
          player2: {
            id: opponent?.id || "disconnected",
            username: opponent?.username || "Opponent",
            score: opponentScore,
            won: false,
          },
          isDraw: false,
          reason: "opponent_disconnected",
          };
          setGameResults(fallbackResults);
          updateGameResults(fallbackResults);
        }
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        break;

      case "REMATCH_PENDING":
        setRematchState("pending");
        break;

      case "REMATCH_REQUESTED":
        setIncomingRematch({
          fromPlayerId: message.fromPlayerId,
          fromUsername: message.fromUsername || "Opponent",
        });
        break;

      case "REMATCH_DECLINED":
        setRematchState("declined");
        setIncomingRematch(null);
        break;

      case "REMATCH_TIMEOUT":
        setRematchState("timeout");
        setIncomingRematch(null);
        break;

      case "REMATCH_UNAVAILABLE":
        setRematchState("unavailable");
        setIncomingRematch(null);
        break;

      default:
        break;
    }
  };

  const updateGameResults = async (results) => {
    try {
      if (resultPersistedRef.current) {
        return;
      }

      const serverUrl = import.meta.env.VITE_SERVER_URL || "127.0.0.1:8787";
      const fullUrl = serverUrl.startsWith("http")
        ? serverUrl
        : `http://${serverUrl}`;

      const idToken = await currentUser.getIdToken();

      // Determine if current user won
      const currentUserResult =
        results.player1.id === currentUser.uid
          ? results.player1
          : results.player2;
      const opponentResult =
        results.player1.id === currentUser.uid
          ? results.player2
          : results.player1;

      if (!opponentResult?.id || opponentResult.id === "disconnected") {
        console.warn("Skipping game result persistence due to missing opponent id");
        return;
      }

      const persistedGameId = results.gameId || activeGameId;
      if (!persistedGameId) {
        console.warn("Skipping game result persistence due to missing game id");
        return;
      }

      const response = await fetch(
        `${fullUrl}/api/users/${currentUser.uid}/game-result`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            won: currentUserResult.won,
            isDraw: Boolean(results.isDraw),
            opponentId: opponentResult.id,
            score: currentUserResult.score,
            opponentScore: opponentResult.score,
            modeSeconds,
            gameId: persistedGameId,
          }),
        }
      );

      if (response.ok) {
        resultPersistedRef.current = true;
        const data = await response.json();
        setPostMatchRating(
          Number.isFinite(Number(data?.modeStats?.rating))
            ? Number(data.modeStats.rating)
            : Number.isFinite(Number(data?.player?.rating))
              ? Number(data.player.rating)
              : null
        );

        // Update local user stats for immediate UI update
        setUserStats((prev) => ({
          ...prev,
          ...data.player,
          modeStats: Array.isArray(prev?.modeStats)
            ? prev.modeStats.map((mode) =>
                Number(mode.modeSeconds) === Number(modeSeconds) && data?.modeStats
                  ? { ...mode, ...data.modeStats }
                  : mode
              )
            : prev?.modeStats,
          winRate:
            prev.gamesPlayed > 0
              ? (
                  (data.player.gamesWon / data.player.gamesPlayed) *
                  100
                ).toFixed(1)
              : 0,
        }));
      } else {
        const errorBody = await response.text();
        console.error("Failed to persist game results:", response.status, errorBody);
      }
    } catch (error) {
      console.error("Failed to update game results:", error);
    }
  };

  const startTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleInputChange = (e) => {
    const maxLength = currentWord.length;
    const nextValue = String(e.target.value || "").replace(/\s/g, "").slice(0, maxLength);
    setInput(nextValue);

    if (isAutoAdvanceEnabled) {
      submitWordIfCorrect(nextValue);
    }
  };

  const handleInputSubmit = (e) => {
    if (e.key === " ") {
      e.preventDefault();
      return;
    }

    if (isAutoAdvanceEnabled) {
      return;
    }

    if (activeSubmitKeySet.has(e.key)) {
      e.preventDefault();
      submitWordIfCorrect(input);
    }
  };

  const submitCurrentInput = () => {
    submitWordIfCorrect(input);
  };

  useEffect(() => {
    if (gameState !== "playing") {
      setInput("");
    }
  }, [gameState]);

  const handleBackToDashboard = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "LEAVE_QUEUE" }));
    }
    cleanup();
    navigate("/dashboard");
  };

  const handleRematch = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    try {
      wsRef.current.send(JSON.stringify({ type: "REMATCH_REQUEST" }));
      setRematchState("pending");
    } catch {
      setRematchState("unavailable");
    }
  };

  const respondToRematch = (action) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    try {
      wsRef.current.send(JSON.stringify({ type: "REMATCH_RESPONSE", action }));
    } catch {
      // no-op
    } finally {
      setIncomingRematch(null);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getRatingColor = (rating) => {
    if (rating >= 1600) return "text-chart-5";
    if (rating >= 1400) return "text-chart-4";
    if (rating >= 1200) return "text-chart-3";
    if (rating >= 1000) return "text-chart-2";
    return "text-muted-foreground";
  };

  const isWinner = Boolean(
    gameResults && (
      (gameResults.player1?.id === currentUser?.uid && gameResults.player1?.won) ||
      (gameResults.player2?.id === currentUser?.uid && gameResults.player2?.won)
    )
  );

  return (
    <div className="flex h-full flex-col gap-6">
      {gameState === "finished" && isWinner && viewport.width > 0 && viewport.height > 0 ? (
        <Confetti
          width={viewport.width}
          height={viewport.height}
          numberOfPieces={220}
          recycle={false}
          gravity={0.2}
        />
      ) : null}
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between border-b border-border/50 pb-4"
      >
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Ranked Match
          </p>
          <h2 className="font-sans text-xl font-semibold tracking-tight">Live Game</h2>
          <p className="mt-1 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
            {modeSeconds}s mode
          </p>
        </div>

        {gameState === "playing" && (
          <div className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 font-mono text-lg font-bold tabular-nums text-primary">
            <FiClock className="h-4 w-4" />
            {formatTime(timeLeft)}
          </div>
        )}
      </motion.div>

      {/* Game States */}
      <AnimatePresence initial={false} mode="wait">
        {gameState === "error" && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-1 items-center justify-center py-12"
            >
              <Card className="w-full max-w-md border-destructive/50">
                <CardHeader className="text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/20"
                  >
                    <FiZap className="h-8 w-8 text-destructive" />
                  </motion.div>
                  <CardTitle className="font-sans text-destructive">
                    {connectionError?.title || "Connection Lost"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    {connectionError?.message || "Could not connect to the game server."}
                  </p>
                  <Button onClick={() => navigate("/dashboard")} className="w-full gap-2">
                    <FiArrowLeft className="h-4 w-4" />
                    Back to Dashboard
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {gameState === "waiting" && (
            <motion.div
              key="waiting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-1 items-center justify-center py-12"
            >
              <Card className="w-full max-w-md overflow-hidden">
                <CardHeader className="text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200 }}
                    className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/20"
                  >
                    <FiZap className="h-8 w-8 text-primary" />
                  </motion.div>
                  <CardTitle className="font-sans">Finding Opponent</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6 py-8 text-center">
                  <DotLoader duration={100} className="mx-auto scale-150" />
                  <div className="space-y-2">
                    <p className="font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
                      Searching for players...
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      <FiTrendingUp className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Your Rating:{" "}
                        <span className={`font-semibold ${getRatingColor(queueRating)}`}>
                          {queueRating}
                        </span>
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleBackToDashboard}
                    className="w-full gap-2"
                  >
                    <FiArrowLeft className="h-4 w-4" />
                    Cancel
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {gameState === "countdown" && (
            <motion.div
              key="countdown"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-1 items-center justify-center py-12"
            >
              <Card className="w-full max-w-md overflow-hidden border-primary/50">
                <CardHeader className="text-center">
                  <CardTitle className="font-sans">Match Found!</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6 py-8 text-center">
                  {/* VS Display */}
                  <div className="flex items-center justify-center gap-4">
                    <div className="text-right">
                      <p className="font-semibold">{userStats.username}</p>
                      <p className={`font-mono text-sm ${getRatingColor(userStats.rating)}`}>
                        {userStats.rating}
                      </p>
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted font-sans text-lg font-bold text-muted-foreground">
                      VS
                    </div>
                    <div className="text-left">
                      <p className="font-semibold">{opponent?.username}</p>
                      <p className={`font-mono text-sm ${getRatingColor(opponent?.rating)}`}>
                        {opponent?.rating}
                      </p>
                    </div>
                  </div>
                  
                  {/* Countdown */}
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

          {gameState === "playing" && (
            <motion.div
              key="playing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid min-h-0 flex-1 grid-rows-[auto,1fr,auto] gap-6"
            >
              {/* Score Display */}
              <div className="grid grid-cols-2 gap-4">
                <Card className="border-primary/30 bg-primary/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                      <FiUser className="h-3 w-3" />
                      {userStats.username} (You)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="font-sans text-3xl font-bold text-primary">{myScore}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      Word {currentWordIndex + 1} / {words.length}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                      <FiUser className="h-3 w-3" />
                      {opponent?.username}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="font-sans text-3xl font-bold">{opponentScore}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      Word {opponentWordIndex + 1} / {words.length}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Current Word Display - Monkeytype Style */}
              <Card className="h-full">
                <CardContent className="flex h-full flex-col gap-6 py-8">
                  <div className="text-center">
                    <p className="mb-4 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
                      Type This Word
                    </p>
                    <div className="relative inline-block font-mono text-4xl font-medium tracking-wider leading-none sm:text-5xl">
                      {(words[currentWordIndex] || "").split("").map((char, charIndex) => {
                        const typedChar = input[charIndex];
                        const isCurrentPosition = charIndex === input.length;
                        const isTyped = charIndex < input.length;
                        const isCorrect = isTyped && typedChar === char;
                        const isWrong = isTyped && typedChar !== char;
                        const renderedChar = char === " " ? "\u00A0" : char;
                        const renderedTypedChar = isWrong && typedChar === " " ? "_" : typedChar;

                        return (
                          <span
                            key={charIndex}
                            className={`relative inline-block min-w-[0.45em] align-baseline ${
                              isCorrect
                                ? "text-primary"
                                : isWrong
                                ? "text-destructive"
                                : "text-muted-foreground/50"
                            }`}
                          >
                            {isCurrentPosition && (
                              <span
                                className="absolute -left-[2px] top-0 h-full w-[3px] bg-primary"
                                style={{
                                  animation: "blink 1s ease-in-out infinite",
                                }}
                              />
                            )}
                            {isWrong ? renderedTypedChar : renderedChar}
                          </span>
                        );
                      })}
                      {/* Cursor at end if all typed */}
                      {input.length === (words[currentWordIndex] || "").length && (
                        <span
                          className="absolute -right-[2px] top-0 h-full w-[3px] bg-primary"
                          style={{
                            animation: "blink 1s ease-in-out infinite",
                          }}
                        />
                      )}
                    </div>
                  </div>
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleInputSubmit}
                    className={isCoarsePointer ? "h-11 w-full rounded-md border border-border/70 bg-background px-3 text-base" : "pointer-events-none absolute opacity-0"}
                    autoFocus={!isCoarsePointer}
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                    inputMode="text"
                    enterKeyHint="go"
                  />
                  {/* Click area to refocus */}
                  <div
                    onClick={() => inputRef.current?.focus()}
                    className="cursor-text rounded-md border border-border/50 bg-muted/30 p-4 text-center"
                  >
                    <p className="font-mono text-sm text-muted-foreground">
                      {input.length > 0 ? (
                        <span>Typing: <span className="text-foreground">{input}</span></span>
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
                      onClick={submitCurrentInput}
                    >
                      Submit Word
                    </Button>
                  ) : null}
                </CardContent>
              </Card>

              {/* Progress Indicators */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                      Your Progress
                    </span>
                    <span className="font-mono text-xs text-primary">
                      {Math.round((currentWordIndex / words.length) * 100)}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <motion.div
                      className="h-full rounded-full bg-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${(currentWordIndex / words.length) * 100}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                      Opponent Progress
                    </span>
                    <span className="font-mono text-xs text-destructive">
                      {Math.round((opponentWordIndex / words.length) * 100)}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <motion.div
                      className="h-full rounded-full bg-destructive"
                      initial={{ width: 0 }}
                      animate={{ width: `${(opponentWordIndex / words.length) * 100}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {gameState === "finished" && gameResults && (
            <motion.div
              key="finished"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-1 items-center justify-center py-12"
            >
              <Card className="w-full max-w-md overflow-hidden">
                <CardHeader className="text-center">
                  <CardTitle className="font-sans text-2xl">
                    {gameResults.reason === "opponent_disconnected"
                      ? "Opponent Disconnected"
                      : gameResults.isDraw
                      ? "It's a Draw!"
                      : gameResults.player1.id === currentUser.uid &&
                        gameResults.player1.won
                      ? "You Won"
                      : gameResults.player2.id === currentUser.uid &&
                        gameResults.player2.won
                      ? "You Won"
                      : "Better Luck Next Time!"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6 py-6">
                  {/* Score Display */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className={`rounded-md p-4 text-center ${
                      gameResults.player1.won ? "bg-primary/10" : "bg-muted/50"
                    }`}>
                      <p className="font-semibold">{gameResults.player1.username}</p>
                      <p className="font-sans text-3xl font-bold">
                        {gameResults.player1.score}
                      </p>
                      {gameResults.player1.won && (
                        <span className="font-mono text-xs text-primary">WINNER</span>
                      )}
                    </div>
                    <div className={`rounded-md p-4 text-center ${
                      gameResults.player2.won ? "bg-primary/10" : "bg-muted/50"
                    }`}>
                      <p className="font-semibold">{gameResults.player2.username}</p>
                      <p className="font-sans text-3xl font-bold">
                        {gameResults.player2.score}
                      </p>
                      {gameResults.player2.won && (
                        <span className="font-mono text-xs text-primary">WINNER</span>
                      )}
                    </div>
                  </div>

                  {/* Rating Update */}
                  {userStats && (
                    <div className="flex items-center justify-center gap-2 rounded-md bg-muted/50 p-3">
                      <FiTrendingUp className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        New Rating:{" "}
                        <span
                          className={`font-semibold ${getRatingColor(
                            Number.isFinite(Number(postMatchRating)) ? Number(postMatchRating) : userStats.rating
                          )}`}
                        >
                          {Number.isFinite(Number(postMatchRating)) ? Number(postMatchRating) : userStats.rating}
                        </span>
                      </span>
                    </div>
                  )}

                  <Button onClick={handleBackToDashboard} className="w-full gap-2">
                    <FiArrowLeft className="h-4 w-4" />
                    Back to Dashboard
                  </Button>
                  {rematchState !== "declined" ? (
                    <Button variant="outline" onClick={handleRematch} className="w-full" disabled={rematchState === "pending"}>
                      {rematchState === "pending" ? "Rematch Requested..." : "Rematch"}
                    </Button>
                  ) : null}
                  {rematchState === "declined" ? (
                    <p className="text-center text-xs text-muted-foreground">Opponent declined the rematch.</p>
                  ) : null}
                  {rematchState === "timeout" ? (
                    <p className="text-center text-xs text-muted-foreground">Rematch request timed out.</p>
                  ) : null}
                  {rematchState === "unavailable" ? (
                    <p className="text-center text-xs text-muted-foreground">Opponent is unavailable for rematch.</p>
                  ) : null}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {gameState === "finished" && incomingRematch ? (
            <motion.div
              key="rematch-request"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="fixed bottom-4 right-4 z-50 w-[min(92vw,22rem)]"
            >
              <Card className="border-primary/40 bg-background/95 shadow-xl backdrop-blur">
                <CardContent className="space-y-3 p-4">
                  <p className="text-sm">
                    <span className="font-semibold">{incomingRematch.fromUsername}</span> wants a rematch.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button onClick={() => respondToRematch("accept")} size="sm" className="gap-1.5">
                      <FiCheck className="h-3.5 w-3.5" />
                      Accept
                    </Button>
                    <Button onClick={() => respondToRematch("reject")} size="sm" variant="outline" className="gap-1.5">
                      <FiX className="h-3.5 w-3.5" />
                      Decline
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ) : null}
        </AnimatePresence>
    </div>
  );
};

export default Game;
