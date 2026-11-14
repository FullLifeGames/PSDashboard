import { CHAMPIONS_MOD, formatRules, simFormats } from '@fulllifegames/replay-core';

/**
 * Round 89 (lane H, #105): the formats the new-game panel lists. Every format the simulator registers for a user's own team
 * (singles or doubles, no generated team, no other game type) is playable; the list names no format itself. The caller passes
 * the ids it wants on top (the measured families); the rest groups by generation, the Champions mod as its own group, a Custom
 * Game first in its group. The Champions formats register with the mod, so `loadFormatOptions` awaits it first.
 */

export interface FormatOption {
  id: string;
  name: string;
  generation: number;
  gameType: 'singles' | 'doubles';
  /** A Custom Game: the simulator checks nothing there (the project's ability rule joins in `checkGameTeams`). */
  custom: boolean;
  champions: boolean;
}

export interface FormatGroup {
  label: string;
  options: FormatOption[];
}

function optionOf(format: ReturnType<ReturnType<typeof simFormats>['all']>[number]): FormatOption {
  const rules = formatRules(format.id);
  return {
    id: format.id,
    name: format.name,
    generation: rules.gen,
    gameType: format.gameType === 'doubles' ? 'doubles' : 'singles',
    custom: !!format.debug,
    champions: rules.mod === CHAMPIONS_MOD,
  };
}

/** The playable formats of the registry as it stands now (the Champions formats only once the mod is loaded). */
export function playableFormats(): FormatOption[] {
  return simFormats().all()
    .filter(format => format.effectType === 'Format' && !format.team && (format.gameType === 'singles' || format.gameType === 'doubles'))
    .map(optionOf);
}

/** Within a group: Custom Game first, singles before doubles, then by name. */
const byRank = (a: FormatOption, b: FormatOption): number =>
  Number(b.custom) - Number(a.custom) || Number(a.gameType === 'doubles') - Number(b.gameType === 'doubles') || a.name.localeCompare(b.name);

/** The groups of the panel's list: `featured` ids first (in the order given, those the registry has), then one group per generation, newest first. */
export function formatGroups(featured: readonly string[] = []): FormatGroup[] {
  const all = playableFormats();
  const top = featured.map(id => all.find(option => option.id === id)).filter((option): option is FormatOption => option !== undefined);
  const rest = all.filter(option => !top.includes(option));
  const groups: FormatGroup[] = top.length > 0 ? [{ label: 'Featured', options: top }] : [];
  const keys = [...new Set(rest.map(option => (option.champions ? 'Champions' : `Gen ${option.generation}`)))];
  const rank = (key: string): number => (key === 'Champions' ? 100 : Number(key.slice(4)));
  for (const key of keys.sort((a, b) => rank(b) - rank(a))) {
    const options = rest.filter(option => (option.champions ? 'Champions' : `Gen ${option.generation}`) === key).sort(byRank);
    groups.push({ label: key, options });
  }
  return groups;
}

/** `formatGroups` after the Champions mod loads in this realm (the registry grows from 206 to 217 formats). */
export async function loadFormatGroups(featured: readonly string[] = []): Promise<FormatGroup[]> {
  const { loadSimMods } = await import('../lazy/branch-engine');
  await loadSimMods('gen9championsou');
  return formatGroups(featured);
}
