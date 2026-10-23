import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { healProfile } from '../src/score/races';
import { fingerprint } from '../src/sim-ask';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 76 (T258): the heal rate of a move from the simulator. A heal move without a ratio in the Dex (Shore Up: half
 * the HP, two thirds in sand; the Moonlight family: by weather; Jungle Healing: a quarter; Heal Pulse: the target's HP,
 * which in singles is the foe's) used to fall back to one half. healProfile now plays the move on a twin battle under
 * the live weather and terrain and reads the HP the click leaves per turn over a full cycle of the sleep and wish
 * moves. This sweep plays every heal move of the Dex in every generation and the Champions mod, under every weather
 * and the Grassy terrain, on a live battle, and holds healProfile to what it saw. The scenes: Shore Up in sand, the
 * Moonlight family, a heal pulse in singles (it heals the foe).
 */

await loadSimMods('gen9championscustomgame');

const CHAMPIONS = 'gen9championscustomgame';
const FORMATS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(gen => `gen${gen}customgame`).concat(CHAMPIONS);
const WINDOW = 12;

const plain = (moves: string[], item = ''): PokemonSet => ({
  name: 'Chansey', species: 'Chansey', item, ability: '', moves, nature: '', gender: '',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
});

/** `float`: the healer holds an Air Balloon, so the Grassy terrain's upkeep heal does not hide in the delta (Rest fills the HP and caps it). */
function duel(format: string, moves: string[], foe = 'Chansey', float = false): Battle {
  const battle = new Battle({
    formatid: toID(format), seed: '1,2,3,4' as never,
    p1: { name: 'Healer', team: Teams.pack([plain(moves, float ? 'airballoon' : '')]) }, p2: { name: 'Foe', team: Teams.pack([{ ...plain(['harden']), name: foe, species: foe }]) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) battle.makeChoices('team 1', 'team 1');
  return battle;
}

interface Field { weather: string; terrain: string }

function withField(battle: Battle, field: Field): Battle {
  const foe = battle.sides[1].active[0]!;
  if (field.weather) { battle.field.setWeather(field.weather, foe); battle.field.weatherState.duration = 0; }
  if (field.terrain) { battle.field.setTerrain(field.terrain, foe); battle.field.terrainState.duration = 0; }
  return battle;
}

/** The HP a click of the move leaves per turn on a live battle: a user reset to a quarter of its HP and a foe to full HP before every turn, a cycle of WINDOW turns, the field's own chip taken off (a Harden control). */
function gained(format: string, moveId: string, field: Field, foe: string): number {
  const battle = withField(duel(format, [moveId], foe, field.terrain !== ''), field);
  const user = battle.sides[0].active[0]!;
  for (const slot of user.moveSlots) slot.pp = slot.maxpp = 99;
  let total = 0;
  for (let turn = 0; turn < WINDOW && !battle.ended; turn++) {
    user.sethp(Math.floor(user.maxhp / 4));
    battle.sides[1].active[0]!.sethp(battle.sides[1].active[0]!.maxhp);
    const before = user.hp;
    battle.makeChoices('move 1', 'move 1');
    total += user.hp - before;
  }
  return total / (WINDOW * user.maxhp);
}

/** The rate against one foe; a heal that differs between a Chansey and a Machamp follows the foe (Strength Sap) and keeps the proxy of one half. */
function playedRate(format: string, moveId: string, field: Field): number {
  const [weak, strong] = ['Chansey', 'Machamp'].map(foe => Math.max(0, gained(format, moveId, field, foe) - gained(format, 'harden', field, foe)));
  return Math.abs(weak - strong) > 0.005 ? 1 / 2 : weak;
}

const read = (format: string, moveId: string, field: Field): number => {
  const battle = withField(duel(format, [moveId], 'Chansey', field.terrain !== ''), field);
  return healProfile(battle.sides[0].active[0]!, battle).rate;
};

const NONE: Field = { weather: '', terrain: '' };

describe('healProfile reads the heal the simulator plays (T258)', () => {
  test('scenes: Shore Up heals half in clear weather and two thirds in sand; Heal Pulse heals the foe, not the user', () => {
    expect(read('gen9customgame', 'shoreup', NONE)).toBeCloseTo(1 / 2, 2);
    expect(read('gen9customgame', 'shoreup', { weather: 'sandstorm', terrain: '' })).toBeCloseTo(2 / 3, 2);
    expect(read('gen9customgame', 'healpulse', NONE)).toBe(0);
    expect(read('gen9customgame', 'junglehealing', NONE)).toBeCloseTo(1 / 4, 2);
  });

  test('scenes: the Moonlight family scales with the weather the live battle has', () => {
    for (const id of ['moonlight', 'synthesis', 'morningsun']) {
      expect(read('gen9customgame', id, NONE), id).toBeCloseTo(1 / 2, 2);
      expect(read('gen9customgame', id, { weather: 'sunnyday', terrain: '' }), id).toBeCloseTo(2 / 3, 2);
      expect(read('gen9customgame', id, { weather: 'raindance', terrain: '' }), id).toBeCloseTo(1 / 4, 2);
    }
  });

  test('Strength Sap heals by the Attack of the foe: no rate of the healer alone, the proxy of one half stays', () => {
    expect(read('gen9customgame', 'strengthsap', NONE)).toBe(1 / 2);
  });

  test('the sweep: every heal move of every generation and the Champions mod, under every weather and terrain', () => {
    const mismatches: string[] = [];
    let rows = 0;
    for (const format of FORMATS) {
      const dex = duel(format, ['harden']).dex;
      const weathers = ['', ...['sunnyday', 'raindance', 'sandstorm', 'hail', 'snowscape'].filter(id => dex.conditions.get(id).exists)];
      const terrains = dex.gen >= 6 ? ['', 'grassyterrain'] : [''];
      const moves = dex.moves.all().filter(move => move.exists && !move.isNonstandard && move.flags['heal'] && !move.drain && !move.isMax && !move.isZ);
      for (const move of moves) {
        for (const weather of weathers) for (const terrain of terrains) {
          const field = { weather, terrain };
          const [sim, ours] = [playedRate(format, move.id, field), read(format, move.id, field)];
          rows++;
          if (Math.abs(sim - ours) > 0.005) mismatches.push(`${format} ${move.id} ${weather || 'clear'} ${terrain || '-'}: sim ${sim.toFixed(3)}, healProfile ${ours.toFixed(3)}`);
        }
      }
    }
    expect(rows).toBeGreaterThan(1000);
    expect(mismatches).toEqual([]);
  }, 600_000);

  test.each(['gen9doublescustomgame', 'gen9championsdoublescustomgame', 'gen9championsvgc2026regmbbo3'])('doubles (%s): the same rates on a board of two bodies a side, Shore Up in sand and Heal Pulse for the foe', format => {
    const board = () => battleOf(format, [set('Palossand', ['shoreup', 'healpulse', 'junglehealing']), set('Snorlax', ['splash'])], [set('Snorlax', ['splash']), set('Snorlax', ['splash'])]);
    const clear = board();
    const sand = board();
    sand.field.setWeather('sandstorm', sand.sides[1].active[0]!);
    const [user, sandUser] = [clear.sides[0].active[0]!, sand.sides[0].active[0]!];
    expect(healProfile(user, clear).rate).toBeCloseTo(1 / 2, 2);
    expect(healProfile(sandUser, sand).rate).toBeCloseTo(2 / 3, 2);
    // Jungle Healing (a quarter) and Heal Pulse (the target's HP: 0 for the user) never beat Shore Up; with only those two the rate is the quarter.
    const weak = battleOf(format, [set('Palossand', ['healpulse', 'junglehealing']), set('Snorlax', ['splash'])], [set('Snorlax', ['splash']), set('Snorlax', ['splash'])]);
    expect(healProfile(weak.sides[0].active[0]!, weak).rate).toBeCloseTo(1 / 4, 2);
  });

  test('healProfile leaves the live battle as it found it', () => {
    const battle = withField(duel('gen9customgame', ['shoreup', 'moonlight', 'rest']), { weather: 'sandstorm', terrain: '' });
    const before = fingerprint(battle);
    healProfile(battle.sides[0].active[0]!, battle);
    expect(fingerprint(battle)).toBe(before);
  });
});
