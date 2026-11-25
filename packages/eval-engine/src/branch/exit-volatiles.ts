import type { TurnSnapshot } from '@fulllifegames/replay-core';
import type { SimBattle, SimPokemon, SimSide } from './types.ts';

type BodyOf = (side: SimSide, snapshotPokemon: TurnSnapshot['p1']['pokemon'][number]) => SimPokemon | undefined;

type ExitRecorded = SimPokemon & { volatilesAtExit?: SimPokemon['volatiles']; slotAtExit?: number };

/** Keeps a body's volatiles as they stand when the Faint or SwitchOut event runs, before the simulator clears them. */
// The property serializes with the body, so a clone of the raw boundary carries it until the next snapshot correction.
export function recordVolatilesAtExit(pokemon: SimPokemon) {
  const recorded = pokemon as ExitRecorded;
  if (Object.keys(pokemon.volatiles).length > 0) {
    recorded.volatilesAtExit = { ...pokemon.volatiles };
    recorded.slotAtExit = pokemon.position;
  } else {
    delete recorded.volatilesAtExit;
    delete recorded.slotAtExit;
  }
}

// A Roar drag may bring it back on the other slot, so `exitSlot` (the sim's own exit slot) is a second witness.
function leftBeforeEntry(log: readonly string[], name: string, exitSlot?: number): boolean {
  const entries = log.map(line => line.split('|')).filter(([, tag]) => tag === 'switch' || tag === 'drag');
  const last = entries.map(([, , ident]) => ident.replace(/^p[12][a-d]: /, '')).lastIndexOf(name);
  if (last < 0) return false;
  const [entered] = entries[last][2].split(': ');
  const slots = [entered];
  if (exitSlot !== undefined) slots.push(`${entered.slice(0, 2)}${String.fromCharCode(97 + exitSlot)}`);
  return entries.slice(0, last).some(([, , ident]) => slots.some(slot => ident.startsWith(`${slot}: `)));
}

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

/** The protocol's entry put back a body the sim took off after its own entry in the block: the two stints are one. */
export function restoreAfterProtocolEntry(battle: SimBattle, body: SimPokemon, ident: string, events: readonly string[]) {
  const entries = events.filter(line => /^\|(?:switch|drag)\|/.test(line) && line.split('|')[2] === ident).length;
  const name = ident.replace(/^p[12][a-d]: /, '');
  if (entries === 1 && !leftBeforeEntry(events, name, (body as ExitRecorded).slotAtExit)) putBackExitVolatiles(battle, body, name, events);
}

export function bodiesOffTheField(battle: SimBattle): Set<SimPokemon> {
  return new Set(battle.sides.flatMap(side => side.pokemon.filter(pokemon => pokemon.fainted || !side.active.includes(pokemon))));
}

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
