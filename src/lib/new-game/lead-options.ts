import { getReplayGameType } from '@fulllifegames/replay-core';
import type { LeadOption } from '../lead-options';
import { assembleGameLog } from './game-log';
import type { NewGameRecord } from './record';

/** Options from the record (no team preview, no `|poke|` line); picked leads show as the first picks. */
export function gameLeadOptions(record: NewGameRecord): { p1: LeadOption[]; p2: LeadOption[] } {
  const lead = record.entries[0]?.leadChoices;
  const onField = getReplayGameType(assembleGameLog(record.header, [])) === 'doubles' ? 2 : 1;
  const optionsOf = (side: 'p1' | 'p2'): LeadOption[] => {
    const picked = lead?.[side] ?? [];
    const named = (list: string[], name: string, species: string) => list.some(entry => entry === name || entry === species);
    return record.teams[side].map(set => {
      const name = set.name || set.species;
      return { name, species: set.species, wasLead: named(picked.slice(0, onField), name, set.species), wasBrought: named(picked, name, set.species) };
    });
  };
  return { p1: optionsOf('p1'), p2: optionsOf('p2') };
}
