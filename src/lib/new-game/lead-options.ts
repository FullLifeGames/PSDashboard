import { getReplayGameType } from '@fulllifegames/replay-core';
import type { LeadOption } from '../lead-options';
import { assembleGameLog } from './game-log';
import type { NewGameRecord } from './record';

/**
 * Round 89 (lane H, #105): the lead picker's options of a new game. The record knows both teams in full, so the picker offers them
 * from it: a format without team preview (Gen 1 to 4) has no `|poke|` line to read them from. A new game has no real leads to
 * mark; once the leads are picked they show as the ones the game started with (the first picks, as many as stand on the field),
 * and the whole selection as brought.
 */
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
