import { describe, expect, test } from 'vitest';
import type { Battle, Move, Pokemon, PokemonSet } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { pairStages } from '../src/score/boost-race';
import { boostedFraction, pairThreat } from '../src/score/threat';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 79 (T288), the sweep behind the shield rule: every move of the Dex that raises Defense or Special Defense, played
 * once at a Rhydon-shaped hard hitter in every generation and mod the corpus plays (Generations 6, 8 and 9, the Champions
 * mod; singles, and doubles for the stage). The rule reads two things the simulator owns: the stage a standing boost is
 * (the stages each attack sees, `pairStages`) and the damage of the foe's hit at that stage (`boostedFraction`). Both must
 * equal what the simulator played: the stage the move applied, and the hit that came after it in the same turn (the holder
 * moves first), inside the cell of the damage rolls. The moves come from the Dex fields (`boosts`, `self.boosts`) and from
 * the simulator's own play (Stockpile, Curse, Psyshield Bash stand in conditions and secondaries), never by name.
 */

await loadSimMods('gen9championscustomgame');

interface Mode { name: string; format: string; gen: number; doubles: boolean; mon: (species: string, moves: string[]) => PokemonSet }

const SP = { hp: 32, atk: 32, def: 0, spa: 32, spd: 0, spe: 0 };
const base = (species: string, moves: string[]) => set(species, moves);
const champion = (species: string, moves: string[]) => set(species, moves, { evs: SP, level: 50 });
const MODES: Mode[] = [
  { name: 'Gen 6 singles', format: 'gen6customgame', gen: 6, doubles: false, mon: base },
  { name: 'Gen 8 singles', format: 'gen8customgame', gen: 8, doubles: false, mon: base },
  { name: 'Gen 9 singles', format: 'gen9customgame', gen: 9, doubles: false, mon: base },
  { name: 'Gen 9 doubles', format: 'gen9doublescustomgame', gen: 9, doubles: true, mon: base },
  { name: 'Champions singles', format: 'gen9championscustomgame', gen: 9, doubles: false, mon: champion },
  { name: 'Champions doubles', format: 'gen9championsdoublescustomgame', gen: 9, doubles: true, mon: champion },
];

const dexOf = (mode: Mode) => battleOf(mode.format, [set('Pikachu', ['splash']), set('Pikachu', ['splash'])], [set('Pikachu', ['splash']), set('Pikachu', ['splash'])]).dex;

/** The moves the Dex fields say raise Defense or Special Defense of the user for sure (no chance, no handler that can fail it). */
function raisesBulk(move: Move): boolean {
  const boosts = move.target === 'self' ? move.boosts : move.self?.boosts;
  const handlers = ['onTry', 'onTryMove', 'onTryHit', 'onPrepareHit'].some(key => key in move);
  return !!boosts && ((boosts.def ?? 0) > 0 || (boosts.spd ?? 0) > 0) && !handlers && !move.secondary && !move.secondaries?.length;
}

/** p1's lead (Clefable) and the foe's lead (Rhydon with one hit) on a battle of the mode; doubles stand a Splashing Pikachu next to each. */
function board(mode: Mode, holderMove: string, foeMove: string, seed = '1,2,3,4'): { battle: Battle; mine: Pokemon; foe: Pokemon } {
  const mine = [mode.mon('Clefable', [holderMove, 'tackle'])];
  const foe = [mode.mon('Rhydon', [foeMove])];
  if (mode.doubles) { mine.push(set('Pikachu', ['splash'])); foe.push(set('Pikachu', ['splash'])); }
  const battle = battleOf(mode.format, mine, foe, seed);
  return { battle, mine: battle.sides[0].active[0]!, foe: battle.sides[1].active[0]! };
}

/** One turn: the holder clicks its move (a doubles move aims at the foe's slot 0 when it needs a target), the foe clicks its hit. */
function turn(mode: Mode, battle: Battle): void {
  if (mode.doubles) {
    if (!battle.choose('p1', 'move 1, move 1')) battle.choose('p1', 'move 1 1, move 1');
    battle.choose('p2', 'move 1, move 1');
  } else {
    battle.choose('p1', 'move 1');
    battle.choose('p2', 'move 1');
  }
}

