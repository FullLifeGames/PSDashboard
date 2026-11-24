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

export interface InferrerState {
  lines: readonly LogLine[];
  opponentSide: 'p1' | 'p2';
  pokemonMap: Map<string, RevealedPokemonInfo>;
  // Latest move target per ident: resolves Rocky Helmet in video-reconstructed logs that drop [of].
  lastMoveTarget: Map<string, string>;
  // Bare `|-damage|` lines attribute to it only until an action boundary; a stale one would prove an immune move hit.
  pendingMove: { attacker: string; moveName: string } | null;
  identSpecies: Map<string, string>;
  // Plain moves per opponent ident since it entered; `[from]` lines (Sleep Talk, Dancer) never count (not its choice).
  plainMovesSince: Map<string, Set<string>>;
  nicknameSpecies: Map<string, string>;
  // Idents whose item came by a swap (Trick & co): later reveals show the acquired item. The value is the swap's
  // resolving-move action (object identity): in that action the counterpart line may credit the giver, later none.
  swappedIdents: Map<string, object | null>;
  gen: number;
  /** The replay's mod, read from its tier line; the game's Dex is `rulesDex(gen, mod)`. */
  mod: typeof CHAMPIONS_MOD | undefined;
  /** A format that lets any species hold any ability (Balanced Hackmons; a custom game keeps the usual ones). */
  freeAbilities: boolean;
  itemWatch?: ItemWatch;
  triggerWatch?: TriggerWatch;
  screenWatch?: ScreenWatch;
  fieldWatch?: FieldWatch;
  hitWalk?: HitWalk;
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

export function findPokemon(state: InferrerState, nickname: string): RevealedPokemonInfo | undefined {
  return findPokemonByNickname(dexOf(state), state.pokemonMap, nickname, state.lines, state.opponentSide);
}
