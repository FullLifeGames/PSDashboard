import { describe, expect, test } from 'vitest';
import { Battle, State, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { advancePositionWithLog, createRootPosition, positionBattle, type SimPosition } from '../src/forward-model';
import { createMatchupCache } from '../src/eval-function';
import { leafValue } from '../src/search/leaf';
import { MISSING_WEIGHT_CUT, sampleCell } from '../src/search/cell-sampler';
import { BOUNDARY_DRAW_BUDGET } from '../src/cell-blend';

/**
 * Round 69 (T146 part c2): a class whose analytic weight no draw reaches is a state effect the board before the
 * turn cannot see. Weakness Policy (653785 t24): Hidden Power Ice does not kill Dragonite, the policy gives it
 * +2 Attack and +2 Special Attack, and the Dragon Claw back then kills every time, so the class the plan weighs at
 * 0.88 (both survive) never happens. The cell prices as the mean of its draws, not as the two classes it saw
 * renormalised. The reference is the plain mean over 64 natural seeds, read from the simulator in the test.
 */

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const mon = (species: string, moves: string[], extra: Partial<PokemonSet>): PokemonSet => ({
  name: species, species, item: '', ability: '', moves, nature: 'Hardy',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs, level: 100, gender: 'M', ...extra,
});

function scene(item: string): SimPosition {
  const p1 = [
    mon('Tornadus-Therian', ['Hidden Power Ice', 'Hurricane', 'Knock Off', 'U-turn'],
      { ability: 'Regenerator', item: 'Leftovers', nature: 'Timid', evs: { hp: 248, atk: 0, def: 0, spa: 40, spd: 0, spe: 220 }, ivs: { ...ivs, atk: 30, def: 30 } }),
    mon('Volcanion', ['Steam Eruption', 'Flamethrower', 'Earth Power', 'Protect'], { ability: 'Water Absorb', item: 'Leftovers', nature: 'Modest', evs: { hp: 252, atk: 0, def: 0, spa: 252, spd: 4, spe: 0 } }),
    mon('Cofagrigus', ['Hex', 'Will-O-Wisp', 'Haze', 'Toxic Spikes'], { ability: 'Mummy', item: 'Leftovers', nature: 'Bold', evs: { hp: 252, atk: 0, def: 252, spa: 4, spd: 0, spe: 0 } }),
  ];
  const p2 = [
    mon('Dragonite', ['Dragon Claw', 'Dragon Dance', 'Extreme Speed', 'Earthquake'],
      { ability: 'Multiscale', item, nature: 'Adamant', evs: { hp: 48, atk: 252, def: 0, spa: 0, spd: 0, spe: 208 } }),
    mon('Charizard', ['Flare Blitz', 'Dragon Claw', 'Earthquake', 'Dragon Dance'], { ability: 'Blaze', item: 'Charizardite X', nature: 'Jolly', evs: { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 } }),
    mon('Starmie', ['Scald', 'Rapid Spin', 'Recover', 'Psyshock'], { ability: 'Natural Cure', item: 'Leftovers', nature: 'Timid', evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 0, spe: 252 } }),
  ];
  const battle = new Battle({ formatid: toID('gen6customgame'), seed: '1,2,3,4', p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 123');
    battle.choose('p2', 'team 123');
  }
  battle.sides[0].active[0]!.sethp(241);
  battle.sides[1].active[0]!.sethp(252);
  return createRootPosition(JSON.stringify(State.serializeBattle(battle)));
}

/** The simulator's mean leaf over 64 natural seeds, and the standard error of that mean plus a 16-draw one. */
function plainMean(root: SimPosition, p1Choice: string, p2Choice: string) {
  const cache = createMatchupCache();
  const leaves: number[] = [];
  for (let k = 0; k < 64; k++) {
    const { child } = advancePositionWithLog(root, p1Choice, p2Choice, `${1000 + k},${2000 + k},${3000 + k},${4000 + k}` as never);
    leaves.push(leafValue(positionBattle(child), cache));
  }
  const mean = leaves.reduce((sum, leaf) => sum + leaf, 0) / leaves.length;
  const variance = leaves.reduce((sum, leaf) => sum + (leaf - mean) ** 2, 0) / (leaves.length - 1);
  return { mean, se: Math.sqrt(variance / 64 + variance / BOUNDARY_DRAW_BUDGET) };
}

describe('missing class weight (T146 c2)', () => {
  test('653785 t24: Weakness Policy turns the unreachable class into a draw mean', () => {
    const root = scene('Weakness Policy');
    const [p1, p2] = ['move hiddenpower', 'move dragonclaw'];
    const truth = plainMean(root, p1, p2);
    const sample = sampleCell(root, 0, p1, p2, 1, createMatchupCache(), true);
    expect(sample.diagnostic?.missing).toEqual(['hit-nokill|hit-nokill']); // the model still reports what it could not see
    expect(Math.abs(sample.value - truth.mean)).toBeLessThan(2.5 * truth.se);
    expect(sample.blend).toBeUndefined(); // priced by the draws, not by the renormalised classes
  });

  test('the same cell without the policy keeps the analytic blend (a small missing weight stays renormalised)', () => {
    const root = scene('Leftovers');
    const [p1, p2] = ['move hiddenpower', 'move dragonclaw'];
    const truth = plainMean(root, p1, p2);
    const sample = sampleCell(root, 0, p1, p2, 1, createMatchupCache(), true);
    const missing = sample.diagnostic!.missing.reduce((sum, key) => sum + sample.diagnostic!.analytic[key], 0);
    expect(missing).toBeGreaterThan(0); // a crit class no draw reached: reported, below the cut
    expect(missing).toBeLessThan(MISSING_WEIGHT_CUT);
    const classes = sample.blend!.classes;
    expect(classes.reduce((sum, cls) => sum + cls.weight, 0)).toBeCloseTo(1, 9);
    expect(sample.value).toBe(classes.reduce((sum, cls) => sum + cls.weight * (cls.leafSum / cls.count), 0));
    expect(Math.abs(sample.value - truth.mean)).toBeLessThan(2.5 * truth.se);
  });

  test('the cut lies below the weight the policy scene misses', () => {
    expect(MISSING_WEIGHT_CUT).toBeGreaterThan(0);
    expect(MISSING_WEIGHT_CUT).toBeLessThan(0.87890625);
  });

  test('doubles: a root cell is priced by the pair plan from the dice drawn, with no missing class to report', () => {
    const side = (names: string[], move: string) => Teams.pack(names.map(species => mon(species, [move, 'Protect'], {
      ability: 'No Ability', evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 }, level: 50,
    })));
    const battle = new Battle({
      formatid: toID('gen9doublescustomgame'), seed: '1,2,3,4',
      p1: { name: 'Alpha', team: side(['Pikachu', 'Raichu'], 'Thunder') },
      p2: { name: 'Beta', team: side(['Snorlax', 'Blissey'], 'Tackle') },
    });
    if (battle.sides.some(s => s.requestState === 'teampreview')) {
      battle.choose('p1', 'team 12');
      battle.choose('p2', 'team 12');
    }
    const root = createRootPosition(JSON.stringify(State.serializeBattle(battle)));
    const sample = sampleCell(root, 0, 'move thunder 1, move thunder 2', 'move tackle 1, move tackle 2', 1, createMatchupCache(), true);
    expect(sample.diagnostic).toBeUndefined();
    expect(Number.isFinite(sample.value)).toBe(true);
  });
});
