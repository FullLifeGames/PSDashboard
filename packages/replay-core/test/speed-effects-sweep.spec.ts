import { describe, expect, test } from 'vitest';
import type { Battle, Pokemon } from '@pkmn/sim';
import { parseReplayLogWithObservations } from '../src/protocol-parser';
import { raceSpeed } from '../src/spreads/race-speed';
import type { RulesDex } from '../src/rules-dex';
import type { RaceSpeedEffects } from '../src/types';
import { RULE_VIEWS } from './screen-scenes';
import { SINGLES_VIEWS, battleIn, mon, type SimView } from './sim-views';

type Class = 'factor' | 'first-drop' | 'second-drop' | 'hidden';

const CLASSES: Record<string, { class: Class; reason: string }> = {
  choicescarf: { class: 'factor', reason: 'the item path of scarfedSpeed' },
  protosynthesis: { class: 'factor', reason: 'the volatile the log starts, Speed only when its stat is spe' },
  quarkdrive: { class: 'factor', reason: 'the volatile the log starts, Speed only when its stat is spe' },
  tailwind: { class: 'factor', reason: 'a side condition the client keeps' },
  grasspledge: { class: 'factor', reason: 'a side condition the client keeps' },
  slowstart: { class: 'factor', reason: 'the volatile of the counting ability' },
  quickfeet: { class: 'factor', reason: 'revealed with the status it reads; hidden it drops the first mover' },
  chlorophyll: { class: 'first-drop', reason: 'weather doubles the first mover; the ability may be unrevealed' },
  swiftswim: { class: 'first-drop', reason: 'weather doubles the first mover; the ability may be unrevealed' },
  sandrush: { class: 'first-drop', reason: 'weather doubles the first mover; the ability may be unrevealed' },
  slushrush: { class: 'first-drop', reason: 'weather doubles the first mover; the ability may be unrevealed' },
  surgesurfer: { class: 'first-drop', reason: 'terrain doubles the first mover; the ability may be unrevealed' },
  unburden: { class: 'first-drop', reason: 'a lost item doubles the first mover; the ability may be unrevealed' },
  par: { class: 'second-drop', reason: 'paralysis slows the second mover below the order' },
  ironball: { class: 'hidden', reason: 'the item may be unrevealed' },
  machobrace: { class: 'hidden', reason: 'the item may be unrevealed' },
  poweranklet: { class: 'hidden', reason: 'the item may be unrevealed' },
  powerband: { class: 'hidden', reason: 'the item may be unrevealed' },
  powerbelt: { class: 'hidden', reason: 'the item may be unrevealed' },
  powerbracer: { class: 'hidden', reason: 'the item may be unrevealed' },
  powerlens: { class: 'hidden', reason: 'the item may be unrevealed' },
  powerweight: { class: 'hidden', reason: 'the item may be unrevealed' },
  quickpowder: { class: 'hidden', reason: 'the item may be unrevealed' },
};

const HANDLER_COUNT: Record<string, number> = {
  'Gen 1': 0, 'Gen 2': 1, 'Gen 3': 4, 'Gen 4': 17, 'Gen 5': 19, 'Gen 6': 19, 'Gen 7': 21, 'Gen 8': 21, 'Gen 9': 23, Champions: 23,
};

type Entry = { id: string; gen?: number } & Record<string, unknown>;

function handlerIds(dex: RulesDex, hook: string): string[] {
  const entries = [
    ...dex.abilities.all(), ...dex.items.all(), ...dex.moves.all(),
    ...Object.keys(dex.data.Conditions).map(id => dex.conditions.get(id)),
  ] as unknown as Entry[];
  const ids = entries.filter(entry => {
    const condition = entry['condition'] as Record<string, unknown> | undefined;
    return (entry[hook] !== undefined || condition?.[hook] !== undefined) && (entry.gen ?? 0) <= dex.gen;
  }).map(entry => entry.id);
  return [...new Set(ids)].sort();
}

const asDex = (view: SimView) => view.dex as unknown as RulesDex;

