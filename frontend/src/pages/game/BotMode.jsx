import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import Confetti from "react-confetti";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  const seen = new Set();
  const source = Array.isArray(wordsJson) ? wordsJson : [];
  for (const word of source) {
    if (typeof word !== "string") continue;
    const clean = word.trim().toLowerCase();
    if (clean.length >= 3 && clean.length <= 12) {
      seen.add(clean);
    }
  }
  return Array.from(seen);
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

const GAME_INITIAL_STATE = {
  gameState: "setup",
  countdown: null,
  words: [],
  currentWordIndex: 0,
  opponentWordIndex: 0,
  myScore: 0,
  opponentScore: 0,
  timeLeft: 30,
  input: "",
};

function gameReducer(state, action) {
  switch (action.type) {
    case "START": {
      return {
        ...GAME_INITIAL_STATE,
        gameState: "countdown",
        countdown: 3,
        words: action.words,
        timeLeft: action.modeSeconds,
      };
    }
    case "COUNTDOWN": {
      return { ...state, countdown: action.count };
    }
    case "GO": {
      return { ...state, countdown: null, gameState: "playing" };
    }
    case "TICK": {
      return { ...state, timeLeft: state.timeLeft <= 1 ? 0 : state.timeLeft - 1 };
    }
    case "SUBMIT": {
      const nextIndex = Math.min(state.currentWordIndex + 1, state.words.length);
      return {
        ...state,
        myScore: state.myScore + 1,
        currentWordIndex: nextIndex,
        input: "",
      };
    }
    case "BOT_SCORE": {
      return { ...state, opponentScore: state.opponentScore + 1 };
    }
    case "BOT_PROGRESS": {
      return { ...state, opponentWordIndex: action.index };
    }
    case "INPUT": {
      return { ...state, input: action.value };
    }
    case "FINISH": {
      return { ...state, gameState: "finished" };
    }
    case "RESET": {
      return {
        ...GAME_INITIAL_STATE,
        timeLeft: action.modeSeconds,
      };
    }
    default:
      return state;
  }
}

function BotHeader({ modeSeconds, timeLeft, gameState }) {
  return (
    <m.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-between border-b border-border/50 pb-2 sm:pb-4"
    >
      <div>
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Bot Match</p>
        <h2 className="mt-1 text-xl font-semibold sm:mt-2 sm:text-3xl">Practice Arena</h2>
        <p className="mt-1 text-sm text-muted-foreground">{modeSeconds}s mode</p>
      </div>

      {gameState === "playing" ? (
        <div className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 font-mono text-lg font-bold tabular-nums text-primary">
          <FiClock className="h-4 w-4" />
          {timeLeft}
        </div>
      ) : null}
    </m.div>
  );
}

