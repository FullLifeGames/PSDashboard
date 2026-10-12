import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { buildSolveContext, keyOf, observationError, rollRange, spreadFor, type SolveContext } from '../src/spreads/fit';
import type { ReadObservation } from '../src/spreads/observation-read';
import type { DamageObservation, PokemonEvs } from '../src/types';

/**
 * Round 69 (T191, spec decision 9): the item of an observation is the item at the time of the hit. The solver priced every hit with
 * the set's item, also when the item was gone at the hit (2691843318 and 2694103115: an Aegislash whose Air Balloon had popped took
 * Ground hits the solver read as impossible). The parser reads the client battle before the damage line, as it does the stages and
 * the status: the item the client shows, whether it changed since the mon came in (consumed, knocked off, stolen, swapped), and the
 * item that ended during this very move before its damage line (a weakening berry, a gem), which counted for that hit. The oracle
 * is the simulator: real battles, singles and doubles, where the calculator's rolls under the item at the hit must contain the
 * simulator's exact damage and the rolls under the set's item must not.
 */

type Kind = 'singles' | 'doubles';
const FORMAT: Record<Kind, string> = { singles: 'gen9ou', doubles: 'gen9doublesou' };
const ALL_31 = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const sp = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
const set = (species: string, item: string, ability: string, nature: string, spread: Partial<PokemonEvs>): PokemonSet => ({
  name: species, species, item, ability, moves: ['Splash'], nature, evs: sp(spread), ivs: { ...ALL_31 }, level: 100, gender: '',
});
const partner = () => set('Blissey', '', 'Natural Cure', 'Calm', { hp: 252 });

interface Setup {
  title: string;
  attacker: PokemonSet;
  defender: PokemonSet;
  /** The attacker's move of each turn (the defender splashes); a doubles move may differ where the singles one is a spread move. */
  moves: Record<Kind, string[]>;
}

/** Garchomp pops Aegislash's Air Balloon with a Dragon Claw, then a Ground hit lands (2691843318). */
const BALLOON: Setup = {
  title: 'a popped Air Balloon',
  attacker: set('Garchomp', '', 'Rough Skin', 'Jolly', { atk: 252, spe: 252 }),
  defender: set('Aegislash', 'Air Balloon', 'Stance Change', 'Impish', { hp: 252, def: 252 }),
  moves: { singles: ['Dragon Claw', 'Earthquake'], doubles: ['Dragon Claw', 'Stomping Tantrum'] },
};
/** Gengar knocks the Eviolite off Dusclops, which the log has never shown, then a special hit lands. */
const KNOCK_OFF: Setup = {
  title: 'a Knock Off',
  attacker: set('Gengar', '', 'Cursed Body', 'Timid', { spa: 252, spe: 252 }),
  defender: set('Dusclops', 'Eviolite', 'Pressure', 'Calm', { hp: 252, spd: 252 }),
  moves: { singles: ['Knock Off', 'Shadow Ball'], doubles: ['Knock Off', 'Shadow Ball'] },
};
/** A Chilan Berry halves the first Tackle and is gone for the second: the line that eats it comes before the damage line. */
const BERRY: Setup = {
  title: 'a consumed Chilan Berry',
  attacker: set('Garchomp', '', 'Rough Skin', 'Jolly', { atk: 252, spe: 252 }),
  defender: set('Blissey', 'Chilan Berry', 'Natural Cure', 'Calm', { hp: 252, spd: 252 }),
  moves: { singles: ['Tackle', 'Tackle'], doubles: ['Tackle', 'Tackle'] },
};
/** Gengar's Trick hands it Garchomp's Wise Glasses for its Choice Specs; the log shows both items. */
const TRICK: Setup = {
  title: 'a Trick',
  attacker: set('Gengar', 'Choice Specs', 'Cursed Body', 'Timid', { spa: 252, spe: 252 }),
  defender: set('Garchomp', 'Wise Glasses', 'Rough Skin', 'Jolly', { hp: 252, atk: 252 }),
  moves: { singles: ['Trick', 'Shadow Ball'], doubles: ['Trick', 'Shadow Ball'] },
};

