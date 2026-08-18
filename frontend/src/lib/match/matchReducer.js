export const MATCH_INITIAL_STATE = {
  gameState: "setup",
  countdown: null,
  words: [],
  currentWordIndex: 0,
  opponentWordIndex: 0,
  myScore: 0,
  opponentScore: 0,
  timeLeft: 60,
  input: "",
  connectionError: null,
  opponent: null,
  modeSeconds: 60,
  gameResults: null,
  postMatchRating: null,
  rematchState: "idle",
  incomingRematch: null,
  samples: [],
  results: null,
  elapsedMs: 0,
  remaining: 0,
};

export function buildMatchInitialState(overrides = {}) {
  return { ...MATCH_INITIAL_STATE, ...overrides };
}

export function matchReducer(state, action) {
  switch (action.type) {
    case "CONNECTION_CLEAR":
      return { ...state, connectionError: null };

    case "CONNECTION_ERROR":
      return {
        ...state,
        connectionError: { title: action.title, message: action.message },
        gameState: "error",
      };

    case "SET_GAME_STATE":
      return { ...state, gameState: action.gameState };

    case "MATCH_FOUND":
      return {
        ...state,
        rematchState: "idle",
        incomingRematch: null,
        postMatchRating: null,
        gameState: "countdown",
        modeSeconds: action.modeSeconds,
        opponent: action.opponent,
        input: "",
      };

    case "MATCH_ABORTED":
      return {
        ...state,
        rematchState: "idle",
        incomingRematch: null,
        postMatchRating: null,
        opponent: null,
        input: "",
        gameState: "waiting",
      };

    case "START":
      return {
        ...buildMatchInitialState(),
        gameState: "countdown",
        countdown: 3,
        words: action.words,
        timeLeft: action.modeSeconds,
      };

    case "START_SESSION":
      return {
        ...buildMatchInitialState(),
        words: action.words,
        gameState: "countdown",
        countdown: 3,
        remaining: action.remaining,
      };

    case "GO_TO_SETUP":
      return { ...buildMatchInitialState() };

    case "RESET":
      return { ...buildMatchInitialState(), timeLeft: action.modeSeconds };

    case "COUNTDOWN":
      return { ...state, countdown: action.count };

    case "GO":
      return { ...state, countdown: null, gameState: "playing" };

    case "GAME_START":
      return {
        ...state,
        modeSeconds: action.modeSeconds,
        words: action.words,
        timeLeft: action.timeLeft,
        gameState: "playing",
        countdown: null,
        myScore: 0,
        opponentScore: 0,
        currentWordIndex: 0,
        opponentWordIndex: 0,
        input: "",
      };

    case "PLAYER_PROGRESS":
      return {
        ...state,
        myScore: action.myScore,
        currentWordIndex: action.currentWordIndex,
        opponentScore: action.opponentScore,
        opponentWordIndex: action.opponentWordIndex,
      };

    case "BOT_SCORE":
      return { ...state, opponentScore: state.opponentScore + 1 };

    case "BOT_PROGRESS":
      return { ...state, opponentWordIndex: action.index };

    case "GAME_RESUMED":
      return {
        ...state,
        modeSeconds: action.modeSeconds,
        opponent: action.opponent,
        words: action.words,
        myScore: action.myScore,
        currentWordIndex: action.currentWordIndex,
        opponentScore: action.opponentScore,
        opponentWordIndex: action.opponentWordIndex,
        countdown: action.status === "playing" ? null : state.countdown,
        timeLeft: action.status === "playing" ? action.timeLeft : state.timeLeft,
        gameState:
          action.status === "playing"
            ? "playing"
            : action.status === "countdown"
              ? "countdown"
              : "waiting",
      };

    case "GAME_END":
      return {
        ...state,
        rematchState: "idle",
        incomingRematch: null,
        modeSeconds: action.modeSeconds,
        gameResults: action.results,
        input: "",
        gameState: "finished",
      };

    case "OPPONENT_DISCONNECTED":
      return {
        ...state,
        rematchState: "idle",
        incomingRematch: null,
        postMatchRating: null,
        input: "",
        gameState: "finished",
        gameResults: action.results,
      };

    case "REMATCH_PENDING":
      return { ...state, rematchState: "pending" };

    case "REMATCH_REQUESTED":
      return { ...state, incomingRematch: action.incomingRematch };

    case "REMATCH_DECLINED":
      return { ...state, rematchState: "declined", incomingRematch: null };

    case "REMATCH_TIMEOUT":
      return { ...state, rematchState: "timeout", incomingRematch: null };

    case "REMATCH_UNAVAILABLE":
      return { ...state, rematchState: "unavailable", incomingRematch: null };

    case "SET_REMATCH_STATE":
      return { ...state, rematchState: action.rematchState };

    case "CLEAR_INCOMING_REMATCH":
      return { ...state, incomingRematch: null };

    case "TICK":
      return {
        ...state,
        timeLeft:
          action.timeLeft != null
            ? action.timeLeft
            : state.timeLeft <= 1
              ? 0
              : state.timeLeft - 1,
      };

    case "INPUT":
    case "INPUT_CHANGE":
      return { ...state, input: action.input != null ? action.input : action.value };

    case "SUBMIT":
    case "SUBMIT_SUCCESS":
      return {
        ...state,
        myScore: state.myScore + 1,
        currentWordIndex: Math.min(state.currentWordIndex + 1, state.words.length),
        input: "",
      };

    case "SET_POST_MATCH_RATING":
      return { ...state, postMatchRating: action.postMatchRating };

    case "SET_REMAINING":
      return { ...state, remaining: action.value };

    case "SET_ELAPSED":
      return { ...state, elapsedMs: action.value };

    case "ADD_SAMPLE": {
      const last = state.samples[state.samples.length - 1];
      if (last && last.t === action.sample.t) return state;
      return { ...state, samples: [...state.samples, action.sample] };
    }

    case "FINISH": {
      const updates = { gameState: "finished" };
      if (action.results != null) updates.results = action.results;
      if (action.elapsed != null) updates.elapsedMs = action.elapsed;
      return { ...state, ...updates };
    }

    default:
      return state;
  }
}