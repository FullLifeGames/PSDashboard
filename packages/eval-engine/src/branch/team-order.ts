import type { PokemonSet } from '@pkmn/sim';
import { CHAMPIONS_MOD, logRules, speciesBaseId, toId, type GameRules, type TurnSnapshot } from '@fulllifegames/replay-core';
import { restoreSideInvariants } from '../forward-model.ts';
import { hpOfSighting } from './pokemon-info.ts';
import { normalizeLineEndings } from '../line-endings.ts';
import type { PokemonIdent, SimBattle, SimPokemon } from './types.ts';

/** Fields only the brought species by NAME: exact id, else a UNIQUE base-species match; else the team stays whole. */
// The log shows ACTIVE formes (Zamazenta-Crowned), sets may hold the base name; with both siblings only the exact one.
export function trimTeamToBring(team: PokemonSet[], keep: string[] | undefined, rules: GameRules): PokemonSet[] {
  const claimed = claimBring(team, keep, rules);
  return claimed && claimed.length > 0 ? team.filter(set => claimed.includes(set)) : team;
}

// A list as long as the team or longer claims nothing: it names no set, so its guesses cannot move either.
function claimBring(team: PokemonSet[], keep: string[] | undefined, rules: GameRules): PokemonSet[] | null {
  if (!keep || keep.length === 0) return null;
  if (keep.length >= team.length) return [];
  const claimed: PokemonSet[] = [];
  for (const name of keep) {
    const nameId = toId(name);
    const free = team.filter(set => !claimed.includes(set));
    const exact = (name ? free.find(set => set.name === name) : undefined) ??
      free.find(set => (nameId !== '' && toId(set.species) === nameId) || sameBodyName(set.name, name));
    if (exact) {
      claimed.push(exact);
      continue;
    }
    const base = speciesBaseId(name, rules);
    const byBase = free.filter(set => speciesBaseId(set.species, rules) === base);
    if (byBase.length !== 1) return null;
    claimed.push(byBase[0]);
  }
  return claimed;
}

export interface BringLists {
  p1: string[];
  p2: string[];
  guessed?: { p1: number; p2: number };
}

/** Both teams trim to their bring lists, or neither does (ADR 0010); guessed sets move behind the known bodies. */
// Guesses take the last party slots: every world holds each known body at one party index; others keep team order.
export function trimTeamsToBring(
  p1Team: PokemonSet[], p2Team: PokemonSet[], list: BringLists | null | undefined, rules: GameRules,
): { p1: PokemonSet[]; p2: PokemonSet[] } {
  if (!list) return { p1: p1Team, p2: p2Team };
  const claimed = { p1: claimBring(p1Team, list.p1, rules), p2: claimBring(p2Team, list.p2, rules) };
  if (!claimed.p1 || !claimed.p2) return { p1: p1Team, p2: p2Team };
  const side = (team: PokemonSet[], claim: PokemonSet[], guessed: number): PokemonSet[] => {
    if (claim.length === 0) return team;
    const trimmed = team.filter(set => claim.includes(set));
    const guesses = claim.slice(claim.length - Math.min(Math.max(guessed, 0), claim.length));
    return [...trimmed.filter(set => !guesses.includes(set)), ...guesses];
  };
  return {
    p1: side(p1Team, claimed.p1, list.guessed?.p1 ?? 0),
    p2: side(p2Team, claimed.p2, list.guessed?.p2 ?? 0),
  };
}

/** Whether two names are one body's name: the exact text, else an equal id; an id of "" (CJK, emoji) is no key. */
export function sameBodyName(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const id = toId(a);
  return id !== '' && id === toId(b);
}

export function findByName<T>(items: readonly T[], nameOf: (item: T) => string | undefined, name: string | undefined): T | undefined {
  if (!name) return undefined;
  return items.find(item => nameOf(item) === name) ?? items.find(item => sameBodyName(nameOf(item), name));
}

