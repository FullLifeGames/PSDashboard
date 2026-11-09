import type { PokemonSet } from '@pkmn/sim';
import { CHAMPIONS_MOD, logRules, speciesBaseId, toId, type GameRules, type TurnSnapshot } from '@fulllifegames/replay-core';
import { restoreSideInvariants } from '../forward-model.ts';
import { hpOfSighting } from './pokemon-info.ts';
import { normalizeLineEndings } from '../line-endings.ts';
import type { PokemonIdent, SimBattle, SimPokemon } from './types.ts';

/**
 * Fields only the brought species (VGC's 4 of 6, BSS's 3 of 6). Resolution
 * is per NAME: the exact species/nickname id first, then a UNIQUE
 * base-species match — the protocol reveals ACTIVE formes
 * (Zamazenta-Crowned) while built sets may carry the base name, and
 * 7-8-set teams holding both forme siblings must keep the exact one only.
 * Any unresolved or ambiguous name fails the side open (team stays whole).
 * Filtering preserves team order, so leads stay in front.
 */
export function trimTeamToBring(team: PokemonSet[], keep: string[] | undefined, rules: GameRules): PokemonSet[] {
  const claimed = claimBring(team, keep, rules);
  return claimed && claimed.length > 0 ? team.filter(set => claimed.includes(set)) : team;
}

/**
 * The sets a bring list names, in list order: null when the list is empty or missing, or a name stays unresolved or ambiguous
 * (the side fails open). A list as long as the team (or longer) trims nothing and claims nothing: it names no set, so its guesses
 * cannot move either.
 */
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

/** Round 89 (#124): a bring list of both sides, with how many trailing names of each list are guesses (absent: none). */
export interface BringLists {
  p1: string[];
  p2: string[];
  guessed?: { p1: number; p2: number };
}

/**
 * Round 89 (#124): both teams trim to their bring lists, or neither does. A pinned four against an open six overrates the open
 * side (the A.3c gate flipped game 452654 on that asymmetry, ADR 0010), so one side whose list is empty, unresolved or ambiguous
 * leaves both teams whole. After the trim each side's guessed sets (the trailing names of its list) move behind the known bodies, in list
 * order; every other set keeps team order, leads first. A guess therefore takes the last party slots, and every world of a game
 * puts each known body at the same party index, so one choice string names one body in all worlds.
 */
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

/**
 * Whether two names are one body's name. The simulator carries the replay's own name, so the exact text is the key; an
 * equal id is the fallback for a spelling that differs in case or marks. An id of "" (a Chinese or Japanese name, an
 * emoji) is no key: it would match every such body of the side.
 */
export function sameBodyName(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const id = toId(a);
  return id !== '' && id === toId(b);
}

/** The first item named `name` exactly, else the first with the same name by `sameBodyName`. */
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

/**
 * Round 73 (T250): what the protocol says about a side's bench. `shown`: the ids (name and base species) of every body its
 * switch, drag, replace and detailschange lines name; a body outside the set never stood on the field. `fainted`: the slots
 * the block's own lines faint. The game left a slot empty only where its body fainted, so a slot the simulator wants filled
 * without a faint line in the block is the simulator's divergence, not the bring list. `goesOn`: the log plays on past the block.
 * At the log's last block (a forfeit, a win or a tie follows) an empty slot proves nothing about the bench: a player who forfeits
 * with bodies left leaves the same slot empty.
 */
export interface ProtocolBench {
  shown: ReadonlySet<string>;
  fainted: ReadonlySet<number>;
  goesOn: boolean;
}

/** Whether the log has a turn line after the given turn: the game played on with the slot empty. */
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

/** The slots of a side that a block's lines faint. */
export function faintedSlots(blockLines: readonly string[], sideId: 'p1' | 'p2'): Set<number> {
  const slots = new Set<number>();
  for (const line of blockLines) {
    const match = normalizeLineEndings(line).match(/^\|faint\|(p[12])([a-d]):/);
    if (match?.[1] === sideId) slots.add(match[2].charCodeAt(0) - 97);
  }
  return slots;
}

const rulesOf = (battle: SimBattle): GameRules => ({ gen: battle.gen, mod: battle.dex.currentMod === CHAMPIONS_MOD ? CHAMPIONS_MOD : undefined });

/** Whether the log shows the body: its name, species or base species is among the shown ids. */
export const wasShownBody = (body: SimPokemon, shown: ReadonlySet<string>) => {
  const rules = rulesOf(body.battle);
  return [body.name, body.species.name, body.baseSpecies.name].some(name => shown.has(toId(name)) || shown.has(speciesBaseId(name, rules)));
};


/** Round 86 (B9): the shown ids of a snapshot's seen bodies, in the form `shownBodyIds` gives for a log (a body's name, its forme and their base species). */
export function shownIdsOfSnapshot(battle: SimBattle, seen: readonly { name: string; speciesForme: string }[]): Set<string> {
  const rules = rulesOf(battle);
  const shown = new Set<string>();
  for (const entry of seen) for (const name of [entry.name, entry.speciesForme]) shown.add(toId(name)).add(speciesBaseId(name, rules));
  return shown;
}

/** Whether a body's species or set can carry an ability that changes how it shows on entry (the Dex's BeforeSwitchIn handler: Illusion). */
export const mayDisguise = (body: SimPokemon) =>
  [body.ability, body.baseAbility, ...Object.values(body.species.abilities)].some(name =>
    typeof (body.battle.dex.abilities.get(name) as { onBeforeSwitchIn?: unknown }).onBeforeSwitchIn === 'function');

/**
 * Round 86 (B9, ruling C3): the one way a body leaves the game outside the simulator's own turn, in the order of `Battle#resolveFaints`: the
 * fallen count, then the End events of the body's ability and item, then the flags. A body on the field runs the End events (Neutralizing Gas
 * ends and starts what it held back, Desolate Land clears its weather); a bench body that the log never shows was never in the game and runs
 * none. `fallen`: the body fainted in the game and counts as a fallen ally (the side's `totalFainted`, which Last Respects and Supreme Overlord
 * read). `test/body-out-sweep.spec.ts` holds the function to the simulator over every Dex ability with an End handler.
 */
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

/**
 * The game left a forced slot empty (every forced slot is one the block faints, and no switch followed for at least one): the living bench bodies the protocol never shows were not brought (a player with a
 * body to send sends it), so they leave the game as the simulator takes a fainted body out (no faint line, no fallen-ally
 * count) and the slot takes `pass`, which the simulator accepts once no living body waits. Nothing happens, and the old
 * answer stands, when the bench holds a shown body the log's answers leave over (the simulator diverged, not the bring
 * list) or a body that may disguise itself as another. True when bodies left.
 */
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

/**
 * Round 86 (B9, ruling C3): a body the correction took out leaves a slot empty when the snapshot has nobody to stand in it. The game left that
 * slot empty because its side had no body to send, so the bench bodies the log never shows were not brought: they leave the game, as they do
 * when the rebuild's own replacement round meets the empty slot (`buildForcedSwitchChoice`). The same rule (`retireUnshownBench`) with the
 * snapshot's shown bodies (the ones the log saw: a team preview entry nobody saw has no hit points), and only while the side has a shown
 * body alive, so the retire never ends a game the log goes on with.
 */
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

/**
 * The faint state of one body against its snapshot entry. Round 86 (ruling C3): the log's faint of a body the simulator's turn left standing
 * takes it out the way the simulator does (`takeBodyOut`); a faint written or taken back otherwise moves the side's fainted count.
 */
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
