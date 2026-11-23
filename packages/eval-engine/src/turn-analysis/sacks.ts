/** The sack shapes of one turn's protocol (which faint reads as a deliberate feed); detection only, pure, no @pkmn/sim import (main-bundle safe). */

import { dexOf, type GameRules, type RulesDex, type TurnSnapshot, toId, type SideId } from '@fulllifegames/replay-core';
import { CHANCE_CANT } from '../dice-events.ts';

/** A Pokémon fed to the opponent on purpose or nearly dead; the shape flags tell which gate the verdict layer (grading.ts) applies. */
export interface SackInfo {
  name: string;
  /** The fed body's species (the pre-turn snapshot's forme, else the switch line's details); absent when neither names it. */
  species?: string;
  hpFraction: number;
  /**
   * Switched in and fainted the same turn above the low-HP threshold: honored only while the engine's scores call the game decisively won
   * on both sides.
   */
  healthy?: boolean;
  /**
   * Already active at turn start, never entered this turn, fainted above the low-HP threshold: a deliberate-feed candidate (gates in
   * sack-gates.ts).
   */
  stayed?: true;
  /**
   * Set by the verdict layer (analysis.ts), never by detection: the stayed feed repaid the full regret with the margin, so the verdict
   * cleared.
   */
  verified?: true;
  /**
   * The fainted body's own action failed by dice: its move missed, or a dice |cant| (full paralysis, flinch, freeze, sleep) held it.
   * The verdict layer refuses the feed framing when that move carried a knock-out: a hit would have kept the body alive
   * (a +4 Garchomp at 11 % moved first, Fire Fang missed, Body Press killed it: a roll, not a trade).
   */
  rolled?: 'miss' | 'cant';
  /**
   * Switched in during the switch phase (before any move) and taken by the entry hazards before it acted: the attack aimed at it
   * hits nothing and the next body comes in free (Weavile into Stealth Rock). Rides on the low-HP or the healthy shape.
   */
  hazard?: true;
  /**
   * The side's other bodies that fainted on the same turn, as the protocol names them, so a turn that cost two bodies does not read as
   * one.
   */
  alsoFell?: string[];
  /**
   * The sack shape of each body in `alsoFell`, in protocol order (null = a plain loss); the framing holds only when every fallen body
   * earns it.
   */
  others?: (SackInfo | null)[];
}

/** Below this pre-turn HP fraction a faint reads as a sacrifice, not a loss. */
const SACK_HP_THRESHOLD = 0.15;

/** Latest deliberate switch-in per slot ident this turn (drags excluded). */
type Entered = Map<string, { name: string; species: string; hpFraction: number }>;

/** The sack a faint line reads as, in shape order: low-HP feed, healthy switch-in, stay-and-die; undefined for a plain loss. */
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
    return { name, species: pokemon.speciesForme, hpFraction: pokemon.hpPercent / 100 };
  }
  // The healthy candidate stands on the switch line alone: a body first revealed by the sack switch-in is absent from the pre-turn
  // snapshot.
  const fed = entered.get(`${side}${slot}`);
  if (fed && fed.hpFraction > SACK_HP_THRESHOLD) {
    return { name, species: fed.species, hpFraction: fed.hpFraction, healthy: true };
  }
  // Stay-and-die: active since the turn began (neither switched nor dragged in this turn) and above the low-HP threshold.
  if (!fed && !dragged.has(`${side}${slot}`) && pokemon &&
    pokemon.hpPercent / 100 > SACK_HP_THRESHOLD) {
    return { name, species: pokemon.speciesForme, hpFraction: pokemon.hpPercent / 100, stayed: true };
  }
  return undefined;
}

/** An entry hazard by the Dex: a move that lays a side condition on the foe side (Stealth Rock, Spikes). */
const isEntryHazard = (dex: RulesDex, effect: string): boolean => {
  const move = dex.moves.get(effect);
  return move.exists && !!move.sideCondition && move.target === 'foeSide';
};

/** What one turn's lines told the sack detector before each faint. */
interface SackScan {
  dex: RulesDex;
  entered: Entered;
  /** Slots force-dragged in this turn — a drag is never a deliberate feed. */
  dragged: Set<string>;
  /** Slots whose own action the dice failed this turn (a miss, a dice |cant|). */
  rolled: Map<string, 'miss' | 'cant'>;
  /** A move line has passed: later switch-ins are pivots or replacements, not the turn's switch phase. */
  moved: boolean;
  /** Slots switched in during the switch phase. */
  switchPhase: Set<string>;
  /** Switch-phase slots the entry hazards brought to 0 HP. */
  hazardFell: Set<string>;
}

