import type { TurnSnapshot } from '@fulllifegames/replay-core';
import type { SimBattle, SimPokemon, SimSide } from './types.ts';

type BodyOf = (side: SimSide, snapshotPokemon: TurnSnapshot['p1']['pokemon'][number]) => SimPokemon | undefined;

/** The key the session's subscription writes: the volatiles a body held when the simulator took it off the field. */
type ExitRecorded = SimPokemon & { volatilesAtExit?: SimPokemon['volatiles']; slotAtExit?: number };

/**
 * Keeps a body's volatiles as they stand when the Faint or SwitchOut event runs, before the simulator clears them: an exit the game never
 * saw (a K.O. its damage did not deal, a guessed Eject Button) would leave the body the game kept without Protosynthesis, Quark Drive,
 * Leech Seed, Heal Block or Substitute. The property serializes with the body, so a clone of the raw boundary carries it until the next
 * snapshot correction settles it.
 */
export function recordVolatilesAtExit(pokemon: SimPokemon) {
  const recorded = pokemon as ExitRecorded;
  if (Object.keys(pokemon.volatiles).length > 0) {
    recorded.volatilesAtExit = { ...pokemon.volatiles };
    // The slot the body stood on: the block shows its switch-out as another body's entry on that slot.
    recorded.slotAtExit = pokemon.position;
  } else {
    delete recorded.volatilesAtExit;
    delete recorded.slotAtExit;
  }
}

/**
 * Whether the protocol itself took the body off the field earlier in the block: a switch or drag line puts another body on its slot before
 * the body's own entry line (Blacephalon out for Weavile, Weavile knocked out, Blacephalon back). The simulator's exit is then the game's
 * exit, and the second stint starts fresh, without the first one's Choice lock or Leech Seed. The block shows the body leave through
 * another body's entry on the slot it left, and a Roar drag may bring it back on the other slot (Sableye out of p2b for Rillaboom, dragged
 * into p2a): `exitSlot` is the simulator's own exit slot, the slot the body enters a second witness.
 */
function leftBeforeEntry(log: readonly string[], name: string, exitSlot?: number): boolean {
  const entries = log.map(line => line.split('|')).filter(([, tag]) => tag === 'switch' || tag === 'drag');
  const last = entries.map(([, , ident]) => ident.replace(/^p[12][a-d]: /, '')).lastIndexOf(name);
  if (last < 0) return false;
  const [entered] = entries[last][2].split(': ');
  const slots = [entered];
  if (exitSlot !== undefined) slots.push(`${entered.slice(0, 2)}${String.fromCharCode(97 + exitSlot)}`);
  return entries.slice(0, last).some(([, , ident]) => slots.some(slot => ident.startsWith(`${slot}: `)));
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
  delete recorded.slotAtExit;
}

/**
 * The protocol's switch-in put a body on the field that the simulator took off after its own entry in the same block (a guessed Eject
 * Button sent Hatterene out after the Psychic Noise that began its Heal Block): with one entry line the two stints are one, and the record
 * holds what the body carried at the exit.
 */
export function restoreAfterProtocolEntry(battle: SimBattle, body: SimPokemon, ident: string, events: readonly string[]) {
  const entries = events.filter(line => /^\|(?:switch|drag)\|/.test(line) && line.split('|')[2] === ident).length;
  const name = ident.replace(/^p[12][a-d]: /, '');
  if (entries === 1 && !leftBeforeEntry(events, name, (body as ExitRecorded).slotAtExit)) putBackExitVolatiles(battle, body, name, events);
}

/** Every body the simulator holds off the field right now: fainted, or not among the actives. */
export function bodiesOffTheField(battle: SimBattle): Set<SimPokemon> {
  return new Set(battle.sides.flatMap(side => side.pokemon.filter(pokemon => pokemon.fainted || !side.active.includes(pokemon))));
}

/**
 * For a body the simulator took off the field and the game kept, puts back what it carried at the exit minus the conditions the protocol
 * ended in the block; then every record goes, used or not.
 */
export function restoreExitVolatiles(battle: SimBattle, snapshot: TurnSnapshot, offTheField: ReadonlySet<SimPokemon>, bodyOf: BodyOf) {
  for (const [sideIdx, snapshotSide] of [snapshot.p1, snapshot.p2].entries()) {
    const side = battle.sides[sideIdx];
    for (const snapshotPokemon of snapshotSide.pokemon) {
      const body = bodyOf(side, snapshotPokemon) as ExitRecorded | undefined;
      if (!body?.volatilesAtExit || !offTheField.has(body)) continue;
      if (!snapshotPokemon.isActive || snapshotPokemon.fainted || body.fainted || !side.active.includes(body)) continue;
      if (leftBeforeEntry(snapshot.log, snapshotPokemon.name, body.slotAtExit)) continue;
      putBackExitVolatiles(battle, body, snapshotPokemon.name, snapshot.log);
    }
  }
  for (const side of battle.sides) {
    for (const body of side.pokemon) {
      delete (body as ExitRecorded).volatilesAtExit;
      delete (body as ExitRecorded).slotAtExit;
    }
  }
}
