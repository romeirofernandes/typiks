import React, { useState, useEffect, useRef, useCallback, useReducer, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  m,
  AnimatePresence,
} from "framer-motion";
import Confetti from "react-confetti";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useStats } from "@/hooks/useStats";
import { useViewport } from "@/hooks/useViewport";
import { useIsCoarsePointer } from "@/hooks/useIsCoarsePointer";
import { usePlayerPreferences } from "@/hooks/usePlayerPreferences";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DotLoader } from "@/components/ui/dot-loader";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  getSubmitKeyOptionById,
  NEXT_WORD_CONDITIONS,
} from "@/lib/player-preferences";
import { FiClock, FiArrowLeft, FiZap, FiTrendingUp, FiCheck, FiX, FiSave } from "react-icons/fi";
import GuestUpgradePrompt from "@/components/auth/GuestUpgradePrompt";
import { userKeys } from "@/lib/query-keys";
import { openWebSocket } from "@/lib/websocket";
import { buildMatchInitialState, matchReducer } from "@/lib/match/matchReducer";
import { WordDisplay } from "@/components/game/WordDisplay";

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function getRatingColor(rating) {
  if (rating >= 1600) return "text-chart-5";
  if (rating >= 1400) return "text-chart-4";
  if (rating >= 1200) return "text-chart-3";
  if (rating >= 1000) return "text-chart-2";
  return "text-muted-foreground";
}

function buildInitialGameState(modeSeconds) {
  return buildMatchInitialState({ gameState: "waiting", modeSeconds });
}

