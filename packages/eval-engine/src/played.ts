/**
 * Parses what each side actually chose in one turn's protocol block. Pure —
 * no @pkmn/sim imports of its own (the Dex comes from replay-core's resolver), main-bundle safe.
 */

import { dexOf, toId, type GameRules, type RulesDex, type SideId, type TurnSnapshot } from '@fulllifegames/replay-core';
import { normalizeLineEndings, normalizeLines } from './line-endings.ts';
import { isPivotMove } from './pivot-moves.ts';
import { detectSacks as detectSacksOfLf, type SackInfo } from './turn-analysis/sacks.ts';

export type { SackInfo } from './turn-analysis/sacks.ts';

/**
 * Round 63: the sack shapes live in turn-analysis/sacks.ts; the protocol API keeps its old address. Round 70 (T206): the address
 * is also the reader's door for line endings, because the faint pattern matches to the line end and a '\r' there hid every sack.
 */
export function detectSacks(events: string[], snapshotBefore: TurnSnapshot | null, rules: GameRules): { p1?: SackInfo; p2?: SackInfo } {
  return detectSacksOfLf(normalizeLines(events), snapshotBefore, rules);
}

export interface PlayedAction {
  kind: 'move' | 'switch';
  /** Move name, or the incoming Pokémon's nickname for switches. */
  name: string;
  /** Switches: the species (matching fallback when the nickname differs). */
  species?: string;
  /** Move actions: the side terastallized this turn. */
  tera?: boolean;
  /** Move actions: the Pokémon Mega Evolved / Ultra Bursted this turn. */
  mega?: boolean;
  ultra?: boolean;
  /**
   * Doubles moves: the sim target location (1/2 = foe slots, negative =
   * own side), null when the line names no slot target (spread/self).
   */
  targetLoc?: number | null;
  /**
   * Pivot moves (U-turn family): the species that came in on the follow-up
   * switch — the other half of the pair the player actually chose.
   */
  pivotTarget?: string;
}

/** One move action of a turn's log: the body's slot ('p1a') and the move's name as the line writes it. */
export interface LoggedMove { slot: string; move: string }

/**
 * Round 89 (#108): a body that fell before it acted, with what the order bound reads (`branch/action-bound.ts`): the move actions the log
 * shows before the fall (other bodies), whether a line before it can have moved a speed (then only a priority bracket proves an order), and
 * the turn's `|-activate|` lines (the dice of Quick Claw, Custap Berry, Quick Draw and the like). Plain data, so it travels with a cache entry.
 */
export interface FellMark {
  before: LoggedMove[];
  speedMoved: boolean;
  activations: string[];
}

/**
 * Round 89 (#108): what the order rules rule out for a body that fell before it acted: the move ids it cannot have chosen, and whether a
 * chosen switch is out too. Plain data (the grading reads it, the cache carries it).
 */
export interface SlotBound {
  moves: string[];
  switchOut: boolean;
}

/** The bound per side and slot, as the parse's `fell` marks it (null: no bound for the slot). */
export interface PlayedBounds { p1?: (SlotBound | null)[]; p2?: (SlotBound | null)[] }

