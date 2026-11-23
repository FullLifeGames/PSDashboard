import type { RevealedPokemonInfo } from '../types.ts';
import { findPokemonByNickname } from './lookup.ts';
import { abilitiesAreFree } from '../team/dex-legal.ts';
import { toId } from '../ids.ts';
import { calcModOf, type CHAMPIONS_MOD } from '../calc-gen.ts';
import { dexOf } from '../rules-dex.ts';
import type { ItemWatch } from './item-evidence.ts';
import type { TriggerWatch } from './trigger-evidence.ts';
import type { ScreenWatch } from './screen-evidence.ts';
import type { FieldWatch } from './field-evidence.ts';
import type { HitWalk } from './hits.ts';
import type { BlockedWatch } from './blocked-effects.ts';
import { arg, type LogLine } from './log-line.ts';

/** The scan state one team inference carries from line to line. */
export interface InferrerState {
  /** Every line of the log, read once through @pkmn/protocol. */
  lines: readonly LogLine[];
  opponentSide: 'p1' | 'p2';
  pokemonMap: Map<string, RevealedPokemonInfo>;
  // Each ident's latest move target: resolves Rocky Helmet reveals in video-reconstructed logs that drop the [of] attribution.
  lastMoveTarget: Map<string, string>;
  // The move action currently resolving; bare |-damage| lines attribute to it only until an action boundary (a stale attribution would let
  // a confusion self-hit or a Future Sight resolution "prove" that an immune-blocked Earthquake landed).
  pendingMove: { attacker: string; moveName: string } | null;
  // Ident to species for both sides (the attacker of a rule-out line can be on either side).
  identSpecies: Map<string, string>;
  // Distinct plain move names each opponent ident used since it last entered the field; `[from]`-attributed lines (Sleep Talk calls,
  // bounces, Dancer copies) never count, they are not the holder's choice.
  plainMovesSince: Map<string, Set<string>>;
  // Opponent nickname to species, fed by the same switch/drag lines as identSpecies; serves the rule-out path without re-scanning the log
  // (the full scan is the fallback for synthetic logs).
  nicknameSpecies: Map<string, string>;
  // Idents whose current item arrived via a swap (Trick & co): later reveals show the acquired item, not the set item. The value is the
  // swap's resolving-move action (object identity): within the same action the counterpart line may still credit the giver's original; from
  // a later action the ident only gives away acquired items.
  swappedIdents: Map<string, object | null>;
  /** The replay's generation (|gen| line): the Dex that decides who may hold an ability. */
  gen: number;
  /** The replay's mod, read from its tier line ('champions' for a Pokémon Champions format): the Dex of the game is `rulesDex(gen, mod)`. */
  mod: typeof CHAMPIONS_MOD | undefined;
  /** A format that lets any species hold any ability (Balanced Hackmons; a custom game keeps the usual ones): the Dex decides nothing. */
  freeAbilities: boolean;
  /** Item evidence by absence (the resolving move and the residual phase); item-evidence.ts creates it. */
  itemWatch?: ItemWatch;
  /** Item evidence by a trigger without its line; trigger-evidence.ts creates it. */
  triggerWatch?: TriggerWatch;
  /** Item evidence by a screen's turns; screen-evidence.ts creates it. */
  screenWatch?: ScreenWatch;
  /** Item evidence by a weather's or a terrain's turns; field-evidence.ts creates it. */
  fieldWatch?: FieldWatch;
  /** The client walk that collects each opponent attacker's clean hits; hits.ts creates it. */
  hitWalk?: HitWalk;
  /** The abilities a landed effect rules out; blocked-effects.ts creates it. */
  blockedWatch?: BlockedWatch;
}

export function createInferrerState(lines: readonly LogLine[], opponentSide: 'p1' | 'p2'): InferrerState {
  const genLine = lines.find(line => line.cmd === 'gen');
  return {
    lines,
    opponentSide,
    gen: (genLine ? Number(arg(genLine, 1)) : 9) || 9,
    mod: calcModOf(lines.find(line => line.cmd === 'tier')?.raw ?? ''),
    freeAbilities: abilitiesAreFree(lines.find(line => line.cmd === 'tier')?.raw ?? ''),
    pokemonMap: new Map<string, RevealedPokemonInfo>(),
    lastMoveTarget: new Map<string, string>(),
    pendingMove: null,
    identSpecies: new Map<string, string>(),
    plainMovesSince: new Map<string, Set<string>>(),
    nicknameSpecies: new Map<string, string>(),
    swappedIdents: new Map<string, object | null>(),
  };
}

export function canHaveDancer(state: InferrerState, ident: string): boolean {
  const species = state.identSpecies.get(ident);
  if (!species) return false;
  return Object.values(dexOf(state).species.get(species).abilities ?? {})
    .some(ability => toId(String(ability)) === 'dancer');
}

export function ruleOut(state: InferrerState, nickname: string, kind: 'abilities' | 'items', id: string) {
  const known = state.nicknameSpecies.get(nickname);
  const pokemon = (known ? state.pokemonMap.get(known) : undefined) ??
    findPokemonByNickname(dexOf(state), state.pokemonMap, nickname, state.lines, state.opponentSide);
  if (!pokemon) return;
  const ruledOut = (pokemon.ruledOut ??= { abilities: [], items: [] });
  if (!ruledOut[kind].includes(id)) ruledOut[kind].push(id);
}

/** The opponent Pokémon behind a nickname, through the log's switch lines. */
export function findPokemon(state: InferrerState, nickname: string): RevealedPokemonInfo | undefined {
  return findPokemonByNickname(dexOf(state), state.pokemonMap, nickname, state.lines, state.opponentSide);
}
