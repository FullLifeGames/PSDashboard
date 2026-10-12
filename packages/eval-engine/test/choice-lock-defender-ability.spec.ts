import { describe, expect, test } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import { corroborateChoiceItem } from '../src/choice-lock';
import { battleOf } from './power-oracle';
import { set } from './move-oracle';

/**
 * Round 68 (T157): the Choice item check gives the defender the ability it has, not the calc's pick of the species'
 * first (Dragonite's Inner Focus for Multiscale, which halves a hit at full HP). The oracle is the simulator: the
 * damage a Choice Band Garchomp really does to a full-HP Multiscale Dragonite, read as the fraction of its HP. With
 * Multiscale only the Band explains it (the bare hit and the Dragon Fang bluff are too strong or too weak); with Inner
 * Focus on the defender the Band would overshoot and nothing explains it. The check has no game type input: it prices
 * one target with an empty field, so the same hit is read from a singles and a doubles battle.
 */
const garchomp = (): PokemonSet => set('Garchomp', ['dragonclaw', 'splash'], { item: 'Choice Band', ability: 'Rough Skin' });
const dragonite = (ability: string): PokemonSet => set('Dragonite', ['splash'], { ability, item: '' });

/** The fraction of its HP Dragonite loses to Dragon Claw in one real turn, a hit with no critical. */
function dragonClawFraction(format: string): number {
  const doubles = format.includes('doubles');
  const battle = battleOf(format, doubles ? [garchomp(), set('Corviknight', ['splash'])] : [garchomp()],
    doubles ? [dragonite('Multiscale'), set('Corviknight', ['splash'])] : [dragonite('Multiscale')]);
  const target = battle.sides[1].active[0];
  const before = target.hp;
  battle.makeChoices(doubles ? 'move dragonclaw 1, move splash' : 'move dragonclaw', doubles ? 'move splash, move splash' : 'move splash');
  expect(battle.log.join('\n')).not.toMatch(/\|-crit\|/);
  expect(before).toBe(target.maxhp);
  return (before - target.hp) / target.maxhp;
}

const observation = (fraction: number) => [{
  attackerSpecies: 'Garchomp', defenderSpecies: 'Dragonite', attackerSide: 'p1' as const,
  moveId: 'dragonclaw', observedFraction: fraction, lethal: false,
  attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
}];

describe('the defender of the Choice item check has its own ability (T157)', () => {
  for (const format of ['gen9customgame', 'gen9doublescustomgame']) {
    const kind = format.includes('doubles') ? 'doubles' : 'singles';

    test(`${kind}: Dragonite with Multiscale at full HP corroborates the Band the simulator's hit shows`, () => {
      const fraction = dragonClawFraction(format);
      expect(fraction).toBeGreaterThan(0.1);
      const teams = { p1Team: [garchomp()], p2Team: [dragonite('Multiscale')] };
      expect(corroborateChoiceItem('p1', 'Garchomp', 'Choice Band', teams, observation(fraction), 9)).toBe('corroborated');
    });

    test(`${kind}: a defender with no ability on the set ranges the species' abilities, Multiscale among them`, () => {
      const fraction = dragonClawFraction(format);
      const teams = { p1Team: [garchomp()], p2Team: [dragonite('')] };
      expect(corroborateChoiceItem('p1', 'Garchomp', 'Choice Band', teams, observation(fraction), 9)).toBe('corroborated');
    });
  }
});
