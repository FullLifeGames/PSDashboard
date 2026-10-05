import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { calcSingleDamageRange, createBranchStateFromBattle, type DamageResult } from '@fulllifegames/eval-engine';
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

function battle(format: 'gen9customgame' | 'gen9doublescustomgame', p1: PokemonSet[], p2: PokemonSet[]): Battle {
  const created = new Battle({
    formatid: toID(format), seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (created.sides.some(side => side.requestState === 'teampreview')) {
    created.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    created.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return created;
}

/** The picker's preview at this position, both sides. */
function preview(current: Battle, teraBySlot?: { p1: (string | null)[]; p2: (string | null)[] }) {
  const state = createBranchStateFromBattle(current as never, [], {});
  return computePreviewDamage({
    p1ActiveSlots: state.p1ActiveSlots, p2ActiveSlots: state.p2ActiveSlots,
    p1MovesBySlot: state.p1MovesBySlot, p2MovesBySlot: state.p2MovesBySlot,
    fieldState: state.field, gen: current.gen, ...(teraBySlot ? { teraBySlot } : {}),
  }, calcSingleDamageRange);
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
