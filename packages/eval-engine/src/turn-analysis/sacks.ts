/**
 * The sack shapes of one turn's protocol: which faint reads as a deliberate
 * feed (low HP, a healthy switch-in, a body that stayed, or a switch-in the
 * entry hazards took). Detection only; the verdict layer (grading.ts)
 * decides which shape earns the sack framing. Pure — no @pkmn/sim imports,
 * main-bundle safe. Moved out of played.ts in round 63.
 */

import { Dex } from '@pkmn/dex';
import { type TurnSnapshot, toId, type SideId } from '@fulllifegames/replay-core';
import { CHANCE_CANT } from '../dice-events.ts';

/** A Pokémon fed to the opponent while nearly dead — its loss cost almost nothing. */
export interface SackInfo {
  name: string;
  /**
   * Round 63: the fed body's species (the pre-turn snapshot's forme, or the
   * switch line's details) — the verdict layer matches it against the
   * opposing near-decided target. Absent when neither names it.
   */
  species?: string;
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
  /**
   * The fainted body's OWN action this turn failed by dice — its move
   * missed, or a dice |cant| (full paralysis, flinch, freeze, sleep) held
   * it. The verdict layer refuses the feed framing when that move carried a
   * knock-out: a hit would have kept the body alive (573756 t73: +4
   * Garchomp at 11 % moved first, Fire Fang missed, Body Press killed it —
   * a roll, not a trade).
   */
  rolled?: 'miss' | 'cant';
  /**
   * Round 63 (T17): the body was switched in during the turn's switch phase
   * (before any move) and the entry hazards took it before it acted — the
   * attack aimed at it hits nothing and the next body comes in free
   * (653785 t19: Weavile into Stealth Rock). Rides on the low-HP or the
   * healthy shape; the verdict layer gates it on its own.
   */
  hazard?: true;
  /**
   * Round 64 (T123): the side's other bodies that fainted on the same turn,
   * as the protocol names them. The verdict reads the first sack-shaped
   * faint alone; the sentence names the rest, so a turn that cost two bodies
   * does not read as one (912045 t1: Ogerpon and Rillaboom to Make It Rain).
   */
  alsoFell?: string[];
}

/** Below this pre-turn HP fraction a faint reads as a sacrifice, not a loss. */
const SACK_HP_THRESHOLD = 0.15;

/** Latest deliberate switch-in per slot ident this turn (drags excluded). */
type Entered = Map<string, { name: string; species: string; hpFraction: number }>;

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
    return { name, species: pokemon.speciesForme, hpFraction: pokemon.hpPercent / 100 };
  }
  // The healthy candidate stands on the switch line alone — a body first
  // REVEALED by the sack switch-in is absent from the pre-turn snapshot.
  const fed = entered.get(`${side}${slot}`);
  if (fed && fed.hpFraction > SACK_HP_THRESHOLD) {
    return { name, species: fed.species, hpFraction: fed.hpFraction, healthy: true };
  }
  // STAY-AND-DIE CANDIDATE: active since the turn began (neither switched
  // nor dragged in this turn) and above the low-HP threshold. The verdict
  // layer decides whether certainty + payoff justify the feed framing.
  if (!fed && !dragged.has(`${side}${slot}`) && pokemon &&
    pokemon.hpPercent / 100 > SACK_HP_THRESHOLD) {
    return { name, species: pokemon.speciesForme, hpFraction: pokemon.hpPercent / 100, stayed: true };
  }
  return undefined;
}

/** An entry hazard by the Dex: a move that lays a side condition on the foe side (Stealth Rock, Spikes). */
const isEntryHazard = (effect: string): boolean => {
  const move = Dex.moves.get(effect);
  return move.exists && !!move.sideCondition && move.target === 'foeSide';
};

/** What one turn's lines told the sack detector before each faint. */
interface SackScan {
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
  if (hazardMatch && scan.switchPhase.has(hazardMatch[1]) && isEntryHazard(hazardMatch[2].trim())) {
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
 * A switch-phase entry the hazards took before it acted adds `hazard` to
 * its low-HP or healthy shape (round 63). The side's other faints of the
 * turn ride along as `alsoFell` (round 64).
 */
export function detectSacks(
  events: string[],
  snapshotBefore: TurnSnapshot | null,
): { p1?: SackInfo; p2?: SackInfo } {
  if (!snapshotBefore) return {};
  const sacks: { p1?: SackInfo; p2?: SackInfo } = {};
  const fallen: Record<SideId, string[]> = { p1: [], p2: [] };
  const scan: SackScan = {
    entered: new Map(), dragged: new Set(), rolled: new Map(), moved: false, switchPhase: new Set(), hazardFell: new Set(),
  };
  for (const line of events) {
    if (noteSackLine(scan, line)) continue;
    const match = line.match(/^\|faint\|(p[12])([a-d]):\s*(.+)$/);
    if (!match) continue;
    const side = match[1] as SideId;
    fallen[side].push(match[3].trim());
    if (sacks[side]) continue;
    const sack = sackForFaint(side, match[2], match[3].trim(), snapshotBefore, scan.entered, scan.dragged);
    if (!sack) continue;
    const ref = `${side}${match[2]}`;
    const roll = scan.rolled.get(ref);
    sacks[side] = {
      ...sack,
      ...(roll ? { rolled: roll } : {}),
      ...(scan.hazardFell.has(ref) ? { hazard: true as const } : {}),
    };
  }
  return withAlsoFell(sacks, fallen);
}

/** Round 64 (T123): every other own faint of the turn, in protocol order, onto the side's sack. */
function withAlsoFell(sacks: { p1?: SackInfo; p2?: SackInfo }, fallen: Record<SideId, string[]>): { p1?: SackInfo; p2?: SackInfo } {
  for (const side of ['p1', 'p2'] as const) {
    const sack = sacks[side];
    if (!sack) continue;
    const own = fallen[side].indexOf(sack.name);
    const others = fallen[side].filter((_, index) => index !== own);
    if (others.length > 0) sacks[side] = { ...sack, alsoFell: others };
  }
  return sacks;
}
