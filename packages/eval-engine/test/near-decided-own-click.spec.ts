import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { unansweredMons } from '../src/eval-function';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

const level = { level: 50 };
const clicker = (): PokemonSet => set('Tauros', ['crushclaw'], level);
const ghostClearer = (): PokemonSet => set('Gengar', ['shadowball'], level);

function scene(format: string, p2: PokemonSet[], clickerHp: (maxhp: number) => number): Battle {
  const battle = battleOf(format, [clicker(), ghostClearer()], p2);
  const [tauros, gengar] = battle.sides[0].pokemon;
  tauros.sethp(clickerHp(tauros.maxhp));
  tauros.boosts.spe = 6;
  gengar.sethp(1);
  battle.sides[1].pokemon[0].sethp(1);
  return battle;
}

describe('the near stage names the clicker, who clears the rest itself', () => {
  const ghostBehind = (): PokemonSet[] => [set('Alakazam', ['psychic'], level), set('Dusknoir', ['splash'], level)];

  test('singles: a click that only unlocks a teammate\'s sweep is no near-decided', () => {
    expect(unansweredMons(scene('gen9customgame', ghostBehind(), () => 1)).nearDecided).toBeUndefined();
  });

  test('doubles: the partner\'s sweep behind the slot-0 click is no near-decided either', () => {
    expect(unansweredMons(scene('gen9doublescustomgame', ghostBehind(), () => 1)).nearDecided).toBeUndefined();
  });

  test('a clicker that clears the rest itself keeps the stage and records the click as the played choice writes it', () => {
    const harmlessBehind = (format: string): Battle => {
      const battle = scene(format, [set('Alakazam', ['psychic'], level), set('Machamp', ['bulkup'], level)], maxhp => Math.floor(maxhp / 5));
      battle.sides[0].pokemon[0].setStatus('psn');
      battle.sides[1].pokemon[1].sethp(1);
      return battle;
    };
    const singles = unansweredMons(harmlessBehind('gen9customgame'));
    expect(singles.decided).toBeUndefined();
    expect(singles.nearDecided).toMatchObject({ side: 'p1', species: 'Tauros', removes: 'Alakazam', click: { move: 'crushclaw' } });
    expect(singles.nearDecided?.click?.target).toBeUndefined();
    expect(singles.nearDecided?.odds).toBeCloseTo(0.95, 6);
    const doubles = unansweredMons(harmlessBehind('gen9doublescustomgame')).nearDecided;
    expect(doubles).toMatchObject({ side: 'p1', species: 'Tauros', removes: 'Alakazam', click: { move: 'crushclaw', target: 1 } });
  });
});