/** Records one non-faint line; true when the line was consumed. */
function noteSackLine(scan: SackScan, line: string): boolean {
  const switchMatch = line.match(/^\|switch\|(p[12][a-d]): ([^|]+)\|([^|]*)\|(\d+)\/(\d+)/);
  if (switchMatch) {
    scan.entered.set(switchMatch[1], {
      name: switchMatch[2].trim(),
      species: switchMatch[3].split(',')[0].trim(),
      hpFraction: Number(switchMatch[4]) / Number(switchMatch[5]),
    });
    if (!scan.moved) scan.switchPhase.add(switchMatch[1]);
    return true;
  }
  const dragMatch = line.match(/^\|drag\|(p[12][a-d]):/);
  if (dragMatch) {
    scan.dragged.add(dragMatch[1]);
    return true;
  }
  const hazardMatch = line.match(/^\|-damage\|(p[12][a-d]): [^|]*\|0 fnt\|\[from\] ([^|]+)/);
  if (hazardMatch && scan.switchPhase.has(hazardMatch[1]) && isEntryHazard(scan.dex, hazardMatch[2].trim())) {
    scan.hazardFell.add(hazardMatch[1]);
    return true;
  }
  const missMatch = (line.startsWith('|move|') && line.includes('|[miss]') ? line : '').match(/^\|move\|(p[12][a-d]):/)
    ?? line.match(/^\|-miss\|(p[12][a-d]):/);
  if (line.startsWith('|move|')) scan.moved = true;
  if (missMatch) {
    scan.rolled.set(missMatch[1], 'miss');
    return true;
  }
  const cantMatch = line.match(/^\|cant\|(p[12][a-d]):[^|]*\|([^|]*)/);
  if (cantMatch) {
    if (CHANCE_CANT.has(cantMatch[2])) scan.rolled.set(cantMatch[1], 'cant');
    return true;
  }
  return false;
}

/**
 * Detects per-side sacrifices in one turn's events: low-HP feed (stood at or below SACK_HP_THRESHOLD per the pre-turn snapshot),
 * `healthy` (deliberately switched in, never dragged, entry HP from the switch line, pre-chip) and `stayed`; a hazard-taken
 * switch-phase entry adds `hazard`, and the side's other faints ride along as `alsoFell` and `others`.
 */
export function detectSacks(
  events: string[],
  snapshotBefore: TurnSnapshot | null,
  rules: GameRules,
): { p1?: SackInfo; p2?: SackInfo } {
  if (!snapshotBefore) return {};
  const fallen: Record<SideId, { name: string; sack: SackInfo | null }[]> = { p1: [], p2: [] };
  const scan: SackScan = {
    dex: dexOf(rules),
    entered: new Map(), dragged: new Set(), rolled: new Map(), moved: false, switchPhase: new Set(), hazardFell: new Set(),
  };
  for (const line of events) {
    if (noteSackLine(scan, line)) continue;
    const match = line.match(/^\|faint\|(p[12])([a-d]):\s*(.+)$/);
    if (!match) continue;
    const side = match[1] as SideId;
    fallen[side].push({ name: match[3].trim(), sack: faintShape(side, match[2], match[3].trim(), snapshotBefore, scan) });
  }
  return { ...sideSack('p1', fallen.p1), ...sideSack('p2', fallen.p2) };
}

/** One faint's sack shape with its roll and hazard marks, or null for a plain loss. */
function faintShape(side: SideId, slot: string, name: string, snapshotBefore: TurnSnapshot, scan: SackScan): SackInfo | null {
  const sack = sackForFaint(side, slot, name, snapshotBefore, scan.entered, scan.dragged);
  if (!sack) return null;
  const ref = `${side}${slot}`;
  const roll = scan.rolled.get(ref);
  return {
    ...sack,
    ...(roll ? { rolled: roll } : {}),
    ...(scan.hazardFell.has(ref) ? { hazard: true as const } : {}),
  };
}

/** The side's sack: its first sack-shaped faint, with every other own faint of the turn in protocol order as `alsoFell` and `others`. */
function sideSack(side: SideId, fallen: { name: string; sack: SackInfo | null }[]): { p1?: SackInfo; p2?: SackInfo } {
  const first = fallen.findIndex(entry => entry.sack !== null);
  if (first < 0) return {};
  const rest = fallen.filter((_, index) => index !== first);
  const sack = rest.length > 0
    ? { ...fallen[first].sack!, alsoFell: rest.map(entry => entry.name), others: rest.map(entry => entry.sack) }
    : fallen[first].sack!;
  return { [side]: sack };
}
