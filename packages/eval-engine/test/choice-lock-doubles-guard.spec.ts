import { describe, expect, test } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import { parseReplayLogWithObservations } from '@fulllifegames/replay-core';
import { corroborateChoiceItem } from '../src/choice-lock';
import { battleOf } from './power-oracle';
import { set } from './move-oracle';

/**
 * Round 69 (T31): the parser records doubles hits now, and the Choice item check prices every observation with an empty
 * singles field. A hit through Reflect shows it: a real Choice Band Garchomp hits a Reflect-screened Slowking in doubles
 * for 1.5 x 2732/4096 = about the bare damage, so the check would read "no item explains it, the Band does not" and
 * contradict the Band the holder really has. Until the check reads the doubles field (lane F's T193 and a new proposal),
 * a doubles observation does not reach the Choice verdict: doubles keeps what it had before the parser recorded it (no
 * observation, ambiguous). Singles reads as before. The oracle is the simulator: both logs come from real battles.
 */
const garchomp = (item: string): PokemonSet => set('Garchomp', ['dragonclaw', 'splash'], { item, ability: 'Rough Skin' });
const slowking = (): PokemonSet => set('Slowking', ['reflect', 'splash'], { ability: 'Regenerator' });
const bystander = (): PokemonSet => set('Corviknight', ['splash'], { ability: 'Pressure' });

const publicLog = (lines: string[]) => lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');

/** Garchomp (p1) hits Slowking (p2) with Dragon Claw; in doubles after Slowking set up Reflect. A clean log of a hit with no critical, else the next seed. */
function sceneLog(doubles: boolean, held: string): string {
  for (let seed = 1; seed <= 60; seed++) {
    const battle = battleOf(doubles ? 'gen9doublescustomgame' : 'gen9customgame',
      doubles ? [garchomp(held), bystander()] : [garchomp(held)], doubles ? [slowking(), bystander()] : [slowking()], `1,2,3,${seed}`);
    if (doubles) {
      battle.makeChoices('move dragonclaw 2, move splash', 'move reflect, move splash'); // a Choice item locks Garchomp into Dragon Claw from turn 1
      battle.makeChoices('move dragonclaw 1, move splash', 'move splash, move splash');
    } else {
      battle.makeChoices('move dragonclaw', 'move splash');
    }
    const log = publicLog(battle.log);
    if (!/\|-crit\|/.test(log) && /\|-damage\|p2a: Slowking\|/.test(log)) return log;
  }
  throw new Error('no clean hit in 60 seeds');
}

const observationsOf = (log: string) => parseReplayLogWithObservations(log).observations.filter(obs => obs.attackerSpecies === 'Garchomp' && obs.defenderSpecies === 'Slowking');
const teams = { p1Team: [garchomp('Choice Band')], p2Team: [slowking()] };

describe('a doubles observation does not move the Choice verdict (T31 guard)', () => {
  test('doubles: a Choice Band hit through Reflect is not contradicted', () => {
    const observations = observationsOf(sceneLog(true, 'Choice Band'));
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ doubles: true, screens: ['reflect'] });
    expect(corroborateChoiceItem('p1', 'Garchomp', 'Choice Band', teams, observations, 9)).toBe('ambiguous');
  });

  test('singles: a hit only the Band explains corroborates it', () => {
    const observations = observationsOf(sceneLog(false, 'Choice Band'));
    expect(observations[0].doubles).toBe(false);
    expect(corroborateChoiceItem('p1', 'Garchomp', 'Choice Band', teams, observations, 9)).toBe('corroborated');
  });

  test('singles: a bare hit contradicts a guessed Band', () => {
    const observations = observationsOf(sceneLog(false, ''));
    expect(corroborateChoiceItem('p1', 'Garchomp', 'Choice Band', teams, observations, 9)).toBe('contradicted');
  });
});
