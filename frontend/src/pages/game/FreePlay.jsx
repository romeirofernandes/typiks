import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useIsCoarsePointer } from "@/hooks/useIsCoarsePointer";
import { buildWordBank, pickWords } from "@/lib/typing/words";
import {
  timedSupplySize,
  wpmFromChars,
  accuracyFromChars,
  formatSeconds,
} from "@/lib/typing/metrics";
import { SessionWpmChart } from "@/components/charts/SessionWpmChart";
import {
  FiClock,
  FiArrowLeft,
  FiMinus,
  FiPlus,
  FiRotateCw,
  FiCheck,
} from "react-icons/fi";

const TIME_PRESETS = [15, 30, 60];
const WORDS_PRESETS = [10, 25, 50];
const CUSTOM_TIME_MIN = 15;
const CUSTOM_TIME_MAX = 120;
const CUSTOM_TIME_STEP = 5;
const CUSTOM_WORDS_MIN = 10;
const CUSTOM_WORDS_MAX = 100;
const CUSTOM_WORDS_STEP = 5;
const VISIBLE_LINES = 3;
const DOUBLE_ESC_WINDOW_MS = 400;

const EMPTY_RUN = { index: 0, typed: [], records: [] };

const SESSION_INITIAL_STATE = {
  gameState: "setup",
  countdown: null,
  words: [],
  samples: [],
  results: null,
  elapsedMs: 0,
  remaining: 0,
};

function sessionReducer(state, action) {
  switch (action.type) {
    case "GO_TO_SETUP": {
      return { ...SESSION_INITIAL_STATE };
    }
    case "START_SESSION": {
      return {
        ...SESSION_INITIAL_STATE,
        words: action.words,
        gameState: "countdown",
        countdown: 3,
        remaining: action.remaining,
      };
    }
    case "COUNTDOWN": {
      return { ...state, countdown: action.count };
    }
    case "GO": {
      return { ...state, countdown: null, gameState: "playing" };
    }
    case "SET_REMAINING": {
      return { ...state, remaining: action.value };
    }
    case "SET_ELAPSED": {
      return { ...state, elapsedMs: action.value };
    }
    case "ADD_SAMPLE": {
      const last = state.samples[state.samples.length - 1];
      if (last && last.t === action.sample.t) return state;
      return { ...state, samples: [...state.samples, action.sample] };
    }
    case "FINISH": {
      return {
        ...state,
        gameState: "finished",
        results: action.results,
        elapsedMs: action.elapsed,
      };
    }
    default:
      return state;
  }
}

function Stepper({ label, value, min, max, step, onChange, suffix = "" }) {
  const decrease = () => onChange(Math.max(min, value - step));
  const increase = () => onChange(Math.min(max, value + step));

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-background/50 px-3 py-2">
      <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Decrease ${label.toLowerCase()}`}
          onClick={decrease}
          disabled={value <= min}
        >
          <FiMinus className="h-4 w-4" />
        </Button>
        <div className="min-w-16 text-center font-mono text-lg font-semibold tabular-nums">
          {value}
          {suffix ? ` ${suffix}` : ""}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Increase ${label.toLowerCase()}`}
          onClick={increase}
          disabled={value >= max}
        >
          <FiPlus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-md border border-border/70 bg-background/50 p-3 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-sans text-xl font-bold tabular-nums sm:text-2xl">{value}</p>
    </div>
  );
}

function Caret() {
  return (
    <m.span
      layoutId="caret"
      className="absolute -left-[2px] top-0 h-full w-[3px] bg-primary"
      transition={{ type: "tween", duration: 0.12, ease: "easeOut" }}
      style={{ animation: "blink 1s ease-in-out infinite" }}
    />
  );
}

