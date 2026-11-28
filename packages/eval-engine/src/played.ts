import { dexOf, toId, type GameRules, type RulesDex, type SideId, type TurnSnapshot } from '@fulllifegames/replay-core';
import { normalizeLineEndings, normalizeLines } from './line-endings.ts';
import { isPivotMove } from './pivot-moves.ts';
import { detectSacks as detectSacksOfLf, type SackInfo } from './turn-analysis/sacks.ts';

export type { SackInfo } from './turn-analysis/sacks.ts';

/** The sack each side made this turn; it also passes the line-ending door, since a '\r' hid every faint pattern. */
export function detectSacks(events: string[], snapshotBefore: TurnSnapshot | null, rules: GameRules): { p1?: SackInfo; p2?: SackInfo } {
  return detectSacksOfLf(normalizeLines(events), snapshotBefore, rules);
}

/** One side's chosen action of a turn: a move or a switch with gimmick flags, doubles target and pivot follow-up. */
export interface PlayedAction {
  kind: 'move' | 'switch';
  /** Move name, or the incoming Pokémon's nickname for switches. */
  name: string;
  /** Switches: the species (matching fallback when the nickname differs). */
  species?: string;
  tera?: boolean;
  mega?: boolean;
  ultra?: boolean;
  /** Doubles sim target location: 1/2 foe slots, negative own side, null when the line names no slot target. */
  targetLoc?: number | null;
  pivotTarget?: string;
}

export interface LoggedMove { slot: string; move: string }

/** A body that fell before it acted, with what the order bound reads (`branch/action-bound.ts`); plain data, cached. */
export interface FellMark {
  before: LoggedMove[];
  speedMoved: boolean;
  activations: string[];
}

/** What the order rules exclude for a body that fell before acting: move ids it cannot have picked, and a switch. */
export interface SlotBound {
  moves: string[];
  switchOut: boolean;
}

/** The bound per side and slot, as the parse's `fell` marks it; null when the slot has none. */
export interface PlayedBounds { p1?: (SlotBound | null)[]; p2?: (SlotBound | null)[] }

/** What each side chose in one turn: one action per side, or per slot in doubles. */
export interface PlayedTurn {
  p1: PlayedAction | null;
  p2: PlayedAction | null;
  /** Doubles: per-slot actions, index 0 = slot a; absent in singles. */
  p1Slots?: (PlayedAction | null)[];
  p2Slots?: (PlayedAction | null)[];
  /** Why a choice never surfaced: the `|cant|` reason ('slp', 'move: Taunt') or 'faint'; the player did choose. */
  prevented?: { p1?: string; p2?: string };
  /** Per side and slot, the mark of a body that fell before acting (null: the slot did not); absent when none fell. */
  fell?: { p1?: (FellMark | null)[]; p2?: (FellMark | null)[] };
  /** Doubles: per side and slot, true where the slot logged nothing before `|win|` or `|tie|`; absent when none. */
  ended?: { p1?: boolean[]; p2?: boolean[] };
}

const sideOf = (pokemonRef: string): SideId | null => {
  if (pokemonRef.startsWith('p1')) return 'p1';
  if (pokemonRef.startsWith('p2')) return 'p2';
  return null;
};

const slotOf = (pokemonRef: string): { side: SideId; slot: number } | null => {
  const match = pokemonRef.match(/^(p[12])([a-c])/);
  if (!match) return null;
  return { side: match[1] as SideId, slot: match[2].charCodeAt(0) - 97 };
};

const nickname = (pokemonRef: string): string => pokemonRef.replace(/^p[12][a-c]: /, '');

/** `|move|` lines count unless a `[from]` tag says another effect ran them (Dancer, Magic Bounce, Sleep Talk). */
export function loggedMoves(lines: readonly string[]): LoggedMove[] {
  const out: LoggedMove[] = [];
  for (const line of lines) {
    const parts = line.split('|');
    const mover = /^p[12][a-d](?=:)/.exec(parts[2] ?? '');
    if (parts[1] !== 'move' || !mover) continue;
    if (parts.slice(5).some(tag => tag.startsWith('[from]') && !tag.startsWith('[from]lockedmove'))) continue;
    out.push({ slot: mover[0], move: parts[3] ?? '' });
  }
  return out;
}

