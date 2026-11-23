import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet, Dex } from '@pkmn/sim';
import { parseReplayLogWithObservations, type TurnSnapshot } from '@fulllifegames/replay-core';
import { sightedHp, type HpDisplayBody, makePokemonInfo, shownPercent } from '../src/branch/pokemon-info';
import { correctBattleFromSnapshot } from '../src/branch/corrections';
import { loadSimMods } from '../src/forward/sim-mods';
import type { SimBattle } from '../src/branch/types';
import { Field, Generations, Move, Pokemon, calculate } from '@smogon/calc';
import { positionBattle } from '../src/forward-model';
import { boundaryEvent } from '../src/ko-odds';
import { killCount } from '../src/pair/kill-table';
import { checkedRolls, drawTurn, rootOf, rollSet } from './calc-roll-oracle';
import { calcSingleDamageRange } from '../src/damage-calc';

/**
 * The HP a percent sighting stands for is the middle of the HPs the simulator's own display (getHealth) shows as that percent. Gen 7 and
 * later round the percent up, Champions rounds it down, and a Gen 6 game without the HP Percentage Mod shows 48 pixels. The checker holds
 * sightedHp against getHealth itself, over every maximum HP from 50 to 700 and every shown value, and the corrections against a battle that
 * played the hit (battle G is the game, battle A the simulator's own run with another seed). The engine runs a VGC game on the Doubles OU
 * format (a Champions VGC game on the Champions doubles format), so those two formats carry the VGC rows.
 */
await loadSimMods('gen9championsou');

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const set = (species: string, moves: string[], level = 50): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy', evs, ivs, level,
});

interface Case {
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

function shownAt(body: HpDisplayBody, hp: number): number {
  body.hp = hp;
  return Number(/^(\d+)\//.exec(body.getHealth().shared)![1]);
}

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
        }
      }
      expect(checked).toBeGreaterThan(30_000);
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
      const own = play(scene, seed + 1000);
      correctBattleFromSnapshot(own.battle, snapshot);
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