function useGameSession() {
  const { state: { currentUser } } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const initialModeSeconds = [15, 30, 60].includes(Number(location.state?.modeSeconds))
    ? Number(location.state.modeSeconds)
    : 60;
  const [
    {
      gameState,
      connectionError,
      opponent,
      countdown,
      words,
      currentWordIndex,
      opponentWordIndex,
      myScore,
      opponentScore,
      timeLeft,
      input,
      gameResults,
      postMatchRating,
      modeSeconds,
      rematchState,
      incomingRematch,
    },
    dispatch,
  ] = useReducer(matchReducer, initialModeSeconds, buildInitialGameState);
  const activeGameIdRef = useRef(null);
  const [showGuestUpgrade, setShowGuestUpgrade] = useState(false);
  const [playerPreferences] = usePlayerPreferences();
  const isCoarsePointer = useIsCoarsePointer();
  const viewport = useViewport();
  const { stats: fetchedStats, loading: statsLoading } = useStats();
  const queryClient = useQueryClient();
  const userStats = useMemo(
    () =>
      fetchedStats ?? {
        username:
          currentUser?.displayName || currentUser?.email?.split("@")[0] || "Player",
        rating: 800,
        gamesPlayed: 0,
        gamesWon: 0,
      },
    [currentUser, fetchedStats]
  );
  const handleWebSocketMessageRef = useRef(null);
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const timeLeftRef = useRef(60);
  const wsRef = useRef(null);
  const wsKindRef = useRef(null); // "queue" | "game" | null
  const matchAbortedRef = useRef(false);
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

  const cleanup = useCallback(() => {
    connectAttemptRef.current += 1;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    wsKindRef.current = null;
    isConnectingRef.current = false;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
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

      dispatch({ type: "SUBMIT_SUCCESS" });
      return true;
    },
    [currentWord, gameState]
  );

  const connectQueue = useCallback(async () => {
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
      dispatch({ type: "CONNECTION_CLEAR" });
      const idToken = await currentUser.getIdToken();

      if (attemptId !== connectAttemptRef.current) {
        isConnectingRef.current = false;
        return;
      }

      const websocket = openWebSocket("/ws");
      wsRef.current = websocket;
      wsKindRef.current = "queue";

      websocket.onopen = () => {
        if (attemptId !== connectAttemptRef.current || wsRef.current !== websocket) {
          websocket.close();
          return;
        }

        isConnectingRef.current = false;
        dispatch({ type: "SET_GAME_STATE", gameState: "waiting" });

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
        handleWebSocketMessageRef.current(message);
      };

      websocket.onclose = (event) => {
        if (wsRef.current !== websocket) {
          return; // Was intentionally closed or replaced
        }
        wsRef.current = null;
        wsKindRef.current = null;
        isConnectingRef.current = false;

        console.warn("Queue WebSocket closed:", {
          url: websocket.url,
          code: event?.code,
          reason: event?.reason,
          wasClean: event?.wasClean,
        });

        if (gameEndedRef.current || matchAbortedRef.current) {
          matchAbortedRef.current = false;
          return;
        }

        const reason = String(event?.reason || "");
        if (event?.code === 1000 && /replaced by newer session/i.test(reason)) {
          dispatch({
            type: "CONNECTION_ERROR",
            title: "Session Replaced",
            message:
              "This session was replaced by a newer one (another tab/device). Close other sessions and try again.",
          });
          return;
        }

        dispatch({
          type: "CONNECTION_ERROR",
          title: "Connection Lost",
          message: "Could not connect to the game server.",
        });
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
  }, [currentUser, modeSeconds, queueRating, userStats]);

  const connectToGame = useCallback(
    async (gameId) => {
      if (!currentUser || !gameId) return;
      if (isConnectingRef.current) return;

      isConnectingRef.current = true;
      const attemptId = ++connectAttemptRef.current;

      try {
        dispatch({ type: "CONNECTION_CLEAR" });
        const idToken = await currentUser.getIdToken();

        if (attemptId !== connectAttemptRef.current) {
          isConnectingRef.current = false;
          return;
        }

        const websocket = openWebSocket(`/ws/game/${encodeURIComponent(gameId)}`);
        wsRef.current = websocket;
        wsKindRef.current = "game";

        websocket.onopen = () => {
          if (attemptId !== connectAttemptRef.current || wsRef.current !== websocket) {
            websocket.close();
            return;
          }

          isConnectingRef.current = false;

          websocket.send(
            JSON.stringify({
              type: "JOIN_GAME",
              gameId,
              idToken,
              userInfo: {
                username: userStats?.username || "player",
                rating: Number.isFinite(Number(queueRating)) ? Number(queueRating) : 800,
              },
            })
          );
        };

        websocket.onmessage = (event) => {
          if (wsRef.current !== websocket) return;
          const message = JSON.parse(event.data);
          handleWebSocketMessageRef.current(message);
        };

        websocket.onclose = (event) => {
          if (wsRef.current !== websocket) {
            return; // Was intentionally closed or replaced
          }
          wsRef.current = null;
          wsKindRef.current = null;
          isConnectingRef.current = false;

          console.warn("Game WebSocket closed:", {
            url: websocket.url,
            code: event?.code,
            reason: event?.reason,
            wasClean: event?.wasClean,
          });

          if (gameEndedRef.current || matchAbortedRef.current) {
            matchAbortedRef.current = false;
            return;
          }

          dispatch({
            type: "CONNECTION_ERROR",
            title: "Connection Lost",
            message: "Could not connect to the game server.",
          });
        };

        websocket.onerror = (error) => {
          if (wsRef.current !== websocket) return;
          isConnectingRef.current = false;
          console.error("Game WebSocket error:", error);
        };
      } catch (error) {
        isConnectingRef.current = false;
        console.error("Failed to connect to game:", error);
      }
    },
    [currentUser, queueRating, userStats]
  );

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

// Wait for the stats fetch to settle so the JOIN_QUEUE payload carries the real
  // rating (not the default 800). Also reconnects to the queue when MATCH_ABORTED
  // flips gameState back to "waiting".
  useEffect(() => {
    if (
      !statsLoading &&
      gameState === "waiting" &&
      !wsRef.current &&
      !isConnectingRef.current
    ) {
      connectQueue();
    }
  }, [connectQueue, gameState, statsLoading]);

  useEffect(() => {
    handleWebSocketMessageRef.current = (message) => {
      switch (message.type) {
      case "MATCH_FOUND":
        activeGameIdRef.current = message.gameId || null;
        dispatch({
          type: "MATCH_FOUND",
          modeSeconds: Number(message.modeSeconds) || modeSeconds,
          opponent: message.opponent,
        });

        // Initial match: hop from the matchmaking queue to the dedicated game room.
        // Rematch: MATCH_FOUND arrives on the already-open game socket, so skip.
        if (wsKindRef.current !== "game") {
          const queueSocket = wsRef.current;
          wsRef.current = null;
          wsKindRef.current = null;
          if (queueSocket && queueSocket.readyState === WebSocket.OPEN) {
            queueSocket.close();
          }
          connectToGame(message.gameId);
        }
        break;

      case "MATCH_ABORTED":
        matchAbortedRef.current = true;
        activeGameIdRef.current = null;
        dispatch({ type: "MATCH_ABORTED" });
        break;

      case "COUNTDOWN":
        dispatch({ type: "COUNTDOWN", count: message.count });
        break;

      case "GAME_START": {
        gameEndedRef.current = false;
        resultPersistedRef.current = false;
        const startTimeLeft = Number.isFinite(message.duration)
          ? Math.max(0, Math.round(message.duration / 1000))
          : 60;
        timeLeftRef.current = startTimeLeft;
        dispatch({
          type: "GAME_START",
          modeSeconds: Number(message.modeSeconds) || modeSeconds,
          words: Array.isArray(message.words) ? message.words : [],
          timeLeft: startTimeLeft,
        });
        startTimer();
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

        dispatch({
          type: "PLAYER_PROGRESS",
          myScore: myData.score,
          currentWordIndex: myData.currentWordIndex,
          opponentScore: opponentData.score,
          opponentWordIndex: opponentData.currentWordIndex,
        });
        break;
      }

      case "GAME_RESUMED": {
        const myData =
          message.player1?.id === currentUser.uid
            ? message.player1
            : message.player2;
        const opponentData =
          message.player1?.id === currentUser.uid
            ? message.player2
            : message.player1;

        let resumedTimeLeft;
        if (message.status === "playing") {
          resumedTimeLeft = Number.isFinite(message.duration)
            ? Math.max(0, Math.round(message.duration / 1000))
            : 60;
          timeLeftRef.current = resumedTimeLeft;
        }

        dispatch({
          type: "GAME_RESUMED",
          modeSeconds: Number(message.modeSeconds) || modeSeconds,
          opponent: message.opponent || null,
          words: Array.isArray(message.words) ? message.words : [],
          myScore: Number.isFinite(myData?.score) ? myData.score : 0,
          currentWordIndex: Number.isFinite(myData?.currentWordIndex)
            ? myData.currentWordIndex
            : 0,
          opponentScore: Number.isFinite(opponentData?.score)
            ? opponentData.score
            : 0,
          opponentWordIndex: Number.isFinite(opponentData?.currentWordIndex)
            ? opponentData.currentWordIndex
            : 0,
          status: message.status,
          timeLeft: resumedTimeLeft,
        });

        if (message.status === "playing") {
          startTimer();
          setTimeout(() => inputRef.current?.focus(), 100);
        }

        break;
      }

      case "WRONG_WORD":
        break;

      case "GAME_END":
        gameEndedRef.current = true;
        activeGameIdRef.current = message.results?.gameId || activeGameIdRef.current;
        dispatch({
          type: "GAME_END",
          results: message.results,
          modeSeconds: Number(message.results?.modeSeconds) || modeSeconds,
        });
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        // Update ratings after game ends
        updateGameResults(message.results);
        break;

      case "OPPONENT_DISCONNECTED":
        gameEndedRef.current = true;
        {
          const fallbackResults = {
            gameId: activeGameIdRef.current,
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
          dispatch({
            type: "OPPONENT_DISCONNECTED",
            results: fallbackResults,
          });
          updateGameResults(fallbackResults);
        }
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        break;

      case "REMATCH_PENDING":
        dispatch({ type: "REMATCH_PENDING" });
        break;

      case "REMATCH_REQUESTED":
        dispatch({
          type: "REMATCH_REQUESTED",
          incomingRematch: {
            fromPlayerId: message.fromPlayerId,
            fromUsername: message.fromUsername || "Opponent",
          },
        });
        break;

      case "REMATCH_DECLINED":
        dispatch({ type: "REMATCH_DECLINED" });
        break;

      case "REMATCH_TIMEOUT":
        dispatch({ type: "REMATCH_TIMEOUT" });
        break;

      case "REMATCH_UNAVAILABLE":
        dispatch({ type: "REMATCH_UNAVAILABLE" });
        break;

      default:
        break;
    }
    };
  });

  const applyPostMatchRatings = (results) => {
    const ratings = results?.ratings;
    if (!ratings) return;

    const currentUserId = currentUser?.uid;
    const mine =
      ratings.player1?.id === currentUserId
        ? ratings.player1
        : ratings.player2?.id === currentUserId
          ? ratings.player2
          : null;

    const postMatchRating = Number.isFinite(Number(mine?.ratingAfter))
      ? Number(mine.ratingAfter)
      : Number.isFinite(Number(mine?.ratingBefore))
        ? Number(mine.ratingBefore)
        : null;

    if (postMatchRating === null) return;

    dispatch({
      type: "SET_POST_MATCH_RATING",
      postMatchRating,
    });

    // Update the cached stats for an immediate UI update. The invalidation in
    // updateGameResults refetches the authoritative rating from the server.
    if (currentUser) {
      queryClient.setQueryData(userKeys.stats(currentUser.uid), (old) =>
        old ? { ...old, rating: postMatchRating } : old
      );
    }
  };

  const updateGameResults = (results) => {
    // Results are recorded server-side by the GameRoom. The client only
    // refreshes derived queries and applies the authoritative post-match
    // rating carried on the result message.
    if (!resultPersistedRef.current) {
      resultPersistedRef.current = true;
      if (currentUser) {
        queryClient.invalidateQueries({
          queryKey: userKeys.stats(currentUser.uid),
        });
        queryClient.invalidateQueries({
          queryKey: userKeys.activity(currentUser.uid, 364),
        });
        queryClient.invalidateQueries({
          queryKey: userKeys.detail(currentUser.uid),
        });
      }
    }

    applyPostMatchRatings(results);
  };

  const startTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    timerRef.current = setInterval(() => {
      timeLeftRef.current -= 1;
      dispatch({ type: "TICK", timeLeft: timeLeftRef.current });
      if (timeLeftRef.current <= 0) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, 1000);
  }, []);

  const handleInputChange = (e) => {
    const maxLength = currentWord.length;
    const nextValue = String(e.target.value || "")
      .replace(/\s/g, "")
      .slice(0, maxLength)
      .toLowerCase();
    dispatch({ type: "INPUT_CHANGE", input: nextValue });

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
      dispatch({ type: "INPUT_CHANGE", input: "" });
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
      dispatch({ type: "SET_REMATCH_STATE", rematchState: "pending" });
    } catch {
      dispatch({ type: "SET_REMATCH_STATE", rematchState: "unavailable" });
    }
  };

  const respondToRematch = (action) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    try {
      wsRef.current.send(JSON.stringify({ type: "REMATCH_RESPONSE", action }));
    } catch {
      // no-op
    } finally {
      dispatch({ type: "CLEAR_INCOMING_REMATCH" });
    }
  };

  const isWinner = Boolean(
    gameResults && (
      (gameResults.player1?.id === currentUser?.uid && gameResults.player1?.won) ||
      (gameResults.player2?.id === currentUser?.uid && gameResults.player2?.won)
    )
  );

  const displayRating =
    postMatchRating != null && Number.isFinite(Number(postMatchRating))
      ? Number(postMatchRating)
      : userStats?.rating ?? 800;

  return {
    currentUser,
    gameState,
    connectionError,
    opponent,
    countdown,
    words,
    currentWordIndex,
    opponentWordIndex,
    myScore,
    opponentScore,
    timeLeft,
    input,
    gameResults,
    modeSeconds,
    rematchState,
    incomingRematch,
    userStats,
    queueRating,
    currentWord,
    isAutoAdvanceEnabled,
    activeSubmitLabel,
    isCoarsePointer,
    viewport,
    inputRef,
    isWinner,
    displayRating,
    showGuestUpgrade,
    setShowGuestUpgrade,
    handleInputChange,
    handleInputSubmit,
    submitCurrentInput,
    handleBackToDashboard,
    handleRematch,
    respondToRematch,
  };
}