const SPEED_MOVING = new Set([
  '-sidestart', '-sideend', '-fieldstart', '-fieldend', '-weather', '-curestatus', '-item', '-enditem', '-ability', '-endability',
  '-formechange', '-detailschange', '-transform', '-mega', '-burst', '-swapboost', '-copyboost', '-clearboost', '-clearallboost',
  '-clearnegativeboost', '-clearpositiveboost', '-invertboost',
]);

const movesSpeed = (parts: string[]): boolean =>
  SPEED_MOVING.has(parts[1] ?? '') ||
  ((parts[1] === '-boost' || parts[1] === '-unboost' || parts[1] === '-setboost') && parts[3] === 'spe') ||
  (parts[1] === '-status' && parts[3] === 'par');

interface FellTrack { moves: LoggedMove[]; speedMoved: boolean }

function trackLine(track: FellTrack, line: string, parts: string[]): void {
  track.moves.push(...loggedMoves([line]));
  if (movesSpeed(parts)) track.speedMoved = true;
}

const fellMark = (track: FellTrack, ref: string, activations: string[]): FellMark => ({
  before: track.moves.filter(action => action.slot !== ref.slice(0, 3)),
  speedMoved: track.speedMoved,
  activations: [...activations],
});

const activationLines = (lines: string[]): string[] => lines.filter(line => line.startsWith('|-activate|'));

interface PlayedScan {
  dex: RulesDex;
  actions: { p1: PlayedAction | null; p2: PlayedAction | null };
  settled: Record<SideId, boolean>;
  /** The side's body fainted: a switch after that is a replacement, never the follow-up of a move. */
  fainted: Record<SideId, boolean>;
  tera: Record<SideId, boolean>;
  mega: Record<SideId, boolean>;
  ultra: Record<SideId, boolean>;
  prevented: { p1?: string; p2?: string };
}

function noteGimmick(scan: PlayedScan, tag: string, side: SideId): void {
  if (tag === '-terastallize') scan.tera[side] = true;
  else if (tag === '-mega') scan.mega[side] = true;
  else scan.ultra[side] = true;
}

// A cancelled choice: what follows for the side (replacements) is not its chosen action.
function notePrevented(scan: PlayedScan, tag: string, side: SideId, reason: string | undefined): void {
  if (!scan.settled[side] && scan.actions[side] === null && scan.prevented[side] === undefined) {
    scan.prevented[side] = tag === 'faint' ? 'faint' : (reason ?? 'prevented');
  }
  if (tag === 'faint') scan.fainted[side] = true;
  scan.settled[side] = true;
}

function noteMove(scan: PlayedScan, side: SideId, name: string): void {
  if (scan.settled[side]) return;
  scan.actions[side] = {
    kind: 'move', name, tera: scan.tera[side],
    ...(scan.mega[side] ? { mega: true } : {}), ...(scan.ultra[side] ? { ultra: true } : {}),
  };
  scan.settled[side] = true;
}

function noteSwitch(scan: PlayedScan, side: SideId, ref: string, species: string): void {
  if (scan.settled[side]) {
    // A switch after the side's own pivot move records the player's second pick; a body that fainted after its move
    // is a replacement instead, and a Teleport that failed before Gen 8 records no target.
    const action = scan.actions[side];
    if (action && action.kind === 'move' && !scan.fainted[side] && isPivotMove(scan.dex, toId(action.name)) &&
      action.pivotTarget === undefined) {
      action.pivotTarget = species;
    }
    return;
  }
  scan.actions[side] = { kind: 'switch', name: nickname(ref), species };
  scan.settled[side] = true;
}

