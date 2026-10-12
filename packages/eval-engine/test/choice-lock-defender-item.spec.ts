import { describe, expect, test } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import type { OpponentTeamInfo, RevealedPokemonInfo } from '@fulllifegames/replay-core';
import { corroborateChoiceItem } from '../src/choice-lock';
import { battleOf } from './power-oracle';
import { set } from './move-oracle';

/**
 * Round 69 (T193, decision 37): the Choice item check gives the defender an item range, not the empty item. A Choice
 * Specs hit into an Assault Vest holder (a Choice Band hit into an Eviolite holder) looks like "no Choice item" to a
 * calc that strips the defender's item: the 1.5 of the Choice item and the 1.5 of the bulk item cancel, and the bare
 * hit fits the observation. The oracle is the simulator: the damage the hit really does, read as the fraction of the
 * defender's HP. The item range is the item the log showed alone, else the built item or none, minus the items the log
 * ruled out. A range with both the bulk item and none explains the hit under the Choice item (with the bulk item) and
 * under the bare rival (without it): ambiguous, never contradicted. The check has no game type input, so the singles
 * and the doubles battle hand it the same function.
 */
interface Scene { attacker: () => PokemonSet; move: string; defender: (item: string) => PokemonSet; bulkItem: string; choice: string }
const SCENES: Record<string, Scene> = {
  'Choice Specs into Assault Vest': {
    attacker: () => set('Latios', ['psychic', 'splash'], { item: 'Choice Specs', ability: 'Levitate' }),
    move: 'psychic', bulkItem: 'Assault Vest', choice: 'Choice Specs',
    defender: item => set('Corviknight', ['tackle'], { item, ability: 'Pressure' }),
  },
  'Choice Band into Eviolite': {
    attacker: () => set('Garchomp', ['dragonclaw', 'splash'], { item: 'Choice Band', ability: 'Sand Veil' }),
    move: 'dragonclaw', bulkItem: 'Eviolite', choice: 'Choice Band',
    defender: item => set('Dusclops', ['tackle'], { item, ability: 'Pressure' }),
  },
};

/** The fraction of its HP the defender holding `item` loses to the move in one real turn, a hit with no critical. */
function hitFraction(format: string, scene: Scene, item: string): number {
  const doubles = format.includes('doubles');
  const partner = () => set('Blissey', ['splash'], { ability: 'Natural Cure' });
  const battle = battleOf(format, doubles ? [scene.attacker(), partner()] : [scene.attacker()],
    doubles ? [scene.defender(item), partner()] : [scene.defender(item)]);
  const target = battle.sides[1].active[0];
  const before = target.hp;
  battle.makeChoices(doubles ? `move ${scene.move} 1, move splash` : `move ${scene.move}`, doubles ? 'move tackle 1, move splash' : 'move tackle');
  expect(battle.log.join('\n')).not.toMatch(/\|-crit\|/);
  expect(before).toBe(target.maxhp);
  return (before - target.hp) / target.maxhp;
}

const observation = (scene: Scene, fraction: number) => [{
  attackerSpecies: scene.attacker().species, defenderSpecies: scene.defender('').species, attackerSide: 'p1' as const,
  moveId: scene.move, observedFraction: fraction, lethal: false,
  attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
}];

/** The inference of the defender's side: what the log showed of its item and what it ruled out. */
function defenderInfo(scene: Scene, item: { value: string; source: 'revealed' | 'guessed' | 'unknown' }, ruledOut: string[] = []): Record<'p1' | 'p2', OpponentTeamInfo> {
  const field = (value: string, source: string) => ({ value, source, probability: 1 }) as RevealedPokemonInfo['item'];
  const mon = {
    species: scene.defender('').species, moves: [], ability: field('', 'unknown'), item: field(item.value, item.source), teraType: field('', 'unknown'),
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, level: 100, gender: '', ruledOut: { abilities: [], items: ruledOut },
  } as unknown as RevealedPokemonInfo;
  return { p1: { pokemon: [] }, p2: { pokemon: [mon] } };
}

describe('the defender of the Choice item check has an item range (T193)', () => {
  for (const format of ['gen9customgame', 'gen9doublescustomgame']) {
    const kind = format.includes('doubles') ? 'doubles' : 'singles';
    for (const [name, scene] of Object.entries(SCENES)) {
      const check = (defender: PokemonSet, defenders?: Record<'p1' | 'p2', OpponentTeamInfo>) => corroborateChoiceItem(
        'p1', scene.attacker().species, scene.choice, { p1Team: [scene.attacker()], p2Team: [defender] },
        observation(scene, hitFraction(format, scene, scene.bulkItem)), 9, undefined, defenders);

      test(`${kind}: ${name}, a defender built with the bulk item leaves the Choice item standing (ambiguous, not contradicted)`, () => {
        expect(hitFraction(format, scene, scene.bulkItem)).toBeGreaterThan(0.05);
        expect(check(scene.defender(scene.bulkItem))).toBe('ambiguous');
      });

      test(`${kind}: ${name}, a defender built with no item keeps the item-less reading`, () => {
        expect(check(scene.defender(''))).toBe('contradicted');
      });

      test(`${kind}: ${name}, the item the log showed is the only one the defender gets`, () => {
        const shownBulk = defenderInfo(scene, { value: scene.bulkItem, source: 'revealed' });
        expect(check(scene.defender('Leftovers'), shownBulk)).toBe('corroborated');
        const shownOther = defenderInfo(scene, { value: 'Leftovers', source: 'revealed' });
        expect(check(scene.defender(scene.bulkItem), shownOther)).toBe('contradicted');
      });

      test(`${kind}: ${name}, an item the log ruled out leaves the range`, () => {
        const ruled = defenderInfo(scene, { value: '', source: 'unknown' }, [scene.bulkItem.toLowerCase().replace(/ /g, '')]);
        expect(check(scene.defender(scene.bulkItem), ruled)).toBe('contradicted');
        const open = defenderInfo(scene, { value: '', source: 'unknown' });
        expect(check(scene.defender(scene.bulkItem), open)).toBe('ambiguous');
      });
    }
  }
});
