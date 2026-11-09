# One timeline holds the replay and at most one variation, and exactness is the app's job

Replay view and branch mode are one mode, as in a chess engine: the replay is the main line, a position pointer (`viewTurn` plus `viewLine`) says where the user stands, and at most one variation exists at a time (user gate 28.08.2026, move-input variant B, the picker always visible). Deviating follows chess rules: shortening inside the variation is silent, replacing it from the main line asks first. Returning to the main line is one click and destroys nothing. The user can evaluate any position on either line and let the engine play a position out. Two scoping decisions came with it. A variation tree with several branches at once is a non-goal. And the button "Rebuild exact position" (an exact position is one rebuilt in the simulator; a snapshot is the approximation the parser records each turn) went away in round 18b, on the user's objection that once branching and simulator are married the exactness of a position is not the user's concern: every reconstruction that runs through the app feeds a session store keyed by replay, turn and sets fingerprint, the analysis sweep streams its boundary positions into it, a pointer that rests for a short dwell (`useEvalAcquire.ts`) on a main-line turn without a known exact position reconstructs it in the background, and the branch panel upgrades in place from snapshot to the exact position. Every deviation funnels through one path: chess rules, then the proven rebuild, then the move. Round 84 replaced the branch panel's Basic and Advanced modes with the turn dock.

## Considered options

- Move-input variants A and C of the mockup of 28.08.2026: the user chose B, the picker always visible (the spec section "Zugeingabe" holds the alternatives).
- Several variations at once: a stated non-goal; the sources give no cost for it.
- Reviving a live simulator from serialized positions (approach C of the spec): the spec's non-goal ("the live simulator arises only through the proven reconstruction plus replaying the history"), now superseded by `adoptSerializedRuntime` (`usePositionSource.ts`, `branch/adopt.ts`): the position source adopts a serialized runtime.
- A branch edit as a patch of the live simulator: rejected in the design of 31.07.2026 for hypothetical moves, because it bypasses PP and disable bookkeeping; the rebuild path already exists and keeps the history (see ADR 0001).

## Consequences

Four kinds of deviation exist (open, extend, truncate, replace), and a variation ends in three ways. A confirm appears only when the user replaces a variation from the main line.

Sources: `docs/superpowers/specs/2026-08-28-unified-timeline-design.md` (Ziel, Nicht-Ziele, Nachtrag 2; gate 28.08.2026), `docs/superpowers/plans/2026-08-28-unified-timeline.md`, `docs/superpowers/specs/2026-07-31-sets-io-dropdowns-hypothetical-moves-design.md`, `docs/superpowers/specs/2026-11-01-round-84-turn-dock-design.md`, `docs/completed/timeline-ux.md` (rounds 17 to 21), `ARCHITECTURE.md`.
