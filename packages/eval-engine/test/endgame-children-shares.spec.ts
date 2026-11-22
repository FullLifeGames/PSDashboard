import { readFileSync } from 'node:fs';
import { State } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { flipTurn, recordTurn, type FlipTurn } from '../src/dice/flip';
import { dieKey } from '../src/dice/types';
import { endgameChildren } from '../src/endgame/children';
import { createRootPosition, positionBattle, type SimPosition } from '../src/forward-model';
import { forkBattle } from '../src/forward/position';
import { applyChoice, resolveForcedSwitches } from '../src/forward/switches';
import { loadSimMods } from '../src/forward/sim-mods';
import { cellSeeds } from '../src/search/root-quantile';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 89 (P2, 1.2.0): the share of a flipped child. `pricedGroup` plays the recorded turn once with each chance die answered the
 * other way; the flipped branch is worth the chance of that answer times the chances of the other deciding dice that branch drew.
 * Before P2 it multiplied the recorded chances of every other deciding die, also one the branch never reached: Champions VGC
 * 2682637901 turn 6, a failed second Protect lets Aqua Jet end the game before Volcarona's paralysis die (1 in 8) is rolled, so its share
 * read 7/12 instead of 2/3. `FlippedTurn.drawn` names the dice a flipped branch drew again; the plain path's `delaySplit` prices a split
 * of the faints or the end that the recorded dice explain (a repeated Protect), for the prover's delay rule only.
 */
interface Scene { serialized: string; ruleset: 'champions' | 'standard' }
const scene = (name: string): Scene => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf-8')) as Scene;
const SCENE_1 = ['forced-win/scout-miss-gen9championsvgc2026regmbbo3-2682637901-t6', 'forced-win-delay/champions-vgc-2682637901-t6-bank'];
const OWN = 'move heatwave, move aquajet 1';

/** The position after Raichu's first Protect (sure): Raichu carries the stall volatile, the second Protect rolls one in three. */
async function afterFirstProtect(name: string): Promise<SimPosition> {
  await loadSimMods('gen9championsdoublescustomgame');
  const board = scene(name);
  const root = createRootPosition(board.serialized, board.ruleset);
  return endgameChildren(root, OWN, 'move protect', 6).children[0].position;
}

/** The turn of one cell on its first seed, as the plain path plays it. */
function turnOf(root: SimPosition, p1Choice: string, p2Choice: string, seedIndex = 0): FlipTurn {
  const seed = cellSeeds(root, p1Choice, p2Choice)[seedIndex];
  return {
    fork: () => forkBattle(root, seed),
    play: battle => {
      applyChoice(battle, 'p1', p1Choice);
      applyChoice(battle, 'p2', p2Choice);
      resolveForcedSwitches(battle, seed, { p1: undefined, p2: undefined });
    },
  };
}

describe.each(SCENE_1)('Champions VGC 2682637901 turn 6, the second Protect against Heat Wave and Aqua Jet (%s)', name => {
  test('the failed repeat ends the game before the paralysis die is drawn: its share is 2/3, the shares sum to 1', async () => {
    const child = await afterFirstProtect(name);
    const cell = endgameChildren(child, OWN, 'move protect', 3);
    expect(cell.unpriced).toBe(true);
    const split = cell.delaySplit?.();
    expect(split, 'the recorded dice explain every draw of the cell').toBeTruthy();
    const ended = split!.filter(entry => entry.ended);
    expect(ended).toHaveLength(1);
    expect(ended[0].share).toBeCloseTo(2 / 3, 12);
    expect(split!.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(1, 12);
  });

  test('the flip of the Protect die did not draw the paralysis die, the flip of the paralysis die drew the Protect die', async () => {
    const child = await afterFirstProtect(name);
    // a seed on which the second Protect held and the paralysis die was drawn: the recorded turn names both dice
    const index = cellSeeds(child, OWN, 'move protect').findIndex((_seed, at) => recordTurn(turnOf(child, OWN, 'move protect', at)).dice.length >= 2);
    expect(index, 'a seed where the repeat holds').toBeGreaterThanOrEqual(0);
    const turn = turnOf(child, OWN, 'move protect', index);
    const recorded = recordTurn(turn);
    const kinds = recorded.dice.map(die => die.name.kind);
    expect(kinds).toContain('stalling');
    const stall = recorded.dice.find(die => die.name.kind === 'stalling')!;
    const others = recorded.dice.filter(die => die !== stall);
    expect(others.length).toBeGreaterThan(0);
    const failed = flipTurn(turn, recorded, stall);
    expect(failed.battle.ended).toBe(true);
    expect([...failed.drawn]).not.toContain(others[0].key);
    const turned = flipTurn(turn, recorded, others[0]);
    expect([...turned.drawn]).toContain(dieKey(stall.name));
  });
});

describe('two dice that both fall in every branch keep the product of the other die\'s recorded chance', () => {
  // two bodies that each roll a die of their own in every branch: the share of a flipped branch is its chance times the other die's held chance
  test('a paralysed attacker against a confused one: the flipped shares are other times held, as before P2', async () => {
    await loadSimMods('gen9championsou');
    const snorlax = (moves: string[]) => set('Snorlax', moves, { evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } });
    const battle = battleOf('gen9customgame', [snorlax(['tackle'])], [snorlax(['tackle'])]);
    battle.sides[0].active[0]!.setStatus('par');
    battle.sides[1].active[0]!.addVolatile('confusion');
    const root = createRootPosition(JSON.stringify(State.serializeBattle(battle)), 'standard');
    const turn = turnOf(root, 'move tackle', 'move tackle');
    const recorded = recordTurn(turn);
    const dice = recorded.dice;
    expect(dice.length).toBe(2);
    const [a, b] = dice;
    const expected = [a.held * b.held, a.other * b.held, b.other * a.held].sort((x, y) => x - y);
    const cell = endgameChildren(root, 'move tackle', 'move tackle', 6);
    expect(cell.children.map(child => child.share).sort((x, y) => x - y)).toEqual(expected.map(share => expect.closeTo(share, 12)));
    expect(positionBattle(root).gameType).toBe('singles');
  });
});
