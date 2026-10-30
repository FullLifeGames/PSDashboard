import { describe, expect, test } from 'vitest';
import { replacementRounds } from '../src/replacement-rounds';
import { reconstructWithPoints } from './replacement-points';

/**
 * Round 79 (T290), the sweep of the capture: over the fixture replays (singles of generations 3, 7 and 9, Doubles OU, Scarlet/
 * Violet VGC, Pokémon Champions singles and VGC), every request round the protocol shows meets the capture hook's point of the
 * same turn and ordinal with the same slots and the same species, and the hook fires nowhere else. A round the capture skips is
 * a counted gap whose cause is the simulator's own divergence (the block's alignment missed the faint); the skip rate over the set is bounded.
 */

const FIXTURES: { name: string; kind: 'singles' | 'doubles' | 'vgc' }[] = [
  { name: 'gen9ou-2658662321', kind: 'singles' },
  { name: 'gen3customgame-2115579570', kind: 'singles' },
  { name: 'smogtours-gen7ou-450650', kind: 'singles' },
  { name: 'gen9championsou-2691703002', kind: 'singles' },
  { name: 'champions/gen9championsou-2693832490', kind: 'singles' },
  { name: 'gen9doublesou-2694811367', kind: 'doubles' },
  { name: 'smogtours-gen9doublesou-938640', kind: 'doubles' },
  { name: 'gen9vgc2026regi-2630181744', kind: 'vgc' },
  { name: 'gen9championsvgc2026regmbbo3-2634204248', kind: 'vgc' },
  { name: 'gen9championsvgc2026regmbbo3-2687970740', kind: 'vgc' },
  { name: 'champions/gen9championsvgc2026regmbbo3-2679053861', kind: 'vgc' },
];

/** The highest share of protocol rounds the capture may leave as a gap (measured over this set: 5 of 47 rounds, singles 3 of 31, doubles 1 of 5, VGC 1 of 11). */
const SKIP_BOUND = 0.25;

const tally = { rounds: 0, skipped: 0 };
const byKind: Record<string, { rounds: number; skipped: number }> = {};

describe('the capture hook meets every request round of the protocol', () => {
  test.each(FIXTURES)('$kind $name', { timeout: 480000 }, async ({ name, kind }) => {
    const run = await reconstructWithPoints(name);
    const rounds = replacementRounds(run.replay.log);
    expect(rounds.length).toBeGreaterThan(0);
    const points = new Map(run.points.map(({ point }) => [`${point.turn}.${point.ordinal}`, point]));
    expect(points.size).toBe(run.points.length);
    const roundKeys = new Set(rounds.map(round => `${round.turn}.${round.ordinal}`));
    // The hook fires nowhere the protocol shows no round.
    const extras = [...points.entries()].filter(([key]) => !roundKeys.has(key)).map(([key, point]) => `${key} ${JSON.stringify(point)}`);
    expect(extras, JSON.stringify(rounds.map(round => `${round.turn}.${round.ordinal}`))).toEqual([]);
    let skipped = 0;
    for (const round of rounds) {
      const point = points.get(`${round.turn}.${round.ordinal}`);
      if (!point) {
        // A gap has one cause: the simulator did not play the knockout the protocol shows (the block's hax alignment counts the
        // faint it missed), so no request opens for the player's pick. Never a guess.
        const record = run.runtime.haxAlignment.find(entry => entry.turn === round.turn);
        expect(record?.actual.faintMismatches ?? 0, `${name} turn ${round.turn}: a gap without a missed faint`).toBeGreaterThan(0);
        skipped++;
        continue;
      }
      expect({ forced: point.forced, played: point.played }).toEqual({ forced: round.slots, played: round.species });
    }
    tally.rounds += rounds.length;
    tally.skipped += skipped;
    byKind[kind] = { rounds: (byKind[kind]?.rounds ?? 0) + rounds.length, skipped: (byKind[kind]?.skipped ?? 0) + skipped };
  });

  test('the skip rate over the set stays under the measured bound, singles and doubles apart', () => {
    expect(tally.rounds).toBeGreaterThan(0);
    for (const [kind, counts] of Object.entries(byKind)) {
      expect(counts.skipped / counts.rounds, `${kind}: ${JSON.stringify(counts)}`).toBeLessThanOrEqual(SKIP_BOUND);
    }
    expect(tally.skipped / tally.rounds, JSON.stringify(tally)).toBeLessThanOrEqual(SKIP_BOUND);
  });
});
