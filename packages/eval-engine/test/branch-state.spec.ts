import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { createBranchStateFromBattle, createBranchState } from '../src/branch/state';
import { serializeBattleStable, positionBattle, type SimPosition } from '../src/forward-model';
import type { BranchMoveOption } from '../src/branch/types';
import { set, singles, clickTera } from './move-oracle';
import { battleOf } from './power-oracle';
import { BattleStreams, Teams } from '@pkmn/sim';
import { calcSingleDamageRange } from '../src/damage-calc';
import { rootOf } from './calc-roll-oracle';
import { doubles, IDLE_ALONE, SCENES, SCREENS, wall, type Scene } from './forced-spread-scenes';
import { simDamages } from './sim-rolls';

/**
 * Round 69 (T182): a move button also carries the type the move lands with
 * after the Tera click (typeUnderTera), read from the simulator on a copy of
 * the battle where the simulator's own terastallize ran. The oracle here is
 * the real queue: the same position played through the click, then read with
 * the same reading as `type`. Singles and doubles share the code (VGC is a
 * doubles format).
 */
const SINGLES = 'gen9customgame';
const DOUBLES = 'gen9doublescustomgame';
const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);

const movesOf = (battle: Battle, side: 'p1' | 'p2' = 'p1', slot = 0): BranchMoveOption[] =>
  createBranchStateFromBattle(battle, [], {})[`${side}MovesBySlot`][slot];

const byName = (moves: BranchMoveOption[]) => Object.fromEntries(moves.map(move => [move.name, move]));

/** What the button should show with the toggle pressed: the label the state computed before the click. */
const underTera = (moves: BranchMoveOption[]) => Object.fromEntries(moves.map(move => [move.name, move.typeUnderTera ?? move.type]));
/** What the simulator's queue gives after the click: the state's plain reading on the terastallized body. */
const afterClick = (moves: BranchMoveOption[]) => Object.fromEntries(moves.map(move => [move.name, move.type]));

/** Slot `slot` of p1 clicks Tera on its first move (a Splash); everyone else Splashes. */
function clickTeraAt(battle: Battle, slot: number, doubles: boolean) {
  const own = doubles ? [0, 1].map(index => (index === slot ? 'move 1 terastallize' : 'move 1')).join(', ') : 'move 1 terastallize';
  battle.choose('p1', own);
  battle.choose('p2', doubles ? 'move 1, move 1' : 'move 1');
}

const ogerpon = (teraType: string) =>
  set('Ogerpon-Wellspring', ['splash', 'ivycudgel', 'terablast'], { item: 'Wellspring Mask', teraType });
const terapagos = () => set('Terapagos', ['splash', 'terastarstorm', 'terablast'], { ability: 'Tera Shift', teraType: 'Stellar' });
const garchomp = () => set('Garchomp', ['splash', 'terablast', 'earthquake'], { teraType: 'Fairy' });

