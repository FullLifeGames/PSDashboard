import type { BranchMoveOption, DamageResult } from '@fulllifegames/eval-engine';


export const ppTextFor = (move: BranchMoveOption): string => (move.maxpp > 0 ? `${move.pp}/${move.maxpp}` : '—');

/** A drawn hit count, count by count: its chance and its range; '' for one hit. */
export function hitSharesText(dmg: DamageResult | undefined): string {
  return (dmg?.hitShares ?? []).map(({ hits, chance, minPercent, maxPercent }) =>
    `${hits} hits (${Math.round(chance * 1000) / 10}%): ${minPercent}% - ${maxPercent}%`).join(' · ');
}

/** The type a move button shows: with Tera armed, the type after the click when the engine read one (Tera Blast). */
export const shownType = (move: BranchMoveOption, teraArmed: boolean | undefined): string =>
  (teraArmed && move.typeUnderTera) || move.type;

/** The calc's verdict without the "after ..." clause, "N% chance to" as "N% to"; the tooltip keeps the sentence. */
export const koVerdict = (koChance: string): string => koChance.split(' after ')[0].replace(' chance to ', ' to ');

export const koShort = (koChance: string): string => koVerdict(koChance).replace(/^guaranteed /, '').replace(' to ', ' ');

export function fullMoveTitle(dmg: DamageResult | undefined): string | undefined {
  const sentence = dmg?.koChance ? `${dmg.range} (${dmg.koChance})` : '';
  return [sentence, hitSharesText(dmg)].filter(Boolean).join(' · ') || undefined;
}

export function shortRange(minPercent: number, maxPercent: number): string {
  const low = Math.round(minPercent);
  const high = Math.round(maxPercent);
  return low === high ? `${high}%` : `${low}-${high}%`;
}