describe('every Speed handler of the Dex has a class, Past and Unobtainable ones too (a Custom Game plays them)', () => {
  test.each(SINGLES_VIEWS)('$name', view => {
    const ids = handlerIds(asDex(view), 'onModifySpe');
    expect(ids).toHaveLength(HANDLER_COUNT[view.name]);
    expect(ids.filter(id => !CLASSES[id])).toEqual([]);
  });

  test('Champions plays the Speed handlers of Generation 9, the Dex the parser reads its side conditions from', () => {
    expect(handlerIds(asDex(SINGLES_VIEWS[9]), 'onModifySpe')).toEqual(handlerIds(asDex(SINGLES_VIEWS[8]), 'onModifySpe'));
  });

  test('every class names a handler of some Dex', () => {
    const named = new Set(SINGLES_VIEWS.flatMap(view => handlerIds(asDex(view), 'onModifySpe')));
    expect(Object.keys(CLASSES).filter(id => !named.has(id))).toEqual([]);
  });
});

const ORDER_READERS: Record<string, string> = {
  custapberry: 'quickActed', quickclaw: 'quickActed', quickdraw: 'quickActed', galewings: 'conditionalPriority',
  grassyglide: 'conditionalPriority', prankster: 'conditionalPriority', triage: 'conditionalPriority',
  myceliummight: 'secondMoverContaminated', stall: 'secondMoverContaminated', fullincense: 'hidden item', laggingtail: 'hidden item',
};

describe('the order handlers outside onModifySpe and where they are read', () => {
  test('Gen 9 holds exactly the fractional-priority and priority handlers the parser names', () => {
    const dex = asDex(SINGLES_VIEWS[8]);
    expect([...handlerIds(dex, 'onFractionalPriority'), ...handlerIds(dex, 'onModifyPriority')].sort()).toEqual(Object.keys(ORDER_READERS).sort());
  });
});

interface Factor {
  title: string;
  effects: RaceSpeedEffects;
  applies: (dex: RulesDex) => boolean;
  setup: (view: SimView, scarf: boolean) => Battle;
}

const split = (view: SimView, own: string, foe: string) => (view.doubles ? `${own}, move splash` : own) + '|' + (view.doubles ? `${foe}, move splash` : foe);
const play = (battle: Battle, view: SimView, own: string, foe = 'move splash'): void => {
  const [p1, p2] = split(view, own, foe).split('|');
  battle.makeChoices(p1, p2);
};
const team = (view: SimView, lead: Parameters<typeof mon>) => [mon(...lead), ...(view.doubles ? [mon('Blissey', ['splash'])] : [])];
const leadOf = (battle: Battle): Pokemon => battle.sides[0].active[0]!;
const hasScarf = (dex: RulesDex) => dex.items.get('choicescarf').exists && dex.items.get('choicescarf').gen <= dex.gen;

const PARADOX = [
  { volatile: 'protosynthesis', species: 'Walking Wake', ability: 'Protosynthesis', setter: 'sunnyday' },
  { volatile: 'quarkdrive', species: 'Iron Bundle', ability: 'Quark Drive', setter: 'electricterrain' },
];

