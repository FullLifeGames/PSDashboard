import type { TurnSnapshot } from '../types';
import { broughtSpeciesFor, speciesBaseId } from './replay-format';
import type { LeadOption } from '../components/LeadPanel';

/** T0 lead picker data: each side's team with the real leads marked (the
 *  pre-turn-1 snapshot's actives ARE the leads) and, for bring-limited
 *  formats, which Pokemon the real game brought (active in ANY snapshot). */
export function buildLeadOptions(snapshots: TurnSnapshot[]): { p1: LeadOption[]; p2: LeadOption[] } {
  const snapshot = snapshots[0] ?? null;
  if (!snapshot) return { p1: [], p2: [] };
  // Base-species matching: the preview lists "Zamazenta-*" while the
  // active reveals "Zamazenta-Crowned" — same body, same badge.
  const optionsOf = (side: typeof snapshot.p1, broughtBases: Set<string>): LeadOption[] =>
    side.pokemon.map(pokemon => ({
      name: pokemon.name,
      species: pokemon.speciesForme,
      wasLead: pokemon.isActive,
      wasBrought: broughtBases.has(speciesBaseId(pokemon.speciesForme)),
    }));
  const basesOf = (sideKey: 'p1' | 'p2') =>
    new Set(broughtSpeciesFor(snapshots, sideKey).map(name => speciesBaseId(name)));
  return {
    p1: optionsOf(snapshot.p1, basesOf('p1')),
    p2: optionsOf(snapshot.p2, basesOf('p2')),
  };
}

/** The lead picker's default selection: the real game's leads, then the
 *  rest of its bring; unknown slots fill in option order (an engine run
 *  needs a complete selection even when the protocol reveals less). */
export function defaultLeadSelectionFor(
  leadOptions: { p1: LeadOption[]; p2: LeadOption[] },
  bringCount: number | null,
  gameType: string | null,
): { p1: string[]; p2: string[]; bring?: boolean } {
  const max = bringCount ?? (gameType === 'doubles' ? 2 : 1);
  const pick = (options: LeadOption[]) => [
    ...options.filter(option => option.wasLead),
    ...options.filter(option => !option.wasLead && option.wasBrought),
    ...options.filter(option => !option.wasLead && !option.wasBrought),
  ].slice(0, max).map(option => option.species);
  const leads = { p1: pick(leadOptions.p1), p2: pick(leadOptions.p2) };
  return bringCount !== null ? { ...leads, bring: true } : leads;
}