function GameHeader({ modeSeconds, gameState, timeLeft }) {
  return (
    <m.div
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
    </m.div>
  );
}

function GameErrorState({ connectionError, onBack }) {
  return (
    <m.div
      key="error"
      initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="flex flex-1 items-center justify-center py-12"
      >
        <Card className="w-full max-w-md border-destructive/50">
          <CardHeader className="text-center">
            <m.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/20"
            >
              <FiZap className="h-8 w-8 text-destructive" />
            </m.div>
            <CardTitle className="font-sans text-destructive">
              {connectionError?.title || "Connection Lost"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              {connectionError?.message || "Could not connect to the game server."}
            </p>
            <Button onClick={onBack} className="w-full gap-2">
              <FiArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </m.div>
  );
}

function GameWaitingState({ queueRating, onCancel }) {
  return (
    <m.div
      key="waiting"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-1 items-center justify-center py-12"
    >
      <Card className="w-full max-w-md overflow-hidden">
        <CardHeader className="text-center">
          <m.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200 }}
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/20"
          >
            <FiZap className="h-8 w-8 text-primary" />
          </m.div>
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
            onClick={onCancel}
            className="w-full gap-2"
          >
            <FiArrowLeft className="h-4 w-4" />
            Cancel
          </Button>
        </CardContent>
      </Card>
    </m.div>
  );
}

