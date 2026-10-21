import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { parseReplayLogWithObservations } from '@fulllifegames/replay-core';
import { corroborateChoiceItem, type ItemCorroboration } from '../src/choice-lock';

/**
 * Round 73 (T204): the Choice check priced the hit on an empty field, with no Terastallization and no Paradox stat on either
 * body, and so read a Choice hypothesis as proof (or as no proof) for the wrong reason. In rain the Specs' 1.5 looked like the
 * rain's 1.5: a Politoed with no item "corroborated" Choice Specs. The check now builds both bodies as the observation shows them
 * (Tera type, the stat a Paradox ability raised, HP, the defender's status) and prices the hit on the field of the observation
 * (weather, terrain, screens, Gravity), through the same helpers as the spread solver. The oracle is the simulator: a real game
 * is played with the true item, and the verdict on a guessed Choice item must follow it. Singles only: doubles hits bypass the
 * check (stated below).
 */

const mon = (species: string, item: string, ability: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet => ({
  name: species, species, item, ability, moves, nature: 'Hardy', gender: '', level: 100,
  evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, ...extra,
});
const BLISSEY = () => mon('Blissey', '', 'Natural Cure', ['Splash'], { evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 252, spe: 0 } });

/** The public log of one turn, the attacker's first move into the defender. */
function turnOf(format: string, attacker: PokemonSet, defender: PokemonSet, move: string, setup: string[] = [], seed = 4): string {
  const battle = new Battle({ formatid: toID(format) as never, seed: [1, 2, 3, seed], p1: { name: 'Alpha', team: Teams.pack([attacker]) }, p2: { name: 'Beta', team: Teams.pack([defender]) } });
  battle.choose('p1', 'team 1');
  battle.choose('p2', 'team 1');
  for (const click of setup) {
    expect(battle.choose('p1', 'move splash')).toBe(true);
    expect(battle.choose('p2', click)).toBe(true);
  }
  expect(battle.choose('p1', move)).toBe(true);
  expect(battle.choose('p2', 'move splash')).toBe(true);
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
}

/** The verdict on a guessed `guess` item for a body that really holds `truth`. */
function verdict(guess: string, truth: string, make: (item: string) => PokemonSet, defender: PokemonSet, move: string): ItemCorroboration {
  const log = turnOf('gen9customgame', make(truth), defender, move);
  const observations = parseReplayLogWithObservations(log).observations.filter(obs => obs.attackerSide === 'p1');
  expect(observations).toHaveLength(1);
  const built = make(guess);
  return corroborateChoiceItem('p1', built.species, guess, { p1Team: [built], p2Team: [defender] }, observations, 9);
}

describe('singles: the verdict follows the item the body really held (T204)', () => {
  // Rain doubles the water move by half, as Choice Specs do.
  const politoed = (item: string) => mon('Politoed', item, 'Drizzle', ['Surf', 'Splash'], { nature: 'Modest', evs: { hp: 252, atk: 0, def: 0, spa: 252, spd: 0, spe: 0 } });

  test('weather: Choice Specs corroborated when held, contradicted when the rain alone did it', () => {
    expect(verdict('Choice Specs', 'Choice Specs', politoed, BLISSEY(), 'move surf')).toBe('corroborated');
    expect(verdict('Choice Specs', '', politoed, BLISSEY(), 'move surf')).toBe('contradicted');
  });

  // Great Tusk's Protosynthesis in sun lifts Attack by 30 percent, a Choice Band's 1.5 reads like it.
  const tusk = (item: string) => mon('Great Tusk', item, 'Protosynthesis', ['Close Combat', 'Splash'], { nature: 'Adamant', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 0, spe: 0 } });
  const TORKOAL = mon('Torkoal', '', 'Drought', ['Splash'], { evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 } });
  function sunVerdict(truth: string): ItemCorroboration {
    const log = turnOf('gen9customgame', tusk(truth), TORKOAL, 'move closecombat');
    const observations = parseReplayLogWithObservations(log).observations.filter(obs => obs.attackerSide === 'p1');
    expect(observations[0].attackerParadox?.stat).toBe('atk');
    return corroborateChoiceItem('p1', 'Great Tusk', 'Choice Band', { p1Team: [tusk('Choice Band')], p2Team: [TORKOAL] }, observations, 9);
  }

  test('Paradox stat: Choice Band corroborated when held, contradicted when the Protosynthesis alone did it', () => {
    expect(sunVerdict('Choice Band')).toBe('corroborated');
    expect(sunVerdict('')).toBe('contradicted');
  });

  // A Terastallized Gengar hits with the doubled same-type bonus.
  const gengar = (item: string) => mon('Gengar', item, 'Cursed Body', ['Shadow Ball', 'Splash'], { teraType: 'Ghost', level: 60, nature: 'Modest', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 0, spe: 0 } });
  const CLEFABLE = mon('Clefable', '', 'Unaware', ['Splash']);
  // Specs and Spell Tag (1.5 against 1.2) overlap at the extreme rolls of the 2 percent slack: the seed gives a middle roll.
  const TERA_SEED = 2;
  function teraVerdict(truth: string): ItemCorroboration {
    const log = turnOf('gen9customgame', gengar(truth), CLEFABLE, 'move shadowball terastallize', [], TERA_SEED);
    const observations = parseReplayLogWithObservations(log).observations.filter(obs => obs.attackerSide === 'p1');
    expect(observations[0].attackerTera).toBe('Ghost');
    return corroborateChoiceItem('p1', 'Gengar', 'Choice Specs', { p1Team: [gengar('Choice Specs')], p2Team: [CLEFABLE] }, observations, 9);
  }

  test('Terastallization: Choice Specs corroborated when held, contradicted when the Tera bonus alone did it', () => {
    expect(teraVerdict('Choice Specs')).toBe('corroborated');
    expect(teraVerdict('')).toBe('contradicted');
  });
});

describe('doubles: hits bypass the check', () => {
  test('a doubles hit gives no verdict, whatever the item (the guard stays until the check prices the doubles field)', () => {
    const doublesLog = (item: string) => {
      const attacker = mon('Politoed', item, 'Drizzle', ['Surf', 'Splash'], { nature: 'Modest', evs: { hp: 252, atk: 0, def: 0, spa: 252, spd: 0, spe: 0 } });
      const teams = { p1: [attacker, BLISSEY()], p2: [BLISSEY(), mon('Chansey', '', 'Natural Cure', ['Splash'])] };
      const battle = new Battle({ formatid: toID('gen9doublescustomgame') as never, seed: [1, 2, 3, 4], p1: { name: 'Alpha', team: Teams.pack(teams.p1) }, p2: { name: 'Beta', team: Teams.pack(teams.p2) } });
      battle.choose('p1', 'team 12');
      battle.choose('p2', 'team 12');
      expect(battle.choose('p1', 'move surf, move splash')).toBe(true);
      expect(battle.choose('p2', 'move splash, move splash')).toBe(true);
      const lines = battle.log;
      return { log: lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n'), attacker };
    };
    const { log, attacker } = doublesLog('');
    const observations = parseReplayLogWithObservations(log).observations.filter(obs => obs.attackerSide === 'p1' && obs.attackerSpecies === 'Politoed');
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every(obs => obs.doubles)).toBe(true);
    const guessed = { ...attacker, item: 'Choice Specs' };
    expect(corroborateChoiceItem('p1', 'Politoed', 'Choice Specs', { p1Team: [guessed], p2Team: [BLISSEY()] }, observations, 9)).toBe('ambiguous');
  });
});
