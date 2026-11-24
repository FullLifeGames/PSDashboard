import type { Battle, PokemonSet } from '@pkmn/sim';
import { sideIndex } from '@fulllifegames/replay-core';
import { FixedDice, twinBattle } from '../sim-ask/index.ts';
import { removalFormat } from '../score/boost-bite.ts';
import { usableSlots } from '../score/threat.ts';
import { other, type Side } from './prover-order.ts';

// The Dex marks some stage readers and not others, so the simulator answers: five runs of a move, stages differ only.
// Speed is left out (`onlyHelpsMover` never carries a class that moves it); a charge move plays its second turn.

const body = (species: string, moves: string[]): PokemonSet => ({
// eslint-disable-next-line names/no-new-dex-name -- stand-in bodies of a played question: the census plays every move against them, held by stage-readers-sweep.spec.ts
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
  evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  level: 100, gender: '',
});

type Stat = 'atk' | 'def' | 'spa' | 'spd' | 'accuracy' | 'evasion';
const GAINS: readonly (readonly Stat[])[] = [['atk', 'spa'], ['def', 'spd'], ['accuracy', 'evasion']];
const ALL: readonly Stat[] = ['atk', 'def', 'spa', 'spd', 'accuracy', 'evasion'];

interface Played { lost: number; target: Record<string, number>; foe: Record<string, number> }

function played(format: string, moveId: string, gain: readonly Stat[], loss: readonly Stat[]): Played | null {
// eslint-disable-next-line names/no-new-dex-name -- stand-in bodies of a played question: the census plays every move against them, held by stage-readers-sweep.spec.ts
  const twin = twinBattle(format, { p1: { name: 'Target', team: [body('Vaporeon', ['splash'])] }, p2: { name: 'Foe', team: [body('Snorlax', [moveId, 'splash'])] } });
  twin.prng = new FixedDice({ chance: true });
  const target = twin.sides[0].active[0]!;
  const foe = twin.sides[1].active[0]!;
  for (const stat of gain) target.boosts[stat] = 2;
  for (const stat of loss) foe.boosts[stat] = -2;
  const hp = target.hp;
  for (let turn = 0; turn < 2 && !twin.ended; turn++) {
    if (!twin.choose('p2', turn === 0 ? 'move 1' : 'default')) return null;
    twin.choose('p1', turn === 0 ? 'move 1' : 'default');
    if (!foe.volatiles['twoturnmove'] && !foe.volatiles['mustrecharge']) break;
  }
  return { lost: hp - target.hp, target: { ...target.boosts }, foe: { ...foe.boosts } };
}

function worse(run: Played, base: Played): boolean {
  const stages = Object.keys(base.target);
  return run.lost > base.lost || stages.some(stat => run.target[stat] < base.target[stat] || run.foe[stat] > base.foe[stat]);
}

function ask(format: string, moveId: string): boolean {
  try {
    const base = played(format, moveId, [], []);
    if (!base) return false;
    const runs = [...GAINS.map(gain => played(format, moveId, gain, [])), played(format, moveId, [], ALL)];
    return runs.some(run => run !== null && worse(run, base));
  } catch {
    return false;
  }
}

const answers = new Map<string, boolean>();

/** Whether a move reads or moves stat stages, as the simulator plays it (test/stage-readers-sweep.spec.ts holds it). */
export function readsStages(format: string, moveId: string): boolean {
  const key = `${format}|${moveId}`;
  let reads = answers.get(key);
  if (reads === undefined) {
    reads = ask(format, moveId);
    answers.set(key, reads);
  }
  return reads;
}

/** Whether a living foe body, on the field or the bench (a switch brings it in), can click a move that reads stages. */
export function foeReadsStages(battle: Battle, mover: Side): boolean {
  const format = removalFormat(battle);
  return battle.sides[sideIndex(other(mover))].pokemon.some(mon => !mon.fainted && usableSlots(mon).some(slot => readsStages(format, slot.id)));
}