const FACTORS: Factor[] = [
  {
    title: 'a Speed stage', effects: { stage: 2 }, applies: dex => dex.gen >= 2,
    setup: (view, scarf) => {
      const battle = battleIn(view, team(view, ['Smeargle', ['agility', 'splash'], { item: scarf ? 'Choice Scarf' : '' }]), team(view, ['Smeargle', ['splash']]));
      play(battle, view, 'move agility');
      return battle;
    },
  },
  {
    title: 'Tailwind', effects: { sideConditions: ['tailwind'] }, applies: dex => dex.moves.get('tailwind').gen <= dex.gen && dex.moves.get('tailwind').exists,
    setup: (view, scarf) => {
      const battle = battleIn(view, team(view, ['Smeargle', ['tailwind', 'splash'], { item: scarf ? 'Choice Scarf' : '' }]), team(view, ['Smeargle', ['splash']]));
      play(battle, view, 'move tailwind');
      return battle;
    },
  },
  ...PARADOX.map(paradox => ({
    title: `${paradox.species} under ${paradox.ability} Speed`,
    effects: { volatile: paradox.volatile } as RaceSpeedEffects,
    applies: (dex: RulesDex) => dex.gen >= 9 && dex.abilities.get(paradox.ability).exists,
    setup: (view: SimView, scarf: boolean) => {
      const own = mon(paradox.species, ['splash'], {
        item: scarf ? 'Choice Scarf' : '', ability: paradox.ability, nature: 'Jolly',
        evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 252 }, ivs: { hp: 31, atk: 0, def: 31, spa: 0, spd: 31, spe: 31 },
      });
      const battle = battleIn(view, [own, ...(view.doubles ? [mon('Blissey', ['splash'])] : [])], [mon('Smeargle', [paradox.setter, 'splash']), ...(view.doubles ? [mon('Smeargle', ['splash'])] : [])]);
      play(battle, view, 'move splash', `move ${paradox.setter}`);
      return battle;
    },
  })),
];

const SPEEDS = [100, 257, 412];

describe.each(RULE_VIEWS.filter(view => view.dex.gen >= 2))('a race Speed with effects equals the simulator\'s action Speed: $name', view => {
  const dex = asDex(view);
  for (const scarf of [false, true]) {
    if (scarf && !hasScarf(dex)) continue;
    for (const factor of FACTORS.filter(entry => entry.applies(dex))) {
      test(`${factor.title}, Scarf ${scarf ? 'on' : 'off'}`, () => {
        const battle = factor.setup(view, scarf);
        const holder = leadOf(battle);
        if (factor.effects.volatile) {
          expect(holder.volatiles[factor.effects.volatile], 'the paradox volatile started').toBeDefined();
          expect(holder.volatiles[factor.effects.volatile].bestStat).toBe('spe');
        }
        if (factor.effects.stage) expect(holder.boosts.spe).toBe(factor.effects.stage);
        for (const speed of SPEEDS) {
          holder.storedStats.spe = speed;
          expect(raceSpeed(dex, speed, scarf, [factor.effects]), `Speed ${speed}`).toBe(holder.getActionSpeed());
        }
      });
    }
  }
});

describe('raceSpeed reads a list of effects by its pick', () => {
  const dex = asDex(SINGLES_VIEWS[8]);
  const plain: RaceSpeedEffects = {};
  const tailwind: RaceSpeedEffects = { sideConditions: ['tailwind'] };

  test('the winner reads the faster entry, the loser the slower', () => {
    expect(raceSpeed(dex, 300, false, [plain, tailwind], 'max')).toBe(600);
    expect(raceSpeed(dex, 300, false, [plain, tailwind], 'min')).toBe(300);
    expect(raceSpeed(dex, 300, true, [plain, tailwind], 'min')).toBe(450);
  });

  test('an effect-less race keeps the plain and the Scarf path', () => {
    expect(raceSpeed(dex, 300, false)).toBe(300);
    expect(raceSpeed(dex, 300, true)).toBe(450);
    expect(raceSpeed(dex, 300, false, undefined, 'min')).toBe(300);
  });

  test('one key reads the same value in any call order across other keys', () => {
    const first = raceSpeed(dex, 257, true, [{ stage: 1 }]);
    raceSpeed(dex, 257, true, [{ volatile: 'protosynthesis' }]);
    raceSpeed(dex, 412, false, [tailwind]);
    expect(raceSpeed(dex, 257, true, [{ stage: 1 }])).toBe(first);
  });
});

type Kind = 'singles' | 'doubles';
const KINDS: Kind[] = ['singles', 'doubles'];

const sceneLog = (kind: Kind, tier: string, gen: number, setup: string[], turn: string[]) => [
  '|player|p1|Alice|', '|player|p2|Bob|', '|teamsize|p1|2', '|teamsize|p2|2',
  `|gen|${gen}`, `|gametype|${kind}`, `|tier|${tier}`, '|start',
  ...setup, '|turn|1', ...turn, '|turn|2',
].join('\n');
const racesOf = (log: string) => parseReplayLogWithObservations(log).speedOrders;

