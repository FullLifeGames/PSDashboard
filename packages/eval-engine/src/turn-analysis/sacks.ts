/** The sack shapes of one turn's protocol; detection only, pure, no @pkmn/sim import (main-bundle safe). */

import { dexOf, type GameRules, type RulesDex, type TurnSnapshot, toId, type SideId } from '@fulllifegames/replay-core';
import { CHANCE_CANT } from '../dice-events.ts';

/** A Pokémon fed to the opponent on purpose or nearly dead; the shape flags tell which gate (grading.ts) applies. */
export interface SackInfo {
  name: string;
  species?: string;
  hpFraction: number;
  /** Switched in and fainted the same turn above the low-HP threshold; honored only while decisively ahead. */
  healthy?: boolean;
  /** Active at turn start, never entered this turn, fainted above the low-HP threshold: a deliberate-feed candidate. */
  stayed?: true;
  /** Set by the verdict layer (analysis.ts), never by detection: the stayed feed repaid the regret with the margin. */
  verified?: true;
  /** The body's action failed by dice (a miss or a dice `|cant|`); no feed when that move carried a knock-out. */
  rolled?: 'miss' | 'cant';
  /** Switched in in the switch phase and taken by entry hazards before acting: the attack aimed at it hits nothing. */
  hazard?: true;
  alsoFell?: string[];
  /** The sack shape of each body in `alsoFell`, in protocol order (null = a plain loss). */
  others?: (SackInfo | null)[];
}

const SACK_HP_THRESHOLD = 0.15;

// Latest deliberate switch-in per slot ident this turn; drags are excluded.
type Entered = Map<string, { name: string; species: string; hpFraction: number }>;

// Shapes in order: low-HP feed, healthy switch-in, stay-and-die; undefined for a plain loss.
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
  // Healthy stands on the switch line alone: a body first revealed by the switch-in is not in the pre-turn snapshot.
  const fed = entered.get(`${side}${slot}`);
  if (fed && fed.hpFraction > SACK_HP_THRESHOLD) {
    return { name, species: fed.species, hpFraction: fed.hpFraction, healthy: true };
  }
  if (!fed && !dragged.has(`${side}${slot}`) && pokemon &&
    pokemon.hpPercent / 100 > SACK_HP_THRESHOLD) {
    return { name, species: pokemon.speciesForme, hpFraction: pokemon.hpPercent / 100, stayed: true };
  }
  return undefined;
}

const isEntryHazard = (dex: RulesDex, effect: string): boolean => {
  const move = dex.moves.get(effect);
  return move.exists && !!move.sideCondition && move.target === 'foeSide';
};

interface SackScan {
  dex: RulesDex;
  entered: Entered;
  /** Slots force-dragged in this turn: a drag is never a deliberate feed. */
  dragged: Set<string>;
  rolled: Map<string, 'miss' | 'cant'>;
  /** A move line has passed: later switch-ins are pivots or replacements, not the switch phase. */
  moved: boolean;
  switchPhase: Set<string>;
  hazardFell: Set<string>;
}

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

/** Per-side sacrifices in one turn's events: low-HP feed, `healthy`, `stayed`; `hazard` and `alsoFell` ride along. */
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

function sideSack(side: SideId, fallen: { name: string; sack: SackInfo | null }[]): { p1?: SackInfo; p2?: SackInfo } {
  const first = fallen.findIndex(entry => entry.sack !== null);
  if (first < 0) return {};
  const rest = fallen.filter((_, index) => index !== first);
  const sack = rest.length > 0
    ? { ...fallen[first].sack!, alsoFell: rest.map(entry => entry.name), others: rest.map(entry => entry.sack) }
    : fallen[first].sack!;
  return { [side]: sack };
}
