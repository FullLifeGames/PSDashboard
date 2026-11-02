import type { BranchMoveOption, DamageResult } from '@fulllifegames/eval-engine';

/**
 * Round 84 (turn dock): the texts a move tile and its tooltip read from the calc's verdict, one module for the dock's tiles and
 * their tooltips.
 */

export const ppTextFor = (move: BranchMoveOption): string => (move.maxpp > 0 ? `${move.pp}/${move.maxpp}` : '—');

/** A drawn hit count, count by count: its chance and its range (round 67, T136 point 1); '' for one hit. */
export function hitSharesText(dmg: DamageResult | undefined): string {
  return (dmg?.hitShares ?? []).map(({ hits, chance, minPercent, maxPercent }) =>
    `${hits} hits (${Math.round(chance * 1000) / 10}%): ${minPercent}% - ${maxPercent}%`).join(' · ');
}

/** The type a move button shows: with the Tera toggle pressed, the type after the click when the engine read one (Tera Blast, Tera Starstorm). */
export const shownType = (move: BranchMoveOption, teraArmed: boolean | undefined): string =>
  (teraArmed && move.typeUnderTera) || move.type;

/**
 * Round 83 (the user, 01.11.2026: "I want them to be aligned", then "we still have run-over text"): the calc's verdict on one
 * line. The "after ..." clause names the end-of-turn chip and recovery the verdict already counts ("guaranteed 2HKO after
 * Leftovers recovery"), and "N% chance to" shortens to "N% to"; the full sentence wrapped onto a second line and left the tiles
 * of a row at different heights. The tooltip keeps the whole sentence.
 */
export const koVerdict = (koChance: string): string => koChance.split(' after ')[0].replace(' chance to ', ' to ');

/**
 * Round 84 (turn dock), A4 (the integrator's look check: "guaranteed 2..." ran out of the bar row): the verdict's core for the
 * bar of a tile, "OHKO" or "2HKO", with the chance in front when the calc gives one ("62.5% OHKO"). The target row and the
 * tooltip keep the longer text.
 */
export const koShort = (koChance: string): string => koVerdict(koChance).replace(/^guaranteed /, '').replace(' to ', ' ');

/** The full button's tooltip: the range with the whole KO sentence, then the drawn hit counts. */
export function fullMoveTitle(dmg: DamageResult | undefined): string | undefined {
  const sentence = dmg?.koChance ? `${dmg.range} (${dmg.koChance})` : '';
  return [sentence, hitSharesText(dmg)].filter(Boolean).join(' · ') || undefined;
}

/** A range in whole percent for the dock's bars ("45-54%"); the tooltip keeps the calc's own text. */
export function shortRange(minPercent: number, maxPercent: number): string {
  const low = Math.round(minPercent);
  const high = Math.round(maxPercent);
  return low === high ? `${high}%` : `${low}-${high}%`;
}
