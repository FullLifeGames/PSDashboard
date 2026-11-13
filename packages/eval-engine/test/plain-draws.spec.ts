import { describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { endgameChildren } from '../src/endgame/children';
import { proveForcedWin } from '../src/endgame/prover';
import { createRootPosition } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import type { StaticRuleset } from '../src/eval-function';
import type { TeraAllowance } from '../src/types';

vi.mock('../src/search/outcome-children', async importOriginal => {
  const real = await importOriginal<typeof import('../src/search/outcome-children')>();
  return { ...real, drawChild: vi.fn(real.drawChild) };
});
import { drawChild } from '../src/search/outcome-children';

/**
 * Round 89 (A5f-5, ruling 20): the plain path of the endgame children (the prover and the endgame solver) reads a damaging pair
 * through several draws of the cell's own seeds and takes their median; a proof books it only when every draw agrees. The count
 * is one table, `PLAIN_DRAWS` in `endgame/children.ts`, and both game types read it. Doubles take five, singles three: A5f-3
 * measured the five on the doubles holdouts (+0.1 to +0.2 % forks per family, 20 of 89 sampled proofs gone, 1 added, 1 of the 3
 * proofs for the side that lost gone), and nobody measured singles. The scenes below are A5f-3's lost proofs: three seeds agree
 * and book mass 1, five do not.
 */
interface Scene {
  id: string;
  turn: number;
  serialized: string;
  tera: TeraAllowance;
  sleepClause: boolean;
  ruleset: StaticRuleset;
  side: 'p1' | 'p2';
  p1Won: boolean;
}
const scene = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as Scene;

function makeSet(name: string, species: string, moves: string[]): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 100, gender: '',
  };
}
function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[], formatid: string): string {
  const battle = new Battle({
    formatid: toID(formatid), seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) }, p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1Sets.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2Sets.map((_, index) => index + 1).join('')}`);
  }
  return JSON.stringify(State.serializeBattle(battle));
}

/** The draws one plain cell takes: drawChild calls per child (a doubles speed tie draws each order apart). */
function drawsOf(serialized: string, p1Choice: string, p2Choice: string): { draws: number; plain: boolean } {
  vi.mocked(drawChild).mockClear();
  const result = endgameChildren(createRootPosition(serialized), p1Choice, p2Choice);
  return { draws: vi.mocked(drawChild).mock.calls.length / result.children.length, plain: result.plain };
}

describe('plain draws of the endgame children (round 89, A5f-5)', () => {
  test('singles: a damaging pair the class plan refuses (Protect) takes three draws, a quiet pair one', () => {
    const serialized = makeBattle([makeSet('Champ', 'Machamp', ['Seismic Toss', 'Splash'])], [makeSet('Egg', 'Chansey', ['Protect', 'Splash'])], 'gen9customgame');
    expect(drawsOf(serialized, 'move seismictoss', 'move protect')).toEqual({ draws: 3, plain: true });
    expect(drawsOf(serialized, 'move splash', 'move splash').draws).toBe(1);
  });

  test('doubles: a damaging pair takes five draws, a quiet pair one', () => {
    const serialized = makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss', 'Splash']), makeSet('Mime', 'Mr. Mime', ['Seismic Toss', 'Splash'])],
      [makeSet('Egg', 'Chansey', ['Pound', 'Splash']), makeSet('Egg2', 'Blissey', ['Pound', 'Splash'])],
      'gen9doublescustomgame',
    );
    expect(drawsOf(serialized, 'move seismictoss 1, move seismictoss 2', 'move pound 1, move pound 2')).toEqual({ draws: 5, plain: true });
    expect(drawsOf(serialized, 'move splash, move splash', 'move splash, move splash').draws).toBe(1);
  });

  // A5f-3 (a5f3-draws.jsonl): the proof below reads mass 1 with three draws and mass 0 with five. The root order is empty, so the
  // prover tries the root candidates in its own odds order; the scenes are the bank's positions as the holdout run builds them.
  // gen9doublesou-2694460841 turn 16: Player 2 proves a win in 1 turn on three draws. gen9vgc2025regi-2391814405 turn 9: Player 2
  // proves a win on three draws and loses the game (one of the three proofs for a losing side that A5f-3 found).
  test.each(['gen9doublesou-2694460841-t16', 'gen9vgc2025regi-2391814405-t9'])('doubles, %s: three agreeing draws prove nothing once five must agree', async name => {
    const board = scene(name);
    await loadSimMods('gen9doublescustomgame');
    const proof = proveForcedWin(board.serialized, { side: board.side, rootOrder: [], tera: board.tera, sleepClause: board.sleepClause, ruleset: board.ruleset });
    expect(proof.mass).toBe(0);
  });
});
