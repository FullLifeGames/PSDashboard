---
Status: superseded by ADR 0022 (round 86, T306)
---

# The reconstruction replays choices and picks the simulator's dice by a search over 16 seeds

A replay log holds the results of a game (a miss, a crit, a flinch), but the simulator rolls its own dice when the dashboard rebuilds a turn, so a phantom crit or miss can contaminate the position. A premature end of a game is unhealable, and one seeded crit cost game 653785 two turns. The decision (hax alignment, 15.08.2026): before each turn block commits, the engine trials the block under the pinned seeds of `ALIGNMENT_SEEDS` (16 today) on forks of the battle, scores the emitted events against the protocol block (game end and faint set first, then misses, crits, secondaries, hit counts, `|cant|` reasons, confusion self-hits and move order), and plays the block under the best seed. Candidate 0 (index 0 of `ALIGNMENT_SEEDS`, which must stay `'1,2,3,4'`) runs first and exits early on a perfect match, and the battle is reseeded every turn so that the turns' random streams stay independent. The pick is deterministic: `ALIGNMENT_SEEDS` is a frozen literal, and changing it is a cache-version event. Damage magnitude stays unscored because the boundary snapshots pin HP. Corrections from a snapshot write state directly; round 60 rejected `addSideCondition`, `setWeather` and `setTerrain` because they re-fire events that already ran. In the feedback runs of round 82 the best seed matches the log in 332 of 356 turns (singles 286 of 297, Doubles OU 17 of 25, VGC 29 of 34).

## Considered options

- A scripted or forcing PRNG that answers each die as the log says: rejected in the spec because it patches simulator internals, the order of PRNG calls varies across Gens 3 to 9, and it breaks silently on simulator updates. The dice module of round 82 (ADR 0002) later solved the naming problem by hooks, and a branch's first turn now forces its logged results on top of the seed search. Since round 43 the search scripts dice for a named move through `ScriptedPRNG` to draw an outcome class on demand (see ADR 0009). The round 43 lessons accept it because the simulator has few interception points and each one has a test, and a script is a request: the log still decides the class.
- A hybrid of both: rejected as contradicting the rule to measure first.
- Live dice or random seeds: the reconstruction must stay bit-stable run to run (hax spec, section on determinism), and the feedback harness reads any report difference as "a code change, never noise" (design of 14.08.2026).

## Consequences

Up to 16 trial advances per turn plus the real one. In round 82, the 24 turns without a perfect match carry a result the game did not have until the next snapshot corrects it. T306 (approved at the final gate of round 82, 01.11.2026, built in round 86) replaced the search with forced logged results where the log shows them. ADR 0022 supersedes this ADR: one fixed seed stays for the dice the log hides (damage rolls), and the search over 16 seeds survives as the fallback and as the search for dice no name covers. The text above records the decision of 15.08.2026 as it stood.

Sources: `docs/superpowers/specs/2026-08-15-hax-alignment-design.md` (section 2, approach 1 of 3), `docs/superpowers/plans/2026-08-15-hax-alignment.md`, `docs/superpowers/specs/2026-08-14-feedback-corpus-harness-design.md` (determinism), `docs/superpowers/specs/2026-10-02-round-60-design.md`, `ARCHITECTURE.md`, T306 (booked in `docs/completed/eval-quality.md`), `docs/adr/0002-dice-recognized-by-simulator-hooks.md`; gate 01.11.2026.