describe('calc-sim-inputs', () => {
  const set = rollSet;
  function overlordRoot(format: 'gen9customgame' | 'gen9doublescustomgame') {
    const doubles = format === 'gen9doublescustomgame';
    const p1 = [set('Pawmot', ['Splash']), ...(doubles ? [set('Corviknight', ['Roost', 'Protect'])] : []),
      set('Kingambit', ['Iron Head'], { ability: 'Supreme Overlord' })];
    const p2 = [set('Snorlax', ['Splash'], { ability: 'Battle Armor' }), ...(doubles ? [set('Blissey', ['Soft-Boiled'], { ability: 'Battle Armor' })] : [])];
    return rootOf(format, p1, p2, (battle: Battle) => {
      battle.sides[0].totalFainted = 3;
      battle.choose('p1', doubles ? 'switch 3, move roost' : 'switch 2');
      battle.choose('p2', doubles ? 'move splash, move softboiled' : 'move splash');
      battle.sides[1].active[0].sethp(120);
    });
  }

  describe('the simulator\'s inputs reach the calc (T76)', () => {
    test('singles: Supreme Overlord\'s fallen count reaches the odds and the table, as the simulator hits', () => {
      const root = overlordRoot('gen9customgame');
      const battle = positionBattle(root);
      const kingambit = battle.sides[0].active[0];
      expect(kingambit.species.name).toBe('Kingambit');
      expect((kingambit.abilityState as { fallen?: number }).fallen).toBe(3);
      const [hit] = checkedRolls(drawTurn(root, 'move ironhead', 'move splash'));
      expect(hit.holds).toBe(true);
      const event = boundaryEvent(battle, kingambit, battle.sides[1].active[0], 'ironhead')!;
      expect(event.normalKillRolls).toBe(killCount(hit.table!.normal, 120));
    });

    test('doubles: Kingambit\'s Iron Head after three faints lands on its kill table', () => {
      const root = overlordRoot('gen9doublescustomgame');
      const hits = checkedRolls(drawTurn(root, 'move ironhead 1, move roost', 'move splash, move softboiled'));
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every(({ holds }) => holds)).toBe(true);
    });

    test('singles and doubles: Booster Energy\'s Quark Drive boosts the stat its volatile names', () => {
      const bundle = () => set('Iron Bundle', ['Ice Beam'], { ability: 'Quark Drive', item: 'Booster Energy' });
      const single = rootOf('gen9customgame', [bundle()], [set('Snorlax', ['Splash'], { ability: 'Battle Armor' })]);
      const drive = (positionBattle(single).sides[0].active[0].volatiles as Record<string, { bestStat?: string }>).quarkdrive;
      expect(drive?.bestStat).toBe('spa');
      expect(checkedRolls(drawTurn(single, 'move icebeam', 'move splash')).every(({ holds }) => holds)).toBe(true);
      const double = rootOf('gen9doublescustomgame', [bundle(), set('Corviknight', ['Roost'])],
        [set('Snorlax', ['Splash'], { ability: 'Battle Armor' }), set('Blissey', ['Soft-Boiled'], { ability: 'Battle Armor' })]);
      const hits = checkedRolls(drawTurn(double, 'move icebeam 1, move roost', 'move splash, move softboiled'));
      expect(hits.length).toBe(1);
      expect(hits[0].holds).toBe(true);
    });

    test('doubles: Last Respects after two faints lands on its kill table (the power its own callback gives)', () => {
      const root = rootOf('gen9doublescustomgame',
        [set('Houndstone', ['Last Respects']), set('Corviknight', ['Roost'])],
        [set('Garchomp', ['Splash'], { ability: 'Battle Armor', evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 } }), set('Blissey', ['Soft-Boiled'], { ability: 'Battle Armor' })],
        battle => { battle.sides[0].totalFainted = 2; });
      const hits = checkedRolls(drawTurn(root, 'move lastrespects 1, move roost', 'move splash, move softboiled'));
      expect(hits.length).toBe(1);
      expect(hits[0].holds).toBe(true);
    });

    test('the picker\'s state carries the volatile\'s stat, the fallen count and the side\'s fallen', () => {
      const battle = positionBattle(overlordRoot('gen9customgame'));
      const kingambit = makePokemonInfo(battle.sides[0].active[0] as never, true, 0);
      expect(kingambit.alliesFainted).toBe(3);
      expect(kingambit.totalFainted).toBe(3);
      expect(kingambit.boostedStat).toBeUndefined();
      const bundle = positionBattle(rootOf('gen9customgame', [set('Iron Bundle', ['Ice Beam'], { ability: 'Quark Drive', item: 'Booster Energy' })], [set('Snorlax', ['Splash'])]));
      expect(makePokemonInfo(bundle.sides[0].active[0] as never, true, 0).boostedStat).toBe('spa');
    });

    test('checker: calc 0.11 prices Last Respects at its listed power whatever alliesFainted says, so the engine passes the power', () => {
      const gen = Generations.get(9);
      const range = (alliesFainted: number) => calculate(gen, new Pokemon(gen, 'Houndstone', { alliesFainted }), new Pokemon(gen, 'Garchomp'), new Move(gen, 'Last Respects'), new Field({})).range();
      expect(range(3)).toEqual(range(0));
    });
  });
});

