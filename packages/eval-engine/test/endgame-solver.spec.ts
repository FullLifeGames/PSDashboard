import { test, expect } from '@playwright/test';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet, PRNGSeed } from '@pkmn/sim';
import { advancePosition, createRootPosition, positionBattle } from '../src/forward-model';
import { endgameKey } from '../src/endgame/key';
import { endgameChildren } from '../src/endgame/children';
import { searchOptions } from '../src/search/options';
import { ENDGAME_CAPS, endgameScope, solveEndgame } from '../src/endgame/solver';
import { createMatchupCache } from '../src/eval-function';
import { leafValue } from '../src/search/leaf';
import { LAST_PAIR_CAP } from '../src/score/last-pair';

function makeSet(
  name: string,
  species: string,
  moves: string[],
  level = 100,
  extras: { item?: string; ability?: string } = {},
): PokemonSet {
  return {
    name, species, item: extras.item ?? '', ability: extras.ability ?? 'No Ability', moves,
    nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level, gender: '',
  };
}

function makeBattle(p1Sets: PokemonSet[], p2Sets: PokemonSet[], formatid = 'gen9customgame'): Battle {
  const battle = new Battle({
    formatid: toID(formatid),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1Sets) },
    p2: { name: 'Beta', team: Teams.pack(p2Sets) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return battle;
}

const serialize = (battle: Battle): string => JSON.stringify(State.serializeBattle(battle));

test.describe('endgame key (round 34)', () => {
  test('two move orders reaching the same board share one key, different PP do not', () => {
    // Setup moves without chance: Iron Defense, Swords Dance, Swords Dance
    // equals Swords Dance, Iron Defense, Swords Dance (same PP, same
    // boosts, same last move, which stays in the key because Choice lock,
    // Encore, and Torment read it); seeds differ on purpose so the key
    // provably ignores the PRNG, the turn counter, and the log.
    const root = createRootPosition(serialize(makeBattle(
      [makeSet('Scizor', 'Scizor', ['Swords Dance', 'Iron Defense'])],
      [makeSet('Magikarp', 'Magikarp', ['Splash'])],
    )));
    const walk = (moves: string[], seeds: PRNGSeed[]) => moves.reduce(
      (position, move, index) => advancePosition(position, `move ${move}`, 'move splash', seeds[index]),
      root,
    );
    const pathA = walk(['irondefense', 'swordsdance', 'swordsdance'], ['1,2,3,4', '5,6,7,8', '9,10,11,12']);
    const pathB = walk(['swordsdance', 'irondefense', 'swordsdance'], ['13,14,15,16', '17,18,19,20', '21,22,23,24']);
    const pathC = walk(['swordsdance', 'swordsdance', 'swordsdance'], ['1,2,3,4', '5,6,7,8', '9,10,11,12']);
    expect(endgameKey(positionBattle(pathA))).toBe(endgameKey(positionBattle(pathB)));
    expect(endgameKey(positionBattle(pathA))).not.toBe(endgameKey(positionBattle(pathC)));
    expect(endgameKey(positionBattle(pathA))).not.toBe(endgameKey(positionBattle(root)));
  });
});

test.describe('endgame children (round 34)', () => {
  test('a deterministic pair yields one child with weight 1 and no unpriced flag', () => {
    // Chansey, not Blissey: Blissey ties Machamp on base speed, which is a
    // priced order split of its own (the next tests cover it).
    const root = createRootPosition(serialize(makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss'])],
      [makeSet('Egg', 'Chansey', ['Soft-Boiled'])],
    )));
    const { children, unpriced } = endgameChildren(root, 'move seismictoss', 'move softboiled');
    expect(children).toHaveLength(1);
    expect(children[0].weight).toBe(1);
    expect(unpriced).toBe(false);
  });
  test('an accuracy roll on a kill splits into miss and hit-kill children with analytic weights', () => {
    const battle = makeBattle(
      [makeSet('Jolt', 'Jolteon', ['Thunder'])],
      [makeSet('Champ', 'Machamp', ['Close Combat'])],
    );
    // Both at 1 HP: Thunder kills on a hit (70 %), Close Combat kills for
    // sure after a miss, so the cell has exactly two classes.
    for (const side of battle.sides) side.active[0]!.sethp(1);
    const { children, unpriced } = endgameChildren(createRootPosition(serialize(battle)), 'move thunder', 'move closecombat');
    expect(unpriced).toBe(false);
    const weights = children.map(child => child.weight).sort((a, b) => a - b);
    expect(weights[0]).toBeCloseTo(0.3, 6);
    expect(weights[1]).toBeCloseTo(0.7, 6);
    expect(children.some(child => child.ended)).toBe(true);
  });
  test('a singles speed tie splits the cell into two order classes of one half each', () => {
    const battle = makeBattle(
      [makeSet('A', 'Machamp', ['Close Combat'])],
      [makeSet('B', 'Machamp', ['Close Combat'])],
    );
    for (const side of battle.sides) side.active[0]!.sethp(1);
    const { children, unpriced } = endgameChildren(createRootPosition(serialize(battle)), 'move closecombat', 'move closecombat');
    expect(unpriced).toBe(false);
    expect(children.map(child => child.weight)).toEqual([0.5, 0.5]);
    const winners = children.map(child => positionBattle(child.position).winner);
    expect(new Set(winners)).toEqual(new Set(['Alpha', 'Beta']));
  });
  test('doubles cells take the plain path and flag unpriced only when the draws disagree on a KO', () => {
    const battle = makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss']), makeSet('Pika', 'Pikachu', ['Tackle'], 5)],
      [makeSet('Blob', 'Blissey', ['Soft-Boiled']), makeSet('Chu', 'Pikachu', ['Tackle'], 5)],
      'gen9doublescustomgame',
    );
    for (const side of battle.sides) side.active[1]!.faint();
    battle.faintMessages();
    const root = createRootPosition(serialize(battle));
    // The first legal option of each side: the solver uses searchOptions, the test only needs one valid pair.
    const p1Choice = searchOptions(root, 'p1', { tera: false })[0].choice;
    const p2Choice = searchOptions(root, 'p2', { tera: false })[0].choice;
    const { children, unpriced } = endgameChildren(root, p1Choice, p2Choice);
    expect(children).toHaveLength(1);
    expect(unpriced).toBe(false);
  });
  test('class children carry their analytic share and key; the plain path says so (round 35)', () => {
    const battle = makeBattle(
      [makeSet('Jolt', 'Jolteon', ['Thunder'])],
      [makeSet('Champ', 'Machamp', ['Close Combat'])],
    );
    // Both at 1 HP like the weights test above: every hit kills, the miss lets Machamp answer.
    for (const side of battle.sides) side.active[0]!.sethp(1);
    const { children, plain } = endgameChildren(createRootPosition(serialize(battle)), 'move thunder', 'move closecombat');
    expect(plain).toBe(false);
    expect(children.map(child => child.key).sort()).toEqual(['p1:hit-kill', 'p1:miss']);
    expect(children.reduce((sum, child) => sum + child.share, 0)).toBeCloseTo(1, 6);
    for (const child of children) expect(child.share).toBeCloseTo(child.weight, 6);
  });
  test('the doubles plain path reports plain with share 1 and no key (round 35)', () => {
    const battle = makeBattle(
      [makeSet('Champ', 'Machamp', ['Seismic Toss']), makeSet('Pika', 'Pikachu', ['Tackle'], 5)],
      [makeSet('Blob', 'Blissey', ['Soft-Boiled']), makeSet('Chu', 'Pikachu', ['Tackle'], 5)],
      'gen9doublescustomgame',
    );
    for (const side of battle.sides) side.active[1]!.faint();
    battle.faintMessages();
    const root = createRootPosition(serialize(battle));
    const p1Choice = searchOptions(root, 'p1', { tera: false })[0].choice;
    const p2Choice = searchOptions(root, 'p2', { tera: false })[0].choice;
    const { children, plain } = endgameChildren(root, p1Choice, p2Choice);
    expect(plain).toBe(true);
    expect(children).toHaveLength(1);
    expect(children[0].share).toBe(1);
    expect(children[0].key).toBeUndefined();
  });
});

