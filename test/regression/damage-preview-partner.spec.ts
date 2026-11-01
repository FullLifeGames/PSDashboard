import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { calcSingleDamageRange, createBranchStateFromBattle, loadSimMods, type DamageResult } from '@fulllifegames/eval-engine';
import { computePreviewDamage, hitsPartner } from '../../src/lib/branch-damage';

/**
 * Round 83 (the user, 01.11.2026: "Multihits like Earthquake are also weird, the damage on P1B is missing"): a move that hits
 * every body next to its user hits the user's partner too, and the move tile listed only the foes. The preview now adds the
 * partner's row, priced behind the partner's own side's screens. The scenes hold the row to the HP the simulator takes; the
 * sweep holds the reading to the simulator's targets for every damaging move of the Dex.
 */

await loadSimMods('gen9championsou');

const STATS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

function set(species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet {
  return {
    name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
    evs: { ...STATS, hp: 252, atk: 252 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50, gender: '', ...extra,
  };
}

/** A bulky body that takes every hit standing; Battle Armor keeps the crit out of the check. */
const wall = (species: string) => set(species, ['Splash'], { evs: { ...STATS, hp: 252, def: 252 }, ability: 'Battle Armor' });

function battle(format: string, p1: PokemonSet[], p2: PokemonSet[], seed = 1): Battle {
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

function preview(current: Battle) {
  const state = createBranchStateFromBattle(current as never, [], {});
  return computePreviewDamage({
    p1ActiveSlots: state.p1ActiveSlots, p2ActiveSlots: state.p2ActiveSlots,
    p1MovesBySlot: state.p1MovesBySlot, p2MovesBySlot: state.p2MovesBySlot,
    fieldState: state.field, gen: current.gen,
  }, calcSingleDamageRange);
}

/** Plays one turn and returns the HP every active body lost, by row label. */
function play(current: Battle, p1: string, p2: string): Record<string, number> {
  const bodies = current.sides.flatMap((side, sideIndex) => side.active.map((mon, slot) => ({ label: `P${sideIndex + 1}${'AB'[slot]}`, mon })));
  const before = bodies.map(({ mon }) => mon.hp);
  current.choose('p1', p1);
  current.choose('p2', p2);
  expect(current.log.join('\n')).not.toContain('|-miss|');
  return Object.fromEntries(bodies.map(({ label, mon }, index) => [label, before[index] - mon.hp]));
}

function expectInside(range: DamageResult | undefined, lost: number, maxhp: number) {
  expect(range).toBeDefined();
  const percent = Math.round(lost / maxhp * 1000) / 10;
  expect(percent).toBeGreaterThanOrEqual(range!.minPercent);
  expect(percent).toBeLessThanOrEqual(range!.maxPercent);
}

describe('the partner of a move that hits every body next to its user (round 83)', () => {
  const scene = () => battle('gen9doublescustomgame',
    [set('Garchomp', ['Earthquake', 'Rock Slide']), wall('Blissey')],
    [wall('Snorlax'), wall('Clefable')]);

  test('Earthquake lists P1B after both foes, and the simulator\'s damage to the partner lies in its row', () => {
    const current = scene();
    const rows = preview(current).p1.spread[0][1];
    expect(rows.map(row => row.label)).toEqual(['P2A', 'P2B', 'P1B']);
    const lost = play(current, 'move earthquake, move splash', 'move splash, move splash');
    for (const row of rows) {
      const body = current.sides[row.label[1] === '1' ? 0 : 1].active[row.label[2] === 'A' ? 0 : 1];
      expectInside(row.result, lost[row.label], body.maxhp);
    }
  });

  test('the partner stands behind its own side\'s Reflect: the row shrinks with it, as the simulator\'s damage does', () => {
    const open = preview(scene()).p1.spread[0][1].find(row => row.label === 'P1B')!.result;
    const current = scene();
    current.sides[0].addSideCondition('reflect', current.sides[0].active[1]);
    const screened = preview(current).p1.spread[0][1].find(row => row.label === 'P1B')!.result;
    expect(screened.maxPercent).toBeLessThan(open.maxPercent);
    const lost = play(current, 'move earthquake, move splash', 'move splash, move splash');
    expectInside(screened, lost.P1B, current.sides[0].active[1].maxhp);
  });

  test('Rock Slide hits only the foes, and the partner\'s row never becomes the move\'s default range', () => {
    const current = battle('gen9doublescustomgame',
      [set('Garchomp', ['Earthquake', 'Rock Slide']), wall('Heatran')],
      [wall('Snorlax'), wall('Clefable')]);
    const side = preview(current).p1;
    expect(side.spread[0][2].map(row => row.label)).toEqual(['P2A', 'P2B']);
    const quake = side.spread[0][1];
    const partner = quake.find(row => row.label === 'P1B')!.result;
    const foes = quake.filter(row => row.label !== 'P1B').map(row => row.result.maxPercent);
    // Heatran takes four times the damage of a Ground move: the partner's row is the largest, the default stays a foe's
    expect(partner.maxPercent).toBeGreaterThan(Math.max(...foes));
    expect(side.default[0][0].maxPercent).toBe(Math.max(...foes));
  });
});

/** Every realm with doubles the corpus plays: Scarlet/Violet and the older generations back to 3, and the Champions mod. */
const REALMS = [3, 4, 5, 6, 7, 8, 9].map(gen => `gen${gen}doublescustomgame`).concat('gen9championsdoublescustomgame');

describe.each(REALMS)('%s: the partner\'s row follows the simulator\'s targets (round 83 sweep)', format => {
  test('every damaging move hits the partner in the simulator exactly when the preview lists its row', () => {
    const current = battle(format, [set('Mew', ['Splash']), wall('Blissey')], [wall('Snorlax'), wall('Clefable')]);
    const [user, partner] = current.sides[0].active;
    const foe = current.sides[1].active[0];
    const moves = current.dex.moves.all().filter(move => move.exists && move.gen <= current.gen && !move.isMax && !move.isZ && move.category !== 'Status');
    expect(moves.length).toBeGreaterThan(150);
    const reaching = moves.filter(move => user.getMoveTargets(current.dex.getActiveMove(move.id), foe).targets.includes(partner));
    // Generation 3 knows four of them (Earthquake, Magnitude, Explosion, Self-Destruct)
    expect(reaching.length).toBeGreaterThanOrEqual(4);
    for (const move of moves) {
      expect(`${move.id} ${hitsPartner({ targetType: move.target })}`).toBe(`${move.id} ${reaching.includes(move)}`);
    }
  });
});