function GameCountdownState({ userStats, opponent, countdown }) {
  return (
    <m.div
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
              <p className="inline-flex items-center gap-2 font-semibold">
                <UserAvatar username={userStats.username} size="sm" />
                <span>{userStats.username}</span>
              </p>
              <p className={`font-mono text-sm ${getRatingColor(userStats.rating)}`}>
                {userStats.rating}
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted font-sans text-lg font-bold text-muted-foreground">
              VS
            </div>
            <div className="text-left">
              <p className="inline-flex items-center gap-2 font-semibold">
                <UserAvatar username={opponent?.username || "Opponent"} size="sm" />
                <span>{opponent?.username}</span>
              </p>
              <p className={`font-mono text-sm ${getRatingColor(opponent?.rating)}`}>
                {opponent?.rating}
              </p>
            </div>
          </div>
          
          {/* Countdown */}
          <m.div
            key={countdown}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="font-sans text-7xl font-bold text-primary"
          >
            {countdown === 0 ? "GO!" : countdown}
          </m.div>
        </CardContent>
      </Card>
    </m.div>
  );
}

function GamePlayingState({
  userStats,
  opponent,
  myScore,
  currentWordIndex,
  opponentScore,
  opponentWordIndex,
  words,
  input,
  inputRef,
  isCoarsePointer,
  isAutoAdvanceEnabled,
  activeSubmitLabel,
  handleInputChange,
  handleInputSubmit,
  submitCurrentInput,
}) {
  return (
    <m.div
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
              <UserAvatar username={userStats.username} size="sm" />
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
              <UserAvatar username={opponent?.username || "Opponent"} size="sm" />
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
            <WordDisplay word={words[currentWordIndex]} input={input} />
          </div>
          <input
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleInputSubmit}
            aria-label="Type the next word"
            className={isCoarsePointer ? "h-11 w-full rounded-md border border-border/70 bg-background px-3 text-base" : "pointer-events-none absolute opacity-0"}
            autoFocus={!isCoarsePointer}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="one-time-code"
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
            <m.div
              className="h-full w-full origin-left rounded-full bg-primary"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: currentWordIndex / words.length }}
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
            <m.div
              className="h-full w-full origin-left rounded-full bg-destructive"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: opponentWordIndex / words.length }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>
      </div>
    </m.div>
  );
}