describe('champions-roll-oracle', () => {
  const SP = { hp: 32, atk: 32, def: 0, spa: 32, spd: 0, spe: 0 };
  const set = (species: string, moves: string[], extra: Partial<PokemonSet> = {}) => rollSet(species, moves, { evs: SP, ...extra });
  const tank = (species: string) => set(species, ['Splash'], { ability: 'No Ability' });

  type Game = 'singles' | 'doubles';
  const FORMAT = { singles: 'gen9championscustomgame', doubles: 'gen9championsdoublescustomgame' } as const;

  interface Scene {
    name: string;
    attacker: () => PokemonSet;
    moveId: string;
    setup?: Parameters<typeof rootOf>[3];
    suffix?: string;
  }

  const SCENES: Scene[] = [
    { name: 'a full hit', attacker: () => set('Garchomp', ['Dragon Claw']), moveId: 'dragonclaw' },
    { name: 'a hit that always crits', attacker: () => set('Glaceon', ['Frost Breath']), moveId: 'frostbreath' },
    { name: 'a spread move into the foes', attacker: () => set('Garchomp', ['Rock Slide']), moveId: 'rockslide' },
    {
      name: 'Reflect and Light Screen on the defender\'s side', attacker: () => set('Garchomp', ['Dragon Claw']), moveId: 'dragonclaw',
      setup: battle => { for (const screen of ['reflect', 'lightscreen']) battle.sides[1].addSideCondition(screen, battle.sides[1].active[0]); },
    },
    { name: 'a Mega attacker', attacker: () => set('Garchomp', ['Dragon Claw'], { item: 'Garchompite' }), moveId: 'dragonclaw', suffix: ' mega' },
  ];

  function drawn(game: Game, scene: Scene) {
    const doubles = game === 'doubles';
    const p1 = [scene.attacker(), ...(doubles ? [set('Corviknight', ['Roost'])] : [])];
    const p2 = [tank('Snorlax'), ...(doubles ? [tank('Blissey')] : [])];
    const root = rootOf(FORMAT[game], p1, p2, scene.setup);
    const needsTarget = ['normal', 'any', 'adjacentFoe'].includes(Dex.dexes.champions.moves.get(scene.moveId).target);
    const attackerChoice = `move ${scene.moveId}${doubles && needsTarget ? ' 1' : ''}${scene.suffix ?? ''}`;
    const choice = doubles ? `${attackerChoice}, move roost` : attackerChoice;
    const reply = doubles ? 'move splash, move splash' : 'move splash';
    return { root, hits: checkedRolls(drawTurn(root, choice, reply)) };
  }

  describe('Champions damage rolls against the simulator (singles and doubles)', () => {
    test('the scenes use moves and items the mod allows', () => {
      const dex = Dex.dexes.champions;
      for (const move of ['dragonclaw', 'frostbreath', 'rockslide', 'reflect', 'lightscreen']) expect(dex.moves.get(move).isNonstandard, move).toBeFalsy();
      expect(dex.items.get('garchompite').exists).toBe(true);
    });

    // Singles' screens halve the damage; the pair plan's kill table prices a doubles field only (singles never ask it), so the
    // singles screen scene runs through the damage preview, which reads the singles field.
    for (const game of ['singles', 'doubles'] as const) {
      for (const scene of SCENES.filter(candidate => game === 'doubles' || candidate !== SCENES[3])) {
        test(`${game}: ${scene.name} lies on the kill table at the drawn roll`, () => {
          const { root, hits } = drawn(game, scene);
          expect(positionBattle(root).dex.currentMod).toBe('champions');
          expect(hits.length, 'a priced hit').toBeGreaterThan(0);
          expect(hits.filter(({ table }) => table === null).length, 'every hit priced').toBe(0);
          expect(hits.filter(({ holds }) => !holds).length, 'hits off the table').toBe(0);
        });
      }
    }

    test('singles: Reflect and Light Screen halve the hit the simulator deals, as the damage preview prices it', () => {
      const scene = SCENES[3];
      const root = rootOf(FORMAT.singles, [scene.attacker()], [tank('Snorlax')], scene.setup);
      const battle = positionBattle(root);
      const [attacker, target] = [battle.sides[0].active[0], battle.sides[1].active[0]];
      const option = { name: 'Dragon Claw', activeSlot: 0, slot: 1, pp: 1, maxpp: 1, disabled: false, type: 'Dragon', targetType: 'normal', requiresTarget: false, targetOptions: [] };
      const priced = calcSingleDamageRange(makePokemonInfo(attacker), makePokemonInfo(target), option, { gameType: 'Singles', gen: 9, defenderSideConditions: ['reflect', 'lightscreen'] });
      const before = target.hp;
      battle.choose('p1', 'move dragonclaw');
      battle.choose('p2', 'move splash');
      const loss = before - target.hp;
      const [min, max] = [priced.minPercent * target.maxhp / 100, priced.maxPercent * target.maxhp / 100];
      expect(loss, `simulator loss ${loss}, preview ${priced.range}`).toBeGreaterThanOrEqual(min - 1);
      expect(loss, `simulator loss ${loss}, preview ${priced.range}`).toBeLessThanOrEqual(max + 1);
      const bare = calcSingleDamageRange(makePokemonInfo(attacker), makePokemonInfo(target), option, { gameType: 'Singles', gen: 9 });
      expect(priced.maxPercent, 'the screens change the price').toBeLessThan(bare.maxPercent);
    });

    test('doubles: the spread move is priced as a spread hit on both foes', () => {
      const { hits } = drawn('doubles', SCENES[2]);
      expect(hits.length).toBe(2);
      expect(hits.every(({ roll }) => roll.snapshot.spreadHit)).toBe(true);
    });
  });
});

