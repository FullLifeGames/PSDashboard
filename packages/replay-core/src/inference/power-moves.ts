import { Dex } from '@pkmn/sim';
import type { OpenMove, RevealedPokemonInfo } from '../types.ts';
import { sameOpenMove } from '../team/open-moves.ts';
import { toId } from '../ids.ts';
import { findPokemon, type InferrerState } from './inferrer-state.ts';
import { arg, identOf, kwText, type LogLine } from './log-line.ts';

/**
 * What the move line of a Z-move or a Max move proves about the set (round 70, batch fix). The log shows the powered move and
 * never its base move. The Dex answers the rest:
 * - a Z-move (`isZ`) names its crystal; a species' own Z-move also names the base move (`zMoveFrom` of the crystal);
 * - a status Z-move prints "Z-" before its base move and names the base move again in `[anim]`;
 * - any other damaging Z-move keeps the type of its base move, and so does every damaging Max move (`isMax`; a G-Max move
 *   holds the species there), whose category is the base move's;
 * - Max Guard, the Max move of status category, stands for every status move.
 */

type PowerMove =
  /** The base move, named: it is a move of the set. */
  | { base: string; gigantamax?: undefined }
  /** The base move, hidden: the set keeps a slot open for it; a G-Max move shows the Gigantamax too. */
  | { open: OpenMove; gigantamax?: boolean };

type GenDex = ReturnType<typeof Dex.forGen>;

/** A species' own Z-move: its base move, from the crystal. Any other damaging Z-move: the type the crystal enables (`zMoveType`). */
function zMoveReading(dex: GenDex, move: ReturnType<GenDex['moves']['get']>): PowerMove {
  const crystal = dex.items.get(String(move.isZ));
  return crystal.zMoveFrom ? { base: crystal.zMoveFrom } : { open: { kind: 'attack', type: crystal.zMoveType ?? move.type } };
}

/** The base move a status Z-move prints: the `[anim]` marker, else the name after "Z-"; null when the name is no Z-move's. */
function statusZReading(dex: GenDex, line: LogLine): PowerMove | null {
  const name = arg(line, 2);
  if (!name.startsWith('Z-') || dex.moves.get(name).exists) return null;
  const shown = dex.moves.get(kwText(line, 'anim'));
  const base = shown.exists ? shown : dex.moves.get(name.slice(2));
  return base.exists ? { base: base.name } : null;
}

/** The reading of a `move` line, or null for a move that is its own base. */
export function readPowerMove(dex: GenDex, line: LogLine): PowerMove | null {
  const move = dex.moves.get(arg(line, 2));
  if (move.exists && move.isZ) return zMoveReading(dex, move);
  if (!move.exists || !move.isMax) return statusZReading(dex, line);
  const gigantamax = typeof move.isMax === 'string';
  return { open: move.category === 'Status' ? { kind: 'status' } : { kind: 'attack', type: move.type }, gigantamax };
}

/** A Z-move or Max move books what it proves: the base move when the log names it, else an open slot for it; a G-Max move shows the Gigantamax. */
export function bookPowerMove(pokemon: RevealedPokemonInfo, power: PowerMove): void {
  if ('base' in power) {
    if (!pokemon.moves.some(move => toId(move.name) === toId(power.base))) pokemon.moves.push({ name: power.base, source: 'revealed' });
  } else if (!(pokemon.openMoves ?? []).some(open => sameOpenMove(open, power.open))) {
    pokemon.openMoves = [...(pokemon.openMoves ?? []), power.open];
  }
  if (power.gigantamax) pokemon.gigantamax = true;
}

/** `|-start|p2a: Nick|Dynamax|Gmax`: the Pokémon Gigantamaxed, whatever move it picks. */
export function recordGigantamax(state: InferrerState, line: LogLine): void {
  if (line.cmd !== '-start' || arg(line, 2) !== 'Dynamax' || arg(line, 3) !== 'Gmax') return;
  const subject = identOf(arg(line, 1));
  const pokemon = subject?.side === state.opponentSide ? findPokemon(state, subject.name) : undefined;
  if (pokemon) pokemon.gigantamax = true;
}