function notePlayedLine(scan: PlayedScan, tag: string, side: SideId, parts: string[]): void {
  if (tag === '-terastallize' || tag === '-mega' || tag === '-burst') {
    noteGimmick(scan, tag, side);
  } else if (tag === 'faint' || tag === 'cant') {
    notePrevented(scan, tag, side, parts[3]);
  } else if (tag === 'move') {
    noteMove(scan, side, parts[3] ?? '');
  } else if (tag === 'switch') {
    noteSwitch(scan, side, parts[2] ?? '', (parts[3] ?? '').split(',')[0].trim());
  }
}

// The lines pass the line-ending door first, so a `|cant|` reason (its last field) reads "flinch", never "flinch\r".
/** Per side, the first |move| or |switch| line, except pivot follow-ups, replacements, |drag| and |replace|. */
export function parsePlayedActions(lines: string[], rules: GameRules): PlayedTurn {
  const scan: PlayedScan = {
    dex: dexOf(rules),
    actions: { p1: null, p2: null },
    settled: { p1: false, p2: false },
    fainted: { p1: false, p2: false },
    tera: { p1: false, p2: false },
    mega: { p1: false, p2: false },
    ultra: { p1: false, p2: false },
    prevented: {},
  };

  const turn = normalizeLines(lines);
  const activations = activationLines(turn);
  const track: FellTrack = { moves: [], speedMoved: false };
  const fell: NonNullable<PlayedTurn['fell']> = {};
  for (const line of turn) {
    const parts = line.split('|');
    const tag = parts[1];
    if (!tag) continue;
    const side = sideOf(parts[2] ?? '');
    if (side && tag === 'faint' && !scan.settled[side] && scan.actions[side] === null && scan.prevented[side] === undefined) {
      fell[side] = [fellMark(track, parts[2] ?? '', activations)];
    }
    trackLine(track, line, parts);
    if (side) notePlayedLine(scan, tag, side, parts);
  }

  return {
    ...scan.actions, ...(scan.prevented.p1 || scan.prevented.p2 ? { prevented: scan.prevented } : {}),
    ...(fell.p1 || fell.p2 ? { fell } : {}),
  };
}

/** The leads each side sent out: species of the `|switch|` lines before the first `|turn|`, in slot order. */
export function parseLeadSpecies(rawLog: string): { p1: string[]; p2: string[] } {
  const leads = { p1: [] as string[], p2: [] as string[] };
  let started = false;
  for (const line of normalizeLineEndings(rawLog).split('\n')) {
    const parts = line.split('|');
    const tag = parts[1];
    if (tag === 'start') {
      started = true;
      continue;
    }
    if (!started) continue;
    if (tag === 'turn') break;
    if (tag === 'switch') {
      const side = sideOf(parts[2] ?? '');
      if (side) leads[side].push((parts[3] ?? '').split(',')[0].trim());
    }
  }
  return leads;
}

interface DoublesScan {
  slots: Record<SideId, (PlayedAction | null)[]>;
  settled: Record<SideId, boolean[]>;
  tera: Record<SideId, boolean[]>;
  mega: Record<SideId, boolean[]>;
  ultra: Record<SideId, boolean[]>;
}

type SlotRef = { side: SideId; slot: number };

function noteDoublesMove(scan: DoublesScan, ref: SlotRef, parts: string[]): void {
  if (scan.settled[ref.side][ref.slot]) return;
  const target = slotOf(parts[4] ?? '');
  const targetLoc = target === null || target.slot > 1
    ? null
    : target.side === ref.side ? -(target.slot + 1) : target.slot + 1;
  scan.slots[ref.side][ref.slot] = {
    kind: 'move', name: parts[3] ?? '', tera: scan.tera[ref.side][ref.slot],
    ...(scan.mega[ref.side][ref.slot] ? { mega: true } : {}),
    ...(scan.ultra[ref.side][ref.slot] ? { ultra: true } : {}),
    targetLoc,
  };
  scan.settled[ref.side][ref.slot] = true;
}

function noteDoublesSwitch(scan: DoublesScan, ref: SlotRef, parts: string[]): void {
  if (scan.settled[ref.side][ref.slot]) return;
  const species = (parts[3] ?? '').split(',')[0].trim();
  scan.slots[ref.side][ref.slot] = { kind: 'switch', name: nickname(parts[2] ?? ''), species };
  scan.settled[ref.side][ref.slot] = true;
}