function BotConfigureCard({
  modeSeconds,
  setModeSeconds,
  difficulty,
  setDifficulty,
  onStart,
  wordBankReady,
}) {
  return (
    <m.div
      key="setup"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex h-full min-h-0 flex-1 flex-col gap-4"
    >
      <Card className="relative flex-1 overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(-45deg,var(--border)_0_0.9px,transparent_0.9px_12px)] dark:bg-[repeating-linear-gradient(-45deg,#1f1f1f_0_0.9px,transparent_0.9px_12px)]"
        />
        <CardHeader className="relative py-2 sm:py-6">
          <CardTitle className="flex items-center gap-2">
            <FiCpu className="h-4 w-4" /> Configure Bot
          </CardTitle>
        </CardHeader>
        <CardContent className="relative flex flex-1 flex-col justify-center gap-4 py-3 sm:gap-8 sm:py-8">
          <div className="mx-auto flex w-full max-w-sm flex-col gap-3 sm:gap-8">
            <div className="space-y-2 sm:space-y-3">
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Timer</p>
              <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-col sm:gap-2.5">
                {MODE_SECONDS.map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    variant={modeSeconds === mode ? "default" : "outline"}
                    className={`h-10 w-full justify-center px-2 text-sm sm:h-12 sm:justify-start sm:px-4 sm:text-base ${modeSeconds === mode ? "" : "dark:bg-input dark:hover:bg-input hover:scale-[1.02] active:scale-[0.98]"}`}
                    onClick={() => setModeSeconds(mode)}
                  >
                    {mode}s
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2 sm:space-y-3">
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Difficulty</p>
              <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-col sm:gap-2.5">
                {Object.values(BOT_DIFFICULTIES).map((preset) => (
                  <Button
                    key={preset.id}
                    type="button"
                    variant={difficulty === preset.id ? "default" : "outline"}
                    className={`h-10 w-full justify-center px-2 text-sm sm:h-12 sm:justify-start sm:px-4 sm:text-base ${difficulty === preset.id ? "" : "dark:bg-input dark:hover:bg-input hover:scale-[1.02] active:scale-[0.98]"}`}
                    onClick={() => setDifficulty(preset.id)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
        <div className="relative flex items-center justify-end px-5 pb-3 sm:px-6 sm:pb-6">
          <Button size="lg" onClick={onStart} disabled={!wordBankReady}>
            Start Bot Match
          </Button>
        </div>
      </Card>
    </m.div>
  );
}

function BotCountdownScreen({ countdown }) {
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

function BotPlayingScreen({
  words,
  currentWordIndex,
  opponentWordIndex,
  myScore,
  opponentScore,
  input,
  isCoarsePointer,
  isAutoAdvanceEnabled,
  activeSubmitLabel,
  inputRef,
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
            <m.div
              className="h-full w-full origin-left rounded-full bg-primary"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: currentWordIndex / Math.max(1, words.length) }}
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
            <m.div
              className="h-full w-full origin-left rounded-full bg-destructive"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: opponentWordIndex / Math.max(1, words.length) }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>
      </div>
    </m.div>
  );
}

function BotResultScreen({ title, myScore, opponentScore, onPlayAgain, onBackToDashboard }) {
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
          <CardTitle className="font-sans text-2xl">{title}</CardTitle>
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

          <Button onClick={onPlayAgain} className="w-full gap-2">
            <FiZap className="h-4 w-4" /> Play Again
          </Button>
          <Button variant="outline" onClick={onBackToDashboard} className="w-full gap-2">
            <FiArrowLeft className="h-4 w-4" /> Back to Dashboard
          </Button>
        </CardContent>
      </Card>
    </m.div>
  );
}

export default function BotMode() {
  const navigate = useNavigate();

  const [modeSeconds, setModeSeconds] = useState(30);
  const [difficulty, setDifficulty] = useState("medium");
  const [wordBank, setWordBank] = useState([]);
  const [game, dispatch] = useReducer(gameReducer, GAME_INITIAL_STATE);
  const { gameState, countdown, words, currentWordIndex, opponentWordIndex, myScore, opponentScore, timeLeft, input } = game;
  const [playerPreferences] = usePlayerPreferences();
  const viewport = useViewport();
  const isCoarsePointer = useIsCoarsePointer();

  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const botTickRef = useRef(null);
  const botWordIndexRef = useRef(0);
  const botCharProgressRef = useRef(0);
  const countdownRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const countdownTimeoutRef = useRef(null);

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
    import("../../../../words.json")
      .then((module) => {
        if (cancelled) return;
        setWordBank(buildWordBank(module.default));
      })
      .catch(() => {
        if (cancelled) return;
        setWordBank([]);
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
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (countdownTimeoutRef.current) {
      clearTimeout(countdownTimeoutRef.current);
      countdownTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearGameTimers();
    };
  }, []);

  const finishBotGame = useCallback(() => {
    clearGameTimers();
    dispatch({ type: "FINISH" });
  }, []);

  const startMainTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    timerRef.current = setInterval(() => {
      dispatch({ type: "TICK" });
    }, 1000);
  }, []);

  useEffect(() => {
    if (gameState === "playing" && timeLeft === 0) {
      finishBotGame();
    }
  }, [gameState, timeLeft, finishBotGame]);

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
        dispatch({ type: "BOT_SCORE" });
      }

      const nextBotIndex = Math.min(botWordIndexRef.current + 1, targetWords.length);
      botWordIndexRef.current = nextBotIndex;
      dispatch({ type: "BOT_PROGRESS", index: nextBotIndex });
      if (nextBotIndex >= targetWords.length) {
        finishBotGame();
      }
    }, tickMs);
  }, [botDifficulty.accuracy, botDifficulty.cpsRange, finishBotGame]);

  const startBotGame = () => {
    clearGameTimers();

    const generatedWords = pickWords(Math.max(18, Math.round(modeSeconds * 1.2)), wordBank);
    dispatch({ type: "START", words: generatedWords, modeSeconds });
    countdownRef.current = 3;

    const countdownTimer = setInterval(() => {
      const current = countdownRef.current;
      if (current === null) return;
      const next = current - 1;
      countdownRef.current = next;
      if (next <= 0) {
        dispatch({ type: "COUNTDOWN", count: 0 });
        clearInterval(countdownTimer);
        countdownTimerRef.current = null;
        countdownTimeoutRef.current = setTimeout(() => {
          countdownTimeoutRef.current = null;
          countdownRef.current = null;
          dispatch({ type: "GO" });
          startMainTimer();
          startBotProgress(generatedWords);
          setTimeout(() => inputRef.current?.focus(), 100);
        }, 250);
      } else {
        dispatch({ type: "COUNTDOWN", count: next });
      }
    }, 1000);
    countdownTimerRef.current = countdownTimer;
  };

  const submitWordIfCorrect = (rawInput) => {
    if (gameState !== "playing") return false;

    const normalizedInput = String(rawInput || "").trim();
    if (!normalizedInput || !currentWord) return false;
    if (normalizedInput !== currentWord) return false;

    const nextIndex = Math.min(currentWordIndex + 1, words.length);
    dispatch({ type: "SUBMIT" });
    if (nextIndex >= words.length) {
      finishBotGame();
    }
    return true;
  };

  const handleInputChange = (event) => {
    const maxLength = currentWord.length;
    const nextValue = String(event.target.value || "")
      .replace(/\s/g, "")
      .slice(0, maxLength)
      .toLowerCase();
    dispatch({ type: "INPUT", value: nextValue });

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
    dispatch({ type: "RESET", modeSeconds });
  };

  const getResultTitle = useMemo(() => {
    if (myScore === opponentScore) return "It's a Draw!";
    return myScore > opponentScore ? "You Won" : "Better Luck Next Time!";
  }, [myScore, opponentScore]);

  return (
    <div className="flex min-h-full flex-col gap-3 sm:gap-6">
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

      <BotHeader modeSeconds={modeSeconds} timeLeft={timeLeft} gameState={gameState} />

      <AnimatePresence initial={false} mode="wait">
        {gameState === "setup" ? (
          <BotConfigureCard
            modeSeconds={modeSeconds}
            setModeSeconds={setModeSeconds}
            difficulty={difficulty}
            setDifficulty={setDifficulty}
            onStart={startBotGame}
            wordBankReady={wordBank.length > 0}
          />
        ) : null}

        {gameState === "countdown" ? <BotCountdownScreen countdown={countdown} /> : null}

        {gameState === "playing" ? (
          <BotPlayingScreen
            words={words}
            currentWordIndex={currentWordIndex}
            opponentWordIndex={opponentWordIndex}
            myScore={myScore}
            opponentScore={opponentScore}
            input={input}
            isCoarsePointer={isCoarsePointer}
            isAutoAdvanceEnabled={isAutoAdvanceEnabled}
            activeSubmitLabel={activeSubmitLabel}
            inputRef={inputRef}
            handleInputChange={handleInputChange}
            handleInputSubmit={handleInputSubmit}
            submitCurrentInput={submitCurrentInput}
          />
        ) : null}

        {gameState === "finished" ? (
          <BotResultScreen
            title={getResultTitle}
            myScore={myScore}
            opponentScore={opponentScore}
            onPlayAgain={resetSetup}
            onBackToDashboard={() => navigate("/dashboard")}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}