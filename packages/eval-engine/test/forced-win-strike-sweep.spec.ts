import { State, type Battle } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { sureStrike } from '../src/endgame/prover-strike';
import { createRootPosition, legalChoices, positionBattle } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import { boundaryEvent } from '../src/ko-odds';
import { mon, playClicks, seedOf, standing, type Mode, type Rules } from './dice-fixtures';
import { dexOfRules, SWEEP_CASES, sweepMoves } from './dice-sweep-support';
import { battleOf } from './power-oracle';
import { rulesetOf } from './forced-win-delay-support';

/**
 * Round 89 (P3, 1.2.0): the sure strike against the simulator, in every rule set the corpus plays (Gens 1 to 9 and the Champions mod),
 * singles and doubles. The board: the foe's last body stands at 1 HP behind a Tackle and a Splash and outruns the attacker; the attacker
 * clicks one move of the Dex with positive priority. The oracle plays that turn on 20 seeds (6 without `DICE_SWEEPS=full`): the strike
 * exists exactly where every game ends before the foe moves. Rules that stop a priority move (Psychic Terrain, Dazzling, a move that
 * fails after the first turn, a Focus Sash, an immune target, a Quick Claw that lets the foe go first) are rows of their own, and the
 * strike is never offered where the simulator stops it. Generations 1 and 2 have no kill odds in the model (`boundaryEvent` returns
 * null there), so no strike is offered and the oracle's rows only count what the model leaves out.
 */
await loadSimMods('gen9championsou');

const SEEDS = process.env.DICE_SWEEPS === 'full' ? 20 : 6;
const foeClick = (mode: Mode): string => (mode === 'singles' ? 'move 1' : 'move 1 1');
const AIMED = new Set(['normal', 'any', 'adjacentFoe']);
const ownClick = (mode: Mode, target: string): string => (mode === 'singles' ? 'move 1' : `move 1${AIMED.has(target) ? ' 1' : ''}, move 1`);

interface Foe { species: string; moves?: string[]; item?: string; ability?: string; maxHp?: boolean }
interface Own { species: string; moves: string[] }

/** The attacker leads side p1, the foe's last body leads side p2 (in doubles the foe's partner has fallen and the attacker's partner splashes). */
function board(rules: Rules, mode: Mode, own: Own, foe: Foe, seed: string, prepare: (battle: Battle) => void = () => undefined): Battle {
  const attacker = mon(rules, { species: own.species, moves: own.moves, gender: 'M' });
  const target = { ...mon(rules, { species: foe.species, moves: foe.moves ?? ['tackle', 'splash'] }), ...(foe.item ? { item: foe.item } : {}), ...(foe.ability ? { ability: foe.ability } : {}) };
  const one = [attacker];
  const two = [target];
  if (mode === 'doubles') {
    one.push(mon(rules, { species: 'Blissey', moves: ['splash'] }));
    two.push(mon(rules, { species: 'Chansey', moves: ['splash'] }));
  }
  const battle = battleOf(mode === 'singles' ? rules.singles : rules.doubles!, one, two, seed);
  const body = battle.sides[1].active[0]!;
  if (foe.maxHp) body.maxhp = 1;
  body.hp = 1;
  if (mode === 'doubles') {
    const partner = battle.sides[1].pokemon[1];
    partner.hp = 0;
    partner.fainted = true;
    partner.faint();
    battle.sides[1].pokemonLeft--;
    battle.sides[1].faintedThisTurn = null;
  }
  prepare(battle);
  return battle;
}

/** The simulator: the share of the seeds on which the attacker's turn ends the game before the foe moves. */
function endsBeforeFoe(build: (seed: string) => Battle, own: string, foe: string): { ended: number; refused: boolean } {
  let ended = 0;
  for (let index = 0; index < SEEDS; index++) {
    const battle = build(seedOf(index));
    try {
      playClicks(battle, { p1: own, p2: foe });
    } catch {
      return { ended: 0, refused: true };
    }
    const foeMoved = battle.log.some(line => /^\|move\|p2[ab]:/.test(line));
    if (battle.ended && battle.winner === battle.sides[0].name && !foeMoved) ended++;
  }
  return { ended, refused: false };
}

/** The strike the prover offers on a board: the first of the legal choices that the strike rule takes (null when none). */
function offered(battle: Battle, rules: Rules): string | null {
  const position = createRootPosition(JSON.stringify(State.serializeBattle(battle)), rulesetOf(rules));
  const live = standing(positionBattle(position));
  const strike = sureStrike(position, 'p1', legalChoices(position, 'p1', { tera: false }), false);
  expect(standing(positionBattle(position)), 'the question leaves the live battle as it was').toBe(live);
  return strike?.choice ?? null;
}

/** Whether the model prices the attacker's move at the foe as a sure kill (the generations before 3 and the unpriceable moves: no). */
function sureKill(battle: Battle, moveId: string): boolean {
  const event = boundaryEvent(battle, battle.sides[0].active[0]!, battle.sides[1].active[0]!, moveId);
  return event !== null && event.pKill === 1;
}