export function slotLetter(index: number): string {
  return String.fromCharCode('a'.charCodeAt(0) + index);
}

export function formatTargetLoc(targetLoc: number): string {
  return targetLoc > 0 ? `+${targetLoc}` : `${targetLoc}`;
}

export function reorderForLeads(team: PokemonSet[], leads: PokemonIdent[]): PokemonSet[] {
  if (leads.length === 0) return [...team];

  const remaining = [...team];
  const orderedLeads: PokemonSet[] = [];
  for (const lead of leads) {
    const leadSpeciesId = toId(lead.species);
    const named = lead.name ? remaining.filter(pokemon => pokemon.name === lead.name) : [];
    const sameId = named.length > 0 ? named : remaining.filter(pokemon => sameBodyName(pokemon.name, lead.name));
    // One name on two bodies: the lead's species tells them apart.
    const byName = sameId.find(pokemon => toId(pokemon.species) === leadSpeciesId) ?? sameId[0];
    const pokemon = byName ?? remaining.find(candidate =>
      toId(candidate.species) === leadSpeciesId ||
      toId(candidate.name || '') === leadSpeciesId
    );
    if (pokemon) {
      remaining.splice(remaining.indexOf(pokemon), 1);
      orderedLeads.push(pokemon);
    }
  }

  return [...orderedLeads, ...remaining];
}

/** What the protocol says of a side's bench: `shown` ids (switch, drag, replace), `fainted` slots, `goesOn`. */
// A slot is empty only where its body fainted; at the last block an empty slot proves nothing (a forfeit too).
export interface ProtocolBench {
  shown: ReadonlySet<string>;
  fainted: ReadonlySet<number>;
  goesOn: boolean;
}

export function logGoesOn(replayLog: string, turn: number): boolean {
  return normalizeLineEndings(replayLog).split('\n').some(line => {
    const match = line.match(/^\|turn\|(\d+)/);
    return !!match && Number(match[1]) > turn;
  });
}

export function shownBodyIds(replayLog: string, sideId: 'p1' | 'p2'): Set<string> {
  const shown = new Set<string>();
  const rules = logRules(normalizeLineEndings(replayLog));
  for (const line of normalizeLineEndings(replayLog).split('\n')) {
    const match = line.match(/^\|(?:switch|drag|replace|detailschange)\|(p[12])[a-d]?: ?([^|]*)\|([^,|]+)/);
    if (match?.[1] !== sideId) continue;
    for (const name of [match[2], match[3]]) shown.add(toId(name)).add(speciesBaseId(name, rules));
  }
  return shown;
}

export function faintedSlots(blockLines: readonly string[], sideId: 'p1' | 'p2'): Set<number> {
  const slots = new Set<number>();
  for (const line of blockLines) {
    const match = normalizeLineEndings(line).match(/^\|faint\|(p[12])([a-d]):/);
    if (match?.[1] === sideId) slots.add(match[2].charCodeAt(0) - 97);
  }
  return slots;
}

const rulesOf = (battle: SimBattle): GameRules => ({ gen: battle.gen, mod: battle.dex.currentMod === CHAMPIONS_MOD ? CHAMPIONS_MOD : undefined });

export const wasShownBody = (body: SimPokemon, shown: ReadonlySet<string>) => {
  const rules = rulesOf(body.battle);
  return [body.name, body.species.name, body.baseSpecies.name].some(name => shown.has(toId(name)) || shown.has(speciesBaseId(name, rules)));
};

export function shownIdsOfSnapshot(battle: SimBattle, seen: readonly { name: string; speciesForme: string }[]): Set<string> {
  const rules = rulesOf(battle);
  const shown = new Set<string>();
  for (const entry of seen) for (const name of [entry.name, entry.speciesForme]) shown.add(toId(name)).add(speciesBaseId(name, rules));
  return shown;
}

