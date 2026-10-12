import type { TurnSnapshot } from '@fulllifegames/replay-core';
import type { SimBattle, SimPokemon, SimSide } from './types.ts';

type BodyOf = (side: SimSide, snapshotPokemon: TurnSnapshot['p1']['pokemon'][number]) => SimPokemon | undefined;

/** The key the session's subscription writes: the volatiles a body held when the simulator took it off the field. */
type ExitRecorded = SimPokemon & { volatilesAtExit?: SimPokemon['volatiles'] };

/**
 * Round 69, T172: the simulator's faint and its switch-out clear a body's
 * volatiles, and an exit the game never saw (a K.O. the game's damage did not
 * deal, an Eject Button the build guessed) leaves the body the game kept
 * without Protosynthesis, Quark Drive, Leech Seed, Heal Block or Substitute.
 * The session keeps the volatiles as they stand when the Faint or SwitchOut
 * event runs (before the clear); the property serializes with the body, so a
 * clone of the raw boundary carries it, and the next snapshot correction
 * settles it.
 */
export function recordVolatilesAtExit(pokemon: SimPokemon) {
  const recorded = pokemon as ExitRecorded;
  if (Object.keys(pokemon.volatiles).length > 0) recorded.volatilesAtExit = { ...pokemon.volatiles };
  else delete recorded.volatilesAtExit;
}

/** Puts the record of an exit back on the body, minus the conditions the protocol ended for it in the block (|-end|, as the simulator's condition ids). */
function putBackExitVolatiles(battle: SimBattle, body: SimPokemon, name: string, log: readonly string[]) {
  const recorded = body as ExitRecorded;
  if (!recorded.volatilesAtExit) return;
  const ended = new Set<string>();
  for (const line of log) {
    const [, tag, ident, effect] = line.split('|');
    if (tag !== '-end' || !ident || !effect) continue;
    if (ident.replace(/^p[12][a-d]?: /, '') !== name) continue;
    ended.add(battle.dex.conditions.get(effect.replace(/^(move|ability|item): /, '')).id);
  }
  for (const [id, state] of Object.entries(recorded.volatilesAtExit)) {
    if (ended.has(id) || id in body.volatiles) continue;
    // The exit came inside the turn, so the turn's residual round never ticked the condition's counter on this body.
    const left = typeof state.duration === 'number' ? state.duration - 1 : null;
    if (left !== null && left <= 0) continue;
    body.volatiles[id] = left === null ? state : { ...state, duration: left };
  }
  delete recorded.volatilesAtExit;
}

/**
 * The protocol's switch-in put a body on the field that the simulator had
 * taken off it after its own entry in the same block (752755 turn 9: the
 * guessed Eject Button sent Hatterene out after the Psychic Noise that began
 * its Heal Block). With one entry line in the block the two stints are the
 * same one, and the record holds what the body carried at the exit.
 */
export function restoreAfterProtocolEntry(battle: SimBattle, body: SimPokemon, ident: string, events: readonly string[]) {
  const entries = events.filter(line => /^\|(?:switch|drag)\|/.test(line) && line.split('|')[2] === ident).length;
  if (entries === 1) putBackExitVolatiles(battle, body, ident.replace(/^p[12][a-d]: /, ''), events);
}

/** Every body the simulator holds off the field right now: fainted, or not among the actives. */
export function bodiesOffTheField(battle: SimBattle): Set<SimPokemon> {
  return new Set(battle.sides.flatMap(side => side.pokemon.filter(pokemon => pokemon.fainted || !side.active.includes(pokemon))));
}

/**
 * The corrections put back on the field a body the simulator had taken off
 * it (fainted or switched out) and the game kept: what the simulator carried
 * at that exit comes back, minus the conditions the protocol ended in the
 * block. A body that stayed on the field keeps its own volatiles. Then every
 * record goes, whether it was used or not.
 */
export function restoreExitVolatiles(battle: SimBattle, snapshot: TurnSnapshot, offTheField: ReadonlySet<SimPokemon>, bodyOf: BodyOf) {
  for (const [sideIdx, snapshotSide] of [snapshot.p1, snapshot.p2].entries()) {
    const side = battle.sides[sideIdx];
    for (const snapshotPokemon of snapshotSide.pokemon) {
      const body = bodyOf(side, snapshotPokemon) as ExitRecorded | undefined;
      if (!body?.volatilesAtExit || !offTheField.has(body)) continue;
      if (!snapshotPokemon.isActive || snapshotPokemon.fainted || body.fainted || !side.active.includes(body)) continue;
      putBackExitVolatiles(battle, body, snapshotPokemon.name, snapshot.log);
    }
  }
  for (const side of battle.sides) {
    for (const body of side.pokemon) delete (body as ExitRecorded).volatilesAtExit;
  }
}