interface Scene {
  log: string;
  /** The defender's HP lost to each turn's hit, in the simulator's own numbers. */
  damage: number[];
  maxHp: number;
}

/** A battle of the setup's turns; null when a hit crit (the parser records no crit), missed or a damaging turn dealt nothing. */
function sceneOf(kind: Kind, setup: Setup, seed: number): Scene | null {
  const doubles = kind === 'doubles';
  const attacker = { ...setup.attacker, moves: setup.moves[kind] };
  const battle = new Battle({
    formatid: toID(FORMAT[kind]), seed: [1, 2, 3, seed],
    p1: { name: 'Alpha', team: Teams.pack(doubles ? [attacker, partner()] : [attacker]) },
    p2: { name: 'Beta', team: Teams.pack(doubles ? [setup.defender, partner()] : [setup.defender]) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', 'default');
    battle.choose('p2', 'default');
  }
  const target = battle.p2.active[0];
  const { maxhp: maxHp } = target;
  const damage: number[] = [];
  for (const move of setup.moves[kind]) {
    const before = target.hp;
    battle.choose('p1', doubles ? `move ${toID(move)} 1, move splash` : `move ${toID(move)}`);
    battle.choose('p2', doubles ? 'move splash, move splash' : 'move splash');
    damage.push(before - target.hp);
  }
  const lines = battle.log;
  const log = lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
  if (/\|-crit\|/.test(log) || /\|-miss\|/.test(log) || target.hp <= 0) return null;
  return { log, damage, maxHp };
}

/** Up to `count` clean scenes whose last hit differs. */
function scenesOf(kind: Kind, setup: Setup, count: number): Scene[] {
  const scenes: Scene[] = [];
  for (let seed = 1; scenes.length < count && seed <= 200; seed++) {
    const scene = sceneOf(kind, setup, seed);
    if (scene && !scenes.some(known => known.damage.at(-1) === scene.damage.at(-1))) scenes.push(scene);
  }
  return scenes;
}

/** The observations of the hits into the defender, in turn order (a turn without damage, a Trick, has none). */
function hitsOf(scene: Scene, setup: Setup): DamageObservation[] {
  const found = parseReplayLogWithObservations(scene.log).observations.filter(obs => obs.defenderSpecies === setup.defender.species);
  expect(found).toHaveLength(scene.damage.filter(lost => lost > 0).length);
  return found;
}

const contextOf = (kind: Kind, setup: Setup, observations: DamageObservation[]): SolveContext =>
  buildSolveContext(observations, { p1: [setup.attacker], p2: [setup.defender] }, FORMAT[kind], []);

/** The solver's read of an observation (the forme and side it resolves to). */
const readOf = (ctx: SolveContext, setup: Setup, index: number): ReadObservation =>
  ctx.byMon.get(keyOf('p2', setup.defender.species))![index];

/** Whether the calculator's rolls of the hit, under the sets' own spreads, contain the simulator's exact damage. */
function containsDamage(ctx: SolveContext, setup: Setup, obs: ReadObservation, damage: number, maxHp: number): boolean {
  const range = rollRange(ctx, obs, spreadFor(ctx, 'p1', setup.attacker.species), spreadFor(ctx, 'p2', setup.defender.species));
  expect(range).not.toBeNull();
  return Math.round(range!.min * maxHp) <= damage && damage <= Math.round(range!.max * maxHp);
}

/** The observation as the solver read it before round 69, T191: no item at the hit, the set's item. */
const stale = (obs: ReadObservation): ReadObservation => ({
  ...obs, attackerItem: undefined, defenderItem: undefined, attackerItemChanged: undefined, defenderItemChanged: undefined,
});

const ITEM_FIELDS = ['attackerItem', 'defenderItem', 'attackerItemChanged', 'defenderItemChanged'] as const;
const itemFields = (obs: DamageObservation) => Object.fromEntries(ITEM_FIELDS.map(field => [field, obs[field]]));

describe('the item a hit is priced with is the item at the hit (T191)', () => {
  for (const kind of ['singles', 'doubles'] as const) {
    for (const setup of [BALLOON, KNOCK_OFF, BERRY, TRICK]) {
      test(`${kind}: ${setup.title}: the rolls at the hit contain the simulator's damage, the set's item does not`, () => {
        const scenes = scenesOf(kind, setup, 4);
        expect(scenes.length).toBeGreaterThanOrEqual(3);
        for (const scene of scenes) {
          const observations = hitsOf(scene, setup);
          const ctx = contextOf(kind, setup, observations);
          const lastDamage = scene.damage.at(-1)!;
          const last = readOf(ctx, setup, observations.length - 1);
          expect(containsDamage(ctx, setup, last, lastDamage, scene.maxHp)).toBe(true);
          expect(containsDamage(ctx, setup, stale(last), lastDamage, scene.maxHp)).toBe(false);
          // The played spreads have no error at the hit; priced with the item that was gone they do.
          const defenderKey = keyOf('p2', setup.defender.species);
          expect(observationError(ctx, last, defenderKey, spreadFor(ctx, 'p2', setup.defender.species))).toBe(0);
          expect(observationError(ctx, stale(last), defenderKey, spreadFor(ctx, 'p2', setup.defender.species))).toBeGreaterThan(0);
        }
      });
    }

    test(`${kind}: an item the log has not shown stays the set's (the Knock Off itself hits the Eviolite holder)`, () => {
      for (const scene of scenesOf(kind, KNOCK_OFF, 4)) {
        const observations = hitsOf(scene, KNOCK_OFF);
        expect(itemFields(observations[0])).toEqual({ attackerItem: '', defenderItem: '', attackerItemChanged: false, defenderItemChanged: false });
        const ctx = contextOf(kind, KNOCK_OFF, observations);
        // Knock Off hits 1.5 times harder while the target holds an item: the set's Eviolite is what the first line is priced with.
        expect(containsDamage(ctx, KNOCK_OFF, readOf(ctx, KNOCK_OFF, 0), scene.damage[0], scene.maxHp)).toBe(true);
      }
    });

    test(`${kind}: a berry that weakens the hit counts for that hit and is gone for the next`, () => {
      for (const scene of scenesOf(kind, BERRY, 4)) {
        const observations = hitsOf(scene, BERRY);
        expect(scene.log.indexOf('|-enditem|p2a: Blissey|Chilan Berry')).toBeLessThan(scene.log.indexOf('|-damage|p2a: Blissey'));
        expect(itemFields(observations[0])).toMatchObject({ defenderItem: 'chilanberry', defenderItemChanged: false });
        expect(itemFields(observations[1])).toMatchObject({ defenderItem: '', defenderItemChanged: true });
        const ctx = contextOf(kind, BERRY, observations);
        expect(containsDamage(ctx, BERRY, readOf(ctx, BERRY, 0), scene.damage[0], scene.maxHp)).toBe(true);
      }
    });
  }
});

describe('the observation names the item at the hit (T191)', () => {
  const observationsOf = (setup: Setup, kind: Kind) => hitsOf(scenesOf(kind, setup, 1)[0], setup);

  for (const kind of ['singles', 'doubles'] as const) {
    test(`${kind}: a popped Air Balloon is shown, then gone`, () => {
      const [claw, quake] = observationsOf(BALLOON, kind);
      expect(itemFields(claw)).toEqual({ attackerItem: '', defenderItem: 'airballoon', attackerItemChanged: false, defenderItemChanged: false });
      expect(itemFields(quake)).toEqual({ attackerItem: '', defenderItem: '', attackerItemChanged: false, defenderItemChanged: true });
    });

    test(`${kind}: a Trick gives the attacker the item the log shows it took`, () => {
      const [shadowBall] = observationsOf(TRICK, kind);
      expect(itemFields(shadowBall)).toEqual({
        attackerItem: 'wiseglasses', defenderItem: 'choicespecs', attackerItemChanged: true, defenderItemChanged: true,
      });
    });
  }
});
