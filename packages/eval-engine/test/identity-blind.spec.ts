import { describe, expect, test } from 'vitest';
import { inferOpponentTeam } from '@fulllifegames/replay-core';
import { expectNameBlind, replays } from './identity-blind-support';
import { loadSimMods } from '../src/forward/sim-mods';

await loadSimMods('gen9championsou');

const KEPT: ReadonlyArray<readonly [tag: string, shares: readonly number[]]> = [
  ['gen9ou-2658662321', [0.2, 0.5, 0.8]],
  ['smogtours-gen9doublesou-938276', [0.3, 0.7]],
  ['gen9vgc2026regi-2630181744', [0.3]],
  ['champions-vgc-2679899667', [0.3, 0.7]],
];
const TAGS = KEPT.map(([tag]) => tag);
const SWEEP = replays().filter(entry => TAGS.includes(entry.tag));

describe('the engine reads a position the same with every name the species and no shiny body', () => {
  test('the kept replays cover singles, doubles, VGC and Champions VGC with nicknamed and shiny bodies', () => {
    expect(SWEEP.map(entry => entry.tag).sort()).toEqual([...TAGS].sort());
    const formats = SWEEP.map(entry => entry.replay.format);
    expect(formats.some(format => /Doubles/.test(format))).toBe(true);
    expect(formats.some(format => /VGC/.test(format) && !/Champions/.test(format))).toBe(true);
    expect(formats.some(format => /Champions/.test(format) && /VGC/.test(format))).toBe(true);
    expect(formats.some(format => /\] OU$/.test(format))).toBe(true);
    const mons = SWEEP.flatMap(entry => (['p1', 'p2'] as const).flatMap(side => inferOpponentTeam(entry.replay.log, side).pokemon));
    expect(mons.some(mon => mon.nickname !== undefined)).toBe(true);
    expect(mons.some(mon => mon.shiny === true)).toBe(true);
  });

  test.each(SWEEP.map(entry => [entry.tag, entry.replay] as const))('%s: the turn analysis does not change', { timeout: 600_000 }, async (tag, replay) => {
    await expectNameBlind(replay, KEPT.find(([kept]) => kept === tag)![1]);
  });
});
