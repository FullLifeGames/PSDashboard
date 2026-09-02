import { Dex } from '@pkmn/sim';
import type { RevealedPokemonInfo } from '../types';
import { findPokemonByNickname } from './lookup';
import { toId } from '../ids';

/** The scan state one team inference carries from line to line. */
export interface InferrerState {
  lines: string[];
  opponentSide: 'p1' | 'p2';
  pokemonMap: Map<string, RevealedPokemonInfo>;
  // Each ident's latest move target — resolves Rocky Helmet reveals in
  // video-reconstructed logs that drop the [of] attribution.
  lastMoveTarget: Map<string, string>;
  // The move action currently resolving. Bare |-damage| lines are attributed
  // to it ONLY until an action boundary (miss/immune/switch/turn/...) —
  // a stale attribution would let a confusion self-hit or Future Sight
  // resolution "prove" that an immune-blocked Earthquake landed.
  pendingMove: { attacker: string; moveName: string } | null;
  // Ident → species for BOTH sides (the attacker of a rule-out line can be
  // on either side).
  identSpecies: Map<string, string>;
  // Distinct PLAIN move names each opponent ident used since it last entered
  // the field — two of them disprove a Choice lock; a plain Status move
  // disproves Assault Vest. `[from]`-attributed lines (Sleep Talk calls,
  // bounces, Dancer copies) never count: they are not the holder's choice.
  plainMovesSince: Map<string, Set<string>>;
  // Opponent nickname → species, fed by the same switch/drag lines as
  // identSpecies — serves the rule-out path without re-scanning the log
  // (the full scan remains only as the fallback for synthetic logs).
  nicknameSpecies: Map<string, string>;
  // Idents whose current item arrived via a swap (Trick & co) — later item
  // reveals/consumptions for them show the acquired item, not the set item.
  // The value is the swap's resolving-move action (object identity): within
  // the SAME action the counterpart line may still credit the giver's
  // original; from a later action the ident only gives away acquired items.
  swappedIdents: Map<string, object | null>;
  gravityActive: boolean;
}

export function createInferrerState(lines: string[], opponentSide: 'p1' | 'p2'): InferrerState {
  return {
    lines,
    opponentSide,
    pokemonMap: new Map<string, RevealedPokemonInfo>(),
    lastMoveTarget: new Map<string, string>(),
    pendingMove: null,
    identSpecies: new Map<string, string>(),
    plainMovesSince: new Map<string, Set<string>>(),
    nicknameSpecies: new Map<string, string>(),
    swappedIdents: new Map<string, object | null>(),
    gravityActive: false,
  };
}

export function canHaveDancer(state: InferrerState, ident: string): boolean {
  const species = state.identSpecies.get(ident);
  if (!species) return false;
  return Object.values(Dex.species.get(species).abilities ?? {})
    .some(ability => toId(String(ability)) === 'dancer');
}

export function ruleOut(state: InferrerState, nickname: string, kind: 'abilities' | 'items', id: string) {
  const known = state.nicknameSpecies.get(nickname);
  const pokemon = (known ? state.pokemonMap.get(known) : undefined) ??
    findPokemonByNickname(state.pokemonMap, nickname, state.lines, state.opponentSide);
  if (!pokemon) return;
  const ruledOut = (pokemon.ruledOut ??= { abilities: [], items: [] });
  if (!ruledOut[kind].includes(id)) ruledOut[kind].push(id);
}

/** The opponent Pokémon behind a nickname, through the log's switch lines. */
export function findPokemon(state: InferrerState, nickname: string): RevealedPokemonInfo | undefined {
  return findPokemonByNickname(state.pokemonMap, nickname, state.lines, state.opponentSide);
}
