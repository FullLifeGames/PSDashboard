import { toID, type Battle } from '@pkmn/sim';
import { RecordingPRNG } from '../src/dice/prng';
import type { DieName, Draw } from '../src/dice/types';
import { watchBattle } from '../src/dice/watch';
import { copyOf } from '../src/sim-ask/copy';
import { mon, playClicks, type Mode, type Rules } from './dice-fixtures';
import { battleOf } from './power-oracle';

/**
 * Round 89 (#137): the boards and readers the two sweeps of the random draws share (`dice-random-target-sweep.spec.ts`,
 * `dice-drag-sweep.spec.ts`). The simulator draws a random target (`getRandomTarget`) and a random body to drag in
 * (`getRandomSwitchable`); the module names each as a die whose draw is a `sample` over bodies.
 *
 * Every board has a bench: two bodies behind the leads in singles and doubles, four in VGC (the team of six), all of different
 * species so that a body's name tells which one the draw picked.
 */

const BENCH = ['Chansey', 'Pikachu', 'Gengar', 'Raichu'];

export interface PickBoard {
  rules: Rules;
  mode: Mode;
  vgc: boolean;
  /** The moves of the attacker (p1a, a Snorlax) and the click it makes. */
  attacker: string[];
  attackerItem?: string;
  /** The moves of the foe in p2a (a Vaporeon, or a Persian when it carries moves: faster than the Snorlax) and its item. */
  foe?: string[];
  foeItem?: string;
  /** The first body of the bench carries an ability (a Porygon2: its Trace samples a foe when it comes in, a draw that is not the drag's). */
  benchAbility?: string;
  seed?: string;
}

/** The teams: leads first, the bench behind them (the same species on both sides, so the bodies' names stay distinct within a side). */
export function pickBoard(input: PickBoard): Battle {
  const { rules, mode, vgc } = input;
  const bench = BENCH.slice(0, vgc ? 4 : 2).map(species => mon(rules, { species, moves: ['splash'] }));
  if (input.benchAbility) bench[0] = { ...mon(rules, { species: 'Porygon2', moves: ['splash'] }), ability: input.benchAbility };
  // a Trace on the bench needs abilities to copy on the foe's side of it
  const copyable = input.benchAbility ? { ability: 'Thick Fat' } : {};
  const attacker = { ...mon(rules, { species: 'Snorlax', moves: input.attacker, gender: 'M' }), item: input.attackerItem ?? '', ...copyable };
  const foe = { ...mon(rules, { species: input.foe ? 'Persian' : 'Vaporeon', moves: input.foe ?? ['splash'] }), item: input.foeItem ?? '' };
  const doubles = mode === 'doubles';
  const p1 = [attacker, ...(doubles ? [{ ...mon(rules, { species: 'Blissey', moves: ['splash'] }), ...(input.benchAbility ? { ability: 'Natural Cure' } : {}) }] : []), ...bench];
  const p2 = [foe, ...(doubles ? [mon(rules, { species: 'Vaporeon', moves: ['splash'] })] : []), ...bench];
  return battleOf(doubles ? rules.doubles! : rules.singles, p1, p2, input.seed ?? '1,2,3,4');
}

/** The clicks of a turn: p1a's click and p2a's click (a doubles side's second body splashes). */
export function pickClicks(mode: Mode, p1a: string, p2a = 'move 1'): { p1: string; p2: string } {
  return mode === 'singles' ? { p1: p1a, p2: p2a } : { p1: `${p1a}, move 1`, p2: `${p2a}, move 1` };
}

/** The public half of a log: the simulator writes a private line twice (`|split|pN`, the owner's line, the spectator's line). */
export function publicHalf(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].startsWith('|split|')) index++;
    else out.push(lines[index]);
  }
  return out;
}

/** What the natural turn drew, per die key, and its lines. */
export interface Recorded {
  names: ReadonlyMap<string, DieName>;
  shapes: ReadonlyMap<string, Draw>;
  lines: string[];
}

/** The natural turn on a copy under the recording PRNG: the dice it named with the first draw's shape of each, and the turn's lines (without the clock). */
export function recorded(board: Battle, clicks: { p1: string; p2: string }): Recorded {
  const copy = copyOf(board);
  copy.prng ??= board.prng.clone();
  const start = copy.log.length;
  const watch = watchBattle(copy);
  const recording = new RecordingPRNG(copy.prng, watch);
  copy.prng = recording;
  try {
    playClicks(copy, clicks);
  } finally {
    watch.uninstall();
  }
  return { names: recording.names, shapes: recording.shapes, lines: publicHalf(copy.log.slice(start)).filter(line => !line.startsWith('|t:|')) };
}

/** The dice of one kind a recorded turn named. */
export const ofKind = (turn: Recorded, kind: DieName['kind']): [string, DieName][] => [...turn.names].filter(([, name]) => name.kind === kind);

/** The slot of a protocol ident (`p2a: Vaporeon`). */
export const slotIn = (ident: string | undefined): string | undefined => ident?.split(':')[0].trim();

/** The name of a protocol ident (`p2a: Vaporeon` gives `Vaporeon`). */
export const nameIn = (ident: string | undefined): string | undefined => ident?.split(':').slice(1).join(':').trim();

/** The target the `|move|` line of a body's move names, by slot: `undefined` when the turn shows no such line or it names none. */
export function aimOf(lines: readonly string[], userSlot: string, moveId: string): string | undefined {
  const line = lines.map(entry => entry.split('|')).find(fields => fields[1] === 'move' && slotIn(fields[2]) === userSlot && toID(fields[3]) === moveId);
  return slotIn(line?.[4]);
}

/** The bodies a `|drag|` line brought in, by the slot they took. */
export function draggedIn(lines: readonly string[]): { slot: string; name: string }[] {
  return lines.map(line => line.split('|')).filter(fields => fields[1] === 'drag').map(fields => ({ slot: slotIn(fields[2])!, name: nameIn(fields[2])! }));
}
