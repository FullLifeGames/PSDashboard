---
Status: accepted; round 88 (T314) kept the rule for the evaluation and filters only the bench
---

# A bring-limited game trims both teams to the Pokémon that were brought, or neither

In VGC, Champions VGC and Battle Stadium Singles each player brings a part of the team (four, or three). The replay log shows only the Pokémon that reached the field (the engine calls them bodies). `replayBringOnly` returns a bring list only when both sides fielded all of their brought bodies; otherwise it returns null and both sides stay open, and the reconstruction builds all six. Round 21 (29.08.2026, the gated round A.3c, cache v37 to v38) measured the alternative of trimming each side on its own where its bring is known. It lost: game 2630452654 flipped from 4 of 4 correct to 0 of 4, because a team of four against an open six overrates the open side ("measurement beats theory"). The adopted run changed 35 rows, all in the 7 fully pinned games, with no leak into asymmetric games (byte-identical), sign accuracy 19 to 23 without loss and a paired Brier of 0.21456 to 0.21228. Interactive branches always trim; the sweep and the single evaluation stayed untrimmed until A.3c because they feed the calibration corpora. The branch itself runs on a bring-all base format, a Custom Game or OU format without `maxChosenTeamSize` (probed 05.08.2026), and the app trims the teams before the battle so that the live simulator never switches into a Pokémon that was not brought. The only reason recorded for the Custom Game as base is in T278: a VGC format's team preview keeps only the first four of a team. No source weighs a bring-limited base format against it.

## Considered options

- Trim each side on its own: measured and rejected (above).
- Open games under the current rule: about a fifth to a quarter of the Champions VGC and Scarlet/Violet VGC corpus games stay open (T314 holds the counts), and the bench then offers bodies the side never brought (Champions VGC game 2625939941). T314 weighed three ways out, and round 88 chose (a): (a) a bench-only change that leaves the evaluation as it is, (b) per-side pins that keep and weight the open side's unfielded bodies, (c) a list type of known bodies plus one unknown, with a chance step in the engine.

## Consequences

The rule lives in `replayBringOnly` and `trimTeamToBring`, and the specs `packages/eval-engine/test/bring-limit.spec.ts` and `test/regression/dock-bring-fixture.spec.ts` pin "both sides or neither". Round 88 (T314) chose option (a): `src/lib/bench.ts` filters the What-if bench, the stored positions and the snapshot pickers to the bodies a side brought once that side fielded its whole selection, and the engine and the play-out keep every body the rebuild holds. Option (c), the known bodies plus one unknown in the engine's choices, waits for round 89 (#124); if it lands, this ADR gets the status "superseded by" the ADR of that round.

Sources: `docs/completed/timeline-ux.md` (rounds 20c and 21, 29.08.2026, A.3c), `docs/completed/eval-quality.md` (round 73), `docs/superpowers/plans/2026-08-04-eval-scoring-overhaul.md` (phase G, 05.08.2026), `docs/superpowers/specs/2026-10-21-round-73-wave-5-design.md`, issues #44 (T278) and #55 (T314); gate 02.11.2026.
