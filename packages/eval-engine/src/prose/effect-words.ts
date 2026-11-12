import type { RulesDex } from '@fulllifegames/replay-core';

/**
 * Round 89 (T322, #59), stage 5: a secondary effect as a noun in a sentence ("the 10% burn from Flare Blitz"). The Dex names the six
 * status conditions by their short ids (`brn`), so the nouns are one table, held to the Dex's status conditions by
 * `test/strand-effect-words.spec.ts` (the app's `STATUS_WORDS` in `src/lib/branch-dice.ts` has the same keys and the capitalized form;
 * a spec compares the two). Every other effect reads the Dex: a condition's own name (flinch, confusion), the stat names of a
 * stat change (`boosts:spa`, `self:atk`), else the entry's name.
 */
export const STATUS_NOUNS: Readonly<Record<string, string>> = {
  // eslint-disable-next-line names/no-new-dex-name -- held by strand-effect-words.spec.ts (the keys against the Dex's status conditions) and strand-effect-words-copy.spec.ts (the words against the chips)
  brn: 'burn', par: 'paralysis', slp: 'sleep', frz: 'freeze', psn: 'poison', tox: 'toxic',
};

type Namer = { get(id: string): { exists: boolean; name: string } };

/** The stats of an entry id (`atk+def`) in the Dex's stat names, joined with a plus sign. */
function statsNoun(dex: RulesDex, stats: string): string {
  const names = (dex as unknown as { stats: { names: Record<string, string> } }).stats.names;
  return stats.split('+').map(stat => names[stat] ?? stat).join(' + ');
}

/** The entry of an id among the Dex's conditions, abilities, items and moves (a volatile status first), as a lower-case name. */
function entryNoun(dex: RulesDex, id: string): string | undefined {
  const tables = dex as unknown as Record<'abilities' | 'items' | 'moves' | 'conditions', Namer>;
  for (const table of [tables.conditions, tables.abilities, tables.items, tables.moves]) {
    const entry = table.get(id);
    if (entry.exists) return entry.name.toLowerCase();
  }
  return undefined;
}

/** An effect id (a status, a volatile status, `boosts:<stats>`, `self:<...>`) as a noun, read from the game's Dex. */
export function effectNoun(dex: RulesDex, id: string): string {
  if (STATUS_NOUNS[id]) return STATUS_NOUNS[id];
  if (id.startsWith('boosts:')) return `${statsNoun(dex, id.slice('boosts:'.length))} change`;
  if (id.startsWith('self:')) {
    const own = id.slice('self:'.length);
    return `own ${entryNoun(dex, own) ?? `${statsNoun(dex, own)} change`}`;
  }
  return entryNoun(dex, id) ?? id;
}