/**
 * The share of its maximum HP the holder loses to the foe's hit in the turn: its HP when the foe is about to move against the
 * HP after the turn (the holder's own move and its cost, Clangorous Soul's third of the HP, come before).
 */
function playTurn(mode: Mode, battle: Battle, mine: Pokemon, foe: Pokemon): number {
  let before = mine.hp;
  battle.onEvent('BeforeMove', battle.format, -100, (pokemon: Pokemon) => { if (pokemon === foe) before = mine.hp; });
  turn(mode, battle);
  return (before - mine.hp) / mine.maxhp;
}

const FOE_HIT = { def: 'earthquake', spd: 'surf' } as const;

describe.each(MODES)('every move that raises Defense or Special Defense, played at a hard hitter ($name)', mode => {
  const moves = dexOf(mode).moves.all().filter(move => move.exists && move.isNonstandard !== 'Future' && move.gen <= mode.gen && !move.isZ && !move.isMax && move.id !== 'struggle');

  /** The moves the simulator plays into a higher Defense or Special Defense of the user (the first turn, a hit of the foe behind it). */
  const applied = moves.filter(move => {
    const { battle, mine } = board(mode, move.id, 'earthquake');
    const before = { ...mine.boosts };
    turn(mode, battle);
    return mine.boosts.def > before.def || mine.boosts.spd > before.spd;
  });

  test('the Dex fields name a set of moves, every one of them plays into the stage they say', () => {
    expect(moves.filter(raisesBulk).length).toBeGreaterThanOrEqual(mode.gen === 6 ? 10 : 12);
    const missing = moves.filter(raisesBulk).filter(move => !applied.includes(move)).map(move => move.id);
    expect(missing).toEqual([]);
  });

  test('every move the simulator plays into a Defense or Special Defense stage is read as that stage by the race', () => {
    expect(applied.length).toBeGreaterThanOrEqual(10);
    for (const move of applied) {
      const { battle, mine, foe } = board(mode, move.id, 'earthquake');
      turn(mode, battle);
      const stages = pairStages(battle, mine, foe);
      expect([move.id, stages.mineDefending.def, stages.mineDefending.spd]).toEqual([move.id, mine.boosts.def, mine.boosts.spd]);
    }
  });

  // Doubles hit with spread moves at 0.75 and aim at slots: the damage cell is read in singles, the stage above in both.
  test.skipIf(mode.doubles)('the hit the race prices matches the hit the simulator played at that stage, inside the cell of the damage rolls', () => {
    const problems: string[] = [];
    let checked = 0;
    for (const move of applied) {
      for (const stat of ['def', 'spd'] as const) {
        const hit = FOE_HIT[stat];
        const fresh = board(mode, move.id, hit);
        const threat = pairThreat(fresh.foe, fresh.mine, fresh.battle);
        for (const seed of ['1,2,3,4', '5,6,7,8', '9,10,11,12', '13,14,15,16', '17,18,19,20', '21,22,23,24']) {
          const { battle, mine, foe } = board(mode, move.id, hit, seed);
          const played = playTurn(mode, battle, mine, foe);
          if (mine.boosts[stat] <= 0) break;
          if (battle.log.some(line => line.startsWith('|-crit|') || line.startsWith('|-miss|') || line.startsWith('|-immune|'))) continue;
          const stages = pairStages(battle, mine, foe);
          const view = (pokemon: Pokemon, boosts: Pokemon['boosts']) => Object.create(pokemon, { boosts: { value: boosts } }) as Pokemon;
          const priced = boostedFraction(threat, view(foe, stages.foeHitting), view(mine, stages.mineDefending));
          const slack = 2 / mine.maxhp;
          checked++;
          if (played < 0.84 * priced - slack || played > priced + slack) {
            problems.push(`${move.id} ${stat}+${mine.boosts[stat]} seed ${seed}: the race prices ${priced.toFixed(3)}, the simulator played ${played.toFixed(3)}`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
    expect(problems).toEqual([]);
  });
});