const SMALL = { states: 2000, wallMs: 30_000 };

test.describe('endgame solver (round 34)', () => {
  test('a fixed-damage race resolves to the side that needs fewer hits, speed tie or not', () => {
    const battle = makeBattle(
      [makeSet('Toss', 'Machamp', ['Seismic Toss'])],
      [makeSet('Shade', 'Machamp', ['Night Shade'])],
    );
    battle.sides[0].active[0]!.sethp(250);
    battle.sides[1].active[0]!.sethp(200);
    const result = solveEndgame(serialize(battle), SMALL);
    expect(result.scope).toBe(true);
    expect(result.exact).toBe(true);
    expect(result.flags).toEqual([]);
    expect(result.value).toBe(1);
    expect(result.pv[0]).toContain('Seismic Toss');
  });
  test('a speed tie with mutual sure KOs is worth zero', () => {
    const battle = makeBattle(
      [makeSet('A', 'Machamp', ['Close Combat'])],
      [makeSet('B', 'Machamp', ['Close Combat'])],
    );
    for (const side of battle.sides) side.active[0]!.sethp(1);
    const result = solveEndgame(serialize(battle), SMALL);
    expect(result.exact).toBe(true);
    expect(result.value).toBeCloseTo(0, 6);
  });
  test('an accuracy roll prices the kill at its odds', () => {
    const battle = makeBattle(
      [makeSet('Jolt', 'Jolteon', ['Thunder'])],
      [makeSet('Champ', 'Machamp', ['Close Combat'])],
    );
    for (const side of battle.sides) side.active[0]!.sethp(1);
    const result = solveEndgame(serialize(battle), SMALL);
    expect(result.exact).toBe(true);
    expect(result.value).toBeCloseTo(0.4, 6);
  });
  test('the turn cap marks the result capped and inexact', () => {
    const battle = makeBattle(
      [makeSet('Pex', 'Toxapex', ['Recover', 'Toxic'])],
      [makeSet('Zap', 'Zapdos', ['Thunderbolt', 'Roost'])],
    );
    const result = solveEndgame(serialize(battle), { ...SMALL, turns: 1 });
    expect(result.exact).toBe(false);
    expect(result.flags).toContain('capped');
    expect(result.depth).toBe(0);
  });
  test('doubles: one living body per side solves a fixed-damage race exactly', () => {
    const battle = makeBattle(
      [makeSet('Toss', 'Machamp', ['Seismic Toss']), makeSet('Pika', 'Pikachu', ['Tackle'], 5)],
      [makeSet('Shade', 'Machamp', ['Night Shade']), makeSet('Chu', 'Pikachu', ['Tackle'], 5)],
      'gen9doublescustomgame',
    );
    for (const side of battle.sides) side.active[1]!.faint();
    battle.faintMessages();
    battle.sides[0].active[0]!.sethp(250);
    battle.sides[1].active[0]!.sethp(200);
    const result = solveEndgame(serialize(battle), SMALL);
    expect(result.scope).toBe(true);
    expect(result.exact).toBe(true);
    expect(result.value).toBe(1);
  });
  test('two against one terminates within the caps and reports its flags', () => {
    const battle = makeBattle(
      [makeSet('Pex', 'Toxapex', ['Recover', 'Scald']), makeSet('Blob', 'Blissey', ['Soft-Boiled', 'Seismic Toss'])],
      [makeSet('Champ', 'Machamp', ['Close Combat', 'Knock Off'])],
    );
    const result = solveEndgame(serialize(battle), { states: 300, wallMs: 30_000 });
    expect(result.scope).toBe(true);
    expect(Number.isFinite(result.value)).toBe(true);
    expect(Math.abs(result.value)).toBeLessThanOrEqual(1);
    expect(result.states).toBeGreaterThan(0);
    for (const flag of result.flags) expect(['capped', 'unpriced', 'loop']).toContain(flag);
  });
  test('a level gap reads a full win where the last-pair static stops at its cap', () => {
    const battle = makeBattle(
      [makeSet('Champ', 'Machamp', ['Close Combat'])],
      [makeSet('Eevee', 'Eevee', ['Tackle'], 30)],
    );
    expect(leafValue(battle, createMatchupCache())).toBeLessThanOrEqual(LAST_PAIR_CAP + 1e-9);
    const result = solveEndgame(serialize(battle), SMALL);
    expect(result.exact).toBe(true);
    expect(result.value).toBe(1);
  });
  test('scope: four living bodies are out, the default caps are the documented ones', () => {
    const battle = makeBattle(
      [makeSet('A', 'Machamp', ['Close Combat']), makeSet('B', 'Blissey', ['Soft-Boiled'])],
      [makeSet('C', 'Machamp', ['Close Combat']), makeSet('D', 'Blissey', ['Soft-Boiled'])],
    );
    expect(endgameScope(battle)).toBe(false);
    expect(solveEndgame(serialize(battle)).scope).toBe(false);
    expect(ENDGAME_CAPS).toEqual({ turns: 30, states: 20000, wallMs: 120000 });
  });
});
