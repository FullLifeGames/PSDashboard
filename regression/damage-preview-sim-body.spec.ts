import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { calcSingleDamageRange, createBranchStateFromBattle, type DamageResult } from '@fulllifegames/eval-engine';
import { computePreviewDamage } from '../src/lib/branch-damage';

/**
 * Round 67, lane A: the picker's damage preview reads the body the simulator
 * holds (one builder sim to calc, T100). A battle is built, the preview read
 * the way BranchPanel reads it (createBranchStateFromBattle,
 * computePreviewDamage), then the simulator plays the move and the HP it
 * took must lie inside the previewed range (the harness of
 * damage-preview-landing.spec.ts).
 */
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

function battle(format: 'gen9customgame' | 'gen9doublescustomgame', p1: PokemonSet[], p2: PokemonSet[], seed: number): Battle {
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

/**
 * Reads the preview row, plays the turn, and checks the damage lies in the row; a seed whose hit crits or misses
 * is skipped (the range covers the roll only). At least one seed must count.
 */
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

describe('entry boosts count once in the preview (T100)', () => {
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

describe('an armed Tera reads the body the simulator makes of the click (T100, Terapagos-Stellar)', () => {
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

describe('forms the calc does not know reach the preview (T72)', () => {
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
