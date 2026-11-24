import { Battle as SimBattle, type PokemonSet } from '@pkmn/sim';
import { simFormats } from '@fulllifegames/replay-core';

/** Terastal Clause nulls canTerastallize; a mod (Champions) can switch Tera off without it. */
// A format the rule table allows is asked once more through a throwaway battle; this module loads via import() only.
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

const TERA_PROBE_SET = {
  name: 'Garchomp', species: 'Garchomp', item: '', ability: 'Rough Skin', moves: ['Earthquake'], nature: 'Hardy', gender: '', level: 50,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, teraType: 'Steel',
} as PokemonSet;
const teraOffers = new Map<string, boolean>();

// Null when no battle can be built (its mod not loaded yet); nothing is remembered then.
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
