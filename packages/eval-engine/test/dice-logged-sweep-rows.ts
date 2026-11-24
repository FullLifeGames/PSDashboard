import { writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { hitsIn as hitsOfDex } from '../src/dice/chain';
import { secondariesIn } from '../src/dice/secondaries';
import type { Mode, Rules } from './dice-fixtures';
import { dexOfRules, picksOne, sweepMoves, SWEEP_CASES, type DexMove } from './dice-sweep-support';
import { clickedOf, moveScene, scan, witnessesWanted, type Scan, type Scene } from './dice-logged-sweep-support';

export const WANT = witnessesWanted();
export const summaries: string[] = [];

export function writeSummaries(part?: string): void {
  const logPath = process.env.DICE_SWEEP_LOG;
  if (logPath) writeFileSync(part ? `${logPath}.${part}` : logPath, summaries.join('\n') + '\n', 'utf8');
}

// A move aimed at a random foe in doubles picks its target from the stream; the alignment reads bodies by
// side and species, so two foes of one species hide the difference and the sweep leaves these moves out.
const randomAim = (mode: Mode, move: DexMove): boolean => mode === 'doubles' && picksOne(move.target);
export const GAPS: { cause: string; moves: string[]; modes: Mode[] }[] = [
  { cause: 'the power Present picks (damage or a heal) is a draw no kind of die names, so the other seed can pick another power than the log shows', moves: ['present'], modes: ['singles', 'doubles'] },
  { cause: 'a secondary that picks its status (the die names the chance, the pick follows the stream)', moves: ['triattack', 'direclaw'], modes: ['singles', 'doubles'] },
];

const gapped = (mode: Mode, id: string): boolean => GAPS.some(gap => gap.modes.includes(mode) && gap.moves.includes(id));
const lowAccuracy = (move: DexMove): boolean => typeof move.accuracy === 'number' && move.accuracy < 100;

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

const KINDS = {
  accuracy: { keep: (move: DexMove) => lowAccuracy(move), channels: ['misses'] },
  crit: { keep: (move: DexMove) => move.category !== 'Status', channels: ['crits'] },
} as const;

const CRIT_DOUBLES_A = ['Champions', 'Gen 8', 'Gen 5', 'Gen 4'];
type SweepCase = typeof SWEEP_CASES[number];
export const CRIT_CASES: Record<'singles' | 'doublesA' | 'doublesB', SweepCase[]> = {
  singles: SWEEP_CASES.filter(entry => entry.mode === 'singles'),
  doublesA: SWEEP_CASES.filter(entry => entry.mode === 'doubles' && CRIT_DOUBLES_A.includes(entry.rules.name)),
  doublesB: SWEEP_CASES.filter(entry => entry.mode === 'doubles' && !CRIT_DOUBLES_A.includes(entry.rules.name)),
};

export function registerKindRows(cases: SweepCase[], kinds: (keyof typeof KINDS)[]): void {
  describe.each(cases)('the logged accuracy and crit dice give the log\'s turn: $name', ({ rules, mode }) => {
    const dex = dexOfRules(rules);
    const options = (move: DexMove) => ({ clicked: clickedOf(move.id, mode), secondariesOf: secondariesIn(dex), hitsOf: hitsOfDex(dex) });

    for (const kind of kinds) {
      const spec = KINDS[kind];
      test(`${kind}: every move that draws one`, () => {
        const result = sweepMovesOf(kind, rules, mode, spec.keep, move => moveScene(rules, mode, move, { channels: spec.channels, kind, pool: kind === 'crit' ? 40 : undefined, options: options(move) }));
        expect(result.failures).toEqual([]);
        expect(result.witnesses, 'the sweep found a seed pair the log repairs').toBeGreaterThan(0);
        expect(result.named, 'the log names the die').toBeGreaterThan(0);
      });
    }
  });
}