describe('typeUnderTera labels a move with the type after the Tera click (T182)', () => {
  test('singles: Ogerpon-Wellspring follows the simulator\'s queue for Ivy Cudgel and Tera Blast', () => {
    const lead = [ogerpon('Water')];
    const before = movesOf(singles(SINGLES, lead, [splash('Snorlax')]));
    const played = singles(SINGLES, lead, [splash('Snorlax')]);
    clickTeraAt(played, 0, false);
    const oracle = afterClick(movesOf(played));
    expect(underTera(before)).toEqual(oracle);
    // The click changes Tera Blast (Normal to Water) and leaves the mask's Ivy Cudgel alone.
    expect(byName(before)['Tera Blast'].type).toBe('Normal');
    expect(byName(before)['Tera Blast'].typeUnderTera).toBe(oracle['Tera Blast']);
    expect(byName(before)['Ivy Cudgel'].typeUnderTera).toBeUndefined();
  });

  test('singles: a Tera type the simulator refuses for Ogerpon changes nothing', () => {
    const before = movesOf(singles(SINGLES, [ogerpon('Fairy')], [splash('Snorlax')]));
    const played = singles(SINGLES, [ogerpon('Fairy')], [splash('Snorlax')]);
    clickTeraAt(played, 0, false);
    expect(underTera(before)).toEqual(afterClick(movesOf(played)));
    expect(before.every(move => move.typeUnderTera === undefined)).toBe(true);
  });

  test('singles: Terapagos-Terastal reads Stellar for Tera Starstorm, as the queue does', () => {
    const before = movesOf(singles(SINGLES, [terapagos()], [splash('Snorlax')]));
    const played = singles(SINGLES, [terapagos()], [splash('Snorlax')]);
    clickTeraAt(played, 0, false);
    const oracle = afterClick(movesOf(played));
    expect(oracle['Tera Starstorm']).toBe('Stellar');
    expect(underTera(before)).toEqual(oracle);
    expect(byName(before)['Tera Starstorm'].typeUnderTera).toBe('Stellar');
  });

  test('singles: a plain Tera Blast user reads its Tera type; a move without a type hook carries nothing', () => {
    const before = movesOf(singles(SINGLES, [garchomp()], [splash('Snorlax')]));
    const played = singles(SINGLES, [garchomp()], [splash('Snorlax')]);
    clickTeraAt(played, 0, false);
    expect(underTera(before)).toEqual(afterClick(movesOf(played)));
    expect(byName(before)['Tera Blast'].typeUnderTera).toBe('Fairy');
    expect(byName(before).Earthquake.typeUnderTera).toBeUndefined();
    expect(byName(before).Splash.typeUnderTera).toBeUndefined();
  });

  test('singles: a body that cannot terastallize, and one that already did, carry no typeUnderTera', () => {
    // Generation 8 has no Terastallization.
    const gen8 = movesOf(singles('gen8customgame', [set('Sylveon', ['hypervoice', 'splash'], { ability: 'Pixilate' })], [splash('Snorlax')]));
    // Pixilate turns every Normal move Fairy, Splash included.
    expect(gen8.map(move => move.type)).toEqual(['Fairy', 'Fairy']);
    expect(gen8.every(move => move.typeUnderTera === undefined)).toBe(true);
    const played = singles(SINGLES, [garchomp()], [splash('Snorlax')]);
    clickTeraAt(played, 0, false);
    expect(byName(movesOf(played))['Tera Blast'].type).toBe('Fairy');
    expect(movesOf(played).every(move => move.typeUnderTera === undefined)).toBe(true);
  });

  test('doubles: each slot carries its own body\'s label, whichever slot clicks', () => {
    const team = [ogerpon('Water'), garchomp()];
    const foes = [splash('Snorlax'), splash('Blissey')];
    const before = battleOf(DOUBLES, team, foes);
    for (const slot of [0, 1]) {
      const played = battleOf(DOUBLES, team, foes);
      clickTeraAt(played, slot, true);
      expect(underTera(movesOf(before, 'p1', slot))).toEqual(afterClick(movesOf(played, 'p1', slot)));
    }
    expect(byName(movesOf(before, 'p1', 0))['Tera Blast'].typeUnderTera).toBe('Water');
    expect(byName(movesOf(before, 'p1', 1))['Tera Blast'].typeUnderTera).toBe('Fairy');
    expect(byName(movesOf(before, 'p2', 0))).not.toHaveProperty('Tera Blast');
  });

  test('doubles: the Terapagos slot reads Stellar', () => {
    const team = [garchomp(), terapagos()];
    const foes = [splash('Snorlax'), splash('Blissey')];
    const before = battleOf(DOUBLES, team, foes);
    const played = battleOf(DOUBLES, team, foes);
    clickTeraAt(played, 1, true);
    expect(underTera(movesOf(before, 'p1', 1))).toEqual(afterClick(movesOf(played, 'p1', 1)));
    expect(byName(movesOf(before, 'p1', 1))['Tera Starstorm'].typeUnderTera).toBe('Stellar');
  });

  test('guard: reading the state never touches the live battle, and the plain type fields stay as before', () => {
    for (const [format, build] of [
      [SINGLES, () => singles(SINGLES, [ogerpon('Water')], [splash('Snorlax')])],
      [DOUBLES, () => battleOf(DOUBLES, [ogerpon('Water'), terapagos()], [splash('Snorlax'), splash('Blissey')])],
    ] as const) {
      const battle = build();
      const before = serializeBattleStable(battle);
      const logLength = battle.log.length;
      const state = createBranchStateFromBattle(battle, [], {});
      expect(serializeBattleStable(battle), format).toEqual(before);
      expect(battle.log.length).toBe(logLength);
      for (const mon of battle.sides[0].active) {
        expect(mon.terastallized).toBeFalsy();
        expect(mon.canTerastallize).toBeTruthy();
      }
      // The same state with the label stripped is the state the T85 reading builds.
      const stripped = JSON.parse(JSON.stringify(state, (key, value) => (key === 'typeUnderTera' ? undefined : value)));
      expect(stripped.p1MovesBySlot.flat().map((move: BranchMoveOption) => move.type)).toEqual(
        state.p1MovesBySlot.flat().map(move => move.type));
    }
  });
});

