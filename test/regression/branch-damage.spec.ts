import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { calcSingleDamageRange, createBranchStateFromBattle, type DamageResult } from '@fulllifegames/eval-engine';
import { computePreviewDamage } from '../../src/lib/branch-damage';

// The picker's damage preview reads the body the simulator holds. The preview is read the way BranchPanel reads it
// (createBranchStateFromBattle, computePreviewDamage), then the simulator plays the move and the HP it took must lie inside the
// previewed range (the harness of damage-preview-landing.spec.ts).
const STATS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

function set(species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet {
  return {
    name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
    evs: { ...STATS, hp: 252, atk: 252, spa: 252 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50, gender: '', ...extra,
  };
}

/** A bulky target that takes the hit standing and never takes a crit. */
const armored = (species: string) => set(species, ['Splash'], { evs: { ...STATS, hp: 252, def: 252, spd: 252 }, ability: 'Battle Armor' });

function battle(format: 'gen9customgame' | 'gen9doublescustomgame' | 'gen7customgame' | 'gen7doublescustomgame', p1: PokemonSet[], p2: PokemonSet[], seed: number): Battle {
  const created = new Battle({
    formatid: toID(format), seed: [seed, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (created.sides.some(side => side.requestState === 'teampreview')) {
    created.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    created.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return created;
}

/** The picker's preview at this position, both sides, with the armed Tera toggles. */
function preview(current: Battle, teraBySlot?: { p1: (string | null)[]; p2: (string | null)[] }) {
  const state = createBranchStateFromBattle(current as never, [], {});
  return computePreviewDamage({
    p1ActiveSlots: state.p1ActiveSlots, p2ActiveSlots: state.p2ActiveSlots,
    p1MovesBySlot: state.p1MovesBySlot, p2MovesBySlot: state.p2MovesBySlot,
    fieldState: state.field, gen: current.gen, ...(teraBySlot ? { teraBySlot } : {}),
  } as Parameters<typeof computePreviewDamage>[0], calcSingleDamageRange);
}

/** Plays one turn and returns the HP each side's slots lost, with the turn's log. */
function play(current: Battle, p1: string, p2: string) {
  const before = current.sides.map(side => side.active.map(mon => mon?.hp ?? 0));
  const start = current.log.length;
  current.choose('p1', p1);
  current.choose('p2', p2);
  const lost = current.sides.map((side, index) => side.active.map((mon, slot) => before[index][slot] - (mon?.hp ?? 0)));
  return { lost, log: current.log.slice(start).join('\n') };
}

const percentOf = (lost: number, maxhp: number) => Math.round(lost / maxhp * 1000) / 10;

// Plays the turn and checks the damage lies in the preview row; a seed whose hit crits or misses is skipped (the range covers the roll
// only). At least one seed must count.
function expectRowsHold(scene: (seed: number) => { current: Battle; rows: { row: DamageResult | undefined; side: 0 | 1; slot: number }[]; p1: string; p2: string }) {
  let counted = 0;
  for (const seed of SEEDS) {
    const { current, rows, p1, p2 } = scene(seed);
    const maxhp = rows.map(({ side, slot }) => current.sides[side].active[slot].maxhp);
    const { lost, log } = play(current, p1, p2);
    if (log.includes('|-crit|') || log.includes('|-miss|')) continue;
    rows.forEach(({ row, side, slot }, index) => {
      expect(row, `seed ${seed}`).toBeDefined();
      const percent = percentOf(lost[side][slot], maxhp[index]);
      expect(percent, `seed ${seed}: ${row!.range}`).toBeGreaterThanOrEqual(row!.minPercent);
      expect(percent, `seed ${seed}: ${row!.range}`).toBeLessThanOrEqual(row!.maxPercent);
    });
    counted++;
  }
  expect(counted).toBeGreaterThan(0);
}

describe('entry boosts count once in the preview', () => {
  test('singles: Earthquake into Zamazenta-Crowned, whose Dauntless Shield stage the simulator already holds', () => {
    expectRowsHold(seed => {
      const current = battle('gen9customgame', [set('Garchomp', ['Earthquake'])],
        [set('Zamazenta-Crowned', ['Splash'], { item: 'Rusted Shield', ability: 'Dauntless Shield', evs: { ...STATS, hp: 252 } })], seed);
      expect(current.sides[1].active[0].boosts.def).toBe(1);
      return { current, rows: [{ row: preview(current).p1.default[0][0], side: 1, slot: 0 }], p1: 'move earthquake', p2: 'move splash' };
    });
  });

  test('singles: Porygon-Z\'s Download stage, already on the body, boosts its Thunderbolt once', () => {
    expectRowsHold(seed => {
      const current = battle('gen9customgame', [set('Porygon-Z', ['Thunderbolt'], { ability: 'Download' })], [armored('Shuckle')], seed);
      expect(current.sides[0].active[0].boosts.spa).toBe(1);
      return { current, rows: [{ row: preview(current).p1.default[0][0], side: 1, slot: 0 }], p1: 'move thunderbolt', p2: 'move splash' };
    });
  });

  test('doubles: Zacian-Crowned\'s Intrepid Sword stage counts once in its row into one foe', () => {
    expectRowsHold(seed => {
      const current = battle('gen9doublescustomgame',
        [set('Zacian-Crowned', ['Iron Head'], { item: 'Rusted Sword', ability: 'Intrepid Sword' }), set('Corviknight', ['Splash'])],
        [armored('Snorlax'), armored('Blissey')], seed);
      expect(current.sides[0].active[0].boosts.atk).toBe(1);
      return { current, rows: [{ row: preview(current).p1.targets[0]['1:1'], side: 1, slot: 0 }], p1: 'move ironhead 1, move splash', p2: 'move splash, move splash' };
    });
  });
});

describe('an armed Tera reads the body the simulator makes of the click (Terapagos-Stellar)', () => {
  test('singles: Terapagos\'s Tera Starstorm with the toggle armed is the Terapagos-Stellar hit', () => {
    expectRowsHold(seed => {
      const current = battle('gen9customgame', [set('Terapagos', ['Tera Starstorm'], { ability: 'Tera Shift', teraType: 'Stellar' })], [armored('Snorlax')], seed);
      expect(current.sides[0].active[0].species.name).toBe('Terapagos-Terastal');
      const row = preview(current, { p1: ['Stellar'], p2: [null] }).p1.default[0][0];
      return { current, rows: [{ row, side: 1, slot: 0 }], p1: 'move terastarstorm terastallize', p2: 'move splash' };
    });
  });

  test('doubles: the clicked Tera Starstorm hits both foes, each row holds its damage', () => {
    expectRowsHold(seed => {
      const current = battle('gen9doublescustomgame',
        [set('Terapagos', ['Tera Starstorm'], { ability: 'Tera Shift', teraType: 'Stellar' }), set('Corviknight', ['Splash'])],
        [armored('Snorlax'), armored('Blissey')], seed);
      const targets = preview(current, { p1: ['Stellar', null], p2: [null, null] }).p1.targets[0];
      return {
        current, rows: [{ row: targets['1:1'], side: 1, slot: 0 }, { row: targets['1:2'], side: 1, slot: 1 }],
        p1: 'move terastarstorm 1 terastallize, move splash', p2: 'move splash, move splash',
      };
    });
  });
});

describe('forms the calc does not know reach the preview', () => {
  test('singles: Aegislash attacks in the forme its Stance Change gives it and takes hits in its Shield forme', () => {
    expectRowsHold(seed => {
      const current = battle('gen9customgame', [set('Aegislash', ['Iron Head'], { ability: 'Stance Change' })], [armored('Snorlax')], seed);
      expect(current.sides[0].active[0].species.name).toBe('Aegislash');
      return { current, rows: [{ row: preview(current).p1.default[0][0], side: 1, slot: 0 }], p1: 'move ironhead', p2: 'move splash' };
    });
    expectRowsHold(seed => {
      const current = battle('gen9customgame', [set('Garchomp', ['Earthquake'])],
        [set('Aegislash', ['Splash'], { ability: 'Stance Change', evs: { ...STATS, hp: 252, def: 252 } })], seed);
      return { current, rows: [{ row: preview(current).p1.default[0][0], side: 1, slot: 0 }], p1: 'move earthquake', p2: 'move splash' };
    });
  });

  test('doubles: Gastrodon-East\'s Earth Power and a Dragon Claw into it hold their rows', () => {
    expectRowsHold(seed => {
      const current = battle('gen9doublescustomgame',
        [set('Gastrodon-East', ['Earth Power'], { ability: 'Sticky Hold' }), set('Garchomp', ['Dragon Claw'])],
        [armored('Snorlax'), set('Gastrodon-East', ['Splash'], { ability: 'Sticky Hold', evs: { ...STATS, hp: 252, def: 252 } })], seed);
      const targets = preview(current).p1.targets;
      return {
        current, rows: [{ row: targets[0]['1:1'], side: 1, slot: 0 }, { row: targets[1]['1:2'], side: 1, slot: 1 }],
        p1: 'move earthpower 1, move dragonclaw 2', p2: 'move splash, move splash',
      };
    });
  });
});

describe('what the simulator holds reaches the preview', () => {
  test('singles and doubles: Kingambit\'s Iron Head after three faints holds its row', () => {
    for (const format of ['gen9customgame', 'gen9doublescustomgame'] as const) {
      const doubles = format === 'gen9doublescustomgame';
      expectRowsHold(seed => {
        const current = battle(format,
          [set('Pawmot', ['Splash']), ...(doubles ? [set('Corviknight', ['Splash'])] : []), set('Kingambit', ['Iron Head'], { ability: 'Supreme Overlord' })],
          [armored('Snorlax'), ...(doubles ? [armored('Blissey')] : [])], seed);
        current.sides[0].totalFainted = 3;
        current.choose('p1', doubles ? 'switch 3, move splash' : 'switch 2');
        current.choose('p2', doubles ? 'move splash, move splash' : 'move splash');
        expect((current.sides[0].active[0].abilityState as { fallen?: number }).fallen).toBe(3);
        const view = preview(current).p1;
        return {
          current, rows: [{ row: doubles ? view.targets[0]['1:1'] : view.default[0][0], side: 1, slot: 0 }],
          p1: doubles ? 'move ironhead 1, move splash' : 'move ironhead', p2: doubles ? 'move splash, move splash' : 'move splash',
        };
      });
    }
  });

  test('singles and doubles: a Booster Energy Quark Drive hit holds its row', () => {
    for (const format of ['gen9customgame', 'gen9doublescustomgame'] as const) {
      const doubles = format === 'gen9doublescustomgame';
      expectRowsHold(seed => {
        const current = battle(format,
          [set('Iron Bundle', ['Ice Beam'], { ability: 'Quark Drive', item: 'Booster Energy' }), ...(doubles ? [set('Corviknight', ['Splash'])] : [])],
          [armored('Snorlax'), ...(doubles ? [armored('Blissey')] : [])], seed);
        const view = preview(current).p1;
        return {
          current, rows: [{ row: doubles ? view.targets[0]['1:1'] : view.default[0][0], side: 1, slot: 0 }],
          p1: doubles ? 'move icebeam 1, move splash' : 'move icebeam', p2: doubles ? 'move splash, move splash' : 'move splash',
        };
      });
    }
  });
});

describe('Hidden Power reaches the preview typed', () => {
  test('singles and doubles gen 7: the Hidden Power Ice row holds the damage the simulator deals', () => {
    for (const format of ['gen7customgame', 'gen7doublescustomgame'] as const) {
      const doubles = format === 'gen7doublescustomgame';
      expectRowsHold(seed => {
        const current = battle(format, [set('Starmie', ['Hidden Power Ice']), ...(doubles ? [set('Corviknight', ['Splash'])] : [])],
          [armored('Landorus-Therian'), ...(doubles ? [armored('Blissey')] : [])], seed);
        expect(current.sides[0].active[0].hpType).toBe('Ice');
        const view = preview(current).p1;
        return {
          current, rows: [{ row: doubles ? view.targets[0]['1:1'] : view.default[0][0], side: 1, slot: 0 }],
          p1: doubles ? 'move hiddenpower 1, move splash' : 'move hiddenpower', p2: doubles ? 'move splash, move splash' : 'move splash',
        };
      });
    }
  });
});

describe('damage-preview-live-hit', () => {
  const STATS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

  const set = (species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet => ({
    name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
    evs: { ...STATS, hp: 252, atk: 252, spa: 252 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: '', ...extra,
  });

  /** A doubles battle in which the first foe stands alone behind the screens. */
  function loneFoe(attacker: PokemonSet, psychicTerrain: boolean, screens: string[]): Battle {
    const p1 = [attacker, set('Snorlax', ['Splash'])];
    const p2 = [set('Blissey', ['Splash']), set('Chansey', ['Splash'])];
    const battle = new Battle({ formatid: toID('gen9doublescustomgame'), seed: [1, 2, 3, 4], p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) } });
    battle.choose('p1', 'team 12');
    battle.choose('p2', 'team 12');
    battle.sides[1].active[1]!.faint();
    battle.resolveFaints();
    if (psychicTerrain) battle.field.setTerrain('psychicterrain', 'debug');
    for (const screen of screens) battle.sides[1].addSideCondition(screen, battle.sides[1].active[0]!);
    return battle;
  }

  /** The first move's preview into the first foe, with the live battle handed over or not. */
  function previewed(battle: Battle, live: boolean, tera: string | null): DamageResult {
    const state = createBranchStateFromBattle(battle as never, [], {});
    const result = computePreviewDamage({
      p1ActiveSlots: state.p1ActiveSlots, p2ActiveSlots: state.p2ActiveSlots,
      p1MovesBySlot: state.p1MovesBySlot, p2MovesBySlot: state.p2MovesBySlot,
      fieldState: state.field, gen: battle.gen, teraBySlot: { p1: [tera, null], p2: [null, null] }, ...(live ? { battle } : {}),
    } as Parameters<typeof computePreviewDamage>[0], calcSingleDamageRange);
    return result.p1.targets[0]['1:1'] ?? result.p1.default[0][0];
  }

  /** The HP the first foe loses when the simulator plays the move. */
  function lost(battle: Battle, choice: string): number {
    const foe = battle.sides[1].active[0]!;
    const before = foe.hp;
    battle.choose('p1', `${choice}, move splash`);
    battle.choose('p2', 'move splash, pass');
    return before - foe.hp;
  }

  const CASES = [
    { title: 'Expanding Force in Psychic Terrain', attacker: () => set('Hatterene', ['Expanding Force', 'Splash']), terrain: true, tera: null, choice: 'move expandingforce 1' },
    { title: 'Tera Starstorm after the armed click', attacker: () => set('Terapagos', ['Tera Starstorm', 'Splash'], { ability: 'Tera Shift', teraType: 'Stellar' }), terrain: false, tera: 'Stellar', choice: 'move terastarstorm 1 terastallize' },
  ];

  describe('doubles: the preview of a forced spread on a lone foe behind a screen', () => {
    for (const scene of CASES) {
      for (const screens of [['reflect'], ['lightscreen'], ['auroraveil'], ['reflect', 'lightscreen']]) {
        test(`${scene.title} behind ${screens.join(' and ')}: the range holds the simulator's damage`, () => {
          const build = () => loneFoe(scene.attacker(), scene.terrain, screens);
          const range = previewed(build(), true, scene.tera);
          const battle = build();
          const damage = lost(battle, scene.choice);
          expect(damage).toBeGreaterThan(0);
          const percent = Math.round(damage / battle.sides[1].active[0]!.maxhp * 1000) / 10;
          expect(range.range).not.toBe('-');
          expect(percent).toBeGreaterThanOrEqual(range.minPercent);
          expect(percent).toBeLessThanOrEqual(range.maxPercent);
        });
      }

      test(`${scene.title}: a position without a live battle shows no range behind a screen`, () => {
        expect(previewed(loneFoe(scene.attacker(), scene.terrain, ['lightscreen']), false, scene.tera).range).toBe('-');
      });

      test(`${scene.title}: without a screen the calc range holds the simulator's damage, live battle or not`, () => {
        for (const live of [false, true]) {
          const range = previewed(loneFoe(scene.attacker(), scene.terrain, []), live, scene.tera);
          const battle = loneFoe(scene.attacker(), scene.terrain, []);
          const percent = Math.round(lost(battle, scene.choice) / battle.sides[1].active[0]!.maxhp * 1000) / 10;
          expect(percent).toBeGreaterThanOrEqual(range.minPercent);
          expect(percent).toBeLessThanOrEqual(range.maxPercent);
        }
      });
    }
  });
});
