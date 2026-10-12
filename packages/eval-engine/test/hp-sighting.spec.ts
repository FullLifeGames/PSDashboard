import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { parseReplayLogWithObservations, type TurnSnapshot } from '@fulllifegames/replay-core';
import { sightedHp, type HpDisplayBody } from '../src/branch/pokemon-info';
import { correctBattleFromSnapshot } from '../src/branch/corrections';
import { loadSimMods } from '../src/forward/sim-mods';
import type { SimBattle } from '../src/branch/types';

/**
 * Round 69, T161 (spec decision 31): the HP a percent sighting stands for is the middle of the HPs the
 * simulator's own display (getHealth) shows as that percent. Gen 7 and later round the percent up, Champions
 * rounds it down, and a Gen 6 game without the HP Percentage Mod shows 48 pixels, so the old
 * `round(percent * maxhp / 100)` left the range the format allows (Champions: the low edge, every time).
 * The checker holds sightedHp against getHealth itself, over every maximum HP from 50 to 700 and every shown
 * value, and the corrections against a battle that played the hit (battle G is the game, battle A the
 * simulator's own run with another seed). The engine runs a VGC game on the Doubles OU format (a Champions VGC
 * game on the Champions doubles format), so those two formats carry the VGC rows.
 */
await loadSimMods('gen9championsou');

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const set = (species: string, moves: string[], level = 50): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', evs, ivs, level,
});

interface Case {
  /** What the case stands for beside its format. */
  label: string;
  format: string;
  /** The denominator the game shows: 100 for percentages, 48 for the pixels of a Gen 6 game without the percent rule. */
  scale: 100 | 48;
  champions?: boolean;
}

const CASES: Case[] = [
  { label: 'singles', format: 'gen9ou', scale: 100 },
  { label: 'doubles and VGC', format: 'gen9doublesou', scale: 100 },
  { label: 'Champions singles', format: 'gen9championsou', scale: 100, champions: true },
  { label: 'Champions doubles and VGC', format: 'gen9championsdoublescustomgame', scale: 100, champions: true },
  { label: 'Gen 6 with the HP Percentage Mod', format: 'gen6ou', scale: 100 },
  { label: 'Gen 6 pixels', format: 'gen6customgame', scale: 48 },
  { label: 'Gen 6 without the rule, a percent sighting', format: 'gen6customgame', scale: 100 },
];

