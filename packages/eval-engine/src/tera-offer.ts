import { Battle as SimBattle, type PokemonSet } from '@pkmn/sim';
import { dexOfFormat, simFormats } from '@fulllifegames/replay-core';

/** Terastal Clause nulls canTerastallize; a mod (Champions) can switch Tera off without it. */
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

const teraOffers = new Map<string, boolean>();

function simOffersTera(formatid: string): boolean | null {
  const known = teraOffers.get(formatid);
  if (known !== undefined) return known;
  try {
    const dex = dexOfFormat(formatid as never);
    const probe = { species: dex.species.all().find(species => !species.isNonstandard)?.name, moves: [dex.moves.all()[0]?.name] } as PokemonSet;
    const battle = new SimBattle({ formatid: formatid as never, seed: '1,2,3,4', p1: { name: 'A', team: [probe] }, p2: { name: 'B', team: [probe] } });
    const offers = battle.sides[0].pokemon[0].canTerastallize !== null;
    teraOffers.set(formatid, offers);
    return offers;
  } catch {
    return null;
  }
}
