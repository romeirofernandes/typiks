import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Confetti from "react-confetti";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useViewport } from "@/hooks/useViewport";
import { useIsCoarsePointer } from "@/hooks/useIsCoarsePointer";
import { usePlayerPreferences } from "@/hooks/usePlayerPreferences";
import {
  getSubmitKeyOptionById,
  NEXT_WORD_CONDITIONS,
} from "@/lib/player-preferences";
import { FiUser, FiClock, FiArrowLeft, FiZap, FiCpu } from "react-icons/fi";

const BOT_DIFFICULTIES = {
  easy: { id: "easy", label: "Easy", cpsRange: [2.2, 3.4], accuracy: 0.82 },
  medium: { id: "medium", label: "Medium", cpsRange: [3.2, 4.6], accuracy: 0.9 },
  hard: { id: "hard", label: "Hard", cpsRange: [4.4, 6.2], accuracy: 0.96 },
};

const MODE_SECONDS = [15, 30, 60];

function buildWordBank(wordsJson) {
  return Array.from(
    new Set(
      (Array.isArray(wordsJson) ? wordsJson : [])
        .filter((word) => typeof word === "string")
        .map((word) => word.trim().toLowerCase())
        .filter((word) => word.length >= 3 && word.length <= 12)
    )
  );
}

function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

function pickWords(count, wordBank) {
  if (wordBank.length === 0) return [];

  const shuffled = [...wordBank];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  if (count <= shuffled.length) {
    return shuffled.slice(0, count);
  }

  const output = [...shuffled];
  while (output.length < count) {
    const nextBatch = [...wordBank];
    for (let i = nextBatch.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nextBatch[i], nextBatch[j]] = [nextBatch[j], nextBatch[i]];
    }
    output.push(...nextBatch);
  }

  return output.slice(0, count);
}