describe('hp-percent-readout', () => {
  const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const garchomp: PokemonSet = {
    name: 'Garchomp', species: 'Garchomp', item: '', ability: 'No Ability', moves: ['Splash'], nature: 'Hardy', evs, ivs, level: 50,
  };

  const FORMATS = [
    { label: 'singles', format: 'gen9ou' },
    { label: 'doubles and VGC', format: 'gen9doublesou' },
    { label: 'Champions singles', format: 'gen9championsou' },
    { label: 'Champions doubles and VGC', format: 'gen9championsdoublescustomgame' },
    { label: 'Gen 6 with the HP Percentage Mod', format: 'gen6ou' },
    { label: 'Gen 6 without it', format: 'gen6customgame' },
    { label: 'Gen 4', format: 'gen4ou' },
  ];

  const MODES: { label: string; exact: boolean; percentages: boolean | null }[] = [
    { label: 'the format\'s own', exact: false, percentages: null },
    { label: 'exact HP', exact: true, percentages: false },
    { label: 'percentages', exact: false, percentages: true },
    { label: 'no percentages', exact: false, percentages: false },
  ];

  function battleOf(format: string): Battle {
    return new Battle({
      formatid: toID(format), seed: [1, 2, 3, 4],
      p1: { name: 'Alpha', team: Teams.pack([garchomp]) }, p2: { name: 'Beta', team: Teams.pack([garchomp]) },
    });
  }

  function logPercent(battle: Battle, body: HpDisplayBody, hp: number): number {
    const saved = { exact: battle.reportExactHP, percentages: battle.reportPercentages, hp: body.hp };
    battle.reportExactHP = false;
    battle.reportPercentages = true;
    body.hp = hp;
    const read = /^(\d+)\/100/.exec(body.getHealth().shared);
    battle.reportExactHP = saved.exact;
    battle.reportPercentages = saved.percentages;
    body.hp = saved.hp;
    return read ? Number(read[1]) : 0;
  }

  describe('the branch readouts show the percent of the simulator display', () => {
    for (const shape of FORMATS) {
      test(`shownPercent equals getHealth at every HP of every maximum HP from 50 to 700 (${shape.label})`, () => {
        const battle = battleOf(shape.format);
        const body = battle.sides[0].pokemon[0] as unknown as HpDisplayBody;
        let checked = 0;
        for (const mode of MODES) {
          for (let maxhp = 50; maxhp <= 700; maxhp += maxhp < 120 ? 1 : 7) {
            body.maxhp = maxhp;
            for (let hp = 0; hp <= maxhp; hp++) {
              const expected = logPercent(battle, body, hp);
              battle.reportExactHP = mode.exact;
              if (mode.percentages !== null) battle.reportPercentages = mode.percentages;
              body.hp = hp;
              expect(shownPercent(body), `${shape.format} ${mode.label} ${hp}/${maxhp}`).toBe(expected);
              checked++;
            }
          }
        }
        expect(checked).toBeGreaterThan(100_000);
      });
    }

    test('the body keeps its HP and its display mode afterwards', () => {
      const battle = battleOf('gen6customgame');
      const body = battle.sides[0].pokemon[0] as unknown as HpDisplayBody;
      battle.reportExactHP = true;
      battle.reportPercentages = false;
      body.hp = 77;
      shownPercent(body);
      expect({ hp: body.hp, exact: battle.reportExactHP, percentages: battle.reportPercentages }).toEqual({ hp: 77, exact: true, percentages: false });
    });

    test('the old rounding reads under the log: Gastrodon at 398 of 426 shows 94, the rounding 93', () => {
      const battle = battleOf('gen9ou');
      const body = battle.sides[0].pokemon[0] as unknown as HpDisplayBody;
      body.maxhp = 426;
      body.hp = 398;
      expect(Math.round(398 / 426 * 100)).toBe(93);
      expect(shownPercent(body)).toBe(94);
    });
  });
});
