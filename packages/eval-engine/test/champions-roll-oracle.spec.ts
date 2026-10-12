import { describe, expect, test } from 'vitest';
import { Dex, type PokemonSet } from '@pkmn/sim';
import { makePokemonInfo } from '../src/branch/pokemon-info';
import { calcSingleDamageRange } from '../src/damage-calc';
import { positionBattle } from '../src/forward-model';
import { loadSimMods } from '../src/forward/sim-mods';
import { checkedRolls, drawTurn, rollSet, rootOf } from './calc-roll-oracle';

/**
 * Round 68 (T186): the calculator's damage rolls against the simulator on the Champions mod. A turn is drawn under the
 * recording dice (calc-roll-oracle.ts); every hit's kill table, priced from the snapshot the dice took, must hold the damage
 * the log shows at the drawn roll (at least the HP on a kill). Scenes, each in singles and doubles: a full hit, a hit
 * that always crits, a spread move into two foes (doubles: the spread factor; singles: one foe, no spread), Reflect
 * and Light Screen (singles x0.5, doubles x2732/4096, which the calculator reads off the field), and a Mega attacker.
 * The sets hold Stat Points (the mod's statModify), level 50.
 */
await loadSimMods('gen9championsou');

const SP = { hp: 32, atk: 32, def: 0, spa: 32, spd: 0, spe: 0 };
const set = (species: string, moves: string[], extra: Partial<PokemonSet> = {}) => rollSet(species, moves, { evs: SP, ...extra });
const tank = (species: string) => set(species, ['Splash'], { ability: 'No Ability' });

type Game = 'singles' | 'doubles';
const FORMAT = { singles: 'gen9championscustomgame', doubles: 'gen9championsdoublescustomgame' } as const;

interface Scene {
  name: string;
  attacker: () => PokemonSet;
  moveId: string;
  setup?: Parameters<typeof rootOf>[3];
  /** The move's choice text for the attacker's slot (appended after the move id), e.g. 'mega'. */
  suffix?: string;
}

const SCENES: Scene[] = [
  { name: 'a full hit', attacker: () => set('Garchomp', ['Dragon Claw']), moveId: 'dragonclaw' },
  { name: 'a hit that always crits', attacker: () => set('Glaceon', ['Frost Breath']), moveId: 'frostbreath' },
  { name: 'a spread move into the foes', attacker: () => set('Garchomp', ['Rock Slide']), moveId: 'rockslide' },
  {
    name: 'Reflect and Light Screen on the defender\'s side', attacker: () => set('Garchomp', ['Dragon Claw']), moveId: 'dragonclaw',
    setup: battle => { for (const screen of ['reflect', 'lightscreen']) battle.sides[1].addSideCondition(screen, battle.sides[1].active[0]); },
  },
  { name: 'a Mega attacker', attacker: () => set('Garchomp', ['Dragon Claw'], { item: 'Garchompite' }), moveId: 'dragonclaw', suffix: ' mega' },
];

function drawn(game: Game, scene: Scene) {
  const doubles = game === 'doubles';
  const p1 = [scene.attacker(), ...(doubles ? [set('Corviknight', ['Roost'])] : [])];
  const p2 = [tank('Snorlax'), ...(doubles ? [tank('Blissey')] : [])];
  const root = rootOf(FORMAT[game], p1, p2, scene.setup);
  const needsTarget = ['normal', 'any', 'adjacentFoe'].includes(Dex.dexes.champions.moves.get(scene.moveId).target);
  const attackerChoice = `move ${scene.moveId}${doubles && needsTarget ? ' 1' : ''}${scene.suffix ?? ''}`;
  const choice = doubles ? `${attackerChoice}, move roost` : attackerChoice;
  const reply = doubles ? 'move splash, move splash' : 'move splash';
  return { root, hits: checkedRolls(drawTurn(root, choice, reply)) };
}

describe('Champions damage rolls against the simulator (singles and doubles)', () => {
  test('the scenes use moves and items the mod allows', () => {
    const dex = Dex.dexes.champions;
    for (const move of ['dragonclaw', 'frostbreath', 'rockslide', 'reflect', 'lightscreen']) expect(dex.moves.get(move).isNonstandard, move).toBeFalsy();
    expect(dex.items.get('garchompite').exists).toBe(true);
  });

  // Singles' screens halve the damage; the pair plan's kill table prices a doubles field only (singles never ask it), so the
  // singles screen scene runs through the damage preview, which reads the singles field.
  for (const game of ['singles', 'doubles'] as const) {
    for (const scene of SCENES.filter(candidate => game === 'doubles' || candidate !== SCENES[3])) {
      test(`${game}: ${scene.name} lies on the kill table at the drawn roll`, () => {
        const { root, hits } = drawn(game, scene);
        expect(positionBattle(root).dex.currentMod).toBe('champions');
        expect(hits.length, 'a priced hit').toBeGreaterThan(0);
        expect(hits.filter(({ table }) => table === null).length, 'every hit priced').toBe(0);
        expect(hits.filter(({ holds }) => !holds).length, 'hits off the table').toBe(0);
      });
    }
  }

  test('singles: Reflect and Light Screen halve the hit the simulator deals, as the damage preview prices it', () => {
    const scene = SCENES[3];
    const root = rootOf(FORMAT.singles, [scene.attacker()], [tank('Snorlax')], scene.setup);
    const battle = positionBattle(root);
    const [attacker, target] = [battle.sides[0].active[0], battle.sides[1].active[0]];
    const option = { name: 'Dragon Claw', activeSlot: 0, slot: 1, pp: 1, maxpp: 1, disabled: false, type: 'Dragon', targetType: 'normal', requiresTarget: false, targetOptions: [] };
    const priced = calcSingleDamageRange(makePokemonInfo(attacker), makePokemonInfo(target), option, { gameType: 'Singles', gen: 9, defenderSideConditions: ['reflect', 'lightscreen'] });
    const before = target.hp;
    battle.choose('p1', 'move dragonclaw');
    battle.choose('p2', 'move splash');
    const loss = before - target.hp;
    const [min, max] = [priced.minPercent * target.maxhp / 100, priced.maxPercent * target.maxhp / 100];
    expect(loss, `simulator loss ${loss}, preview ${priced.range}`).toBeGreaterThanOrEqual(min - 1);
    expect(loss, `simulator loss ${loss}, preview ${priced.range}`).toBeLessThanOrEqual(max + 1);
    const bare = calcSingleDamageRange(makePokemonInfo(attacker), makePokemonInfo(target), option, { gameType: 'Singles', gen: 9 });
    expect(priced.maxPercent, 'the screens change the price').toBeLessThan(bare.maxPercent);
  });

  test('doubles: the spread move is priced as a spread hit on both foes', () => {
    const { hits } = drawn('doubles', SCENES[2]);
    expect(hits.length).toBe(2);
    expect(hits.every(({ roll }) => roll.snapshot.spreadHit)).toBe(true);
  });
});