/** Whether a body can carry an ability that changes how it shows on entry (Dex BeforeSwitchIn handler: Illusion). */
export const mayDisguise = (body: SimPokemon) =>
  [body.ability, body.baseAbility, ...Object.values(body.species.abilities)].some(name =>
    typeof (body.battle.dex.abilities.get(name) as { onBeforeSwitchIn?: unknown }).onBeforeSwitchIn === 'function');

/** A body leaves the game outside the sim's turn: fallen count, End events, flags, in `Battle#resolveFaints` order. */
// A body never shown runs no End events; `fallen` counts it a fallen ally. Sweep: `test/body-out-sweep.spec.ts`.
export function takeBodyOut(body: SimPokemon, { fallen }: { fallen: boolean }): void {
  const { side, battle } = body;
  const onField = !body.fainted && side.active.includes(body);
  body.hp = 0;
  body.faintQueued = true;
  if (side.pokemonLeft > 0) side.pokemonLeft--;
  if (fallen && side.totalFainted < 100) side.totalFainted++;
  if (onField) {
    battle.singleEvent('End', body.getAbility(), body.abilityState, body);
    battle.singleEvent('End', body.getItem(), body.itemState, body);
  }
  body.fainted = true;
}

// They leave like a fainted body (no faint line, no fallen count); a leftover shown body or a disguiser stops it.
export function retireUnshownBench(battle: SimBattle, sideIdx: number, bench: ProtocolBench, answers: number, forcedSlots: number[]): boolean {
  const { shown, fainted, goesOn } = bench;
  if (!goesOn) return false;
  const side = battle.sides[sideIdx];
  const living = side.pokemon.filter(body => !body.isActive && !body.fainted);
  const phantoms = living.filter(body => !wasShownBody(body, shown));
  if (!forcedSlots.every(slot => fainted.has(slot))) return false;
  if (phantoms.length === 0 || living.length - phantoms.length > answers || phantoms.some(mayDisguise)) return false;
  for (const body of phantoms) takeBodyOut(body, { fallen: false });
  side.clearChoice();
  if (side.pokemonLeft === 0) battle.checkWin();
  return true;
}

// Shown = the snapshot's seen bodies; only while one is alive, so the retire never ends a game the log goes on with.
export function retireBenchAfterFaints(battle: SimBattle, snapshot: TurnSnapshot, tookOut: ReadonlySet<SimPokemon>) {
  if (tookOut.size === 0) return;
  for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
    const side = battle.sides[sideIdx];
    const slots = side.active.flatMap((body, slot) => (body && tookOut.has(body) ? [slot] : []));
    if (slots.length === 0) continue;
    const seen = (sideIdx === 0 ? snapshot.p1 : snapshot.p2).pokemon.filter(entry => entry.maxhp > 0);
    const shown = shownIdsOfSnapshot(battle, seen);
    if (!side.pokemon.some(body => !body.fainted && body.hp > 0 && wasShownBody(body, shown))) continue;
    if (retireUnshownBench(battle, sideIdx, { shown, fainted: new Set(slots), goesOn: true }, 0, slots)) restoreSideInvariants(battle);
  }
}

export function settleFaintFromSnapshot(battlePokemon: SimPokemon, snapshotPokemon: TurnSnapshot['p1']['pokemon'][number]) {
  if (snapshotPokemon.fainted && !battlePokemon.fainted) {
    takeBodyOut(battlePokemon, { fallen: true });
    return;
  }
  if (battlePokemon.fainted !== snapshotPokemon.fainted) {
    const side = battlePokemon.side;
    side.totalFainted = Math.max(0, side.totalFainted + (snapshotPokemon.fainted ? 1 : -1));
  }
  battlePokemon.hp = Math.max(0, hpOfSighting(battlePokemon, snapshotPokemon));
  battlePokemon.fainted = snapshotPokemon.fainted;
  battlePokemon.faintQueued = snapshotPokemon.fainted;
  if (snapshotPokemon.fainted) battlePokemon.hp = 0;
}
