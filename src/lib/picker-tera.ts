import { Battle as SimBattle, type PokemonSet } from '@pkmn/sim';
import { simFormats } from '@fulllifegames/replay-core';

/**
 * Terastal Clause in the branch format's rule table: the simulator nulls
 * every canTerastallize at battle start. Read the way replay-core reads
 * Sleep Clause (formatEnforcesSleepClause); no format, no clause. This
 * module loads through import() only, so the simulator's dex stays out of
 * the entry chunk. Round 67 merge (T145): a mod may switch Tera off in its
 * own actions without the clause (Pokémon Champions), so a format the rule
 * table allows is asked once more, through a throwaway battle.
 */
export function teraBanned(format: string | undefined): boolean {
  if (!format) return false;
  if (/@@@.*terastal ?clause/i.test(format)) return true;
  try {
    const base = simFormats().get(format.split('@@@')[0]);
    if (!base.exists) return false;
    return simFormats().getRuleTable(base).has('terastalclause') || simOffersTera(base.id) === false;
  } catch {
    return false;
  }
}

/** A one-Pokémon team that may terastallize, for the throwaway battle below. */
const TERA_PROBE_SET = {
  name: 'Garchomp', species: 'Garchomp', item: '', ability: 'Rough Skin', moves: ['Earthquake'], nature: 'Hardy', gender: '', level: 50,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, teraType: 'Steel',
} as PokemonSet;
const teraOffers = new Map<string, boolean>();

/**
 * Whether the simulator offers Tera in a format: a battle of that format reads
 * canTerastallize at creation (null without Tera: Gen 8, Terastal Clause, the
 * Champions mod's actions). Null when no battle of the format can be built
 * (its mod not loaded yet), and then nothing is remembered.
 */
function simOffersTera(formatid: string): boolean | null {
  const known = teraOffers.get(formatid);
  if (known !== undefined) return known;
  try {
    const battle = new SimBattle({ formatid: formatid as never, seed: '1,2,3,4', p1: { name: 'A', team: [TERA_PROBE_SET] }, p2: { name: 'B', team: [TERA_PROBE_SET] } });
    const offers = battle.sides[0].pokemon[0].canTerastallize !== null;
    teraOffers.set(formatid, offers);
    return offers;
  } catch {
    return null;
  }
}