function GameResultsState({
  gameResults,
  currentUser,
  userStats,
  displayRating,
  onBack,
  setShowGuestUpgrade,
  rematchState,
  onRematch,
}) {
  return (
    <m.div
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
              <div className="flex flex-col items-center gap-2">
                <UserAvatar username={gameResults.player1.username} size="md" plain />
                <span className="font-semibold">{gameResults.player1.username}</span>
              </div>
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
              <div className="flex flex-col items-center gap-2">
                <UserAvatar username={gameResults.player2.username} size="md" plain />
                <span className="font-semibold">{gameResults.player2.username}</span>
              </div>
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
                  className={`font-semibold ${getRatingColor(displayRating)}`}
                >
                  {displayRating}
                </span>
              </span>
            </div>
          )}

          <Button onClick={onBack} className="w-full gap-2">
            <FiArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Button>
          {currentUser?.isAnonymous ? (
            <Button
              variant="outline"
              onClick={() => setShowGuestUpgrade(true)}
              className="w-full gap-2"
            >
              <FiSave className="h-4 w-4" />
              Save progress
            </Button>
          ) : null}
          {rematchState !== "declined" ? (
            <Button variant="outline" onClick={onRematch} className="w-full" disabled={rematchState === "pending"}>
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
    </m.div>
  );
}