function noteDoublesLine(scan: DoublesScan, tag: string, ref: SlotRef, parts: string[]): void {
  if (tag === '-terastallize') {
    scan.tera[ref.side][ref.slot] = true;
  } else if (tag === '-mega') {
    scan.mega[ref.side][ref.slot] = true;
  } else if (tag === '-burst') {
    scan.ultra[ref.side][ref.slot] = true;
  } else if (tag === 'faint' || tag === 'cant') {
    scan.settled[ref.side][ref.slot] = true;
  } else if (tag === 'move') {
    noteDoublesMove(scan, ref, parts);
  } else if (tag === 'switch') {
    noteDoublesSwitch(scan, ref, parts);
  }
}

/** Doubles variant of parsePlayedActions: the same settle rules per slot (a/b), plus move target locations. */
export function parsePlayedActionsDoubles(lines: string[]): PlayedTurn {
  const scan: DoublesScan = {
    slots: { p1: [null, null], p2: [null, null] },
    settled: { p1: [false, false], p2: [false, false] },
    tera: { p1: [false, false], p2: [false, false] },
    mega: { p1: [false, false], p2: [false, false] },
    ultra: { p1: [false, false], p2: [false, false] },
  };

  const turn = normalizeLines(lines);
  const activations = activationLines(turn);
  const track: FellTrack = { moves: [], speedMoved: false };
  const fell: Record<SideId, (FellMark | null)[]> = { p1: [null, null], p2: [null, null] };
  for (const line of turn) {
    const parts = line.split('|');
    const tag = parts[1];
    if (!tag) continue;
    const ref = slotOf(parts[2] ?? '');
    if (ref && ref.slot <= 1 && tag === 'faint' && !scan.settled[ref.side][ref.slot]) {
      fell[ref.side][ref.slot] = fellMark(track, parts[2] ?? '', activations);
    }
    trackLine(track, line, parts);
    if (ref && ref.slot <= 1) noteDoublesLine(scan, tag, ref, parts);
  }

  const marked = (['p1', 'p2'] as const).filter(side => fell[side].some(mark => mark !== null));
  const over = turn.some(line => line.startsWith('|win|') || line === '|tie' || line.startsWith('|tie|'));
  const unsettled = over ? (['p1', 'p2'] as const).filter(side => scan.settled[side].some(done => !done)) : [];
  return {
    p1: null, p2: null, p1Slots: scan.slots.p1, p2Slots: scan.slots.p2,
    ...(marked.length > 0 ? { fell: Object.fromEntries(marked.map(side => [side, fell[side]])) as NonNullable<PlayedTurn['fell']> } : {}),
    ...(unsettled.length > 0
      ? { ended: Object.fromEntries(unsettled.map(side => [side, scan.settled[side].map(done => !done)])) as NonNullable<PlayedTurn['ended']> }
      : {}),
  };
}

/** The lines strictly between `|turn|N` and `|turn|N+1`, unlike a TurnSnapshot's `log` chunk (grouped by snapshot). */
export function turnEvents(rawLog: string, turn: number): string[] {
  const lines = normalizeLineEndings(rawLog).split('\n');
  const start = lines.indexOf(`|turn|${turn}`);
  if (start < 0) return [];
  const events: string[] = [];
  for (let index = start + 1; index < lines.length; index++) {
    if (lines[index].startsWith('|turn|')) break;
    events.push(lines[index]);
  }
  return events;
}

/** `result[turn]` holds that turn's events, split in one pass. */
export function allTurnEvents(rawLog: string): string[][] {
  const byTurn: string[][] = [];
  let current: string[] | null = null;
  for (const line of normalizeLineEndings(rawLog).split('\n')) {
    const match = line.match(/^\|turn\|(\d+)/);
    if (match) {
      current = [];
      byTurn[parseInt(match[1], 10)] = current;
      continue;
    }
    current?.push(line);
  }
  return byTurn;
}
