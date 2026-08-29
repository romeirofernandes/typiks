# ADR-0009: Shared Client-Side Typing Engine — Free Play as First Consumer

Status: Accepted
Date: 2026-08-17
Author: Romeiro Fernandes

## Context & Problem Statement

An architecture review while building Free Play surfaced that the typing loop — word rendering, input sanitizing, submit/advance keys, character correctness, caret — was duplicated inline in `BotMode.jsx`, `Game.jsx`, and `CreateRoom.jsx` with no importable engine. Free Play (`/freeplay`, `CONTEXT.md` "Free Play") would have been the fourth copy, and unlike the other modes it is character-level (letters color as you type, space always advances) rather than whole-word submit with `nextWordCondition` (`auto`/`space`/`enter`). The review concluded the duplication no longer made sense.

Without extraction, Free Play would become copy #4, and any bug in scoring or word-list seeding (`backend/src/utils/wordGenerator.js` seeded `seed` per `games.seed` / `matches.seed`) would need four fixes. The engine also must respect `spec.md §3.4` — D1 is not an event stream — so it must remain ephemeral (no per-keystroke writes).

## Decision

Extract a **shared, purely client-side typing engine** before building Free Play, and make Free Play its first consumer (`4405bab`).

- Engine covers word-list preloading, the word renderer (`TypingWordDisplay` / `WordDisplay`), input advance/scoring, and the character-level correctness model.
- Free Play uses it exclusively as the reference implementation — monkeytype-inspired, timed (15/30/60 s + custom 15–120 s) or words (10/25/50 + custom 10–100), setup → countdown → typing → results, ephemeral per `CONTEXT.md` Session definition.
- The other three modes (`BotMode`, `Game`, `CreateRoom` private rooms) migrate gradually outside this feature, keeping the change reviewable.
- The engine is frontend-only and ephemeral by design — Free Play persists nothing, stores no personal bests, and discards state on refresh (unlike ranked modes which persist via ADR-0010).

## Alternatives Considered & Trade-offs

- **Copy the BotMode pattern once more for Free Play**: Rejected — consumer #4 makes eventual consolidation costlier, and the engine would still need to absorb Free Play's character-level behavior anyway. Four copies guarantee four diverging bugs.
- **Backend-driven typing engine (validate each keystroke in `GameRoom`)**: Ensures anti-cheat on every character, but writes per keystroke to a Durable Object and potentially D1, violating `spec.md §3.4`. Rejected: Free Play is solo and pressure-free by definition; ranked modes already validate at match-end via ADR-0010.
- **Extract after Free Play**: Build Free Play as a copy, then refactor. Rejected — the API would be shaped by whole-word behavior first and retrofitting character-level would be a breaking change to three consumers.

Trade-off accepted: the engine's API is shaped by character-level typing first (Free Play), so whole-word modes must later adapt to it rather than the reverse. In return, future fixes (word rendering, `generateWords` seeding) land once.

## Consequences

*Positive:*
- One source of truth for render/input/scoring; `WordDisplay` fixes propagate to all modes.
- Free Play's ephemeral contract (`CONTEXT.md` "Sessions are purely client-side and ephemeral — a refresh discards them") is enforced by having no TanStack Query or D1 path for its `Session`.
- The `words.json` word bank and `randomRange`/`buildWordBank` utilities are shared, not duplicated per mode.

*Negative:*
- The other three modes still carry legacy inline loops until migrated — temporary duplication.
- The engine is deliberately overfitted to character-level first; `nextWordCondition` (`auto` vs `space`) must be reintroduced as a configuration knob for the whole-word consumers.

## Related Decisions

- DEPENDS ON [ADR-0005] — per-mode stats (`userModeStats.modeSeconds`) already exist, so Free Play can deliberately *not* write to them without confusion.
- Complements ADR-0004 — real-time typing in ranked/private rooms stays in Durable Objects, while this ADR isolates solo typing entirely to the client (no WS, no DO).
- REFINED BY future per-mode migrations (not yet ADRed) — this ADR is the first step of a multi-pass consolidation.