type Kind = 'moves' | 'items' | 'abilities' | 'species';
const SLOW = { species: 'Snorlax' };
const FAST_FOE: Foe = { species: 'Pikachu' };

describe.each(SWEEP_CASES)('the sure strike, every move with positive priority: $name', ({ rules, mode }) => {
  const dex = dexOfRules(rules);
  const { moves } = sweepMoves(rules, move => move.priority > 0, false);

  test('the rule set has moves with positive priority', () => {
    expect(moves.length).toBeGreaterThan(0);
  });

  test.each(moves.map(move => move.id))('%s: offered exactly where the simulator ends the game before the foe moves', id => {
    const target = dex.moves.get(id).target;
    const own = ownClick(mode, target);
    const build = (seed: string) => board(rules, mode, { ...SLOW, moves: [id, 'splash'] }, FAST_FOE, seed);
    const strike = offered(build('1,2,3,4'), rules);
    const played = endsBeforeFoe(build, own, foeClick(mode));
    const everySeed = !played.refused && played.ended === SEEDS;
    if (strike !== null) {
      expect(everySeed, `${id} is offered, so every seed must end the game before the foe moves (${played.ended} of ${SEEDS})`).toBe(true);
      expect(sureKill(build('1,2,3,4'), id), 'the strike rests on a priced sure kill').toBe(true);
    } else if (everySeed && sureKill(build('1,2,3,4'), id)) {
      expect.fail(`${id} ends every game before the foe moves and the model prices a sure kill, yet no strike is offered`);
    }
  });
});

describe.each(SWEEP_CASES.filter(({ rules }) => rules.generation >= 3))('what stops a priority move: $name', ({ rules, mode }) => {
  const dex = dexOfRules(rules);
  const has = (kind: Kind, id: string): boolean => dex[kind].get(id).exists;
  const quick = { ...SLOW, moves: ['quickattack', 'splash'] };

  test('control: Quick Attack at the foe\'s last body at 1 HP is a strike and the simulator agrees', () => {
    const build = (seed: string) => board(rules, mode, quick, FAST_FOE, seed);
    expect(offered(build('1,2,3,4'), rules)).not.toBeNull();
    expect(endsBeforeFoe(build, ownClick(mode, 'normal'), foeClick(mode)).ended).toBe(SEEDS);
  });

  const stops: { name: string; needs: [Kind, string][]; own?: Own; foe: Foe; prepare?: (battle: Battle) => void }[] = [
    { name: 'Psychic Terrain under a grounded foe', needs: [['moves', 'psychicterrain']], foe: FAST_FOE, prepare: battle => void battle.field.setTerrain('psychicterrain', battle.sides[0].active[0]!) },
    { name: 'a foe with Dazzling', needs: [['abilities', 'dazzling'], ['species', 'bruxish']], foe: { species: 'Bruxish', ability: 'dazzling' } },
    { name: 'a first-turn move on the second turn (First Impression)', needs: [['moves', 'firstimpression']], own: { ...SLOW, moves: ['firstimpression', 'splash'] }, foe: FAST_FOE, prepare: battle => void (battle.sides[0].active[0]!.activeMoveActions = 2) },
    { name: 'a Focus Sash at full HP', needs: [['items', 'focussash']], foe: { ...FAST_FOE, item: 'focussash', maxHp: true } },
    { name: 'a Ghost foe, immune to Normal', needs: [['moves', 'quickattack']], foe: { species: 'Gengar' } },
  ];
  test.each(stops.filter(stop => stop.needs.every(([kind, id]) => has(kind, id))))('$name: no strike, and the simulator ends no game before the foe moves', stop => {
    const build = (seed: string) => board(rules, mode, stop.own ?? quick, stop.foe, seed, stop.prepare);
    const click = ownClick(mode, 'normal');
    expect(endsBeforeFoe(build, click, foeClick(mode)).ended, 'the rule stops the move on every seed').toBe(0);
    expect(offered(build('1,2,3,4'), rules)).toBeNull();
  });

  test('a body that outruns the foe with a plain move is a strike, and a Quick Claw (the foe may move first on some seeds) takes it away', () => {
    if (!has('items', 'quickclaw')) return;
    // Strength, not Tackle: Tackle misses one time in twenty in Generations 3 and 4, and a miss is no sure kill
    const own: Own = { species: 'Pikachu', moves: ['strength', 'splash'] };
    const slowFoe: Foe = { species: 'Snorlax' };
    const plain = (seed: string) => board(rules, mode, own, slowFoe, seed);
    expect(offered(plain('1,2,3,4'), rules)).not.toBeNull();
    expect(endsBeforeFoe(plain, ownClick(mode, 'normal'), foeClick(mode)).ended).toBe(SEEDS);
    const claw = (seed: string) => board(rules, mode, own, { ...slowFoe, item: 'quickclaw' }, seed);
    expect(offered(claw('1,2,3,4'), rules)).toBeNull();
  });
});
