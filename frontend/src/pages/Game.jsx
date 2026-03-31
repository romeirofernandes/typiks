import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FiUser, FiClock } from "react-icons/fi";

const Game = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [gameState, setGameState] = useState("connecting");
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
  const [userStats, setUserStats] = useState(null);
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const wsRef = useRef(null);
  const isConnectingRef = useRef(false);
  const connectAttemptRef = useRef(0);
  const gameEndedRef = useRef(false);
  const resultPersistedRef = useRef(false);

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
            userInfo: {
              username: userStats.username,
              rating: userStats.rating,
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
  }, [currentUser, navigate, userStats]); // note: handleWebSocketMessage is omitted as it's structurally bound to the latest render by design or handled

  useEffect(() => {
    fetchUserStats();

    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount! fetchUserStats uses latest refs or is stable enough.

  useEffect(() => {
    if (userStats && gameState === "connecting" && !wsRef.current) {
      connectWebSocket();
    }
  }, [connectWebSocket, gameState, userStats]);

  const handleWebSocketMessage = (message) => {
    switch (message.type) {
      case "MATCH_FOUND":
        setOpponent(message.opponent);
        setGameState("countdown");
        break;

      case "COUNTDOWN":
        setCountdown(message.count);
        break;

      case "GAME_START": {
        gameEndedRef.current = false;
        resultPersistedRef.current = false;
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
        // Optional: Add visual feedback for wrong words
        if (inputRef.current) {
          inputRef.current.style.borderColor = "red";
          setTimeout(() => {
            if (inputRef.current) {
              inputRef.current.style.borderColor = "";
            }
          }, 500);
        }
        break;

      case "GAME_END":
        gameEndedRef.current = true;
        setGameResults(message.results);
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
        setGameState("finished");
        {
          const fallbackResults = {
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
            opponentId: opponentResult.id,
            score: currentUserResult.score,
            opponentScore: opponentResult.score,
          }),
        }
      );

      if (response.ok) {
        resultPersistedRef.current = true;
        const data = await response.json();

        // Update local user stats for immediate UI update
        setUserStats((prev) => ({
          ...prev,
          ...data.player,
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
    setInput(e.target.value);
  };

  const handleInputSubmit = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();

        if (gameState !== "playing" || !input.trim() || !wsRef.current) return;
        if (wsRef.current.readyState !== WebSocket.OPEN) return;

        try {
          wsRef.current.send(
            JSON.stringify({
              type: "PLAYER_INPUT",
              input: input.trim(),
            })
          );
        } catch (error) {
          console.error("Failed to send player input:", error);
          return;
        }

      setInput("");
    }
  };

  const handleBackToDashboard = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "LEAVE_QUEUE" }));
    }
    cleanup();
    navigate("/dashboard");
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

  if (!userStats) {
    return (
      <div className="flex h-full min-h-[60svh] items-center justify-center text-foreground">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent"
        />
      </div>
    );
  }

  return (
    <div className="h-full text-foreground font-mono">
      <div className="w-full">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 flex items-center justify-between"
        >
          <h2 className="text-xl font-semibold">Start Game</h2>

          {gameState === "playing" && (
            <div className="flex items-center gap-2 text-lg font-bold tabular-nums">
              <FiClock className="h-5 w-5" />
              {formatTime(timeLeft)}
            </div>
          )}
        </motion.div>

        {/* Game States */}
        <AnimatePresence mode="wait">
          {gameState === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-20"
            >
              <Card className="max-w-md mx-auto border-destructive/50">
                <CardHeader>
                  <CardTitle className="text-destructive">
                    {connectionError?.title || "Connection Lost"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-4">
                    {connectionError?.message ||
                      "Could not connect to the game server."}
                  </p>
                  <button
                    onClick={() => navigate("/dashboard")}
                    className="flex h-10 w-full items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    Back to Dashboard
                  </button>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {gameState === "connecting" && (
            <motion.div
              key="connecting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-20"
            >
              <Card className="max-w-md mx-auto">
                <CardContent className="py-8">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{
                      duration: 1,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                    className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4"
                  />
                  <p>Connecting to game server...</p>
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
              className="text-center py-20"
            >
              <Card className="max-w-md mx-auto">
                <CardHeader>
                  <CardTitle>Finding Opponent</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-center space-x-2 mb-4">
                    {[...Array(3)].map((_, i) => (
                      <motion.div
                        key={i}
                        className="w-4 h-4 bg-primary rounded-full"
                        animate={{
                          scale: [1, 1.2, 1],
                          opacity: [0.5, 1, 0.5],
                        }}
                        transition={{
                          duration: 1.5,
                          repeat: Infinity,
                          delay: i * 0.2,
                        }}
                      />
                    ))}
                  </div>
                  <p className="text-muted-foreground mb-2">
                    Looking for players...
                  </p>
                  <div className="text-sm text-muted-foreground">
                    Your Rating:{" "}
                    <span className={getRatingColor(userStats.rating)}>
                      {userStats.rating}
                    </span>
                  </div>
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
              className="text-center py-20"
            >
              <Card className="max-w-md mx-auto">
                <CardHeader>
                  <CardTitle>Match Found!</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 mb-4">
                    <p>
                      <strong>{userStats.username}</strong>{" "}
                      <span className={getRatingColor(userStats.rating)}>
                        ({userStats.rating})
                      </span>
                    </p>
                    <p className="text-muted-foreground">vs</p>
                    <p>
                      <strong>{opponent?.username}</strong>{" "}
                      <span className={getRatingColor(opponent?.rating)}>
                        ({opponent?.rating})
                      </span>
                    </p>
                  </div>
                  <motion.div
                    key={countdown}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="text-6xl font-bold text-primary"
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
              className="space-y-6"
            >
              {/* Score Display */}
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <FiUser className="w-4 h-4" />
                      {userStats.username}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{myScore}</div>
                    <div className="text-sm text-muted-foreground">
                      Word {currentWordIndex + 1} / {words.length}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <FiUser className="w-4 h-4" />
                      {opponent?.username}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{opponentScore}</div>
                    <div className="text-sm text-muted-foreground">
                      Word {opponentWordIndex + 1} / {words.length}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Current Word Display */}
              <Card>
                <CardContent className="py-8">
                  <div className="text-center">
                    <div className="text-4xl font-bold mb-6">
                      {words[currentWordIndex] || "Loading..."}
                    </div>
                    <Input
                      ref={inputRef}
                      value={input}
                      onChange={handleInputChange}
                      onKeyDown={handleInputSubmit}
                      placeholder="Type the word and press Enter or Space"
                      className="text-center text-xl max-w-md mx-auto"
                      autoFocus
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Progress Indicators */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground mb-2">
                    Your Progress
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${(currentWordIndex / words.length) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-2">
                    Opponent Progress
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div
                      className="bg-destructive h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${(opponentWordIndex / words.length) * 100}%`,
                      }}
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
              className="text-center py-20"
            >
              <Card className="max-w-md mx-auto">
                <CardHeader>
                  <CardTitle>
                    {gameResults.reason === "opponent_disconnected"
                      ? "Opponent Disconnected - You Win!"
                      : gameResults.isDraw
                      ? "Draw!"
                      : gameResults.player1.id === currentUser.uid &&
                        gameResults.player1.won
                      ? "You Won!"
                      : gameResults.player2.id === currentUser.uid &&
                        gameResults.player2.won
                      ? "You Won!"
                      : "You Lost!"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="font-semibold">
                        {gameResults.player1.username}
                      </div>
                      <div className="text-2xl">
                        {gameResults.player1.score}
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold">
                        {gameResults.player2.username}
                      </div>
                      <div className="text-2xl">
                        {gameResults.player2.score}
                      </div>
                    </div>
                  </div>

                  {userStats && (
                    <div className="text-sm text-muted-foreground">
                      <p>
                        Your new rating:{" "}
                        <span className={getRatingColor(userStats.rating)}>
                          {userStats.rating}
                        </span>
                      </p>
                    </div>
                  )}

                  <Button onClick={handleBackToDashboard} className="w-full">
                    Back to Dashboard
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Game;
