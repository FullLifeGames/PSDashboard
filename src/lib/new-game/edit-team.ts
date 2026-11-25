import { Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { toId, type OpponentTeamInfo } from '@fulllifegames/replay-core';
import { buildSetsExport } from '../sets-io';

/** Sets from the editor's info; a game's sets are the user's own, so every value is known and exported. */
export function teamOfInfo(info: OpponentTeamInfo, previous: readonly PokemonSet[] = []): PokemonSet[] {
  const text = buildSetsExport({ p1Name: 'p1', p2Name: 'p2', p1Info: info, p2Info: null });
  const [, ...lines] = text.split('\n');
  const side = lines.join('\n').split(/^=== p2/m)[0];
  const sets = Teams.import(side) ?? [];
  // The editor's info has no gender: a set keeps the gender of the set it replaces (by place, else species).
  return sets.map((set, index) => {
    const same = (other: PokemonSet) => toId(other.species) === toId(set.species);
    const old = previous[index] && same(previous[index]) ? previous[index] : previous.find(same);
    return set.gender || !old?.gender ? set : { ...set, gender: old.gender };
  });
}
