import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { Battle, Teams } from '@pkmn/sim';
import { buildTeamsFromReplay, type SmogonUsageStats } from '@fulllifegames/replay-core';
import { evaluatePosition } from '../src/eval-function';

/**
 * Round 88 (F, #101): the scene that named the round. smogtours-gen4ou-544639 has no team preview and P1 shows 3 of its 6 bodies, so
 * the build gave P1 three bodies and the static evaluation read turn 1 as -0.750, a loss before a move. With the stand-ins (the
 * format's teammate statistics, a slice of the Gen 4 OU file) both sides have six and the read is an even game. A regression scene
 * pin, not an expert pin: it holds the size of the move, not a verdict.
 */
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../test/regression/fixtures/${name}.json`, import.meta.url), 'utf-8'));
const SCENE: string = fixture('smogtours-gen4ou-544639').log;

/** The statistics fixture as the parsed shape the builder reads: the species, their counts and their teammate rows. */
function gen4Stats(): SmogonUsageStats {
  const payload = fixture('stats-gen4ou-trimmed') as { pokemon: Record<string, { count: number; teammates: Record<string, number> }> };
  const pokemon: SmogonUsageStats['pokemon'] = {};
  for (const [name, entry] of Object.entries(payload.pokemon)) {
    pokemon[name.toLowerCase().replace(/[^a-z0-9]/g, '')] = {
      species: name, rawCount: entry.count, abilities: [], items: [], moves: [], spreads: [],
      teammates: Object.entries(entry.teammates).map(([value, probability]) => ({ value, probability, sourceDetail: 'test' })),
    };
  }
  return { format: 'gen4ou', month: 'test', source: 'test', pokemon };
}

function turnOneScore(usageStats: SmogonUsageStats | null): { score: number; p1: number } {
  const { p1Team, p2Team } = buildTeamsFromReplay(SCENE, usageStats ? { usageStats } : {});
  const battle = new Battle({
    formatid: 'gen4ou' as never, seed: [1, 2, 3, 4],
    p1: { name: 'p1', team: Teams.pack(p1Team) }, p2: { name: 'p2', team: Teams.pack(p2Team) },
  });
  return { score: evaluatePosition(battle), p1: p1Team.length };
}

describe('turn 1 of smogtours-gen4ou-544639', () => {
  test('3 bodies against 6 read as a clear loss, 6 against 6 as an even game', () => {
    const short = turnOneScore(null);
    expect(short.p1).toBe(3);
    expect(short.score).toBeLessThan(-0.6);
    const filled = turnOneScore(gen4Stats());
    expect(filled.p1).toBe(6);
    expect(Math.abs(filled.score)).toBeLessThan(0.2);
  });
});
