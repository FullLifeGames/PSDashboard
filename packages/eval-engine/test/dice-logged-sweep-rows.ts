import { writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { hitsIn as hitsOfDex } from '../src/dice/chain';
import { secondariesIn } from '../src/dice/secondaries';
import type { Mode, Rules } from './dice-fixtures';
import { dexOfRules, picksOne, sweepMoves, SWEEP_CASES, type DexMove } from './dice-sweep-support';
import { clickedOf, moveScene, scan, witnessesWanted, type Scan, type Scene } from './dice-logged-sweep-support';

/**
 * D9b (#125): what the five specs of the logged sweep share. `dice-logged-sweep.spec.ts` (accuracy and the small groups),
 * `dice-logged-crit-doubles-a.spec.ts`, `dice-logged-crit-doubles-b.spec.ts`, `dice-logged-crit-singles.spec.ts` and
 * `dice-logged-secondary.spec.ts` hold the rows of the former one file under the same titles; the doubles crits of the 18 cases
 * (`SWEEP_CASES`) split in two halves by their measured time, and a rule set that joins `RULES` lands in the second half.
 * The scene helpers and the scan live in `dice-logged-sweep-support.ts`; the rest of the old file's top is here.
 */
export const WANT = witnessesWanted();
export const summaries: string[] = [];

/** Writes the summaries of a spec where `DICE_SWEEP_LOG` points (the main spec there, a part of the split beside it with its own suffix). */
export function writeSummaries(part?: string): void {
  const logPath = process.env.DICE_SWEEP_LOG;
  if (logPath) writeFileSync(part ? `${logPath}.${part}` : logPath, summaries.join('\n') + '\n', 'utf8');
}

/**
 * A move aimed at a random foe in doubles (Thrash, Struggle): the simulator picks the target from the stream (a `pick` of the census, out
 * of the module's scope) and the log names the one it picked. A forced turn on another seed can hit the other foe; the alignment reads
 * bodies by side and species, so two foes of one species hide the difference and the sweep leaves these moves out.
 */
const randomAim = (mode: Mode, move: DexMove): boolean => mode === 'doubles' && picksOne(move.target);
/**
 * The moves the full sweep (`DICE_SWEEPS=full`, 04.11.2026) found that `loggedDice` cannot repeat, each group with its cause. The main rows leave
 * them out; one known row per group plays them and stays red until the reader (B3, lane B's files) or a die (lane A's files) covers the cause.
 * Names stand here because the sweep's oracle is the simulator's own log of each move; the code that fixes a cause reads the Dex, not these ids.
 */
export const GAPS: { cause: string; moves: string[]; modes: Mode[] }[] = [
  { cause: 'the power Present picks (damage or a heal) is a draw no kind of die names, so the other seed can pick another power than the log shows', moves: ['present'], modes: ['singles', 'doubles'] },
  { cause: 'a secondary that picks its status (the die names the chance, the pick follows the stream)', moves: ['triattack', 'direclaw'], modes: ['singles', 'doubles'] },
];

/** Whether the move is a gap of this game type (a gap may hold in singles and stay open in doubles). */
const gapped = (mode: Mode, id: string): boolean => GAPS.some(gap => gap.modes.includes(mode) && gap.moves.includes(id));
const lowAccuracy = (move: DexMove): boolean => typeof move.accuracy === 'number' && move.accuracy < 100;

/** What a block of a case counted, for the log and the census. */
export function total(label: string, moves: number, scans: Scan[]): Scan {
  const sum: Scan = { scanned: 0, skipped: 0, witnesses: 0, named: 0, rollFaints: 0, failures: [], why: {} };
  for (const entry of scans) {
    sum.scanned += entry.scanned; sum.skipped += entry.skipped; sum.witnesses += entry.witnesses; sum.named += entry.named; sum.rollFaints += entry.rollFaints;
    for (const [reason, count] of Object.entries(entry.why)) sum.why[reason] = (sum.why[reason] ?? 0) + count;
    sum.failures.push(...entry.failures);
  }
  summaries.push(`${label}: ${moves} moves, ${scans.length} played, ${sum.witnesses} witnesses (${sum.named} name the kind), ${sum.rollFaints} faints of the damage roll, ${sum.failures.length} failures, left out ${JSON.stringify(sum.why)}`);
  return sum;
}

/** Plays every move of a list through `sceneOf` and checks that the forced turn gives the log's turn. */
export function sweepMovesOf(
  label: string, rules: Rules, mode: Mode, keep: (move: DexMove) => boolean, sceneOf: (move: DexMove) => Scene | null, foesOnly = true, withGaps = false,
): Scan {
  const { moves } = sweepMoves(rules, move => keep(move) && !randomAim(mode, move) && (withGaps || !gapped(mode, move.id)), foesOnly);
  const scans: Scan[] = [];
  const failures: string[] = [];
  for (const move of moves) {
    const scene = sceneOf(move);
    if (!scene) continue;
    const result = scan(scene, WANT);
    scans.push(result);
    failures.push(...result.failures.map(failure => `${move.id} ${failure}`));
  }
  const sum = total(`${label} ${rules.name} ${mode}`, moves.length, scans);
  sum.failures = failures;
  return sum;
}

/** The cases of a block: the rule sets and game types, and whether the rule set has the moves at all. */
const KINDS = {
  accuracy: { keep: (move: DexMove) => lowAccuracy(move), channels: ['misses'] },
  crit: { keep: (move: DexMove) => move.category !== 'Status', channels: ['crits'] },
} as const;

/** The rule sets whose doubles crits `dice-logged-crit-doubles-a.spec.ts` plays (about 660 of the 1,200 s under `DICE_SWEEPS=full`); the other doubles cases are part b's. */
const CRIT_DOUBLES_A = ['Champions', 'Gen 8', 'Gen 5', 'Gen 4'];
type SweepCase = typeof SWEEP_CASES[number];
export const CRIT_CASES: Record<'singles' | 'doublesA' | 'doublesB', SweepCase[]> = {
  singles: SWEEP_CASES.filter(entry => entry.mode === 'singles'),
  doublesA: SWEEP_CASES.filter(entry => entry.mode === 'doubles' && CRIT_DOUBLES_A.includes(entry.rules.name)),
  doublesB: SWEEP_CASES.filter(entry => entry.mode === 'doubles' && !CRIT_DOUBLES_A.includes(entry.rules.name)),
};

/** The rows of one kind (accuracy or crit) over a list of cases, under the title the old file gave both kinds. */
export function registerKindRows(cases: SweepCase[], kinds: (keyof typeof KINDS)[]): void {
  describe.each(cases)('the logged accuracy and crit dice give the log\'s turn: $name', ({ rules, mode }) => {
    const dex = dexOfRules(rules);
    const options = (move: DexMove) => ({ clicked: clickedOf(move.id, mode), secondariesOf: secondariesIn(dex), hitsOf: hitsOfDex(dex) });

    for (const kind of kinds) {
      const spec = KINDS[kind];
      test(`${kind}: every move that draws one`, () => {
        // a crit comes once in 16 to 24 draws: its seeds scan wider than the other kinds'
        const result = sweepMovesOf(kind, rules, mode, spec.keep, move => moveScene(rules, mode, move, { channels: spec.channels, kind, pool: kind === 'crit' ? 40 : undefined, options: options(move) }));
        expect(result.failures).toEqual([]);
        expect(result.witnesses, 'the sweep found a seed pair the log repairs').toBeGreaterThan(0);
        // a crit the other seed shows against a hit the log missed has no crit die in the log: the log names it where the move hit
        expect(result.named, 'the log names the die').toBeGreaterThan(0);
      });
    }
  });
}
