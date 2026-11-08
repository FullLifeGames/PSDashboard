import type { Battle, PokemonSet } from '@pkmn/sim';
import { sideIndex } from '@fulllifegames/replay-core';
import { FixedDice, twinBattle } from '../sim-ask/index.ts';
import { removalFormat } from '../score/boost-bite.ts';
import { usableSlots } from '../score/threat.ts';
import { other, type Side } from './prover-order.ts';

/**
 * Round 88 (T336, #72, E2b): which moves read or move the stat stages a class moved. A class in which a secondary effect fired may
 * take the proof of the class in which it did not only while the effect cannot turn against the mover later in the proof: the mover's
 * stages up and the foe's down help the mover, unless a foe body clicks a move that reads them (Foul Play reads the target's Attack,
 * Punishment the target's positive stages), copies or steals a gain (Psych Up, Spectral Thief, Transform), turns the stages
 * (Topsy-Turvy) or hands them over (the Swap moves). The Dex has a field for some of them and none for the rest, so the answer is the
 * simulator's, played once per twin format and move, the way `removesStages` (score/boost-bite.ts) asks it about Haze and the phazers.
 *
 * The question: the foe (Snorlax, the move first) clicks the move at the target (Vaporeon, a pure Water type: no typing is immune)
 * in five runs, with every die answering yes and the damage roll at its middle (`FixedDice`), so the runs differ in the stages only.
 * Baseline: nobody has a stage. Then the target gains two stages in Attack and Special Attack, then in Defense and Special Defense,
 * then in Accuracy and Evasion (the gains a class gives the mover), and the foe loses two stages in all six (what the class takes from
 * it). Speed is left out: a class that moves a Speed stage is never carried over (`onlyHelpsMover`). A move reads the stages when, against
 * the baseline, the target loses more HP, a stage of the target ends lower, or a stage of the foe ends higher. Each of the three would
 * make the fired position worse for the mover than the unfired one, which the carried proof denies. A charge move plays its second turn.
 */

// A body with no ability and no item: nothing but the move answers the stages.
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

/** One run of the question: the HP the target lost and the stages both bodies ended with, or null when the move cannot be clicked. */
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

/** Whether the run is worse for the target than the baseline: more HP lost, a target stage lower, a foe stage higher. */
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

/**
 * Whether a move reads or moves the stat stages, as the simulator plays it, once per twin format and move. `format` is the twin's
 * (`removalFormat` of the battle); `test/stage-readers-sweep.spec.ts` plays every move of every rule set against it.
 */
export function readsStages(format: string, moveId: string): boolean {
  const key = `${format}|${moveId}`;
  let reads = answers.get(key);
  if (reads === undefined) {
    reads = ask(format, moveId);
    answers.set(key, reads);
  }
  return reads;
}

/**
 * Whether a living body of the foe's side (on the field or on the bench: a switch brings it in) can click a move that reads the stages.
 * Reads the battle (the move slots, the generation, the format), writes nothing.
 */
export function foeReadsStages(battle: Battle, mover: Side): boolean {
  const format = removalFormat(battle);
  return battle.sides[sideIndex(other(mover))].pokemon.some(mon => !mon.fainted && usableSlots(mon).some(slot => readsStages(format, slot.id)));
}
