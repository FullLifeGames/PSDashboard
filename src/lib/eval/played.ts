/**
 * Parses what each side actually chose in one turn's protocol block. Pure —
 * no @pkmn/sim imports, main-bundle safe.
 */

import type { TurnSnapshot } from '../../types';
import { toId, type SideId } from '../ids';

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

/** The U-turn family — moves whose follow-up switch is part of the choice. */
const PIVOT_MOVE_NAMES = new Set([
  'uturn', 'voltswitch', 'flipturn', 'partingshot', 'teleport', 'batonpass',
  'chillyreception', 'shedtail',
]);

/** The singles scan: per side the settled action, the gimmick flags, and why a choice never surfaced. */
interface PlayedScan {
  actions: { p1: PlayedAction | null; p2: PlayedAction | null };
  settled: Record<SideId, boolean>;
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
    // "U-turn → the wall" from "U-turn → the wincon").
    const action = scan.actions[side];
    if (action && action.kind === 'move' && PIVOT_MOVE_NAMES.has(toId(action.name)) &&
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
 * never surfaced (the side stays unknown rather than guessed).
 */
export function parsePlayedActions(lines: string[]): PlayedTurn {
  const scan: PlayedScan = {
    actions: { p1: null, p2: null },
    settled: { p1: false, p2: false },
    tera: { p1: false, p2: false },
    mega: { p1: false, p2: false },
    ultra: { p1: false, p2: false },
    prevented: {},
  };

  for (const line of lines) {
    const parts = line.split('|');
    const tag = parts[1];
    if (!tag) continue;
    const side = sideOf(parts[2] ?? '');
    if (side) notePlayedLine(scan, tag, side, parts);
  }

  return { ...scan.actions, ...(scan.prevented.p1 || scan.prevented.p2 ? { prevented: scan.prevented } : {}) };
}

/**
 * The leads each side actually sent out: the `|switch|` lines between
 * `|start` and the first `|turn|` — the turn-0 decision as the replay shows
 * it. Species names, in slot order.
 */
export function parseLeadSpecies(log: string): { p1: string[]; p2: string[] } {
  const leads = { p1: [] as string[], p2: [] as string[] };
  let started = false;
  for (const line of log.split('\n')) {
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

  for (const line of lines) {
    const parts = line.split('|');
    const tag = parts[1];
    if (!tag) continue;
    const ref = slotOf(parts[2] ?? '');
    if (!ref || ref.slot > 1) continue;
    noteDoublesLine(scan, tag, ref, parts);
  }

  return { p1: null, p2: null, p1Slots: scan.slots.p1, p2Slots: scan.slots.p2 };
}

/** A Pokémon fed to the opponent while nearly dead — its loss cost almost nothing. */
export interface SackInfo {
  name: string;
  hpFraction: number;
  /**
   * The fed body was HEALTHY (switched in and fainted the same turn above
   * the low-HP threshold) — a simplification-sack CANDIDATE. Unlike low-HP
   * feeds, the verdict layer only honors it while the engine's own scores
   * call the game decisively won on both sides of the sack.
   */
  healthy?: boolean;
  /**
   * The fed body STAYED on the field (already active at turn start, never
   * entered this turn) and fainted above the low-HP threshold — a
   * deliberate-feed CANDIDATE (573756 t68). The verdict layer honors it
   * only when the realized outcome landed on the played line's priced
   * floor (the accepted worst case is what happened — no upside luck)
   * and the windowed payoff over the safe guarantee clears the read margin.
   */
  stayed?: true;
  /**
   * Verdict-layer stamp (analysis.ts) — never set by detection: the stayed
   * feed's windowed payoff repaid the FULL regret with the read margin on
   * top, so the verdict cleared entirely instead of demoting one band.
   */
  verified?: true;
}

/** Below this pre-turn HP fraction a faint reads as a sacrifice, not a loss. */
export const SACK_HP_THRESHOLD = 0.15;

/**
 * The protocol lines strictly between `|turn|N` and `|turn|N+1` (or the log
 * end). NOT the same as a TurnSnapshot's `log` chunk, which groups lines by
 * snapshot association rather than turn boundaries.
 */
export function turnEvents(log: string, turn: number): string[] {
  const lines = log.split('\n');
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
export function allTurnEvents(log: string): string[][] {
  const byTurn: string[][] = [];
  let current: string[] | null = null;
  for (const line of log.split('\n')) {
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

/** Latest deliberate switch-in per slot ident this turn (drags excluded). */
type Entered = Map<string, { name: string; hpFraction: number }>;

/**
 * The sack a faint line reads as, in shape order: the low-HP feed (pre-turn
 * snapshot at or below the threshold), the healthy simplification
 * candidate (deliberately switched in this turn above the threshold), or
 * the stay-and-die candidate (active since the turn began, above the
 * threshold); undefined when the faint is a plain loss.
 */
function sackForFaint(
  side: SideId,
  slot: string,
  name: string,
  snapshotBefore: TurnSnapshot,
  entered: Entered,
  dragged: Set<string>,
): SackInfo | undefined {
  const nameId = toId(name);
  const snapshotSide = side === 'p1' ? snapshotBefore.p1 : snapshotBefore.p2;
  const pokemon = snapshotSide.pokemon.find(entry =>
    toId(entry.name) === nameId || toId(entry.speciesForme) === nameId);
  if (pokemon?.fainted) return undefined;
  if (pokemon && pokemon.hpPercent / 100 <= SACK_HP_THRESHOLD) {
    return { name, hpFraction: pokemon.hpPercent / 100 };
  }
  // The healthy candidate stands on the switch line alone — a body first
  // REVEALED by the sack switch-in is absent from the pre-turn snapshot.
  const fed = entered.get(`${side}${slot}`);
  if (fed && fed.hpFraction > SACK_HP_THRESHOLD) {
    return { name, hpFraction: fed.hpFraction, healthy: true };
  }
  // STAY-AND-DIE CANDIDATE: active since the turn began (neither switched
  // nor dragged in this turn) and above the low-HP threshold. The verdict
  // layer decides whether certainty + payoff justify the feed framing.
  if (!fed && !dragged.has(`${side}${slot}`) && pokemon &&
    pokemon.hpPercent / 100 > SACK_HP_THRESHOLD) {
    return { name, hpFraction: pokemon.hpPercent / 100, stayed: true };
  }
  return undefined;
}

/**
 * Detects per-side sacrifices in one turn's events. Three shapes:
 * - LOW-HP FEED: an own Pokémon fainted that already stood at
 *   ≤ SACK_HP_THRESHOLD when the turn began (per the pre-turn snapshot) —
 *   a deliberate low-cost play, graded as a sack unconditionally.
 * - HEALTHY SIMPLIFICATION CANDIDATE: a body deliberately SWITCHED IN this
 *   turn (never dragged) that fainted before the turn ended, entering above
 *   the threshold (entry HP from the switch line, pre-chip). Marked
 *   `healthy` — the verdict layer honors it only while the engine's scores
 *   call the game decisively won on both sides of the sack (GPL T35).
 * - STAY-AND-DIE CANDIDATE: a body active since the turn began (neither
 *   switched nor dragged in this turn) that fainted above the threshold.
 *   Marked `stayed` — the verdict layer honors it only when the realized
 *   outcome landed on the played line's priced floor and the windowed
 *   payoff clears the read margin (573756 t68).
 */
export function detectSacks(
  events: string[],
  snapshotBefore: TurnSnapshot | null,
): { p1?: SackInfo; p2?: SackInfo } {
  if (!snapshotBefore) return {};
  const sacks: { p1?: SackInfo; p2?: SackInfo } = {};
  const entered: Entered = new Map();
  /** Slots force-dragged in this turn — a drag is never a deliberate feed. */
  const dragged = new Set<string>();

  for (const line of events) {
    const switchMatch = line.match(/^\|switch\|(p[12][a-d]): ([^|]+)\|[^|]*\|(\d+)\/(\d+)/);
    if (switchMatch) {
      entered.set(switchMatch[1], {
        name: switchMatch[2].trim(),
        hpFraction: Number(switchMatch[3]) / Number(switchMatch[4]),
      });
      continue;
    }
    const dragMatch = line.match(/^\|drag\|(p[12][a-d]):/);
    if (dragMatch) {
      dragged.add(dragMatch[1]);
      continue;
    }
    const match = line.match(/^\|faint\|(p[12])([a-d]):\s*(.+)$/);
    if (!match) continue;
    const side = match[1] as SideId;
    if (sacks[side]) continue;
    const sack = sackForFaint(side, match[2], match[3].trim(), snapshotBefore, entered, dragged);
    if (sack) sacks[side] = sack;
  }

  return sacks;
}
