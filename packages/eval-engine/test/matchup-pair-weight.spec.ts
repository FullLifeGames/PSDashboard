import { describe, expect, test } from 'vitest';
import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { createMatchupCache } from '../src/eval-function';
import { matchupTerms } from '../src/score/matchup';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * T248 (round 73), the matchup slope (gen9vgc-2629703929 turn 13, 1.2e-3 of the grade for every point of Koraidon's HP
 * in a 1v1 it loses): the pair verdict was weighted by both bodies' HP shares, so a lost pair counted less the lower
 * the loser's HP and a hit you took raised the matchup, and the won pair counted less the lower the foe's HP. The
 * bodies term cannot cancel that in a small board. The pair now weighs the HP of the side that wins it. This file holds
 * the property on the term itself, one HP point at a time over the whole range of one body, for a pair the body loses,
 * a pair it wins and a pair that turns with HP, in Scarlet/Violet and Champions, singles and doubles, with the body
 * in front.
 */

await loadSimMods('gen9championscustomgame');

interface Mode { name: string; format: string; doubles: boolean; ruleset: 'standard' | 'vgc' | 'champions' }
const MODES: Mode[] = [
  { name: 'Gen 9 singles', format: 'gen9customgame', doubles: false, ruleset: 'standard' },
  { name: 'Champions singles', format: 'gen9championscustomgame', doubles: false, ruleset: 'champions' },
  { name: 'VGC doubles', format: 'gen9doublescustomgame', doubles: true, ruleset: 'vgc' },
  { name: 'Champions doubles', format: 'gen9championsdoublescustomgame', doubles: true, ruleset: 'champions' },
];

const splash = (species: string) => set(species, ['splash']);
/** A Garchomp with Crunch that wins any pair against a body that only Splashes. */
const striker = (): PokemonSet => set('Garchomp', ['crunch', 'splash'], { item: 'Choice Scarf' });
/** A Snorlax with Body Slam: against the striker the pair turns with HP. */
const bulky = (): PokemonSet => set('Snorlax', ['bodyslam', 'splash']);

interface Duel { battle: Battle; mine: Pokemon; theirs: Pokemon }

/** p1's lead against p2's lead; in doubles each side brings a second mon of the lead's kind, so no pair cancels another. */
function duel(mode: Mode, mine: PokemonSet, theirs: PokemonSet): Duel {
  const battle = battleOf(mode.format, [mine, ...(mode.doubles ? [mine] : [])], [theirs, ...(mode.doubles ? [theirs] : [])]);
  return { battle, mine: battle.sides[0].active[0]!, theirs: battle.sides[1].active[0]! };
}

/** Every step of the matchup term as `body` goes down one HP point at a time: how far it moved up (own) or down (foe) at the worst. */
function worstStep(mode: Mode, battle: Battle, body: Pokemon, own: boolean): number {
  const termAt = (hp: number): number => {
    body.sethp(hp);
    return matchupTerms(battle, createMatchupCache(mode.ruleset)).matchup;
  };
  let previous = termAt(body.maxhp);
  let worst = 0;
  for (let hp = body.maxhp - 1; hp >= 1; hp--) {
    const term = termAt(hp);
    worst = Math.max(worst, own ? term - previous : previous - term);
    previous = term;
  }
  return worst;
}

const TOLERANCE = 1e-12;

describe.each(MODES)('$name', mode => {
  const pairs = [
    { kind: 'a pair the body can only lose', mine: () => splash('Clefable'), theirs: striker },
    { kind: 'a pair the body can only win', mine: striker, theirs: () => splash('Clefable') },
    { kind: 'a pair that turns with the HP of the body', mine: bulky, theirs: striker },
  ];
  describe.each(pairs)('$kind', ({ mine, theirs }) => {
    test('own HP down never raises the matchup term, one HP point at a time', () => {
      const { battle, mine: body } = duel(mode, mine(), theirs());
      expect(worstStep(mode, battle, body, true)).toBeLessThanOrEqual(TOLERANCE);
    });

    test('foe HP down never lowers the matchup term, one HP point at a time', () => {
      const { battle, theirs: body } = duel(mode, mine(), theirs());
      expect(worstStep(mode, battle, body, false)).toBeLessThanOrEqual(TOLERANCE);
    });
  });
});
