import { useState } from 'react';
import type { LeadOption } from '../lib/lead-options';

/**
 * Each side's picked leads (and, in bring-limited formats, the whole
 * brought selection). A recorded variation choice wins; otherwise the real
 * game's choice preselects: leads first (slot order), then the rest of the
 * bring. A click toggles; a click past the limit replaces the OLDEST pick,
 * so swapping one Pokémon never needs a deselect first.
 */
export function useLeadSelection(args: {
  p1Options: LeadOption[];
  p2Options: LeadOption[];
  pickedLeads?: { p1: string[]; p2: string[] } | null;
  maxPicks: number;
}) {
  const { p1Options, p2Options, pickedLeads, maxPicks } = args;
  const fromPicked = (options: LeadOption[], picked: string[] | undefined) => {
    const known = new Set(options.map(option => option.species));
    const kept = (picked ?? []).filter(species => known.has(species)).slice(0, maxPicks);
    return kept.length === maxPicks ? kept : null;
  };
  const initialFor = (options: LeadOption[], picked: string[] | undefined) =>
    fromPicked(options, picked) ?? [
      ...options.filter(option => option.wasLead),
      ...options.filter(option => !option.wasLead && option.wasBrought),
    ].slice(0, maxPicks).map(option => option.species);
  const [p1Leads, setP1Leads] = useState<string[]>(() => initialFor(p1Options, pickedLeads?.p1));
  const [p2Leads, setP2Leads] = useState<string[]>(() => initialFor(p2Options, pickedLeads?.p2));
  // Returning to T0 after the variation recorded a choice: mirror it in
  // place (render adjustment, not an effect — the props settle mid-render).
  const pickedKey = JSON.stringify(pickedLeads ?? null);
  const [seenPickedKey, setSeenPickedKey] = useState(pickedKey);
  if (pickedKey !== seenPickedKey) {
    setSeenPickedKey(pickedKey);
    if (pickedLeads) {
      const p1 = fromPicked(p1Options, pickedLeads.p1);
      const p2 = fromPicked(p2Options, pickedLeads.p2);
      if (p1) setP1Leads(p1);
      if (p2) setP2Leads(p2);
    }
  }

  const toggle = (setter: typeof setP1Leads) => (species: string) => {
    setter(previous => (previous.includes(species)
      ? previous.filter(entry => entry !== species)
      : [...previous, species].slice(-maxPicks)));
  };

  return { p1Leads, p2Leads, toggleP1: toggle(setP1Leads), toggleP2: toggle(setP2Leads) };
}
