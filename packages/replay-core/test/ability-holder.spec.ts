import { describe, expect, test } from 'vitest';
import { inferOpponentTeam } from '../src/opponent-inferrer';

/**
 * Round 60 (T104): the sim writes [of] differently per line. An ability heal
 * names the holder and [of] the attacker (battle.js:2103); Pickpocket's
 * -enditem names only the attacker (abilities.js:3390); Rough Skin's -damage
 * names the victim and [of] the holder. The dex decides: a Pokémon whose
 * species cannot have the ability never gets it.
 */

const head = (tier: string) => ['|gametype|singles', '|gen|9', `|tier|${tier}`, '|start'];
const abilityOf = (log: string[], side: 'p1' | 'p2', species: string) =>
  inferOpponentTeam(log.join('\n'), side).pokemon.find(mon => mon.species === species)?.ability.value ?? '';

describe('ability holders from [from] ability lines (round 60, T104)', () => {
  test('Water Absorb belongs to the healed Pokémon, not to the attacker named by [of]', () => {
    const log = [...head('[Gen 9] OU'),
      '|switch|p1a: Alomomola|Alomomola, F|100/100', '|switch|p2a: Toad|Seismitoad, M|80/100', '|turn|1',
      '|move|p1a: Alomomola|Scald|p2a: Toad', '|-heal|p2a: Toad|100/100|[from] ability: Water Absorb|[of] p1a: Alomomola',
      '|turn|2'];
    expect(abilityOf(log, 'p1', 'Alomomola')).toBe('');
    expect(abilityOf(log, 'p2', 'Seismitoad')).toBe('Water Absorb');
  });

  test('Pickpocket goes to the thief, never to the Pokémon that lost the item', () => {
    const log = [...head('[Gen 9] OU'),
      '|switch|p1a: Gambit|Kingambit, M|100/100', '|switch|p2a: Weavile|Weavile, F|100/100', '|turn|1',
      '|move|p1a: Gambit|Sucker Punch|p2a: Weavile', '|-damage|p2a: Weavile|40/100',
      '|-enditem|p1a: Gambit|Leftovers|[silent]|[from] ability: Pickpocket|[of] p1a: Gambit',
      '|-item|p2a: Weavile|Leftovers|[from] ability: Pickpocket|[of] p1a: Gambit',
      '|turn|2'];
    expect(abilityOf(log, 'p1', 'Kingambit')).toBe('');
    expect(abilityOf(log, 'p2', 'Weavile')).toBe('Pickpocket');
  });

  test('Rough Skin still goes to [of], the holder', () => {
    const log = [...head('[Gen 9] OU'),
      '|switch|p1a: Chomp|Garchomp, F|100/100', '|switch|p2a: Lando|Landorus-Therian, M|100/100', '|turn|1',
      '|move|p2a: Lando|U-turn|p1a: Chomp', '|-damage|p1a: Chomp|80/100',
      '|-damage|p2a: Lando|90/100|[from] ability: Rough Skin|[of] p1a: Chomp',
      '|turn|2'];
    expect(abilityOf(log, 'p1', 'Garchomp')).toBe('Rough Skin');
  });

  test('a traced ability is not the tracer\'s own, and Trace belongs to the tracer', () => {
    const log = [...head('[Gen 9] OU'),
      '|switch|p1a: Gardevoir|Gardevoir, F|100/100', '|switch|p2a: Gyarados|Gyarados, M|100/100',
      '|-ability|p1a: Gardevoir|Intimidate|[from] ability: Trace|[of] p2a: Gyarados', '|turn|1'];
    expect(abilityOf(log, 'p1', 'Gardevoir')).toBe('Trace');
    expect(abilityOf(log, 'p2', 'Gyarados')).toBe('');
  });

  test('a custom game keeps today\'s rule: [of] gets it', () => {
    const log = [...head('[Gen 9] Custom Game'),
      '|switch|p1a: Alomomola|Alomomola, F|100/100', '|switch|p2a: Toad|Seismitoad, M|80/100', '|turn|1',
      '|move|p1a: Alomomola|Scald|p2a: Toad', '|-heal|p2a: Toad|100/100|[from] ability: Water Absorb|[of] p1a: Alomomola',
      '|turn|2'];
    expect(abilityOf(log, 'p1', 'Alomomola')).toBe('Water Absorb');
  });

  test('a format whose rule table allows any ability keeps an off-species reveal (Balanced Hackmons)', () => {
    const log = [...head('[Gen 9] Balanced Hackmons'),
      '|switch|p1a: Chomp|Garchomp, F|100/100', '|switch|p2a: Toad|Seismitoad, M|80/100',
      '|-ability|p1a: Chomp|Water Absorb', '|turn|1'];
    expect(abilityOf(log, 'p1', 'Garchomp')).toBe('Water Absorb');
  });
});
