import type { BranchMoveOption, DamageResult } from '@fulllifegames/eval-engine';
import type { SpreadTargetDamage } from './branch-damage';
import { koShort, shortRange } from './move-damage-text';
import { preselectTarget } from './preselect-target';

/** What a move tile shows under its name and the target a click on it takes: both read one target, so the bar is the hit the click plays. */

export interface TileBar {
  /** The body's slot label ("P2A"); empty for the one foe of a singles game. */
  label: string;
  hp: number;
  min: number;
  max: number;
  range: string;
  /** The calc's KO verdict in its short form ("2HKO", "62.5% OHKO"); empty without one. */
  ko: string;
  title: string;
}

/** The damage of one slot's moves: the best range of each move, its rows per body, and its ranges per target ("moveSlot:loc"). */
export interface TileDamage {
  dmg: DamageResult | undefined;
  spread: SpreadTargetDamage[] | undefined;
  targets: Record<string, DamageResult | undefined>;
}

/** The target a click on the tile takes: the played target for the played move, else the foe hit hardest, else the first listed. */
export function tileTarget(
  move: BranchMoveOption, side: 'p1' | 'p2', targets: TileDamage['targets'], playedLoc: number | null | undefined,
): number | undefined {
  const damage: Record<string, { maxPercent: number } | undefined> = {};
  for (const option of move.targetOptions) damage[option.label] = targets[`${move.slot}:${option.targetLoc}`];
  return preselectTarget(move, side, { damage, playedLoc });
}

function barOf(label: string, hp: number, result: DamageResult | undefined): TileBar | null {
  if (!result || result.maxPercent <= 0) return null;
  return {
    label, hp, min: result.minPercent, max: result.maxPercent, range: shortRange(result.minPercent, result.maxPercent),
    ko: result.koChance ? koShort(result.koChance) : '',
    title: `${label ? `${label}: ` : ''}${result.range}${result.koChance ? ` (${result.koChance})` : ''}`,
  };
}

const present = (bars: (TileBar | null)[]): TileBar[] => bars.filter((bar): bar is TileBar => bar !== null);

export function tileBars(args: TileDamage & {
  move: BranchMoveOption;
  side: 'p1' | 'p2';
  hpByLabel: Record<string, number>;
  /** The HP of the one living foe, for a move that names no target. */
  foeHp: number | undefined;
  /** The target the slot's pick holds for this move, when it is the pick. */
  chosenLoc: number | undefined;
  playedLoc: number | null | undefined;
}): TileBar[] {
  const { move, side, targets, spread, dmg, hpByLabel, foeHp, chosenLoc, playedLoc } = args;
  if (move.targetOptions.length > 0) {
    const loc = chosenLoc ?? tileTarget(move, side, targets, playedLoc);
    const option = move.targetOptions.find(candidate => candidate.targetLoc === loc);
    return option ? present([barOf(option.label, option.hpPercent, targets[`${move.slot}:${loc}`])]) : [];
  }
  if (spread && spread.length > 1) return present(spread.map(row => barOf(row.label, hpByLabel[row.label] ?? 100, row.result)));
  return present([barOf('', foeHp ?? 100, dmg)]);
}
