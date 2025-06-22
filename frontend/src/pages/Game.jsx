import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FiArrowLeft, FiUser, FiClock } from "react-icons/fi";

const Game = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [gameState, setGameState] = useState("connecting");
  const [ws, setWs] = useState(null);
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

  useEffect(() => {
    fetchUserStats();

    return () => {
      cleanup();
    };
  }, [currentUser]);

  useEffect(() => {
    if (userStats && gameState === "connecting") {
      connectWebSocket();
    }
  }, [userStats]);

  const cleanup = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const fetchUserStats = async () => {
    if (!currentUser) return;

    try {
      const serverUrl = import.meta.env.VITE_SERVER_URL || "localhost:8787";
      const fullUrl = serverUrl.startsWith("http")
        ? serverUrl
        : `http://${serverUrl}`;

      const response = await fetch(
        `${fullUrl}/api/users/${currentUser.uid}/stats`
      );

      if (response.ok) {
        const data = await response.json();
        setUserStats(data);
      }
    } catch (error) {
      console.error("Failed to fetch user stats:", error);
    }
  };

  const connectWebSocket = async () => {
    if (!userStats) return;

    try {
      cleanup(); // Clean up any existing connections

      const serverUrl = import.meta.env.VITE_SERVER_URL || "localhost:8787";
      const wsUrl = serverUrl.startsWith("http")
        ? serverUrl.replace("http", "ws")
        : `ws://${serverUrl}`;

      const websocket = new WebSocket(`${wsUrl}/ws`);
      wsRef.current = websocket;
      setWs(websocket);

      websocket.onopen = () => {
        setGameState("waiting");

        // Join the matchmaking queue with proper user info
        websocket.send(
          JSON.stringify({
            type: "JOIN_QUEUE",
            playerId: currentUser.uid,
            userInfo: {
              username: userStats.username,
              rating: userStats.rating,
            },
          })
        );
      };

      websocket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      };

      websocket.onclose = (event) => {
      };

      websocket.onerror = (error) => {
        console.error("WebSocket error:", error);
      };
    } catch (error) {
      console.error("Failed to connect WebSocket:", error);
    }
  };

  const handleWebSocketMessage = (message) => {
    switch (message.type) {
      case "MATCH_FOUND":
        setOpponent(message.opponent);
        setGameState("countdown");
        break;

      case "COUNTDOWN":
        setCountdown(message.count);
        break;

      case "GAME_START":
        setWords(message.words);
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

      case "PLAYER_PROGRESS":
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
        // Handle opponent disconnect more gracefully
        setGameState("finished");
        setGameResults({
          player1: {
            id: currentUser.uid,
            username: userStats.username,
            score: myScore,
            won: true,
          },
          player2: {
            id: "disconnected",
            username: opponent?.username || "Opponent",
            score: opponentScore,
            won: false,
          },
          isDraw: false,
          reason: "opponent_disconnected",
        });
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        break;
    }
  };

  const updateGameResults = async (results) => {
    try {
      const serverUrl = import.meta.env.VITE_SERVER_URL || "localhost:8787";
      const fullUrl = serverUrl.startsWith("http")
        ? serverUrl
        : `http://${serverUrl}`;

      // Don't update rating if opponent disconnected
      if (results.reason === "opponent_disconnected") {
        return;
      }

      // Determine if current user won
      const currentUserResult =
        results.player1.id === currentUser.uid
          ? results.player1
          : results.player2;
      const opponentResult =
        results.player1.id === currentUser.uid
          ? results.player2
          : results.player1;

      const response = await fetch(
        `${fullUrl}/api/users/${currentUser.uid}/game-result`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
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

      wsRef.current.send(
        JSON.stringify({
          type: "PLAYER_INPUT",
          input: input.trim(),
        })
      );

      setInput("");
    }
  };

  const handleBackToDashboard = () => {
    if (wsRef.current) {
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
    if (rating >= 1600) return "text-purple-500";
    if (rating >= 1400) return "text-blue-500";
    if (rating >= 1200) return "text-green-500";
    if (rating >= 1000) return "text-yellow-500";
    return "text-gray-500";
  };

  if (!userStats) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-6"
        >
          <Button
            variant="outline"
            onClick={handleBackToDashboard}
            className="gap-2"
          >
            <FiArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Button>

          {gameState === "playing" && (
            <div className="flex items-center gap-2 text-lg font-bold">
              <FiClock className="w-5 h-5" />
              {formatTime(timeLeft)}
            </div>
          )}
        </motion.div>

        {/* Game States */}
        <AnimatePresence mode="wait">
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
                      className="bg-red-500 h-2 rounded-full transition-all duration-300"
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

                  {gameResults.reason !== "opponent_disconnected" &&
                    userStats && (
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