const typesOf = (battle: Battle, side: 'p1' | 'p2' = 'p1', slot = 0) =>
  Object.fromEntries(createBranchStateFromBattle(battle, [], {})[`${side}MovesBySlot`][slot].map(move => [move.name, move.type]));

async function liveSingles(p1: PokemonSet[], p2: PokemonSet[]): Promise<BattleStreams.BattleStream> {
  const stream = new BattleStreams.BattleStream();
  const streams = BattleStreams.getPlayerStreams(stream);
  void (async () => {
    for await (const chunk of streams.omniscient) void chunk;
  })();
  void streams.omniscient.write([
    '>start {"formatid":"gen9customgame"}',
    `>player p1 {"name":"Alpha","team":"${Teams.pack(p1)}"}`,
    `>player p2 {"name":"Beta","team":"${Teams.pack(p2)}"}`,
  ].join('\n'));
  const startedAt = Date.now();
  while (!stream.battle?.sides[1]?.active[0] && Date.now() - startedAt < 1500) await new Promise(resolve => setTimeout(resolve, 10));
  if (stream.battle?.requestState === 'teampreview') void streams.omniscient.write('>p1 default\n>p2 default');
  while (stream.battle?.requestState !== 'move' && Date.now() - startedAt < 3000) await new Promise(resolve => setTimeout(resolve, 10));
  return stream;
}

