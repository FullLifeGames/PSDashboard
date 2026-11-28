import { readFileSync } from 'node:fs';
import { State } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { flipTurn, recordTurn } from '../src/dice/flip';
import { dieKey } from '../src/dice/types';
import { endgameChildren } from '../src/endgame/children';
import { createRootPosition, positionBattle, type SimPosition } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import { cellSeeds } from '../src/search/root-quantile';
import { CHAMPIONS, RULES } from './dice-fixtures';
import { dexOfRules } from './dice-sweep-support';
import { chancesOf, missOf, PP_LISTS, stalledCell, turnOf, WELL_UNDER_100 } from './forced-win-delay-support';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

interface Scene { serialized: string; ruleset: 'champions' | 'standard' }
const scene = (name: string): Scene => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf-8')) as Scene;
const SCENE_1 = ['forced-win/scout-miss-gen9championsvgc2026regmbbo3-2682637901-t6', 'forced-win-delay/champions-vgc-2682637901-t6-bank'];
const OWN = 'move heatwave, move aquajet 1';

async function afterFirstProtect(name: string): Promise<SimPosition> {
  await loadSimMods('gen9championsdoublescustomgame');
  const board = scene(name);
  const root = createRootPosition(board.serialized, board.ruleset);
  return endgameChildren(root, OWN, 'move protect', 6).children[0].position;
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

const sum = (shares: number[]): number => shares.reduce((total, share) => total + share, 0);
const sorted = (shares: number[]): number[] => [...shares].sort((a, b) => a - b);

describe.each(['singles', 'doubles'] as const)('the second Protect against a move that can miss, a foe at 1 HP (%s)', mode => {
  const rules = RULES.find(entry => entry.generation === 9 && entry !== CHAMPIONS)!;
  const strike = missOf(rules, mode, WELL_UNDER_100)!;

  test('from every base draw the split reads held, failed and hit, failed and missed, by the recorded chances', () => {
    let split = 0;
    for (const pp of PP_LISTS) {
      const cell = stalledCell(rules, mode, strike, 'protect', pp);
      const children = endgameChildren(cell.root, cell.own, cell.foe);
      if (!children.unpriced) continue;
      const read = children.delaySplit?.();
      expect(read, `own PP ${pp.own}, foe PP ${pp.foe}: the recorded dice explain every draw`).toBeTruthy();
      const { hold, hit } = chancesOf(cell);
      expect(sorted(read!.map(child => child.share)), `own PP ${pp.own}, foe PP ${pp.foe}`)
        .toEqual(sorted([hold, (1 - hold) * hit, (1 - hold) * (1 - hit)]).map(share => expect.closeTo(share, 12)));
      expect(sum(read!.filter(child => child.ended).map(child => child.share))).toBeCloseTo((1 - hold) * hit, 12);
      split++;
    }
    expect(split, 'cells whose draws disagree').toBeGreaterThan(0);
  });
});

describe('a flipped miss that reaches a die the recorded turn never drew', () => {
  const accuracy = (rules: typeof CHAMPIONS, id: string): number => (dexOfRules(rules).moves.get(id).accuracy as number) / 100;

  test('Champions OU 2691886974 turn 22, singles: the Triple Axel miss lets the 90 % Draco Meteor roll, so its branch splits 0.9 and 0.1', async () => {
    await loadSimMods('gen9championsou');
    const board = scene('forced-win/tripleaxel-miss-gen9championsou-2691886974-t22');
    const root = createRootPosition(board.serialized, board.ruleset);
    const cell = endgameChildren(root, 'move tripleaxel', 'move dracometeor', 6);
    const triple = accuracy(CHAMPIONS, 'tripleaxel');
    const draco = accuracy(CHAMPIONS, 'dracometeor');
    expect(cell.children.reduce((total, child) => total + child.share, 0)).toBeCloseTo(1, 12);
    expect(sum(cell.children.filter(child => child.ended).map(child => child.share))).toBeCloseTo((1 - triple ** 3) * draco, 12);
  });

  test('Champions VGC 2679036012 turn 6, doubles: the High Horsepower miss lets Heat Wave roll its accuracy, so its branch splits', async () => {
    await loadSimMods('gen9championsdoublescustomgame');
    const board = scene('forced-win/highhorsepower-miss-gen9championsvgc2026regmbbo3-2679036012-t6');
    const root = createRootPosition(board.serialized, board.ruleset);
    const cell = endgameChildren(root, 'move highhorsepower 2, move psychocut 2', 'move heatwave', 6);
    const turned = cell.children.filter(child => child.turned);
    const miss = 1 - accuracy(CHAMPIONS, 'highhorsepower');
    expect(turned.length).toBeGreaterThan(1);
    expect(Math.max(...turned.map(child => child.share)), 'no answer of the branch carries the whole miss').toBeLessThan(miss);
    expect(sum(turned.map(child => child.share))).toBeLessThanOrEqual(miss + 1e-12);
    expect(sum(cell.children.map(child => child.share))).toBeLessThanOrEqual(1 + 1e-12);
  });
});