describe('the parser records the Speed effects the loser stood under', () => {
  test('925992 t35: Walking Wake under Protosynthesis Speed falls to Zamazenta and the race records the paradox', () => {
    const log = sceneLog('singles', '[Gen 9] OU', 9, [
      '|switch|p1a: Wake|Walking Wake|100/100', '|-activate|p1a: Wake|ability: Protosynthesis', '|-start|p1a: Wake|protosynthesisspe',
      '|switch|p2a: Zam|Zamazenta|100/100',
    ], ['|move|p2a: Zam|Close Combat|p1a: Wake', '|-damage|p1a: Wake|0 fnt', '|faint|p1a: Wake']);
    expect(racesOf(log)).toEqual([{
      firstSide: 'p2', firstSpecies: 'Zamazenta', secondSide: 'p1', secondSpecies: 'Walking Wake', turn: 1, knockOut: true,
      secondSpeed: [{ volatile: 'protosynthesis' }],
    }]);
  });

  test('a paradox volatile that boosts Attack records no Speed effect', () => {
    const log = sceneLog('singles', '[Gen 9] OU', 9, [
      '|switch|p1a: Wake|Walking Wake|100/100', '|-activate|p1a: Wake|ability: Protosynthesis', '|-start|p1a: Wake|protosynthesisatk',
      '|switch|p2a: Zam|Zamazenta|100/100',
    ], ['|move|p2a: Zam|Close Combat|p1a: Wake', '|-damage|p1a: Wake|0 fnt', '|faint|p1a: Wake']);
    expect(racesOf(log).map(race => race.secondSpeed)).toEqual([undefined]);
  });

  test('Neutralizing Gas on the field: no paradox factor on the loser', () => {
    const log = sceneLog('singles', '[Gen 9] OU', 9, [
      '|switch|p1a: Wake|Walking Wake|100/100', '|-activate|p1a: Wake|ability: Protosynthesis', '|-start|p1a: Wake|protosynthesisspe',
      '|switch|p2a: Wee|Weezing-Galar, M|100/100', '|-ability|p2a: Wee|Neutralizing Gas',
    ], ['|move|p2a: Wee|Sludge Bomb|p1a: Wake', '|-damage|p1a: Wake|0 fnt', '|faint|p1a: Wake']);
    const races = racesOf(log);
    expect(races).toHaveLength(1);
    expect(races[0].secondSpeed).toBeUndefined();
  });

  test('a VGC knock-out across the field on a victim under its side\'s Tailwind records the Tailwind', () => {
    const log = sceneLog('doubles', '[Gen 9] Doubles OU', 9, [
      '|switch|p1a: Zam|Zamazenta|100/100', '|switch|p1b: Gar|Garchomp, M|100/100',
      '|switch|p2a: King|Kingambit, M|100/100', '|switch|p2b: Gho|Gholdengo|100/100',
      '|-sidestart|p2: Bob|move: Tailwind',
    ], ['|move|p1a: Zam|Close Combat|p2b: Gho', '|-damage|p2b: Gho|0 fnt', '|faint|p2b: Gho']);
    expect(racesOf(log)).toEqual([{
      firstSide: 'p1', firstSpecies: 'Zamazenta', secondSide: 'p2', secondSpecies: 'Gholdengo', turn: 1, knockOut: true,
      secondSpeed: [{ sideConditions: ['tailwind'] }],
    }]);
  });

  const doubles = (turn: string[]) => sceneLog('doubles', '[Gen 9] Doubles OU', 9, [
    '|switch|p1a: Zam|Zamazenta|100/100', '|switch|p1b: Gar|Garchomp, M|100/100',
    '|switch|p2a: King|Kingambit, M|100/100', '|switch|p2b: Gho|Gholdengo|100/100',
  ], turn);
  const pair = (first: string, second: string, extra: object = {}) => ({
    firstSide: first === 'Zamazenta' ? 'p1' : 'p2', firstSpecies: first, secondSide: first === 'Zamazenta' ? 'p2' : 'p1', secondSpecies: second, turn: 1, ...extra,
  });

  test('the loser\'s partner sets Tailwind after the first mover acted: no effect', () => {
    const races = racesOf(doubles([
      '|move|p1a: Zam|Close Combat|p2a: King', '|-damage|p2a: King|50/100',
      '|move|p2b: Gho|Tailwind|p2b: Gho', '|-sidestart|p2: Bob|move: Tailwind',
      '|move|p2a: King|Iron Head|p1a: Zam', '|-damage|p1a: Zam|60/100',
    ]));
    expect(races).toEqual([pair('Zamazenta', 'Gholdengo'), pair('Zamazenta', 'Kingambit')]);
  });

  test('the loser\'s partner sets Tailwind before the first mover acted: two entries, read at the slower', () => {
    const races = racesOf(doubles([
      '|move|p2b: Gho|Tailwind|p2b: Gho', '|-sidestart|p2: Bob|move: Tailwind',
      '|move|p1a: Zam|Close Combat|p2a: King', '|-damage|p2a: King|50/100',
      '|move|p2a: King|Iron Head|p1a: Zam', '|-damage|p1a: Zam|60/100',
    ]));
    expect(races).toEqual([pair('Gholdengo', 'Zamazenta'), pair('Zamazenta', 'Kingambit', { secondSpeed: [{}, { sideConditions: ['tailwind'] }] })]);
  });

  test.each(KINDS)('a Speed stage on the loser enters its race: %s', kind => {
    const lead = kind === 'singles'
      ? ['|switch|p1a: Zam|Zamazenta|100/100', '|switch|p2a: King|Kingambit, M|100/100', '|-boost|p2a: King|spe|1']
      : ['|switch|p1a: Zam|Zamazenta|100/100', '|switch|p1b: Gar|Garchomp, M|100/100', '|switch|p2a: Gho|Gholdengo|100/100', '|switch|p2b: King|Kingambit, M|100/100', '|-boost|p2b: King|spe|1'];
    const victim = kind === 'singles' ? 'p2a: King' : 'p2b: King';
    const log = sceneLog(kind, kind === 'singles' ? '[Gen 9] OU' : '[Gen 9] Doubles OU', 9, lead,
      ['|move|p1a: Zam|Close Combat|' + victim, `|-damage|${victim}|0 fnt`, `|faint|${victim}`]);
    expect(racesOf(log).map(race => race.secondSpeed)).toEqual([[{ stage: 1 }]]);
  });

  test.each(KINDS)('a loser slowed by a stage or paralysis drops the race: %s', kind => {
    const slowed = (line: string) => {
      const lead = kind === 'singles'
        ? ['|switch|p1a: Zam|Zamazenta|100/100', '|switch|p2a: King|Kingambit, M|100/100', line.replace('X', 'p2a: King')]
        : ['|switch|p1a: Zam|Zamazenta|100/100', '|switch|p1b: Gar|Garchomp, M|100/100', '|switch|p2a: Gho|Gholdengo|100/100', '|switch|p2b: King|Kingambit, M|100/100', line.replace('X', 'p2b: King')];
      const victim = kind === 'singles' ? 'p2a: King' : 'p2b: King';
      return racesOf(sceneLog(kind, kind === 'singles' ? '[Gen 9] OU' : '[Gen 9] Doubles OU', 9, lead,
        ['|move|p1a: Zam|Close Combat|' + victim, `|-damage|${victim}|0 fnt`, `|faint|${victim}`]));
    };
    expect(slowed('|-status|X|par')).toEqual([]);
    expect(slowed('|-unboost|X|spe|1')).toEqual([]);
  });

  test('a loser paralysed at the first mover\'s action and cured before its own drops the race', () => {
    const log = sceneLog('singles', '[Gen 9] OU', 9, [
      '|switch|p1a: Zam|Zamazenta|100/100', '|switch|p2a: King|Kingambit, M|100/100', '|-status|p2a: King|par',
    ], [
      '|move|p1a: Zam|Close Combat|p2a: King', '|-damage|p2a: King|50/100', '|-curestatus|p2a: King|par',
      '|move|p2a: King|Iron Head|p1a: Zam', '|-damage|p1a: Zam|60/100',
    ]);
    expect(racesOf(log)).toEqual([]);
  });

  test('Gen 1 records no Speed effect and Gen 2 a stage; a paralysed loser drops the race in both', () => {
    const gen = (n: number, setup: string[]) => racesOf(sceneLog('singles', `[Gen ${n}] OU`, n, [
      '|switch|p1a: Zap|Zapdos|100/100', '|switch|p2a: Snor|Snorlax, M|100/100', ...setup,
    ], ['|move|p1a: Zap|Thunderbolt|p2a: Snor', '|-damage|p2a: Snor|50/100', '|move|p2a: Snor|Body Slam|p1a: Zap', '|-damage|p1a: Zap|60/100']));
    expect(gen(1, ['|-boost|p2a: Snor|spe|1']).map(race => race.secondSpeed)).toEqual([undefined]);
    expect(gen(2, ['|-boost|p2a: Snor|spe|1']).map(race => race.secondSpeed)).toEqual([[{ stage: 1 }]]);
    expect(gen(1, ['|-status|p2a: Snor|par'])).toEqual([]);
    expect(gen(2, ['|-status|p2a: Snor|par'])).toEqual([]);
  });
});