const Word = memo(function Word({ text, state, typed }) {
  let content;
  if (state === "active") {
    content = text.split("").map((char, charIndex) => {
      const tc = typed[charIndex];
      const charClass = tc
        ? tc.correct
          ? "text-primary"
          : "text-destructive"
        : "text-muted-foreground/50";
      const isCaret = charIndex === typed.length;
      return (
        <span key={charIndex} className="relative inline-block">
          {isCaret ? <Caret /> : null}
          <span className={charClass}>{char}</span>
        </span>
      );
    });
    if (typed.length === text.length) {
      content = [
        ...content,
        <m.span
          key="end-caret"
          layoutId="caret"
          className="absolute top-0 h-full w-[3px] bg-primary"
          style={{ right: "0.45em", animation: "blink 1s ease-in-out infinite" }}
          transition={{ type: "tween", duration: 0.12, ease: "easeOut" }}
        />,
      ];
    }
  } else if (state === "correct") {
    content = text.split("").map((char, charIndex) => (
      <span key={charIndex} className="text-primary">
        {char}
      </span>
    ));
  } else if (state === "wrong") {
    content = text.split("").map((char, charIndex) => {
      const tc = typed && typed[charIndex];
      const charClass = tc
        ? tc.correct
          ? "text-primary"
          : "text-destructive"
        : "text-muted-foreground/50";
      return (
        <span key={charIndex} className={charClass}>
          {char}
        </span>
      );
    });
  } else {
    content = text.split("").map((char, charIndex) => (
      <span key={charIndex} className="text-muted-foreground/50">
        {char}
      </span>
    ));
  }
  const incompleteWrong = state === "wrong" && typed && typed.length < text.length;
  return (
    <span
      className={`relative inline-block${incompleteWrong ? " underline decoration-destructive decoration-2 underline-offset-4" : ""}`}
    >
      {content}
      <span aria-hidden="true" className="inline-block w-[0.45em]" />
    </span>
  );
});

function FreePlayHeader({ configLabel, gameState, sessionConfig, remaining, run }) {
  return (
    <m.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-between border-b border-border/50 pb-2 sm:pb-4"
    >
      <div>
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Free Play</p>
        <h2 className="mt-1 text-xl font-semibold sm:mt-2 sm:text-3xl">Free Play</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {gameState === "setup" ? "Practice at your own pace" : configLabel}
        </p>
      </div>

      {gameState === "playing" ? (
        sessionConfig.type === "time" ? (
          <div className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 font-mono text-lg font-bold tabular-nums text-primary">
            <FiClock className="h-4 w-4" />
            {remaining}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 font-mono text-lg font-bold tabular-nums text-primary">
            <FiCheck className="h-4 w-4" />
            {run.index} / {sessionConfig.target}
          </div>
        )
      ) : null}
    </m.div>
  );
}

