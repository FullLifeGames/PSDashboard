import { toID, type Battle } from '@pkmn/sim';
import { RecordingPRNG } from '../src/dice/prng';
import type { DieName, Draw } from '../src/dice/types';
import { watchBattle } from '../src/dice/watch';
import { copyOf } from '../src/sim-ask/copy';
import { clicksAccepted, dexOfRules } from './dice-sweep-support';
import { mon, playClicks, sweepSelection, SWEEPS_FULL, type Mode, type Rules } from './dice-fixtures';
import { battleOf } from './power-oracle';

const BENCH = ['Chansey', 'Pikachu', 'Gengar', 'Raichu'];

export interface PickBoard {
  rules: Rules;
  mode: Mode;
  vgc: boolean;
  attacker: string[];
  attackerItem?: string;
  foe?: string[];
  foeItem?: string;
  benchAbility?: string;
  seed?: string;
}

export function pickBoard(input: PickBoard): Battle {
  const { rules, mode, vgc } = input;
  const bench = BENCH.slice(0, vgc ? 4 : 2).map(species => mon(rules, { species, moves: ['splash'] }));
  if (input.benchAbility) bench[0] = { ...mon(rules, { species: 'Porygon2', moves: ['splash'] }), ability: input.benchAbility };
  const copyable = input.benchAbility ? { ability: 'Thick Fat' } : {};
  const attacker = { ...mon(rules, { species: 'Snorlax', moves: input.attacker, gender: 'M' }), item: input.attackerItem ?? '', ...copyable };
  const foe = { ...mon(rules, { species: input.foe ? 'Persian' : 'Vaporeon', moves: input.foe ?? ['splash'] }), item: input.foeItem ?? '' };
  const doubles = mode === 'doubles';
  const p1 = [attacker, ...(doubles ? [{ ...mon(rules, { species: 'Blissey', moves: ['splash'] }), ...(input.benchAbility ? { ability: 'Natural Cure' } : {}) }] : []), ...bench];
  const p2 = [foe, ...(doubles ? [mon(rules, { species: 'Vaporeon', moves: ['splash'] })] : []), ...bench];
  return battleOf(doubles ? rules.doubles! : rules.singles, p1, p2, input.seed ?? '1,2,3,4');
}

export function pickClicks(mode: Mode, p1a: string, p2a = 'move 1'): { p1: string; p2: string } {
  return mode === 'singles' ? { p1: p1a, p2: p2a } : { p1: `${p1a}, move 1`, p2: `${p2a}, move 1` };
}

/** The simulator writes a private line twice (`|split|pN`, the owner's line, the spectator's line). */
export function publicHalf(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].startsWith('|split|')) index++;
    else out.push(lines[index]);
  }
  return out;
}

export interface Recorded {
  names: ReadonlyMap<string, DieName>;
  shapes: ReadonlyMap<string, Draw>;
  lines: string[];
}

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

export const ofKind = (turn: Recorded, kind: DieName['kind']): [string, DieName][] => [...turn.names].filter(([, name]) => name.kind === kind);

export const slotIn = (ident: string | undefined): string | undefined => ident?.split(':')[0].trim();

export const nameIn = (ident: string | undefined): string | undefined => ident?.split(':').slice(1).join(':').trim();

export function aimOf(lines: readonly string[], userSlot: string, moveId: string): string | undefined {
  const line = lines.map(entry => entry.split('|')).find(fields => fields[1] === 'move' && slotIn(fields[2]) === userSlot && toID(fields[3]) === moveId);
  return slotIn(line?.[4]);
}

export function draggedIn(lines: readonly string[]): { slot: string; name: string }[] {
  return lines.map(line => line.split('|')).filter(fields => fields[1] === 'drag').map(fields => ({ slot: slotIn(fields[2])!, name: nameIn(fields[2])! }));
}

export function sweepItems(rules: Rules) {
  const dex = dexOfRules(rules);
  const legal = dex.items.all().filter(item => item.exists && item.gen <= dex.gen && (item.isNonstandard === null || item.isNonstandard === undefined || item.isNonstandard === 'Past'));
  return sweepSelection(legal, SWEEPS_FULL ? undefined : 'pool');
}

export function bentScene(input: { rules: Rules; mode: Mode; vgc: boolean }, moveId: string, first: string): { board: Battle; clicks: { p1: string; p2: string } } | null {
  const { rules, mode, vgc } = input;
  const board = pickBoard({ rules, mode, vgc, attacker: [moveId, 'splash'], foe: ['encore', 'splash'] });
  const opening = pickClicks(mode, first, 'move 2');
  if (!clicksAccepted(board, opening)) return null;
  playClicks(board, opening);
  const clicks = pickClicks(mode, 'move 2', mode === 'singles' ? 'move 1' : 'move 1 1');
  return clicksAccepted(board, clicks) ? { board, clicks } : null;
}
