import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { Battle, PRNG, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet, PRNGSeed } from '@pkmn/sim';
import { proveForcedWin } from '../src/endgame/prover';
import { createRootPosition, legalChoices } from '../src/forward-model';
import { deserializeBattleExact } from '../src/forward/serialize';
import { MIN_FORCED_MASS, type TeraAllowance } from '../src/types';

/**
 * Round 64 (T118): the prover's AND node reads every legal reply of the
 * defending side. In doubles the tree keeps 12 to 16 combos by static
 * hints; a proof against that list held at VGC 2630685175 turn 7 (12 of 36
 * replies, none with Zamazenta's Protect) and at 2660809089 turn 8 (12 of
 * 42), and the simulator refutes both. Boards: the app's build of the
 * feedback game and the bank's build (probe docs/perf/probes/2026-10-06-r64/
 * lanes/A/proof-census.vt.ts), with the root order the search ranked.
 */
interface Scene {
  id: string;
  turn: number;
  serialized: string;
  tera: TeraAllowance;
  sleepClause: boolean;
  side: 'p1' | 'p2';
  rootOrder: string[];
}

const scene = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as Scene;

const SEEDS: PRNGSeed[] = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];

/** Turns in which `choice` ends the game for p1 against `reply`, over five seeds. */
function p1WinsThisTurn(serialized: string, choice: string, reply: string): number {
  return SEEDS.filter(seed => {
    const battle = deserializeBattleExact(serialized);
    battle.prng = new PRNG(seed);
    battle.choose('p1', choice);
    battle.choose('p2', reply);
    return battle.ended && battle.winner === battle.sides[0].name;
  }).length;
}

function makeSet(name: string, species: string, moves: string[]): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 100, gender: '',
  };
}

function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[], formatid: string): Battle {
  const battle = new Battle({
    formatid: toID(formatid),
    seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1Sets.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2Sets.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

/** Two Machamp tossing two 1-HP Chansey, each Chansey with three single-target attacks: 36 legal p2 combos, no escape. */
function tossPair(): string {
  const battle = makeBattle(
    [makeSet('Champ', 'Machamp', ['Seismic Toss']), makeSet('Champ2', 'Machamp', ['Seismic Toss'])],
    [makeSet('Egg', 'Chansey', ['Pound', 'Scratch', 'Tackle']), makeSet('Egg2', 'Chansey', ['Pound', 'Scratch', 'Tackle'])],
    'gen9doublescustomgame',
  );
  for (const mon of battle.sides[1].pokemon) mon.hp = 1;
  return JSON.stringify(State.serializeBattle(battle));
}

describe('forced-win prover: every reply of the defending side (round 64, T118)', () => {
  test('doubles, VGC 2630685175 turn 7: the Wood Hammer and Earth Power line proves nothing, since Zamazenta\'s Protect escapes it', () => {
    const board = scene('gen9vgc2026regi-2630685175-t7');
    const root = createRootPosition(board.serialized);
    const replies = legalChoices(root, 'p2', { tera: board.tera });
    expect(replies).toHaveLength(36);
    const line = 'move woodhammer 1, move earthpower 2';
    expect(board.rootOrder[0]).toBe(line);
    // The simulator: Wood Hammer takes Calyrex-Shadow, Earth Power hits Zamazenta's Protect, and the game goes on.
    const protect = replies.find(reply => reply.label === 'Astral Barrage + Protect');
    expect(protect).toBeDefined();
    expect(p1WinsThisTurn(board.serialized, line, protect!.choice)).toBe(0);
    const proof = proveForcedWin(root, { side: 'p1', rootOrder: board.rootOrder, tera: board.tera, sleepClause: board.sleepClause });
    expect(proof.mass).toBe(0);
    expect(proof.cells).toBeGreaterThanOrEqual(replies.length);
  });

  test('doubles, 2660809089 turn 8: Knock Off and Heat Wave prove nothing against the 42 legal replies', () => {
    const board = scene('gen9doublesou-2660809089-t8');
    const root = createRootPosition(board.serialized);
    const replies = legalChoices(root, 'p1', { tera: board.tera });
    expect(replies).toHaveLength(42);
    const proof = proveForcedWin(root, { side: 'p2', rootOrder: board.rootOrder, tera: board.tera, sleepClause: board.sleepClause });
    expect(proof.mass).toBe(0);
    expect(proof.cells).toBeGreaterThanOrEqual(replies.length);
  });

  test('doubles: a one-turn win proves against every legal reply, and the cell budget counts them all', () => {
    const serialized = tossPair();
    const replies = legalChoices(createRootPosition(serialized), 'p2', { tera: false });
    expect(replies).toHaveLength(36);
    const request = { side: 'p1' as const, rootOrder: ['move seismictoss 1, move seismictoss 2'], tera: false };
    const proof = proveForcedWin(serialized, request);
    expect(proof.mass).toBe(1);
    expect(proof.turns).toBe(1);
    expect(proof.cells).toBeGreaterThanOrEqual(replies.length);
    // What does not fit the budget proves nothing: 40 cells hold the tree's 12 combos, not the 36 legal replies.
    expect(proveForcedWin(serialized, { ...request, budget: { cells: 40 } }).mass).toBeLessThan(MIN_FORCED_MASS);
  });

  test('singles: the defender keeps the engine\'s list, so a Stealth Rock that fails into standing rocks draws no cell', () => {
    const battle = makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss'])],
      [makeSet('Egg', 'Chansey', ['Splash', 'Stealth Rock'])],
      'gen9customgame',
    );
    battle.sides[0].addSideCondition('stealthrock', 'debug');
    battle.sides[1].pokemon[0].hp = 1;
    const serialized = JSON.stringify(State.serializeBattle(battle));
    expect(legalChoices(createRootPosition(serialized), 'p2', { tera: false })).toHaveLength(2);
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: ['move seismictoss'], tera: false });
    expect(proof.mass).toBe(1);
    expect(proof.cells).toBe(1);
  });
});
