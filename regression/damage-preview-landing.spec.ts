import { describe, expect, test } from 'vitest';
import { Battle, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { calcSingleDamageRange, createBranchStateFromBattle, type BranchSlotChoice, type DamageResult } from '@fulllifegames/eval-engine';
import { computePreviewDamage } from '../src/lib/branch-damage';

/**
 * The picker's damage preview against the simulator: a battle is built, the
 * preview is read the way BranchPanel reads it (createBranchStateFromBattle,
 * computePreviewDamage), then the simulator plays the move and the HP it
 * took must lie inside the previewed range. Damage does not depend on the
 * defender's current HP, so the range stays valid across the hit.
 */
const STATS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

function set(species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet {
  return {
    name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
    evs: { ...STATS, hp: 252, atk: 252 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50, gender: '', ...extra,
  };
}

function battle(format: 'gen9customgame' | 'gen9doublescustomgame' | 'gen8doublescustomgame', p1: PokemonSet[], p2: PokemonSet[], seed = 1): Battle {
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

type Picks = { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] };

/** The picker's preview at this position, both sides, with the armed Tera toggles and the picks made so far. */
function preview(current: Battle, teraBySlot?: { p1: (string | null)[]; p2: (string | null)[] }, choices?: Picks) {
  const state = createBranchStateFromBattle(current as never, [], {});
  return computePreviewDamage({
    p1ActiveSlots: state.p1ActiveSlots, p2ActiveSlots: state.p2ActiveSlots,
    p1MovesBySlot: state.p1MovesBySlot, p2MovesBySlot: state.p2MovesBySlot,
    fieldState: state.field, gen: current.gen, ...(teraBySlot ? { teraBySlot } : {}), ...(choices ? { choices } : {}),
  } as Parameters<typeof computePreviewDamage>[0], calcSingleDamageRange);
}

/** Plays one turn and returns the HP each p2 slot lost, with the turn's log. */
function play(current: Battle, p1: string, p2: string) {
  const before = current.sides[1].active.map(mon => mon?.hp ?? 0);
  const start = current.log.length;
  current.choose('p1', p1);
  current.choose('p2', p2);
  return { lost: current.sides[1].active.map((mon, slot) => before[slot] - (mon?.hp ?? 0)), log: current.log.slice(start).join('\n') };
}

/** The simulator's damage, read as the preview reads it (percent of max HP, one decimal), must sit in the range. */
function expectInside(range: DamageResult | undefined, lost: number, maxhp: number) {
  expect(range).toBeDefined();
  const percent = Math.round(lost / maxhp * 1000) / 10;
  expect(percent).toBeGreaterThanOrEqual(range!.minPercent);
  expect(percent).toBeLessThanOrEqual(range!.maxPercent);
}

describe('multi-hit moves land all their hits in the preview (T96 point 1)', () => {
  test('singles: Surging Strikes into Great Tusk', () => {
    const current = battle('gen9customgame', [set('Urshifu-Rapid-Strike', ['Surging Strikes'])], [set('Great Tusk', ['Splash'])]);
    const range = preview(current).p1.default[0][0];
    const { lost, log } = play(current, 'move surgingstrikes', 'move splash');
    expect(log).toContain('|-hitcount|p2a: Great Tusk|3');
    expectInside(range, lost[0], current.sides[1].active[0].maxhp);
  });

  test('doubles: Surging Strikes into one foe, its target row', () => {
    const current = battle('gen9doublescustomgame',
      [set('Urshifu-Rapid-Strike', ['Surging Strikes']), set('Corviknight', ['Splash'])],
      [set('Great Tusk', ['Splash']), set('Kingambit', ['Splash'])]);
    const range = preview(current).p1.targets[0]['1:1'];
    const { lost, log } = play(current, 'move surgingstrikes 1, move splash', 'move splash, move splash');
    expect(log).toContain('|-hitcount|p2a: Great Tusk|3');
    expectInside(range, lost[0], current.sides[1].active[0].maxhp);
    expect(lost[1]).toBe(0);
  });
});

/** A bulky target that takes every hit standing: physical bulk, Splash. */
function wall(species: string): PokemonSet {
  return set(species, ['Splash'], { evs: { ...STATS, hp: 252, def: 252 } });
}

/** Faints one active so its side fights on with a single Pokémon (no bench left to send in). */
function faint(current: Battle, side: 0 | 1, slot: number) {
  current.sides[side].active[slot].faint();
  current.faintMessages();
}

/** The roll is the only luck the range covers: a crit or a miss voids the check. */
function expectPlainHits(log: string) {
  expect(log).not.toContain('|-crit|');
  expect(log).not.toContain('|-miss|');
}

describe('how a move lands in doubles (T20, Rock Slide from T96)', () => {
  test('Rock Slide into a lone foe hits it alone: no spread reduction', () => {
    const current = battle('gen9doublescustomgame',
      [set('Garchomp', ['Rock Slide']), set('Corviknight', ['Splash'])],
      [wall('Snorlax'), wall('Clefable')]);
    faint(current, 1, 1);
    const range = preview(current).p1.default[0][0];
    const { lost, log } = play(current, 'move rockslide, move splash', 'move splash, pass');
    expectPlainHits(log);
    expectInside(range, lost[0], current.sides[1].active[0].maxhp);
  });

  test('Earthquake into a lone foe with no living ally hits one Pokémon: no spread reduction', () => {
    const current = battle('gen9doublescustomgame',
      [set('Garchomp', ['Earthquake']), set('Corviknight', ['Splash'])],
      [wall('Snorlax'), wall('Clefable')]);
    faint(current, 0, 1);
    faint(current, 1, 1);
    const range = preview(current).p1.default[0][0];
    const { lost, log } = play(current, 'move earthquake, pass', 'move splash, pass');
    expectPlainHits(log);
    expectInside(range, lost[0], current.sides[1].active[0].maxhp);
  });

  test('Earthquake into a lone foe next to a living ally still spreads, even when the ally is immune', () => {
    const current = battle('gen9doublescustomgame',
      [set('Garchomp', ['Earthquake']), set('Corviknight', ['Splash'])],
      [wall('Snorlax'), wall('Clefable')]);
    faint(current, 1, 1);
    const range = preview(current).p1.default[0][0];
    const { lost, log } = play(current, 'move earthquake, move splash', 'move splash, pass');
    expectPlainHits(log);
    expectInside(range, lost[0], current.sides[1].active[0].maxhp);
  });

  test('Rock Slide into two foes spreads over both', () => {
    const current = battle('gen9doublescustomgame',
      [set('Garchomp', ['Rock Slide']), set('Corviknight', ['Splash'])],
      [wall('Snorlax'), wall('Clefable')]);
    const rows = preview(current).p1.spread[0][1];
    const { lost, log } = play(current, 'move rockslide, move splash', 'move splash, move splash');
    expectPlainHits(log);
    expectInside(rows.find(row => row.label === 'P2A')?.result, lost[0], current.sides[1].active[0].maxhp);
    expectInside(rows.find(row => row.label === 'P2B')?.result, lost[1], current.sides[1].active[1].maxhp);
  });

  test('Dragon Darts at one of two foes lands one dart on each', () => {
    const current = battle('gen9doublescustomgame',
      [set('Dragapult', ['Dragon Darts']), set('Corviknight', ['Splash'])],
      [wall('Snorlax'), wall('Blissey')]);
    const targets = preview(current).p1.targets[0];
    const { lost, log } = play(current, 'move dragondarts 1, move splash', 'move splash, move splash');
    expectPlainHits(log);
    expectInside(targets['1:1'], lost[0], current.sides[1].active[0].maxhp);
    expectInside(targets['1:2'], lost[1], current.sides[1].active[1].maxhp);
  });

  test('Dragon Darts with an immune partner of the target lands both darts on the target', () => {
    const current = battle('gen9doublescustomgame',
      [set('Dragapult', ['Dragon Darts']), set('Corviknight', ['Splash'])],
      [wall('Snorlax'), wall('Clefable')]);
    const targets = preview(current).p1.targets[0];
    const { lost, log } = play(current, 'move dragondarts 1, move splash', 'move splash, move splash');
    expectPlainHits(log);
    // The second dart turns to the target again (a smart-target move prints no hit count).
    expect(log).toContain('|-anim|p1a: Dragapult|Dragon Darts|p2a: Snorlax');
    expect(lost[1]).toBe(0);
    expectInside(targets['1:1'], lost[0], current.sides[1].active[0].maxhp);
  });

  test('Dragon Darts at a lone foe lands both darts on it', () => {
    const current = battle('gen9doublescustomgame',
      [set('Dragapult', ['Dragon Darts']), set('Corviknight', ['Splash'])],
      [wall('Snorlax'), wall('Blissey')]);
    faint(current, 1, 1);
    const targets = preview(current).p1.targets[0];
    const { lost, log } = play(current, 'move dragondarts 1, move splash', 'move splash, pass');
    expectPlainHits(log);
    expectInside(targets['1:1'], lost[0], current.sides[1].active[0].maxhp);
  });

  test('singles never spreads: Rock Slide reads as before', () => {
    const current = battle('gen9customgame', [set('Garchomp', ['Rock Slide'])], [wall('Snorlax')]);
    const range = preview(current).p1.default[0][0];
    const { lost, log } = play(current, 'move rockslide', 'move splash');
    expectPlainHits(log);
    expectInside(range, lost[0], current.sides[1].active[0].maxhp);
  });
});

/** The numbers of a range, without the KO text (that one reads the defender's current HP). */
const span = (result: DamageResult | undefined) => result && [result.minPercent, result.maxPercent];

describe('the Tera toggle in the preview equals the calc after the click (T20, decision 18)', () => {
  test('singles: the attacker\'s and the defender\'s Tera both move the number, and both together match the executed turn', () => {
    const current = battle('gen9customgame',
      [set('Garchomp', ['Earthquake'], { teraType: 'Ground' })],
      [set('Snorlax', ['Splash'], { evs: { ...STATS, hp: 252, def: 252 }, teraType: 'Steel' })]);
    const off = preview(current).p1.default[0][0];
    const attacker = preview(current, { p1: ['Ground'], p2: [null] }).p1.default[0][0];
    const defender = preview(current, { p1: [null], p2: ['Steel'] }).p1.default[0][0];
    const both = preview(current, { p1: ['Ground'], p2: ['Steel'] });
    expect(span(attacker)).not.toEqual(span(off));
    expect(span(defender)).not.toEqual(span(off));

    const { lost, log } = play(current, 'move earthquake terastallize', 'move splash terastallize');
    expect(log).toContain('|-terastallize|p1a: Garchomp|Ground');
    expect(log).toContain('|-terastallize|p2a: Snorlax|Steel');
    expectPlainHits(log);
    expectInside(both.p1.default[0][0], lost[0], current.sides[1].active[0].maxhp);
    expect(span(preview(current).p1.default[0][0])).toEqual(span(both.p1.default[0][0]));
  });

  test('doubles, two targets: the toggle moves the spread rows and the targeted rows into both foes', () => {
    const current = battle('gen9doublescustomgame',
      [set('Garchomp', ['Earthquake', 'High Horsepower'], { teraType: 'Ground' }), set('Corviknight', ['Splash'])],
      [wall('Snorlax'), wall('Blissey')]);
    const off = preview(current).p1;
    const on = preview(current, { p1: ['Ground', null], p2: [null, null] }).p1;
    const rows = (side: typeof on) => [
      ...side.spread[0][1].map(row => span(row.result)),
      span(side.targets[0]['2:1']), span(side.targets[0]['2:2']),
    ];
    rows(on).forEach((row, index) => expect(row).not.toEqual(rows(off)[index]));

    const { lost, log } = play(current, 'move earthquake terastallize, move splash', 'move splash, move splash');
    expect(log).toContain('|-terastallize|p1a: Garchomp|Ground');
    expectPlainHits(log);
    expectInside(on.spread[0][1].find(row => row.label === 'P2A')?.result, lost[0], current.sides[1].active[0].maxhp);
    expectInside(on.spread[0][1].find(row => row.label === 'P2B')?.result, lost[1], current.sides[1].active[1].maxhp);
    expect(rows(preview(current).p1)).toEqual(rows(on));
  });
});

describe('the KO text reads the defender\'s current HP (review of wave 1)', () => {
  test('singles: Earthquake into a Snorlax at 60/267 HP is a guaranteed KO, and the simulator knocks it out', () => {
    const current = battle('gen9customgame', [set('Garchomp', ['Earthquake'])], [wall('Snorlax')]);
    current.sides[1].active[0].sethp(60);
    const range = preview(current).p1.default[0][0];
    // A third of its max HP or so: the share of max HP alone read "possible 3HKO".
    expect(range.maxPercent).toBeLessThan(50);
    expect(range.minPercent / 100 * 267).toBeGreaterThan(60);
    expect(range.koChance).toBe('guaranteed OHKO');
    const { log } = play(current, 'move earthquake', 'move splash');
    expect(log).toContain('|faint|p2a: Snorlax');
  });

  test('doubles: the spread Earthquake into a damaged Snorlax next to Blissey is a guaranteed KO for that row', () => {
    const current = battle('gen9doublescustomgame',
      [set('Garchomp', ['Earthquake']), set('Corviknight', ['Splash'])],
      [wall('Snorlax'), wall('Blissey')]);
    current.sides[1].active[0].sethp(60);
    const rows = preview(current).p1.spread[0][1];
    const snorlax = rows.find(row => row.label === 'P2A')!.result;
    const blissey = rows.find(row => row.label === 'P2B')!.result;
    expect(snorlax.koChance).toBe('guaranteed OHKO');
    expect(blissey.koChance).not.toContain('OHKO');
    const { log } = play(current, 'move earthquake, move splash', 'move splash, move splash');
    expect(log).toContain('|faint|p2a: Snorlax');
  });
});

/** Seeds for the hit-count checks: enough turns that every count the simulator draws turns up. */
const SEEDS = Array.from({ length: 60 }, (_, index) => index + 1);
/** A wall that never takes a crit: the roll and the hit count stay the only luck the range covers. */
const armored = (species: string) => set(species, ['Splash'], { evs: { ...STATS, hp: 252, def: 252 }, ability: 'Battle Armor' });
const hitCountOf = (log: string) => log.match(/\|-hitcount\|[^|]+\|(\d+)/)?.[1] ?? '0';

describe('a drawn hit count lands inside the preview (T124 point 3)', () => {
  test('singles: every Bullet Seed lies in the range, 2 to 5 hits and with Loaded Dice 4 or 5', () => {
    for (const item of ['', 'Loaded Dice']) {
      const counts = new Set<string>();
      for (const seed of SEEDS) {
        const current = battle('gen9customgame', [set('Breloom', ['Bullet Seed'], { item })], [armored('Snorlax')], seed);
        const range = preview(current).p1.default[0][0];
        const { lost, log } = play(current, 'move bulletseed', 'move splash');
        expectPlainHits(log);
        counts.add(hitCountOf(log));
        expectInside(range, lost[0], current.sides[1].active[0].maxhp);
      }
      expect([...counts].sort(), item || 'no item').toEqual(item ? ['4', '5'] : ['2', '3', '4', '5']);
    }
  });

  test('doubles: the Bullet Seed row into one foe holds every drawn count', () => {
    const counts = new Set<string>();
    for (const seed of SEEDS) {
      const current = battle('gen9doublescustomgame',
        [set('Breloom', ['Bullet Seed']), set('Corviknight', ['Splash'])], [armored('Snorlax'), armored('Blissey')], seed);
      const range = preview(current).p1.targets[0]['1:1'];
      const { lost, log } = play(current, 'move bulletseed 1, move splash', 'move splash, move splash');
      expectPlainHits(log);
      counts.add(hitCountOf(log));
      expectInside(range, lost[0], current.sides[1].active[0].maxhp);
      expect(lost[1]).toBe(0);
    }
    expect([...counts].sort()).toEqual(['2', '3', '4', '5']);
  });

  test('Loaded Dice Population Bomb lands 4 to 10 hits, all inside the range', () => {
    const counts = new Set<string>();
    for (const seed of SEEDS) {
      const current = battle('gen9customgame', [set('Maushold', ['Population Bomb'], { item: 'Loaded Dice' })], [armored('Snorlax')], seed);
      const range = preview(current).p1.default[0][0];
      const { lost, log } = play(current, 'move populationbomb', 'move splash');
      // The move's own accuracy still rolls once; Loaded Dice drops only the roll per hit.
      if (log.includes('|-miss|')) continue;
      counts.add(hitCountOf(log));
      expectInside(range, lost[0], current.sides[1].active[0].maxhp);
    }
    expect([...counts].map(Number).sort((a, b) => a - b)).toEqual([4, 5, 6, 7, 8, 9, 10]);
  });

  test('the previewed OHKO chance matches the share of knockouts over 400 seeded turns', () => {
    // At 100 HP two or three hits never knock Snorlax out, four hits sometimes, five always.
    const scene = (seed: number) => {
      const current = battle('gen9customgame', [set('Breloom', ['Bullet Seed'])], [armored('Snorlax')], seed);
      current.sides[1].active[0].sethp(100);
      return current;
    };
    const text = preview(scene(1)).p1.default[0][0].koChance;
    const chance = Number(text.match(/^([\d.]+)% chance to OHKO$/)?.[1]) / 100;
    expect(chance, text).toBeGreaterThan(0.15);
    const turns = Array.from({ length: 400 }, (_, index) => index + 1);
    const knockouts = turns.filter(seed => play(scene(seed), 'move bulletseed', 'move splash').log.includes('|faint|p2a: Snorlax')).length;
    expect(Math.abs(knockouts / turns.length - chance)).toBeLessThan(3 * Math.sqrt(chance * (1 - chance) / turns.length));
  });
});

/** Dragapult throws Dragon Darts at P2A while P2A's partner Blissey uses `pick`; the preview reads both sides' picks. */
function dartsScene(format: 'gen8doublescustomgame' | 'gen9doublescustomgame', pick: string) {
  const current = battle(format, [set('Dragapult', ['Dragon Darts']), set('Corviknight', ['Splash'])],
    [armored('Snorlax'), set('Blissey', [pick, 'Splash'], { evs: { ...STATS, hp: 252, def: 252 }, ability: 'Battle Armor' })]);
  const choices: Picks = { p1: [null, null], p2: [null, { kind: 'move', moveId: toID(pick), moveName: pick }] };
  const row = preview(current, undefined, choices).p1.targets[0]['1:1'];
  const { lost, log } = play(current, 'move dragondarts 1, move splash', 'move splash, move 1');
  expectPlainHits(log);
  return { row, lost, log, maxhp: current.sides[1].active[0].maxhp };
}

describe('Protect on the Dragon Darts partner (T124 point 4)', () => {
  test('the partner protects: both darts hit the target, as the simulator lands them', () => {
    const { row, lost, log, maxhp } = dartsScene('gen9doublescustomgame', 'Protect');
    expect(log).toContain('|-singleturn|p2b: Blissey|Protect');
    expect(lost[1]).toBe(0);
    expectInside(row, lost[0], maxhp);
  });

  test('the partner endures or splashes: one dart each, as before', () => {
    for (const pick of ['Endure', 'Splash']) {
      const { row, lost, maxhp } = dartsScene('gen9doublescustomgame', pick);
      expect(lost[1], pick).toBeGreaterThan(0);
      expectInside(row, lost[0], maxhp);
    }
  });

  test('every shielding move in gens 8 and 9 lands the darts in the preview where the simulator lands them', () => {
    // Every move that stalls or sets a condition that stops moves (onTryHit), as the partner's pick:
    // Protect and its kin, Endure, the side guards, Magic Coat. The target's row must hold what it took.
    for (const format of ['gen8doublescustomgame', 'gen9doublescustomgame'] as const) {
      const dex = Dex.forFormat(format);
      const stops = (id?: string) => !!id && !!dex.conditions.get(id).onTryHit;
      const picks = dex.moves.all().filter(move => !move.isMax && !move.isZ &&
        (move.stallingMove || stops(move.volatileStatus) || stops(move.sideCondition)));
      expect(picks.length, format).toBeGreaterThan(10);
      for (const move of picks) {
        const { row, lost, maxhp } = dartsScene(format, move.name);
        expectInside(row, lost[0], maxhp);
      }
    }
  });
});

describe('the Stellar first-use boost (T124 point 5)', () => {
  const stellar = () => set('Garchomp', ['Earthquake', 'Smack Down'], { teraType: 'Stellar' });
  /** Plays one turn from full HP (damage never reads the target's HP) and checks every previewed row against it. */
  function turnInside(current: Battle, rows: (DamageResult | undefined)[], p1: string, p2: string) {
    current.sides[1].active.forEach(mon => mon.sethp(mon.maxhp));
    const { lost, log } = play(current, p1, p2);
    expectPlainHits(log);
    rows.forEach((row, slot) => expectInside(row, lost[slot], current.sides[1].active[slot].maxhp));
    return log;
  }

  test('singles: the armed Stellar toggle boosts the first Earthquake, the second is plain, the first Smack Down boosted again', () => {
    const current = battle('gen9customgame', [stellar()], [armored('Snorlax')]);
    const log = turnInside(current, [preview(current, { p1: ['Stellar'], p2: [null] }).p1.default[0][0]], 'move earthquake terastallize', 'move splash');
    expect(log).toContain('|-terastallize|p1a: Garchomp|Stellar');
    turnInside(current, [preview(current).p1.default[0][0]], 'move earthquake', 'move splash');
    turnInside(current, [preview(current).p1.default[0][1]], 'move smackdown', 'move splash');
  });

  test('doubles: the first Stellar Earthquake boosts both foes\' rows, as the simulator keeps the boost for every target of the use', () => {
    const current = battle('gen9doublescustomgame', [stellar(), set('Corviknight', ['Splash'])], [armored('Snorlax'), armored('Blissey')]);
    const rows = preview(current, { p1: ['Stellar', null], p2: [null, null] }).p1.spread[0][1];
    const byLabel = (label: string) => rows.find(row => row.label === label)?.result;
    turnInside(current, [byLabel('P2A'), byLabel('P2B')], 'move earthquake terastallize, move splash', 'move splash, move splash');
    const again = preview(current).p1.spread[0][1];
    turnInside(current, [again.find(row => row.label === 'P2A')?.result, again.find(row => row.label === 'P2B')?.result],
      'move earthquake, move splash', 'move splash, move splash');
  });
});
