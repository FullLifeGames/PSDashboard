import { Dex } from '@pkmn/sim';
import type { OpenMove, RevealedPokemonInfo } from '../types.ts';
import { sameOpenMove } from '../team/open-moves.ts';
import { toId } from '../ids.ts';
import { poweredMove } from '../spreads/powered-move.ts';
import { findPokemon, type InferrerState } from './inferrer-state.ts';
import { arg, identOf, kwText, type LogLine } from './log-line.ts';

// The log shows the powered move, never its base move; Max Guard, the status Max move, stands for every status move.

type PowerMove =
  | { base: string; gigantamax?: undefined }
  | { open: OpenMove; gigantamax?: boolean };

type GenDex = ReturnType<typeof Dex.forGen>;

// A species' own Z-move names its base move (the crystal); any other damaging Z-move the type the crystal enables.
function zMoveReading(dex: GenDex, move: ReturnType<GenDex['moves']['get']>): PowerMove {
  const crystal = dex.items.get(String(move.isZ));
  return crystal.zMoveFrom ? { base: crystal.zMoveFrom } : { open: { kind: 'attack', type: crystal.zMoveType ?? move.type } };
}

// The base move of a status Z-move: the `[anim]` marker, else the name after "Z-".
function statusZReading(dex: GenDex, line: LogLine): PowerMove | null {
  const name = arg(line, 2);
  if (!name.startsWith('Z-') || dex.moves.get(name).exists) return null;
  const shown = dex.moves.get(kwText(line, 'anim'));
  const base = shown.exists ? shown : dex.moves.get(name.slice(2));
  return base.exists ? { base: base.name } : null;
}

export function readPowerMove(dex: GenDex, line: LogLine): PowerMove | null {
  const move = dex.moves.get(arg(line, 2));
  if (!poweredMove(dex, move.id)) return statusZReading(dex, line);
  if (move.isZ) return zMoveReading(dex, move);
  const gigantamax = typeof move.isMax === 'string';
  return { open: move.category === 'Status' ? { kind: 'status' } : { kind: 'attack', type: move.type }, gigantamax };
}

/** Books what the line proves: the base move when named, else an open slot for it. */
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