export default function BotMode() {
  const navigate = useNavigate();

  const [modeSeconds, setModeSeconds] = useState(30);
  const [difficulty, setDifficulty] = useState("medium");
  const [gameState, setGameState] = useState("setup");
  const [countdown, setCountdown] = useState(null);
  const [wordBank, setWordBank] = useState([]);
  const [words, setWords] = useState([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [opponentWordIndex, setOpponentWordIndex] = useState(0);
  const [myScore, setMyScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [input, setInput] = useState("");
  const [isBooting, setIsBooting] = useState(true);
  const [playerPreferences] = usePlayerPreferences();
  const viewport = useViewport();
  const isCoarsePointer = useIsCoarsePointer();

  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const botTickRef = useRef(null);
  const botWordIndexRef = useRef(0);
  const botCharProgressRef = useRef(0);

  const currentWord = words[currentWordIndex] || "";
  const botDifficulty = BOT_DIFFICULTIES[difficulty];
  const isAutoAdvanceEnabled = playerPreferences.nextWordCondition === NEXT_WORD_CONDITIONS.auto;
  const activeSubmitKeyIds = Array.isArray(playerPreferences.submitKeyIds)
    ? playerPreferences.submitKeyIds
    : [playerPreferences.submitKeyId].filter(Boolean);
  const activeSubmitKeys = activeSubmitKeyIds.map((id) => getSubmitKeyOptionById(id));
  const activeSubmitKeySet = new Set(activeSubmitKeys.map((option) => option.key));
  const activeSubmitLabel = activeSubmitKeys.map((option) => option.label).join(" / ");

  const isWinner = gameState === "finished" && myScore > opponentScore;

  useEffect(() => {
    let cancelled = false;
    import("../../../../words.json").then((module) => {
      if (cancelled) return;
      setWordBank(buildWordBank(module.default));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const clearGameTimers = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (botTickRef.current) {
      clearInterval(botTickRef.current);
      botTickRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearGameTimers();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsBooting(false);
    }, 350);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  const finishBotGame = useCallback(() => {
    clearGameTimers();
    setGameState("finished");
  }, []);

  const startMainTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          finishBotGame();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [finishBotGame]);

  const startBotProgress = useCallback((targetWords) => {
    if (botTickRef.current) {
      clearInterval(botTickRef.current);
    }

    const cps = randomRange(botDifficulty.cpsRange[0], botDifficulty.cpsRange[1]);
    const tickMs = 120;
    botWordIndexRef.current = 0;
    botCharProgressRef.current = 0;

    botTickRef.current = setInterval(() => {
      const currentBotWord = targetWords[botWordIndexRef.current] || "";
      if (!currentBotWord) return;

      botCharProgressRef.current += (cps * tickMs) / 1000;
      const charsNeeded = currentBotWord.length;

      if (botCharProgressRef.current < charsNeeded) return;

      botCharProgressRef.current = 0;
      if (Math.random() <= botDifficulty.accuracy) {
        setOpponentScore((prev) => prev + 1);
      }

      setOpponentWordIndex((prev) => {
        const next = Math.min(prev + 1, targetWords.length);
        botWordIndexRef.current = next;
        if (next >= targetWords.length) {
          finishBotGame();
        }
        return next;
      });
    }, tickMs);
  }, [botDifficulty.accuracy, botDifficulty.cpsRange, finishBotGame]);

  const startBotGame = () => {
    clearGameTimers();

    const generatedWords = pickWords(Math.max(18, Math.round(modeSeconds * 1.2)), wordBank);
    setWords(generatedWords);
    setCurrentWordIndex(0);
    setOpponentWordIndex(0);
    setMyScore(0);
    setOpponentScore(0);
    setInput("");
    setTimeLeft(modeSeconds);
    setCountdown(3);
    setGameState("countdown");

    const countdownTimer = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearInterval(countdownTimer);
          setCountdown(0);
          setTimeout(() => {
            setCountdown(null);
            setGameState("playing");
            startMainTimer();
            startBotProgress(generatedWords);
            setTimeout(() => inputRef.current?.focus(), 100);
          }, 250);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const submitWordIfCorrect = (rawInput) => {
    if (gameState !== "playing") return false;

    const normalizedInput = String(rawInput || "").trim();
    if (!normalizedInput || !currentWord) return false;
    if (normalizedInput !== currentWord) return false;

    setMyScore((prev) => prev + 1);
    setCurrentWordIndex((prev) => {
      const next = Math.min(prev + 1, words.length);
      if (next >= words.length) {
        finishBotGame();
      }
      return next;
    });
    setInput("");
    return true;
  };

  const handleInputChange = (event) => {
    const maxLength = currentWord.length;
    const nextValue = String(event.target.value || "").replace(/\s/g, "").slice(0, maxLength);
    setInput(nextValue);

    if (isAutoAdvanceEnabled) {
      submitWordIfCorrect(nextValue);
    }
  };

  const handleInputSubmit = (event) => {
    if (event.key === " ") {
      event.preventDefault();
      return;
    }

    if (isAutoAdvanceEnabled) return;
    if (activeSubmitKeySet.has(event.key)) {
      event.preventDefault();
      submitWordIfCorrect(input);
    }
  };

  const submitCurrentInput = () => {
    submitWordIfCorrect(input);
  };

  const resetSetup = () => {
    clearGameTimers();
    setGameState("setup");
    setCountdown(null);
    setWords([]);
    setCurrentWordIndex(0);
    setOpponentWordIndex(0);
    setMyScore(0);
    setOpponentScore(0);
    setInput("");
    setTimeLeft(modeSeconds);
  };

  const getResultTitle = useMemo(() => {
    if (myScore === opponentScore) return "It's a Draw!";
    return myScore > opponentScore ? "You Won" : "Better Luck Next Time!";
  }, [myScore, opponentScore]);

  return (
    <div className="flex min-h-full flex-col gap-6">
      {gameState === "finished" && isWinner && viewport.width > 0 && viewport.height > 0 ? (
        <Confetti
          width={viewport.width}
          height={viewport.height}
          numberOfPieces={140}
          recycle={false}
          gravity={0.2}
          tweenDuration={1800}
        />
      ) : null}

      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between border-b border-border/50 pb-4"
      >
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Bot Match
          </p>
          <h2 className="font-sans text-xl font-semibold tracking-tight">Practice Arena</h2>
          <p className="mt-1 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
            {modeSeconds}s mode
          </p>
        </div>

        {gameState === "playing" ? (
          <div className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 font-mono text-lg font-bold tabular-nums text-primary">
            <FiClock className="h-4 w-4" />
            {timeLeft}
          </div>
        ) : null}
      </motion.div>

      <AnimatePresence initial={false} mode="wait">
        {gameState === "setup" ? (
          <motion.div
            key="setup"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex h-full min-h-0 flex-1 flex-col gap-4"
          >
            {isBooting ? (
              <Card className="flex-1">
                <CardHeader>
                  <Skeleton className="h-6 w-40" />
                </CardHeader>
                <CardContent className="flex flex-1 flex-col justify-center gap-8">
                  <div className="mx-auto flex w-full max-w-sm flex-col gap-8">
                    <div className="space-y-3">
                      <Skeleton className="h-3 w-20" />
                      <div className="flex flex-col gap-2.5">
                        {MODE_SECONDS.map((mode) => (
                          <Skeleton key={`timer-skeleton-${mode}`} className="h-12 w-full" />
                        ))}
                      </div>
                    </div>
                    <div className="space-y-3">
                      <Skeleton className="h-3 w-24" />
                      <div className="flex flex-col gap-2.5">
                        {Object.keys(BOT_DIFFICULTIES).map((id) => (
                          <Skeleton key={`difficulty-skeleton-${id}`} className="h-12 w-full" />
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                <Card className="relative flex-1 overflow-hidden">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(-45deg,var(--border)_0_0.9px,transparent_0.9px_12px)] dark:bg-[repeating-linear-gradient(-45deg,#1f1f1f_0_0.9px,transparent_0.9px_12px)]"
                  />
                  <CardHeader className="relative">
                    <CardTitle className="flex items-center gap-2">
                      <FiCpu className="h-4 w-4" /> Configure Bot
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="relative flex flex-1 flex-col justify-center gap-6 sm:gap-8">
                    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 sm:gap-8">
                      <div className="space-y-3">
                        <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Timer</p>
                        <div className="flex flex-col gap-2.5">
                          {MODE_SECONDS.map((mode) => (
                            <Button
                              key={mode}
                              type="button"
                              variant={modeSeconds === mode ? "default" : "outline"}
                              className={`h-11 w-full justify-start px-4 text-sm sm:h-12 sm:text-base ${modeSeconds === mode ? "" : "dark:bg-input dark:hover:bg-input hover:scale-[1.02] active:scale-[0.98]"}`}
                              onClick={() => setModeSeconds(mode)}
                            >
                              {mode}s
                            </Button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Difficulty</p>
                        <div className="flex flex-col gap-2.5">
                          {Object.values(BOT_DIFFICULTIES).map((preset) => (
                            <Button
                              key={preset.id}
                              type="button"
                              variant={difficulty === preset.id ? "default" : "outline"}
                              className={`h-11 w-full justify-start px-4 text-sm sm:h-12 sm:text-base ${difficulty === preset.id ? "" : "dark:bg-input dark:hover:bg-input hover:scale-[1.02] active:scale-[0.98]"}`}
                              onClick={() => setDifficulty(preset.id)}
                            >
                              {preset.label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                  <div className="relative flex items-center justify-end px-6">
                    <Button size="lg" onClick={startBotGame} disabled={wordBank.length === 0}>
                      Start Bot Match
                    </Button>
                  </div>
                </Card>
              </>
            )}
          </motion.div>
        ) : null}

        {gameState === "countdown" ? (
          <motion.div
            key="countdown"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-1 items-center justify-center py-12"
          >
            <Card className="w-full max-w-md overflow-hidden border-primary/50">
              <CardHeader className="text-center">
                <CardTitle className="font-sans">Bot Match Starting</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 py-8 text-center">
                <div className="flex items-center justify-center gap-4">
                  <div className="text-right">
                    <p className="font-semibold">You</p>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted font-sans text-lg font-bold text-muted-foreground">
                    VS
                  </div>
                  <div className="text-left">
                    <p className="font-semibold">Bot</p>
                  </div>
                </div>

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
        ) : null}

        {gameState === "playing" ? (
          <motion.div
            key="playing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="grid min-h-0 flex-1 grid-rows-[auto,1fr,auto] gap-6"
          >
            <div className="grid grid-cols-2 gap-4">
              <Card className="border-primary/30 bg-primary/5">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                    <FiUser className="h-3 w-3" /> You
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="font-sans text-3xl font-bold text-primary">{myScore}</div>
                  <div className="font-mono text-xs text-muted-foreground">Word {currentWordIndex + 1} / {words.length}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
                    <FiCpu className="h-3 w-3" /> Bot
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="font-sans text-3xl font-bold">{opponentScore}</div>
                  <div className="font-mono text-xs text-muted-foreground">Word {opponentWordIndex + 1} / {words.length}</div>
                </CardContent>
              </Card>
            </div>

            <Card className="h-full">
              <CardContent className="flex h-full flex-col gap-6 py-8">
                <div className="text-center">
                  <p className="mb-4 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">Type This Word</p>
                  <div
                    key={words[currentWordIndex]}
                    className="relative inline-block font-mono text-4xl font-medium tracking-wider leading-none sm:text-5xl"
                  >
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
                    {input.length === (words[currentWordIndex] || "").length ? (
                      <span
                        className="absolute -right-[2px] top-0 h-full w-[3px] bg-primary"
                        style={{ animation: "blink 1s ease-in-out infinite" }}
                      />
                    ) : null}
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
                  <Button type="button" variant="secondary" className="w-full" onClick={submitCurrentInput}>
                    Submit Word
                  </Button>
                ) : null}
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Your Progress</span>
                  <span className="font-mono text-xs text-primary">{Math.round((currentWordIndex / Math.max(1, words.length)) * 100)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${(currentWordIndex / Math.max(1, words.length)) * 100}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">Bot Progress</span>
                  <span className="font-mono text-xs text-destructive">{Math.round((opponentWordIndex / Math.max(1, words.length)) * 100)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <motion.div
                    className="h-full rounded-full bg-destructive"
                    initial={{ width: 0 }}
                    animate={{ width: `${(opponentWordIndex / Math.max(1, words.length)) * 100}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}

        {gameState === "finished" ? (
          <motion.div
            key="finished"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-1 items-center justify-center py-12"
          >
            <Card className="w-full max-w-md overflow-hidden">
              <CardHeader className="text-center">
                <CardTitle className="font-sans text-2xl">{getResultTitle}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 py-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className={`rounded-md p-4 text-center ${myScore >= opponentScore ? "bg-primary/10" : "bg-muted/50"}`}>
                    <p className="font-semibold">You</p>
                    <p className="font-sans text-3xl font-bold">{myScore}</p>
                    {myScore > opponentScore ? <span className="font-mono text-xs text-primary">WINNER</span> : null}
                  </div>
                  <div className={`rounded-md p-4 text-center ${opponentScore >= myScore ? "bg-primary/10" : "bg-muted/50"}`}>
                    <p className="font-semibold">Bot</p>
                    <p className="font-sans text-3xl font-bold">{opponentScore}</p>
                    {opponentScore > myScore ? <span className="font-mono text-xs text-primary">WINNER</span> : null}
                  </div>
                </div>

                <Button onClick={resetSetup} className="w-full gap-2">
                  <FiZap className="h-4 w-4" /> Play Again
                </Button>
                <Button variant="outline" onClick={() => navigate("/dashboard")} className="w-full gap-2">
                  <FiArrowLeft className="h-4 w-4" /> Back to Dashboard
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
