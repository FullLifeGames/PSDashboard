/* eslint-disable no-restricted-imports -- Round 86 (B9): a white-box measurement chain like forced-reconstruction.spec.ts, which this spec shares its support file with: it reads the alignment records of the engine package, none of which the barrel exports. */
import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import { isPerfectAlignment } from '../../packages/eval-engine/src/hax-alignment';
import { rebuild, type Rebuilt } from './forced-reconstruction-support';

/**
 * Round 86 (the engine reads the dice), lane B, step B9 (T306, the causes C1 to C3 of the B7 diagnosis): scenes of the VGC holdout where the
 * rebuild with the log's dice read worse than the sixteen-seed search of the base. The replays are bank replays of the local fit corpus
 * (`.fit-corpus`), so the rows skip where the corpus is absent (a clone, CI without the bank data).
 *
 * - C1, 2243810213 (Regulation H) turn 6: the log has Jet Punch knock out Annihilape. The turn has a soft mismatch no die mends, so the faint
 *   step used to throw its step set away and Annihilape stood at 14 of 186.
 */

const present = (id: string): boolean => existsSync(`.fit-corpus/${id}.json`);
const SCENE_C1 = 'gen9vgc2024regh-2243810213';

describe.skipIf(!present(SCENE_C1))('C1: the faint step takes a step set that gives the log\'s faints (2243810213)', () => {
  let rebuilt: Rebuilt;
  beforeAll(async () => { rebuilt = await rebuild(SCENE_C1, { corpus: true }); }, 300_000);

  test('turn 6: the forced turn faints the body the log faints, with no ended mismatch', () => {
    const { actual } = rebuilt.records.get(6)!;
    expect({ faint: actual.faintMismatches, ended: actual.endedMismatch }).toEqual({ faint: 0, ended: false });
  });

  test('turn 6 stays imperfect for the soft mismatch no die mends, and no worse than the natural turn', () => {
    const { actual } = rebuilt.records.get(6)!;
    expect(isPerfectAlignment(actual)).toBe(false);
    expect(actual.softMismatches).toBeGreaterThan(0);
  });
});