function FreePlaySetupScreen({
  mode,
  setMode,
  timePreset,
  setTimePreset,
  customTime,
  setCustomTime,
  wordsPreset,
  setWordsPreset,
  customWords,
  setCustomWords,
  wordBankReady,
  onStart,
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
          <CardTitle>Configure Session</CardTitle>
        </CardHeader>
        <CardContent className="relative flex flex-1 flex-col justify-center gap-4 py-3 sm:gap-8 sm:py-8">
          <div className="mx-auto flex w-full max-w-sm flex-col gap-3 sm:gap-8">
            <div role="tablist" aria-label="Session type" className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                role="tab"
                aria-selected={mode === "time"}
                variant={mode === "time" ? "default" : "outline"}
                className="h-10 sm:h-12 sm:text-base"
                onClick={() => setMode("time")}
              >
                Time
              </Button>
              <Button
                type="button"
                role="tab"
                aria-selected={mode === "words"}
                variant={mode === "words" ? "default" : "outline"}
                className="h-10 sm:h-12 sm:text-base"
                onClick={() => setMode("words")}
              >
                Words
              </Button>
            </div>

            {mode === "time" ? (
              <div className="space-y-2 sm:space-y-3">
                <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  Duration
                </p>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-col sm:gap-2.5">
                  {TIME_PRESETS.map((seconds) => (
                    <Button
                      key={seconds}
                      type="button"
                      variant={timePreset === seconds ? "default" : "outline"}
                      className={`h-10 w-full justify-center px-2 text-sm sm:h-12 sm:justify-start sm:px-4 sm:text-base ${
                        timePreset === seconds
                          ? ""
                          : "dark:bg-input dark:hover:bg-input hover:scale-[1.02] active:scale-[0.98]"
                      }`}
                      onClick={() => setTimePreset(seconds)}
                    >
                      {seconds}s
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant={timePreset === "custom" ? "default" : "outline"}
                    className={`h-10 w-full justify-center px-2 text-sm sm:h-12 sm:justify-start sm:px-4 sm:text-base ${
                      timePreset === "custom"
                        ? ""
                        : "dark:bg-input dark:hover:bg-input hover:scale-[1.02] active:scale-[0.98]"
                    }`}
                    onClick={() => setTimePreset("custom")}
                  >
                    Custom
                  </Button>
                </div>
                {timePreset === "custom" ? (
                  <Stepper
                    label="Seconds"
                    value={customTime}
                    min={CUSTOM_TIME_MIN}
                    max={CUSTOM_TIME_MAX}
                    step={CUSTOM_TIME_STEP}
                    onChange={setCustomTime}
                    suffix="s"
                  />
                ) : null}
              </div>
            ) : (
              <div className="space-y-2 sm:space-y-3">
                <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  Word count
                </p>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-col sm:gap-2.5">
                  {WORDS_PRESETS.map((count) => (
                    <Button
                      key={count}
                      type="button"
                      variant={wordsPreset === count ? "default" : "outline"}
                      className={`h-10 w-full justify-center px-2 text-sm sm:h-12 sm:justify-start sm:px-4 sm:text-base ${
                        wordsPreset === count
                          ? ""
                          : "dark:bg-input dark:hover:bg-input hover:scale-[1.02] active:scale-[0.98]"
                      }`}
                      onClick={() => setWordsPreset(count)}
                    >
                      {count}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant={wordsPreset === "custom" ? "default" : "outline"}
                    className={`h-10 w-full justify-center px-2 text-sm sm:h-12 sm:justify-start sm:px-4 sm:text-base ${
                      wordsPreset === "custom"
                        ? ""
                        : "dark:bg-input dark:hover:bg-input hover:scale-[1.02] active:scale-[0.98]"
                    }`}
                    onClick={() => setWordsPreset("custom")}
                  >
                    Custom
                  </Button>
                </div>
                {wordsPreset === "custom" ? (
                  <Stepper
                    label="Words"
                    value={customWords}
                    min={CUSTOM_WORDS_MIN}
                    max={CUSTOM_WORDS_MAX}
                    step={CUSTOM_WORDS_STEP}
                    onChange={setCustomWords}
                  />
                ) : null}
              </div>
            )}
          </div>
        </CardContent>
        <div className="relative flex flex-col items-end gap-3 px-5 pb-3 sm:flex-row sm:items-center sm:justify-end sm:px-6 sm:pb-6">
          <Button size="lg" onClick={onStart} disabled={!wordBankReady}>
            Start Free Play
          </Button>
        </div>
      </Card>
    </m.div>
  );
}

function FreePlayCountdownScreen({ countdown, configLabel }) {
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
          <CardTitle className="font-sans">Get Ready</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 py-8 text-center">
          <p className="font-mono text-sm uppercase tracking-[0.15em] text-muted-foreground">
            {configLabel}
          </p>
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

function FreePlayPlayingScreen({
  flowRef,
  scrollOffset,
  words,
  run,
  lineInfo,
  inputRef,
  isCoarsePointer,
  handleInputChange,
  liveWpm,
  liveAccuracy,
  progress,
}) {
  return (
    <m.div
      key="playing"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex min-h-0 flex-1 flex-col gap-4 sm:gap-6"
    >
      <Card className="flex flex-1 items-center justify-center">
        <CardContent className="w-full py-6 sm:py-10">
          <div className="mx-auto w-full max-w-5xl">
            <div
              onClick={() => inputRef.current?.focus()}
              className="relative cursor-text select-none"
            >
              <div
                className="relative overflow-hidden"
                style={{ height: lineInfo.lineHeight ? lineInfo.lineHeight * VISIBLE_LINES : undefined }}
              >
                <m.div
                  ref={flowRef}
                  initial={false}
                  animate={{ y: -scrollOffset }}
                  transition={{ type: "tween", duration: 0.3, ease: "easeOut" }}
                  className="relative font-mono text-2xl leading-[1.7] tracking-wide text-foreground [overflow-wrap:anywhere] sm:text-3xl"
                >
                  {words.map((word, wordIndex) => {
                    let state = "pending";
                    let typedForWord;
                    if (wordIndex === run.index) {
                      state = "active";
                      typedForWord = run.typed;
                    } else if (wordIndex < run.index) {
                      const record = run.records[wordIndex];
                      if (record) {
                        state = record.correct ? "correct" : "wrong";
                        typedForWord = record.typed;
                      }
                    }
                    return (
                      <Word
                        key={wordIndex}
                        text={word}
                        state={state}
                        typed={typedForWord}
                      />
                    );
                  })}
                </m.div>
              </div>

              <input
                ref={inputRef}
                defaultValue=""
                onChange={handleInputChange}
                aria-label="Type here to begin. Letters are compared to the highlighted word."
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="one-time-code"
                spellCheck={false}
                inputMode="text"
                enterKeyHint="go"
                className={
                  isCoarsePointer
                    ? "mt-4 h-11 w-full rounded-md border border-border/70 bg-background px-3 text-base"
                    : "pointer-events-none absolute h-0 w-0 opacity-0"
                }
              />
            </div>

            <p className="sr-only" aria-live="polite">
              {words[run.index] ? `Current word: ${words[run.index]}` : ""}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <div className="flex items-center gap-4">
          <div className="flex shrink-0 items-center gap-3 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
            <span>WPM {Math.round(liveWpm)}</span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">Acc {Math.round(liveAccuracy)}%</span>
          </div>
          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
            <m.div
              className="h-full w-full origin-left rounded-full bg-primary"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: progress }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>
        <p className="text-center font-mono text-xs text-muted-foreground">
          Tab + Enter restart · Double Esc back to setup
        </p>
      </div>
    </m.div>
  );
}

function FreePlayResultsScreen({ configLabel, results, samples, onPlayAgain, onGoToSetup }) {
  return (
    <m.div
      key="finished"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-1 items-start justify-center py-2 sm:py-6"
    >
      <Card className="w-full max-w-lg overflow-hidden">
        <CardHeader className="py-4 text-center">
          <CardTitle className="font-sans text-xl">Session Complete</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{configLabel}</p>
        </CardHeader>
        <CardContent className="space-y-6 py-4">
          <div className="text-center">
            <p className="font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
              Speed
            </p>
            <div className="mt-1 font-sans text-5xl font-bold tabular-nums">
              {results ? Math.round(results.wpm) : 0}
            </div>
            <p className="mt-1 font-mono text-sm text-muted-foreground">wpm</p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Accuracy" value={results ? `${Math.round(results.accuracy)}%` : "–"} />
            <Stat label="Words" value={results ? results.completedWords : "–"} />
            <Stat label="Errors" value={results ? results.wrongChars : "–"} />
            <Stat label="Time" value={results ? formatSeconds(results.elapsed / 1000) : "–"} />
          </div>

          <SessionWpmChart samples={samples} />

          <Button onClick={onPlayAgain} className="w-full gap-2">
            <FiRotateCw className="h-4 w-4" /> Play Again
          </Button>
          <Button variant="outline" onClick={onGoToSetup} className="w-full gap-2">
            <FiArrowLeft className="h-4 w-4" /> Change Mode
          </Button>
          <p className="text-center font-mono text-xs text-muted-foreground">
            Press Enter to play again
          </p>
        </CardContent>
      </Card>
    </m.div>
  );
}

function useFreePlaySession() {
  const isCoarsePointer = useIsCoarsePointer();

  const [mode, setMode] = useState("time");
  const [timePreset, setTimePreset] = useState(30);
  const [customTime, setCustomTime] = useState(30);
  const [wordsPreset, setWordsPreset] = useState(25);
  const [customWords, setCustomWords] = useState(25);

  const [wordBank, setWordBank] = useState([]);
  const [run, setRun] = useState(EMPTY_RUN);
  const [session, dispatch] = useReducer(sessionReducer, SESSION_INITIAL_STATE);
  const { gameState, countdown, words, samples, results, elapsedMs, remaining } = session;

  const inputRef = useRef(null);
  const tickRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const countdownTimeoutRef = useRef(null);
  const countdownRef = useRef(null);
  const startRef = useRef(null);
  const endRef = useRef(null);
  const lastEscRef = useRef(0);
  const tabPressedRef = useRef(false);
  const runRef = useRef(EMPTY_RUN);
  const streamRef = useRef("");
  const flowRef = useRef(null);
  const [lineInfo, setLineInfo] = useState({ starts: [0], lineHeight: 0 });

  const measureLines = useCallback(() => {
    const el = flowRef.current;
    if (!el || el.children.length === 0) return;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 0;
    const starts = [0];
    let prevTop = el.children[0].offsetTop;
    for (let i = 1; i < el.children.length; i += 1) {
      const top = el.children[i].offsetTop;
      if (top !== prevTop) {
        starts.push(i);
        prevTop = top;
      }
    }
    setLineInfo((prev) =>
      prev.starts.length === starts.length && prev.lineHeight === lineHeight
        ? prev
        : { starts, lineHeight }
    );
  }, []);

  useLayoutEffect(() => {
    if (gameState !== "playing") return;
    measureLines();
    const el = flowRef.current;
    if (!el) return;
    const observer = new ResizeObserver(measureLines);
    observer.observe(el);
    return () => observer.disconnect();
  }, [gameState, words, measureLines]);

  const activeLine = useMemo(() => {
    const { starts } = lineInfo;
    let line = 0;
    for (let i = 0; i < starts.length; i += 1) {
      if (run.index >= starts[i]) line = i;
    }
    return line;
  }, [run.index, lineInfo]);

  const scrollOffset =
    lineInfo.lineHeight *
    Math.floor(activeLine / VISIBLE_LINES) *
    VISIBLE_LINES;

  useEffect(() => {
    runRef.current = run;
  }, [run]);

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

  const sessionConfig = useMemo(() => {
    if (mode === "time") {
      const seconds = timePreset === "custom" ? customTime : timePreset;
      return { type: "time", seconds };
    }
    const target = wordsPreset === "custom" ? customWords : wordsPreset;
    return { type: "words", target };
  }, [mode, timePreset, customTime, wordsPreset, customWords]);

  const configLabel = useMemo(
    () =>
      sessionConfig.type === "time"
        ? `${sessionConfig.seconds}s timed`
        : `${sessionConfig.target} words`,
    [sessionConfig]
  );

  const clearSessionTimers = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (countdownTimeoutRef.current) {
      clearTimeout(countdownTimeoutRef.current);
      countdownTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => () => clearSessionTimers(), [clearSessionTimers]);

  const handleFinish = useCallback(() => {
    clearSessionTimers();
    const runNow = runRef.current;
    let correctChars = 0;
    let wrongChars = 0;
    let completed = 0;
    let correctCompleted = 0;
    for (const rec of runNow.records) {
      if (!rec) continue;
      completed += 1;
      let wordCorrect = true;
      for (const tc of rec.typed) {
        if (tc.correct) {
          correctChars += 1;
        } else {
          wrongChars += 1;
          wordCorrect = false;
        }
      }
      if (wordCorrect) correctCompleted += 1;
    }
    const activeWord = words[runNow.index];
    if (activeWord && runNow.typed.length === activeWord.length) {
      completed += 1;
      const wordCorrect = runNow.typed.every((tc) => tc.correct);
      if (wordCorrect) correctCompleted += 1;
      for (const tc of runNow.typed) {
        if (tc.correct) correctChars += 1;
        else wrongChars += 1;
      }
    }
    const elapsed = Date.now() - (startRef.current || Date.now());
    dispatch({
      type: "FINISH",
      elapsed,
      results: {
        wpm: wpmFromChars(correctChars, elapsed),
        accuracy: accuracyFromChars(correctChars, wrongChars),
        completedWords: completed,
        correctCompleted,
        wrongChars,
        elapsed,
      },
    });
  }, [clearSessionTimers, words]);

  const pushSample = useCallback((elapsedMsVal) => {
    dispatch({
      type: "ADD_SAMPLE",
      sample: (() => {
        const second = Math.floor(elapsedMsVal / 1000);
        const runNow = runRef.current;
        let correct = 0;
        for (const rec of runNow.records) {
          if (!rec) continue;
          for (const tc of rec.typed) if (tc.correct) correct += 1;
        }
        for (const tc of runNow.typed) if (tc.correct) correct += 1;
        return { t: second, wpm: wpmFromChars(correct, elapsedMsVal) };
      })(),
    });
  }, []);

  const beginPlaying = useCallback(() => {
    const now = Date.now();
    startRef.current = now;
    endRef.current = sessionConfig.type === "time" ? now + sessionConfig.seconds * 1000 : null;
    if (sessionConfig.type === "time") dispatch({ type: "SET_REMAINING", value: sessionConfig.seconds });

    let lastSampleAt = now;
    tickRef.current = setInterval(() => {
      const tickNow = Date.now();
      const elapsed = tickNow - startRef.current;
      dispatch({ type: "SET_ELAPSED", value: elapsed });

      if (sessionConfig.type === "time") {
        const remainMs = endRef.current - tickNow;
        dispatch({ type: "SET_REMAINING", value: Math.max(0, Math.ceil(remainMs / 1000)) });
        if (remainMs <= 0) {
          handleFinish();
          return;
        }
      }

      if (tickNow - lastSampleAt >= 1000) {
        lastSampleAt = tickNow;
        pushSample(elapsed);
      }
    }, 200);
  }, [sessionConfig, handleFinish, pushSample]);

  const goToSetup = useCallback(() => {
    clearSessionTimers();
    setRun(EMPTY_RUN);
    streamRef.current = "";
    dispatch({ type: "GO_TO_SETUP" });
  }, [clearSessionTimers]);

  const startSession = useCallback(() => {
    clearSessionTimers();
    if (wordBank.length === 0) return;

    const supplySize =
      sessionConfig.type === "time" ? timedSupplySize(sessionConfig.seconds) : sessionConfig.target;
    const supply = pickWords(supplySize, wordBank);

    setRun(EMPTY_RUN);
    streamRef.current = "";
    dispatch({
      type: "START_SESSION",
      words: supply,
      remaining: sessionConfig.type === "time" ? sessionConfig.seconds : 0,
    });

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
          beginPlaying();
          setTimeout(() => inputRef.current?.focus(), 60);
        }, 250);
      } else {
        dispatch({ type: "COUNTDOWN", count: next });
      }
    }, 1000);
    countdownTimerRef.current = countdownTimer;
  }, [sessionConfig, wordBank, clearSessionTimers, beginPlaying]);

  const handleTypeChar = useCallback(
    (char) => {
      if (!char || char === " ") return false;
      const runNow = runRef.current;
      const targetWord = words[runNow.index];
      if (!targetWord) return false;
      if (runNow.typed.length >= targetWord.length) return false;
      const lower = char.toLowerCase();
      const targetChar = targetWord[runNow.typed.length];
      setRun((prev) => ({
        ...prev,
        typed: [...prev.typed, { char: lower, correct: lower === targetChar }],
      }));
      return true;
    },
    [words]
  );

  const handleSpace = useCallback(() => {
    setRun((prev) => {
      if (prev.typed.length === 0) return prev;
      const targetWord = words[prev.index];
      if (!targetWord) return prev;
      const records = [...prev.records];
      const fullyCorrect =
        prev.typed.length === targetWord.length && prev.typed.every((tc) => tc.correct);
      records[prev.index] = { typed: prev.typed, correct: fullyCorrect };
      return { index: prev.index + 1, typed: [], records };
    });
  }, [words]);

  const handleBackspace = useCallback(() => {
    setRun((prev) => {
      if (prev.typed.length > 0) {
        return { ...prev, typed: prev.typed.slice(0, -1) };
      }
      const prevIndex = prev.index - 1;
      if (prevIndex < 0) return prev;
      const prevRecord = prev.records[prevIndex];
      if (!prevRecord || prevRecord.correct) return prev;
      const records = [...prev.records];
      records[prevIndex] = undefined;
      return { index: prevIndex, typed: prevRecord.typed, records };
    });
  }, []);

  const handleShortcutKey = useCallback(
    (event) => {
      if (event.key === "Enter") {
        const targetIsButton =
          event.target instanceof HTMLElement && event.target.closest("button");
        if (!targetIsButton) {
          event.preventDefault();
          startSession();
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        const now = Date.now();
        if (now - lastEscRef.current <= DOUBLE_ESC_WINDOW_MS) {
          lastEscRef.current = 0;
          if (gameState === "finished") {
            startSession();
          } else if (gameState === "playing") {
            goToSetup();
          }
        } else {
          lastEscRef.current = now;
        }
      }
    },
    [gameState, startSession, goToSetup]
  );

  useEffect(() => {
    if (gameState !== "finished") return;
    const handler = (event) => handleShortcutKey(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [gameState, handleShortcutKey]);

  useEffect(() => {
    if (gameState !== "setup") return;
    const handler = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "Enter") {
        const targetIsButton =
          event.target instanceof HTMLElement && event.target.closest("button");
        if (!targetIsButton) {
          event.preventDefault();
          startSession();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [gameState, startSession]);

  useEffect(() => {
    if (gameState !== "playing") return;
    const handler = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        const now = Date.now();
        if (now - lastEscRef.current <= DOUBLE_ESC_WINDOW_MS) {
          lastEscRef.current = 0;
          goToSetup();
        } else {
          lastEscRef.current = now;
        }
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        tabPressedRef.current = true;
        return;
      }
      if (event.key === "Enter") {
        if (tabPressedRef.current) {
          event.preventDefault();
          tabPressedRef.current = false;
          startSession();
        }
        return;
      }
      if (event.target === inputRef.current) return;
      if (event.key === " ") {
        event.preventDefault();
        handleSpace();
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        handleBackspace();
        return;
      }
      if (event.key.length === 1) {
        event.preventDefault();
        handleTypeChar(event.key);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [gameState, handleSpace, handleBackspace, handleTypeChar, goToSetup, startSession]);

  useEffect(() => {
    if (gameState !== "playing" || sessionConfig.type !== "words") return;
    const target = sessionConfig.target;
    if (run.index >= target || (run.index === target - 1 && run.typed.length === words[run.index]?.length)) {
      handleFinish();
    }
  }, [gameState, run, sessionConfig, words, handleFinish]);

  const handleInputChange = useCallback(
    (event) => {
      const newValue = event.target.value;
      const oldValue = streamRef.current;
      if (newValue.length > oldValue.length) {
        const appended = newValue.slice(oldValue.length);
        let rejected = 0;
        for (const char of appended) {
          if (char === " ") handleSpace();
          else if (!handleTypeChar(char)) rejected += 1;
        }
        streamRef.current = newValue.slice(0, newValue.length - rejected);
        event.target.value = streamRef.current;
      } else if (newValue.length < oldValue.length) {
        const removed = oldValue.length - newValue.length;
        for (let i = 0; i < removed; i += 1) handleBackspace();
        streamRef.current = newValue;
      }
    },
    [handleSpace, handleTypeChar, handleBackspace]
  );

  const liveWpm = useMemo(() => {
    let correct = 0;
    for (const rec of run.records) {
      if (!rec) continue;
      for (const tc of rec.typed) if (tc.correct) correct += 1;
    }
    for (const tc of run.typed) if (tc.correct) correct += 1;
    return wpmFromChars(correct, Math.max(elapsedMs, 1));
  }, [run, elapsedMs]);

  const liveAccuracy = useMemo(() => {
    let correct = 0;
    let wrong = 0;
    for (const rec of run.records) {
      if (!rec) continue;
      for (const tc of rec.typed) {
        if (tc.correct) correct += 1;
        else wrong += 1;
      }
    }
    for (const tc of run.typed) {
      if (tc.correct) correct += 1;
      else wrong += 1;
    }
    return accuracyFromChars(correct, wrong);
  }, [run]);

  const progress = useMemo(() => {
    if (sessionConfig.type === "time") {
      return 1 - remaining / Math.max(1, sessionConfig.seconds);
    }
    return Math.min(1, run.index / Math.max(1, sessionConfig.target));
  }, [sessionConfig, remaining, run.index]);

  return {
    isCoarsePointer,
    mode,
    setMode,
    timePreset,
    setTimePreset,
    customTime,
    setCustomTime,
    wordsPreset,
    setWordsPreset,
    customWords,
    setCustomWords,
    wordBank,
    gameState,
    countdown,
    words,
    samples,
    results,
    elapsedMs,
    remaining,
    run,
    sessionConfig,
    configLabel,
    lineInfo,
    scrollOffset,
    inputRef,
    flowRef,
    startSession,
    goToSetup,
    handleInputChange,
    liveWpm,
    liveAccuracy,
    progress,
  };
}

export default function FreePlay() {
  const {
    isCoarsePointer,
    mode,
    setMode,
    timePreset,
    setTimePreset,
    customTime,
    setCustomTime,
    wordsPreset,
    setWordsPreset,
    customWords,
    setCustomWords,
    wordBank,
    gameState,
    countdown,
    words,
    samples,
    results,
    remaining,
    run,
    sessionConfig,
    configLabel,
    lineInfo,
    scrollOffset,
    inputRef,
    flowRef,
    startSession,
    goToSetup,
    handleInputChange,
    liveWpm,
    liveAccuracy,
    progress,
  } = useFreePlaySession();

  return (
    <div className="flex min-h-full flex-col gap-3 sm:gap-6">
      <FreePlayHeader
        configLabel={configLabel}
        gameState={gameState}
        sessionConfig={sessionConfig}
        remaining={remaining}
        run={run}
      />

      <AnimatePresence initial={false} mode="wait">
        {gameState === "setup" ? (
          <FreePlaySetupScreen
            mode={mode}
            setMode={setMode}
            timePreset={timePreset}
            setTimePreset={setTimePreset}
            customTime={customTime}
            setCustomTime={setCustomTime}
            wordsPreset={wordsPreset}
            setWordsPreset={setWordsPreset}
            customWords={customWords}
            setCustomWords={setCustomWords}
            wordBankReady={wordBank.length > 0}
            onStart={startSession}
          />
        ) : null}

        {gameState === "countdown" ? (
          <FreePlayCountdownScreen countdown={countdown} configLabel={configLabel} />
        ) : null}

        {gameState === "playing" ? (
          <FreePlayPlayingScreen
            flowRef={flowRef}
            scrollOffset={scrollOffset}
            words={words}
            run={run}
            lineInfo={lineInfo}
            inputRef={inputRef}
            isCoarsePointer={isCoarsePointer}
            handleInputChange={handleInputChange}
            liveWpm={liveWpm}
            liveAccuracy={liveAccuracy}
            progress={progress}
          />
        ) : null}

        {gameState === "finished" ? (
          <FreePlayResultsScreen
            configLabel={configLabel}
            results={results}
            samples={samples}
            onPlayAgain={startSession}
            onGoToSetup={goToSetup}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}