describe('move buttons show the type at use (T85)', () => {
  test('singles: Ivy Cudgel follows the mask; Pixilate and Liquid Voice follow the ability', () => {
    const battle = singles('gen9customgame',
      [set('Ogerpon-Wellspring', ['ivycudgel', 'hornleech'], { item: 'Wellspring Mask' })],
      [set('Sylveon', ['hypervoice', 'shadowball', 'protect'], { ability: 'Pixilate' })]);
    expect(typesOf(battle)).toEqual({ 'Ivy Cudgel': 'Water', 'Horn Leech': 'Grass' });
    // Pixilate turns every Normal move Fairy, a status move like Protect included.
    expect(typesOf(battle, 'p2')).toEqual({ 'Hyper Voice': 'Fairy', 'Shadow Ball': 'Ghost', Protect: 'Fairy' });
  });

  test('Tera Blast reads Normal before the click and the Tera type after it', () => {
    const battle = singles('gen9customgame', [set('Garchomp', ['splash', 'terablast'], { teraType: 'Fairy' })], [splash('Snorlax')]);
    expect(typesOf(battle)['Tera Blast']).toBe('Normal');
    clickTera(battle, 0);
    expect(typesOf(battle)['Tera Blast']).toBe('Fairy');
  });

  test('doubles: each slot list carries its own body\'s types', () => {
    const battle = battleOf('gen9doublescustomgame',
      [set('Ogerpon-Hearthflame', ['ivycudgel'], { item: 'Hearthflame Mask' }), set('Primarina', ['hypervoice', 'moonblast'], { ability: 'Liquid Voice' })],
      [splash('Snorlax'), splash('Blissey')]);
    expect(typesOf(battle, 'p1', 0)).toEqual({ 'Ivy Cudgel': 'Fire' });
    expect(typesOf(battle, 'p1', 1)).toEqual({ 'Hyper Voice': 'Water', Moonblast: 'Fairy' });
  });

  test('the live path labels like the stored path', async () => {
    const stream = await liveSingles([set('Ogerpon-Cornerstone', ['ivycudgel'], { item: 'Cornerstone Mask' })], [splash('Snorlax')]);
    const live = createBranchState(stream, [], {});
    expect(live.p1MovesBySlot[0].map(move => move.type)).toEqual(['Rock']);
    expect(live.p1MovesBySlot[0]).toEqual(createBranchStateFromBattle(stream.battle, [], {}).p1MovesBySlot[0]);
  });

  test('asking the simulator writes nothing to the log of a custom game, which runs in debug mode', () => {
    const battle = singles('gen9customgame', [set('Garchomp', ['earthquake', 'tackle'])], [splash('Snorlax')]);
    // Electrify's handler retypes the move and writes a debug line when asked.
    battle.sides[0].active[0].addVolatile('electrify');
    const before = battle.log.length;
    expect(typesOf(battle)).toEqual({ Earthquake: 'Electric', Tackle: 'Electric' });
    expect(battle.log.length).toBe(before);
  });
});