export interface PlayedTurn {
  p1: PlayedAction | null;
  p2: PlayedAction | null;
  /** Doubles: per-slot actions (index 0 = slot a). Absent for singles. */
  p1Slots?: (PlayedAction | null)[];
  p2Slots?: (PlayedAction | null)[];
  /**
   * Why a side's choice never surfaced, when the protocol says: the `|cant|`
   * reason ('slp', 'flinch', 'move: Taunt', …) or 'faint'. The player DID
   * choose — the report should say what swallowed it, not "could not act".
   */
  prevented?: { p1?: string; p2?: string };
  /**
   * Round 89 (#108): per side and slot, the mark of a body that fell before it acted (null: the slot did not). Singles carry one slot.
   * Absent when no body fell before acting.
   */
  fell?: { p1?: (FellMark | null)[]; p2?: (FellMark | null)[] };
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

/**
 * The move actions in a stretch of a turn's lines: a `|move|` line is an action unless a `[from]` tag says another effect ran it (a Dancer
 * copy, a Magic Bounce reflection, Sleep Talk's inner move); a locked move still is one.
 */
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

/** Tags that can move an action speed in the middle of a turn: field and side conditions, weather, status, an ability, an item, a forme, a Mega Evolution. */
const SPEED_MOVING = new Set([
  '-sidestart', '-sideend', '-fieldstart', '-fieldend', '-weather', '-curestatus', '-item', '-enditem', '-ability', '-endability',
  '-formechange', '-detailschange', '-transform', '-mega', '-burst', '-swapboost', '-copyboost', '-clearboost', '-clearallboost',
  '-clearnegativeboost', '-clearpositiveboost', '-invertboost',
]);

/** Whether a protocol line can move an action speed: a Speed stage, a paralysis, or one of the tags above. */
const movesSpeed = (parts: string[]): boolean =>
  SPEED_MOVING.has(parts[1] ?? '') ||
  ((parts[1] === '-boost' || parts[1] === '-unboost' || parts[1] === '-setboost') && parts[3] === 'spe') ||
  (parts[1] === '-status' && parts[3] === 'par');

/** What the scans track up to a fall: the move actions so far and whether a line moved a speed. */
interface FellTrack { moves: LoggedMove[]; speedMoved: boolean }

function trackLine(track: FellTrack, line: string, parts: string[]): void {
  track.moves.push(...loggedMoves([line]));
  if (movesSpeed(parts)) track.speedMoved = true;
}

/** The mark of the body at `ref` ('p1a: Name'): the moves of the other slots so far. */
const fellMark = (track: FellTrack, ref: string, activations: string[]): FellMark => ({
  before: track.moves.filter(action => action.slot !== ref.slice(0, 3)),
  speedMoved: track.speedMoved,
  activations: [...activations],
});

const activationLines = (lines: string[]): string[] => lines.filter(line => line.startsWith('|-activate|'));

/** The singles scan: per side the settled action, the gimmick flags, and why a choice never surfaced. */
interface PlayedScan {
  /** Round 75 (T160): the game's own Dex (generation and mod), for the pivot moves. */
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

/**
 * The side's queued choice was cancelled (or never shown) — whatever
 * follows for it (replacements) is not the chosen action. Record WHY
 * when no action had surfaced yet, so the report can say so.
 */
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
    // A switch after the side's own PIVOT move is the pair's other half —
    // record which Pokémon the player brought in (grading distinguishes
    // "U-turn → the wall" from "U-turn → the wincon"). Round 70 (N1): the pivots
    // are the Dex's selfSwitch moves (pivot-moves.ts), and a body that fainted
    // after its move was replaced, not pivoted: a Teleport that failed before
    // Gen 8 records no target. The scan reads the game's own Dex (round 75, T160).
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

/** Dispatches one protocol line with a side to its handler; other tags are not choices. */
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

/**
 * Per side, the chosen action is its first `|move|` or `|switch|` line —
 * with the protocol's traps excluded: switches after the side already moved
 * are pivots (U-turn), switches after the side's own faint are replacements,
 * `|drag|`/`|replace|` are never choices, and `|cant|` means the choice
 * never surfaced (the side stays unknown rather than guessed). Round 70 (T206): the lines pass the door for line endings first, so
 * the reason of a `|cant|` line, its last field, reads "flinch" and never "flinch\r".
 */
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

/**
 * The leads each side actually sent out: the `|switch|` lines between
 * `|start` and the first `|turn|` — the turn-0 decision as the replay shows
 * it. Species names, in slot order.
 */
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

/** The doubles scan: per side and slot the settled action and the gimmick flags. */
interface DoublesScan {
  slots: Record<SideId, (PlayedAction | null)[]>;
  settled: Record<SideId, boolean[]>;
  tera: Record<SideId, boolean[]>;
  mega: Record<SideId, boolean[]>;
  ultra: Record<SideId, boolean[]>;
}

type SlotRef = { side: SideId; slot: number };

/** A slot's move with its target location, unless the slot already settled. */
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

/** A slot's switch-in, unless the slot already settled. */
function noteDoublesSwitch(scan: DoublesScan, ref: SlotRef, parts: string[]): void {
  if (scan.settled[ref.side][ref.slot]) return;
  const species = (parts[3] ?? '').split(',')[0].trim();
  scan.slots[ref.side][ref.slot] = { kind: 'switch', name: nickname(parts[2] ?? ''), species };
  scan.settled[ref.side][ref.slot] = true;
}

/** The same settle rules as the singles scan, applied per slot. */
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

/**
 * Doubles variant: the same settle rules applied per SLOT (a/b), plus move
 * target locations so combined engine choices can be matched exactly.
 */
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
  return {
    p1: null, p2: null, p1Slots: scan.slots.p1, p2Slots: scan.slots.p2,
    ...(marked.length > 0 ? { fell: Object.fromEntries(marked.map(side => [side, fell[side]])) as NonNullable<PlayedTurn['fell']> } : {}),
  };
}

/**
 * The protocol lines strictly between `|turn|N` and `|turn|N+1` (or the log
 * end). NOT the same as a TurnSnapshot's `log` chunk, which groups lines by
 * snapshot association rather than turn boundaries.
 */
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

/**
 * One-pass turn index: `result[turn]` holds that turn's events (same slicing
 * as turnEvents). Callers iterating every turn use this instead of calling
 * turnEvents per turn, which re-splits the whole log each time.
 */
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