function RematchRequestToast({ incomingRematch, onRespond }) {
  return (
    <m.div
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
            <Button onClick={() => onRespond("accept")} size="sm" className="gap-1.5">
              <FiCheck className="h-3.5 w-3.5" />
              Accept
            </Button>
            <Button onClick={() => onRespond("reject")} size="sm" variant="outline" className="gap-1.5">
              <FiX className="h-3.5 w-3.5" />
              Decline
            </Button>
          </div>
        </CardContent>
      </Card>
    </m.div>
  );
}

const Game = () => {
  const {
    currentUser,
    gameState,
    connectionError,
    opponent,
    countdown,
    words,
    currentWordIndex,
    opponentWordIndex,
    myScore,
    opponentScore,
    timeLeft,
    input,
    gameResults,
    modeSeconds,
    rematchState,
    incomingRematch,
    userStats,
    queueRating,
    isAutoAdvanceEnabled,
    activeSubmitLabel,
    isCoarsePointer,
    viewport,
    inputRef,
    isWinner,
    displayRating,
    showGuestUpgrade,
    setShowGuestUpgrade,
    handleInputChange,
    handleInputSubmit,
    submitCurrentInput,
    handleBackToDashboard,
    handleRematch,
    respondToRematch,
  } = useGameSession();

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

      <GameHeader modeSeconds={modeSeconds} gameState={gameState} timeLeft={timeLeft} />

      <AnimatePresence initial={false} mode="wait">
        {gameState === "error" && (
          <GameErrorState connectionError={connectionError} onBack={handleBackToDashboard} />
        )}

        {gameState === "waiting" && (
          <GameWaitingState queueRating={queueRating} onCancel={handleBackToDashboard} />
        )}

        {gameState === "countdown" && (
          <GameCountdownState
            userStats={userStats}
            opponent={opponent}
            countdown={countdown}
          />
        )}

        {gameState === "playing" && (
          <GamePlayingState
            userStats={userStats}
            opponent={opponent}
            myScore={myScore}
            currentWordIndex={currentWordIndex}
            opponentScore={opponentScore}
            opponentWordIndex={opponentWordIndex}
            words={words}
            input={input}
            inputRef={inputRef}
            isCoarsePointer={isCoarsePointer}
            isAutoAdvanceEnabled={isAutoAdvanceEnabled}
            activeSubmitLabel={activeSubmitLabel}
            handleInputChange={handleInputChange}
            handleInputSubmit={handleInputSubmit}
            submitCurrentInput={submitCurrentInput}
          />
        )}

        {gameState === "finished" && gameResults && (
          <GameResultsState
            gameResults={gameResults}
            currentUser={currentUser}
            userStats={userStats}
            displayRating={displayRating}
            onBack={handleBackToDashboard}
            setShowGuestUpgrade={setShowGuestUpgrade}
            rematchState={rematchState}
            onRematch={handleRematch}
          />
        )}

        {gameState === "finished" && incomingRematch ? (
          <RematchRequestToast incomingRematch={incomingRematch} onRespond={respondToRematch} />
        ) : null}
      </AnimatePresence>

      <GuestUpgradePrompt
        open={showGuestUpgrade}
        onOpenChange={setShowGuestUpgrade}
      />
    </div>
  );
};

export default Game;