describe('the parser records the Speed effects the winner stood under', () => {
  const duel = (kind: Kind, setup: string[], turn: string[], gen = 9) => {
    const lead = kind === 'singles'
      ? ['|switch|p1a: Zam|Zamazenta|100/100', '|switch|p2a: King|Kingambit, M|100/100']
      : ['|switch|p1a: Zam|Zamazenta|100/100', '|switch|p1b: Gar|Garchomp, M|100/100', '|switch|p2a: King|Kingambit, M|100/100', '|switch|p2b: Gho|Gholdengo|100/100'];
    return racesOf(sceneLog(kind, kind === 'singles' ? `[Gen ${gen}] OU` : '[Gen 9] Doubles OU', gen, [...lead, ...setup], turn));
  };
  const zamFirst = ['|move|p1a: Zam|Close Combat|p2a: King', '|-damage|p2a: King|50/100', '|move|p2a: King|Iron Head|p1a: Zam', '|-damage|p1a: Zam|60/100'];
  const race = (extra: object = {}) => ({ firstSide: 'p1', firstSpecies: 'Zamazenta', secondSide: 'p2', secondSpecies: 'Kingambit', turn: 1, ...extra });

  test.each(KINDS)('a Speed stage on the winner enters its race, and so does the stage of both movers: %s', kind => {
    expect(duel(kind, ['|-boost|p1a: Zam|spe|2'], zamFirst)).toEqual([race({ firstSpeed: [{ stage: 2 }] })]);
    expect(duel(kind, ['|-boost|p1a: Zam|spe|2', '|-boost|p2a: King|spe|1'], zamFirst))
      .toEqual([race({ firstSpeed: [{ stage: 2 }], secondSpeed: [{ stage: 1 }] })]);
  });

  test.each(KINDS)('a winner that is paralysed or at a negative stage keeps its race with no effect: %s', kind => {
    expect(duel(kind, ['|-status|p1a: Zam|par'], zamFirst)).toEqual([race()]);
    expect(duel(kind, ['|-unboost|p1a: Zam|spe|1'], zamFirst)).toEqual([race()]);
    expect(duel(kind, ['|-status|p1a: Zam|par', '|-boost|p1a: Zam|spe|1'], zamFirst)).toEqual([race({ firstSpeed: [{ stage: 1 }] })]);
  });

  test('a winner under its side\'s Tailwind keeps its race with the effect recorded (VGC)', () => {
    expect(duel('doubles', ['|-sidestart|p1: Alice|move: Tailwind'], zamFirst)).toEqual([race({ firstSpeed: [{ sideConditions: ['tailwind'] }] })]);
  });

  test('a winner\'s partner sets Tailwind before the winner acted: two entries, read at the faster (VGC)', () => {
    const races = duel('doubles', [], [
      '|move|p1b: Gar|Tailwind|p1b: Gar', '|-sidestart|p1: Alice|move: Tailwind', ...zamFirst,
    ]);
    expect(races).toEqual([
      { firstSide: 'p1', firstSpecies: 'Garchomp', secondSide: 'p2', secondSpecies: 'Kingambit', turn: 1 },
      race({ firstSpeed: [{}, { sideConditions: ['tailwind'] }] }),
    ]);
  });

  test('925992 t35 mirrored: a winner under Protosynthesis Speed keeps the race with the paradox, by a move and by a knock-out', () => {
    const lead = ['|switch|p1a: Wake|Walking Wake|100/100', '|-activate|p1a: Wake|ability: Protosynthesis', '|-start|p1a: Wake|protosynthesisspe', '|switch|p2a: Zam|Zamazenta|100/100'];
    const wake = (turn: string[]) => racesOf(sceneLog('singles', '[Gen 9] OU', 9, lead, turn));
    const pairOf = { firstSide: 'p1', firstSpecies: 'Walking Wake', secondSide: 'p2', secondSpecies: 'Zamazenta', turn: 1, firstSpeed: [{ volatile: 'protosynthesis' }] };
    expect(wake(['|move|p1a: Wake|Hydro Steam|p2a: Zam', '|-damage|p2a: Zam|50/100', '|move|p2a: Zam|Close Combat|p1a: Wake', '|-damage|p1a: Wake|60/100']))
      .toEqual([pairOf]);
    expect(wake(['|move|p1a: Wake|Hydro Steam|p2a: Zam', '|-damage|p2a: Zam|0 fnt', '|faint|p2a: Zam']))
      .toEqual([{ ...pairOf, knockOut: true }]);
  });

  test('a winner whose paradox boosts Attack, or whose ability Neutralizing Gas holds down, records no Speed effect', () => {
    const lead = (stat: string) => ['|switch|p1a: Wake|Walking Wake|100/100', '|-activate|p1a: Wake|ability: Protosynthesis', `|-start|p1a: Wake|protosynthesis${stat}`, '|switch|p2a: Wee|Weezing-Galar, M|100/100'];
    const turn = ['|move|p1a: Wake|Hydro Steam|p2a: Wee', '|-damage|p2a: Wee|50/100', '|move|p2a: Wee|Sludge Bomb|p1a: Wake', '|-damage|p1a: Wake|60/100'];
    const wake = (setup: string[]) => racesOf(sceneLog('singles', '[Gen 9] OU', 9, setup, turn));
    const kept = { firstSide: 'p1', firstSpecies: 'Walking Wake', secondSide: 'p2', secondSpecies: 'Weezing-Galar', turn: 1 };
    expect(wake(lead('atk'))).toEqual([kept]);
    expect(wake([...lead('spe'), '|-ability|p2a: Wee|Neutralizing Gas'])).toEqual([kept]);
  });

  test('Trick Room still drops a race whose winner is raised', () => {
    expect(duel('doubles', ['|-sidestart|p1: Alice|move: Tailwind', '|-fieldstart|move: Trick Room'], zamFirst)).toEqual([]);
  });

  test('Gen 2 records a stage on the winner and Gen 1, which keeps Speed in modifiedStats, drops the race', () => {
    const gen = (n: number) => racesOf(sceneLog('singles', `[Gen ${n}] OU`, n, [
      '|switch|p1a: Zap|Zapdos|100/100', '|switch|p2a: Snor|Snorlax, M|100/100', '|-boost|p1a: Zap|spe|1',
    ], ['|move|p1a: Zap|Thunderbolt|p2a: Snor', '|-damage|p2a: Snor|50/100', '|move|p2a: Snor|Body Slam|p1a: Zap', '|-damage|p1a: Zap|60/100']));
    expect(gen(2).map(race => race.firstSpeed)).toEqual([[{ stage: 1 }]]);
    expect(gen(1)).toEqual([]);
  });
});