async function waitForBattle(
  stream: BattleStreams.BattleStream,
  predicate: (battle: NonNullable<BattleStreams.BattleStream['battle']>) => boolean,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1500) {
    if (stream.battle && predicate(stream.battle)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for battle state');
}

async function createDoublesBattle() {
  const battleStream = new BattleStreams.BattleStream();
  const streams = BattleStreams.getPlayerStreams(battleStream);
  const log: string[] = [];

  void (async () => {
    for await (const chunk of streams.omniscient) {
      log.push(...chunk.split('\n').filter(line => line.trim()));
    }
  })();

  const p1Team: PokemonSet[] = [
    {
      name: 'Amoonguss',
      species: 'Amoonguss',
      ability: 'Regenerator',
      item: 'Sitrus Berry',
      moves: ['Spore', 'Pollen Puff', 'Rage Powder', 'Protect'],
      nature: 'Calm',
      evs: { hp: 252, atk: 0, def: 0, spa: 4, spd: 252, spe: 0 },
      gender: '',
      level: 100,
    },
    {
      name: 'Incineroar',
      species: 'Incineroar',
      ability: 'Intimidate',
      item: 'Safety Goggles',
      moves: ['Fake Out', 'Flare Blitz', 'Parting Shot', 'Protect'],
      nature: 'Careful',
      evs: { hp: 252, atk: 4, def: 0, spa: 0, spd: 252, spe: 0 },
      gender: '',
      level: 100,
    },
    {
      name: 'Rillaboom',
      species: 'Rillaboom',
      ability: 'Grassy Surge',
      item: 'Assault Vest',
      moves: ['Fake Out', 'Wood Hammer', 'Grassy Glide', 'U-turn'],
      nature: 'Adamant',
      evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
      gender: '',
      level: 100,
    },
    {
      name: 'Flutter Mane',
      species: 'Flutter Mane',
      ability: 'Protosynthesis',
      item: 'Booster Energy',
      moves: ['Moonblast', 'Shadow Ball', 'Dazzling Gleam', 'Protect'],
      nature: 'Timid',
      evs: { hp: 0, atk: 0, def: 4, spa: 252, spd: 0, spe: 252 },
      gender: '',
      level: 100,
    },
  ];
  const p2Team = p1Team.map(set => ({ ...set, name: `${set.name} 2` }));

  const command = [
    '>start {"formatid":"gen9doublesou"}',
    `>player p1 {"name":"Player 1","team":"${Teams.pack(p1Team)}"}`,
    `>player p2 {"name":"Player 2","team":"${Teams.pack(p2Team)}"}`,
  ].join('\n');

  void streams.omniscient.write(command);
  await waitForBattle(battleStream, battle => !!battle.sides[0] && !!battle.sides[1]);
  void streams.omniscient.write('>p1 default\n>p2 default');
  await waitForBattle(battleStream, battle => battle.requestState === 'move');

  return { battleStream, log };
}

describe('usage stats and doubles support', () => {
  test('exposes doubles active slots and slot-specific choices', async () => {
    const { battleStream, log } = await createDoublesBattle();
    const state = createBranchState(battleStream, log, {
      p1Choice: null,
      p2Choice: null,
    });

    expect(state.p1ActiveSlots.map(active => active?.species)).toEqual(['Amoonguss', 'Incineroar']);
    expect(state.p2ActiveSlots.map(active => active?.species)).toEqual(['Amoonguss', 'Incineroar']);
    expect(state.p1MovesBySlot).toHaveLength(2);
    expect(state.p2MovesBySlot).toHaveLength(2);
    expect(state.p1MovesBySlot[0][0]).toMatchObject({ name: 'Spore', activeSlot: 0, slot: 1 });
    expect(state.p1MovesBySlot[1][0]).toMatchObject({ name: 'Fake Out', activeSlot: 1, slot: 1 });
    expect(state.p1Choices).toEqual([null, null]);
    expect(state.p2Choices).toEqual([null, null]);
  });
});

const optionOf = (scene: Scene) => ({ name: scene.move, activeSlot: 0, slot: 1, pp: 8, maxpp: 8, disabled: false, type: 'Normal', targetType: 'normal', requiresTarget: true, targetOptions: [] });
const pct = (damage: number, maxhp: number) => Math.round(damage / maxhp * 1000) / 10;

/** The preview's result for the first attacker into the first foe, with the live battle of the position when `live`. */
function previewOf(scene: Scene, root: SimPosition, screen: string, live: boolean, battle = positionBattle(root)) {
  const state = createBranchStateFromBattle(battle, [], {});
  const mon = scene.id === 'terastarstorm' ? { ...state.p1ActiveSlots[0]!, teraType: 'Stellar' } : state.p1ActiveSlots[0]!;
  const foe = state.p2ActiveSlots[0]!;
  const context = {
    gen: 9, gameType: 'Doubles' as const, terrain: scene.terrain, defenderSideConditions: screen ? [screen] : [], defenderPartner: null, attackerPartnerAlive: true,
    ...(live ? { liveHit: { battle, attacker: { side: 0 as const, slot: 0 }, defender: { side: 1 as const, slot: 0 }, armed: { attacker: scene.id === 'terastarstorm' } } } : {}),
  };
  return { result: calcSingleDamageRange(mon, foe, optionOf(scene) as never, context), maxhp: foe.maxhp, battle };
}

describe('the preview of a forced spread on a lone foe behind a screen (doubles)', () => {
  for (const scene of SCENES) {
    for (const screen of SCREENS) {
      test(`${scene.title} behind ${screen}: the simulator's range on a copy of the live battle`, () => {
        const root = doubles(scene, screen, true);
        const damages = simDamages(root, scene.choice, IDLE_ALONE, { script: `p1a:${scene.id}>p2a`, target: { side: 1, slot: 0 } });
        const battle = positionBattle(root);
        const before = serializeBattleStable(battle);
        const { result, maxhp } = previewOf(scene, root, screen, true, battle);
        expect([result.minPercent, result.maxPercent]).toEqual([pct(Math.min(...damages.normal), maxhp), pct(Math.max(...damages.normal), maxhp)]);
        // The live battle is read and never written.
        expect(serializeBattleStable(battle), 'the live battle is unchanged').toBe(before);
      });

      test(`${scene.title} behind ${screen}: no live battle, no range`, () => {
        const { result } = previewOf(scene, doubles(scene, screen, true), screen, false);
        expect(result).toMatchObject({ range: '-', minPercent: 0, maxPercent: 0 });
      });
    }

    test(`${scene.title} without a screen: the calc stays exact with or without a live battle`, () => {
      const root = doubles(scene, null, true);
      const damages = simDamages(root, scene.choice, IDLE_ALONE, { script: `p1a:${scene.id}>p2a`, target: { side: 1, slot: 0 } });
      for (const live of [false, true]) {
        const { result, maxhp } = previewOf(scene, root, '', live);
        expect([result.minPercent, result.maxPercent]).toEqual([pct(Math.min(...damages.normal), maxhp), pct(Math.max(...damages.normal), maxhp)]);
      }
    });
  }
});

describe('singles: nothing spreads, the calc prices a screen exactly and needs no live battle', () => {
  for (const scene of SCENES) {
    test(`${scene.title} behind Light Screen`, () => {
      const root = rootOf('gen9customgame', [scene.attacker()], [wall()], battle => {
        scene.field(battle);
        battle.sides[1].addSideCondition('lightscreen', battle.sides[1].active[0]!);
      });
      const choice = scene.choice.replace(' 1', '').replace(', move splash', '');
      const damages = simDamages(root, choice, 'move splash', { script: `p1a:${scene.id}>p2a`, target: { side: 1, slot: 0 } });
      const state = createBranchStateFromBattle(positionBattle(root), [], {});
      const mon = scene.id === 'terastarstorm' ? { ...state.p1ActiveSlots[0]!, teraType: 'Stellar' } : state.p1ActiveSlots[0]!;
      const foe = state.p2ActiveSlots[0]!;
      const result = calcSingleDamageRange(mon, foe, optionOf(scene) as never, { gen: 9, gameType: 'Singles', terrain: scene.terrain, defenderSideConditions: ['lightscreen'] });
      expect([result.minPercent, result.maxPercent]).toEqual([pct(Math.min(...damages.normal), foe.maxhp), pct(Math.max(...damages.normal), foe.maxhp)]);
    });
  }
});

const stellar = () => set('Garchomp', ['earthquake', 'stoneedge'], { teraType: 'Stellar' });

describe('the picker state carries the spent Stellar types (T124 point 5)', () => {
  test('singles: none before the Tera turn, the move\'s type after it', () => {
    const battle = battleOf('gen9customgame', [stellar()], [splash('Snorlax')]);
    expect(createBranchStateFromBattle(battle, [], {}).p1ActiveSlots[0]?.stellarBoostedTypes).toEqual([]);
    battle.choose('p1', 'move earthquake terastallize');
    battle.choose('p2', 'move splash');
    const [garchomp] = createBranchStateFromBattle(battle, [], {}).p1ActiveSlots;
    expect(garchomp?.teraType).toBe('Stellar');
    expect(garchomp?.stellarBoostedTypes).toEqual(['Ground']);
    expect(garchomp?.stellarBoostedTypes).not.toBe(battle.sides[0].active[0].stellarBoostedTypes);
  });

  test('doubles: the slot that terastallized carries its spent type, its partner none', () => {
    const battle = battleOf('gen9doublescustomgame', [stellar(), splash('Corviknight')], [splash('Snorlax'), splash('Blissey')]);
    battle.choose('p1', 'move earthquake terastallize, move splash');
    battle.choose('p2', 'move splash, move splash');
    const [garchomp, corviknight] = createBranchStateFromBattle(battle, [], {}).p1ActiveSlots;
    // The simulator records the type once per target the boosted use hit: the copy keeps its list as it is.
    expect(garchomp?.stellarBoostedTypes).toEqual(['Ground', 'Ground']);
    expect(garchomp?.stellarBoostedTypes).toEqual(battle.sides[0].active[0].stellarBoostedTypes);
    expect(corviknight?.stellarBoostedTypes).toEqual([]);
  });
});