function battleOf(format: string, p1: PokemonSet[], p2: PokemonSet[], seed = 1): Battle {
  return new Battle({
    formatid: toID(format), seed: [seed, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
}

/** A body at any maximum HP: the display reads only hp and maxhp. */
const bodyAt = (battle: Battle, maxhp: number): HpDisplayBody & { hp: number } => {
  const body = battle.sides[0].pokemon[0];
  body.maxhp = maxhp;
  return body as unknown as HpDisplayBody;
};

/** The display mode of the replay's server: percent on the 100 scale, pixels on 48, never the exact HP a custom game reports. */
function inReplayMode(battle: Battle, scale: 100 | 48): void {
  battle.reportExactHP = false;
  battle.reportPercentages = scale === 100;
}

/** What the simulator shows for an HP: the numerator of the `n/scale` part of getHealth. */
function shownAt(body: HpDisplayBody, hp: number): number {
  body.hp = hp;
  return Number(/^(\d+)\//.exec(body.getHealth().shared)![1]);
}

/** Every HP that shows each numerator, asked from getHealth itself, hp 1 to maxhp. */
function allowedHps(body: HpDisplayBody): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (let hp = 1; hp <= body.maxhp; hp++) {
    const shown = shownAt(body, hp);
    (out.get(shown) ?? out.set(shown, []).get(shown)!).push(hp);
  }
  return out;
}

describe('T161 sightedHp against the simulator getHealth', () => {
  for (const shape of CASES) {
    test(`every shown value at every maximum HP from 50 to 700 lands in the middle of its range (${shape.label}, /${shape.scale})`, () => {
      const battle = battleOf(shape.format, [set('Garchomp', ['Splash'])], [set('Garchomp', ['Splash'])]);
      inReplayMode(battle, shape.scale);
      let checked = 0;
      let outside = 0;
      for (let maxhp = 50; maxhp <= 700; maxhp++) {
        const body = bodyAt(battle, maxhp);
        const range = allowedHps(body);
        for (const [shown, hps] of range) {
          body.hp = maxhp;
          const hp = sightedHp(body, { hp: shown, maxhp: shape.scale });
          expect(hp, `${shape.format} max ${maxhp} shown ${shown}`).not.toBeNull();
          // It shows exactly the percent (checker: the simulator's own display) ...
          expect(hps, `${shape.format} max ${maxhp} shown ${shown} -> ${hp}`).toContain(hp);
          // ... and it is the middle of all HPs that show it.
          expect(Math.abs(2 * hp! - (hps[0] + hps[hps.length - 1])), `${shape.format} max ${maxhp} shown ${shown} -> ${hp}`).toBeLessThanOrEqual(1);
          checked++;
          if (shown !== Math.round(hp! / maxhp * shape.scale) && shape.champions) outside++;
        }
      }
      expect(checked).toBeGreaterThan(30_000);
      void outside;
    });
  }

  test('the body keeps its HP and its display mode afterwards', () => {
    const battle = battleOf('gen6customgame', [set('Garchomp', ['Splash'])], [set('Garchomp', ['Splash'])]);
    const body = battle.sides[0].pokemon[0];
    const before = { hp: body.hp, maxhp: body.maxhp, report: battle.reportPercentages };
    expect(sightedHp(body as unknown as HpDisplayBody, { hp: 37, maxhp: 100 })).not.toBeNull();
    expect({ hp: body.hp, maxhp: body.maxhp, report: battle.reportPercentages }).toEqual(before);
  });

  test('the old rounding leaves the range: Champions reads the low edge', () => {
    const battle = battleOf('gen9championsou', [set('Garchomp', ['Splash'])], [set('Garchomp', ['Splash'])]);
    inReplayMode(battle, 100);
    let off = 0;
    for (let maxhp = 50; maxhp <= 700; maxhp++) {
      const body = bodyAt(battle, maxhp);
      for (const shown of allowedHps(body).keys()) {
        if (shownAt(body, Math.max(1, Math.round(shown * maxhp / 100))) !== shown) off++;
      }
    }
    expect(off).toBeGreaterThan(0);
  });

  test('a value no HP shows, a fainted sighting and a scale the display does not use give null', () => {
    const battle = battleOf('gen9ou', [set('Garchomp', ['Splash'])], [set('Garchomp', ['Splash'])]);
    inReplayMode(battle, 100);
    const body = bodyAt(battle, 300);
    expect(sightedHp(body, { hp: 0, maxhp: 100 })).toBeNull();
    expect(sightedHp(body, { hp: 101, maxhp: 100 })).toBeNull();
    // The game shows exact HP here (not 100 or 48): the display of the body is percent, so there is no match.
    expect(sightedHp(body, { hp: 250, maxhp: 311 })).toBeNull();
    // Pixels asked of a Gen 9 body.
    expect(sightedHp(body, { hp: 24, maxhp: 48 })).toBeNull();
  });

  test('100 percent is a full body and 1 percent a body with at least 1 HP', () => {
    for (const shape of CASES.filter(entry => entry.scale === 100)) {
      const battle = battleOf(shape.format, [set('Garchomp', ['Splash'])], [set('Garchomp', ['Splash'])]);
      inReplayMode(battle, 100);
      const body = bodyAt(battle, 331);
      expect(sightedHp(body, { hp: 100, maxhp: 100 }), shape.format).toBe(331);
      const one = sightedHp(body, { hp: 1, maxhp: 100 })!;
      expect(one, shape.format).toBeGreaterThanOrEqual(1);
      expect(shownAt(body, one), shape.format).toBe(1);
    }
  });
});

/** The scene the corrections run on: a hit on the first body, then a switch that leaves it benched. */
interface Scene {
  format: string;
  doubles: boolean;
  scale: 100 | 48;
  champions?: boolean;
}
const SCENES: Scene[] = [
  { format: 'gen9ou', doubles: false, scale: 100 },
  { format: 'gen9doublesou', doubles: true, scale: 100 },
  { format: 'gen9championsou', doubles: false, scale: 100, champions: true },
  { format: 'gen9championsdoublescustomgame', doubles: true, scale: 100, champions: true },
  { format: 'gen6ou', doubles: false, scale: 100 },
];
const teamsOf = (doubles: boolean) => ({
  p1: [set('Snorlax', ['Splash']), set('Blissey', ['Splash']), set('Gliscor', ['Splash'])].slice(0, doubles ? 3 : 2),
  p2: [set('Pikachu', ['Thunderbolt', 'Splash']), set('Rotom', ['Thunderbolt', 'Splash'])].slice(0, doubles ? 2 : 1),
});

/** The public log of the game: the viewers' lines only (a `|split|` line is followed by the private line, then the public one). */
function publicLog(battle: Battle): string {
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
}

function play(scene: Scene, seed: number): { battle: SimBattle; log: string } {
  const teams = teamsOf(scene.doubles);
  const battle = battleOf(scene.format, teams.p1, teams.p2, seed);
  inReplayMode(battle, scene.scale);
  battle.choose('p1', 'default');
  battle.choose('p2', 'default');
  if (scene.doubles) {
    battle.choose('p1', 'move 1, move 1');
    battle.choose('p2', 'move 1 1, move 1 2');
    battle.choose('p1', 'switch 3, move 1');
    battle.choose('p2', 'move 2, move 2');
  } else {
    battle.choose('p1', 'move 1');
    battle.choose('p2', 'move 1');
    battle.choose('p1', 'switch 2');
    battle.choose('p2', 'move 1');
  }
  return { battle: battle as unknown as SimBattle, log: publicLog(battle) };
}

const snapshotAt = (log: string, turn: number): TurnSnapshot =>
  parseReplayLogWithObservations(log).snapshots.find(snapshot => snapshot.turn === turn)!;

describe.each(SCENES)('T161 the corrections write the middle of the range ($format)', scene => {
  test('a benched body and an active body show the sighted percent and stand in the middle', () => {
    let covered = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const game = play(scene, seed);
      const snapshot = snapshotAt(game.log, 3);
      // The simulator's own run drew other damage; the correction hands it the game's sightings.
      const own = play(scene, seed + 1000);
      correctBattleFromSnapshot(own.battle, snapshot);
      // Snorlax took the first hit and left the field (benched, a sighting), Blissey stands on it (active).
      for (const [name, isActive] of [['Snorlax', false], ['Blissey', true]] as const) {
        const sighted = snapshot.p1.pokemon.find(pokemon => pokemon.name === name)!;
        expect(sighted.isActive, name).toBe(isActive);
        expect(sighted.maxhp, `${scene.format} ${name}`).toBe(scene.scale);
        const body = own.battle.sides[0].pokemon.find(pokemon => pokemon.name === name)! as unknown as HpDisplayBody;
        const corrected = body.hp;
        const hps = allowedHps(body).get(sighted.hp);
        body.hp = corrected;
        expect(hps, `${scene.format} ${name} seed ${seed}: nothing shows ${sighted.hp}`).toBeDefined();
        expect(hps, `${scene.format} ${name} seed ${seed}: ${corrected} does not show ${sighted.hp}`).toContain(corrected);
        expect(Math.abs(2 * corrected - (hps![0] + hps![hps!.length - 1])), `${scene.format} ${name} seed ${seed} ${sighted.hp}% -> ${corrected} of ${body.maxhp}`).toBeLessThanOrEqual(1);
        covered++;
      }
    }
    expect(covered).toBe(24);
  });
});
