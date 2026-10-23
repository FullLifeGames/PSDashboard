import { readFileSync } from 'node:fs';
import { Battle } from '@pkmn/client';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import './champions-mod';

/**
 * Round 69 (T188, decision 33): the protocol parser and the inference's own client walk build their client battle on the
 * Generations of the log's format. A Champions log names Mega formes the default Dex hides as non-standard (Absol-Mega-Z,
 * Meganium-Mega, ...); the client threw "reading 'abilities'" / "'types'" at the Pressure carrier or the Mega target and the
 * line was skipped (275 lines in the round-67 capture). The logs are real Champions battles: singles, singles with a
 * Mega-Z, and VGC doubles.
 */
const read = (path: string): string => (JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as { log: string }).log;
const LOGS = {
  'singles (Meganium-Mega, Absol-Mega-Z)': read('../../eval-engine/test/fixtures/champions/gen9championsou-2693832490.json'),
  'singles (Mega formes)': read('../../../e2e-feedback/fixtures/gen9championsou-2628340185.json'),
  'doubles (VGC Reg M-B, no Mega on the field)': read('../../eval-engine/test/fixtures/champions/gen9championsvgc2026regmbbo3-2679053861.json'),
  'doubles (VGC Reg M-B, Scovillain-Mega and Meganium-Mega)': read('./fixtures/champions-vgc-2679899667.json'),
} as const;

afterEach(() => vi.restoreAllMocks());

describe('a Champions log parses without a skipped line', () => {
  for (const [name, log] of Object.entries(LOGS)) {
    test(name, () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      parseReplayLogWithObservations(log);
      const skipped = warn.mock.calls.map(call => String(call[0]) + String(call[1])).filter(text => text.includes('skipping unparseable'));
      expect(skipped).toEqual([]);
    });
  }
});

describe('the inference walk applies the lines the parser applies', () => {
  for (const [name, log] of Object.entries(LOGS)) {
    test(`${name}: the client battle of the hits walk throws on no line, from either side`, () => {
      const original = Battle.prototype.add;
      const thrown: string[] = [];
      Battle.prototype.add = function (this: Battle, ...args: Parameters<Battle['add']>) {
        try {
          return original.apply(this, args);
        } catch (error) {
          thrown.push(`${String(args[0])}: ${(error as Error).message}`);
          throw error;
        }
      } as typeof original;
      try {
        for (const side of ['p1', 'p2'] as const) inferOpponentTeam(log, side);
      } finally {
        Battle.prototype.add = original;
      }
      expect(thrown).toEqual([]);
    });
  }

  test('a hit into a Mega target is recorded (singles, Absol-Mega-Z hits Meganium-Mega)', () => {
    const info = inferOpponentTeam(LOGS['singles (Meganium-Mega, Absol-Mega-Z)'], 'p2');
    const absol = info.pokemon.find(mon => /^Absol/.test(mon.species));
    expect(absol?.hits?.some(hit => hit.defender.species === 'Meganium-Mega')).toBe(true);
  });
});
