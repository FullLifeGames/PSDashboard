import type { PokemonIdent, SimBattle, SimPokemon, SimSide, TurnBlock } from './types.ts';
import { formatTargetLoc, normalizeBattleOnlyFormeId, slotLetter } from './team-order.ts';
import { answersForcedRequest } from './forced-request.ts';
import { nextChoosingSlot } from '../forward/request-moves.ts';
import { sideIndex, toId, type RulesDex } from '@fulllifegames/replay-core';

export function parseTurnBlocks(log: string): { preGame: string[]; turns: TurnBlock[] } {
  const lines = log.split('\n');
  const preGame: string[] = [];
  const turns: TurnBlock[] = [];
  let current: TurnBlock | null = null;
  let inPostUpkeep = false;

  for (const line of lines) {
    if (line.startsWith('|turn|')) {
      if (current) turns.push(current);
      current = { turn: parseInt(line.split('|')[2], 10), preUpkeep: [], postUpkeep: [] };
      inPostUpkeep = false;
    } else if (!current) {
      preGame.push(line);
    } else if (line.startsWith('|upkeep')) {
      inPostUpkeep = true;
    } else if (inPostUpkeep) {
      current.postUpkeep.push(line);
    } else {
      current.preUpkeep.push(line);
    }
  }
  if (current) turns.push(current);

  return { preGame, turns };
}

export function extractLeads(log: string): { p1Leads: PokemonIdent[]; p2Leads: PokemonIdent[] } {
  const p1Leads: PokemonIdent[] = [];
  const p2Leads: PokemonIdent[] = [];

  for (const line of log.split('\n')) {
    if (line.startsWith('|turn|')) break;

    const match = line.match(/^\|switch\|(p[12])[a-d]:\s*([^|]*)\|([^,|]+)/);
    if (!match) continue;

    const side = match[1];
    const name = match[2].trim();
    const species = match[3].trim();
    const target = side === 'p1' ? p1Leads : p2Leads;
    if (!target.some(existing => existing.name === name && toId(existing.species) === toId(species))) {
      target.push({ name, species });
    }
  }

  return { p1Leads, p2Leads };
}

/** Whether a bench body is the species by its forme, its name or a shared prefix (a base name for a forme). */
function matchesSpeciesId(pokemon: SimPokemon, speciesId: string, normalizedSpeciesId: string): boolean {
  const speciesName = toId(pokemon.species?.name || '');
  const displayName = toId(pokemon.name || '');
  return (
    speciesName === speciesId ||
    speciesName === normalizedSpeciesId ||
    displayName === speciesId ||
    displayName === normalizedSpeciesId ||
    speciesName.startsWith(speciesId) ||
    speciesId.startsWith(speciesName) ||
    speciesName.startsWith(normalizedSpeciesId) ||
    normalizedSpeciesId.startsWith(speciesName)
  );
}

export function findSlotBySpecies(battle: SimBattle, sideIdx: number, species: string): number {
  const side = battle.sides[sideIdx];
  const speciesId = toId(species);
  const normalizedSpeciesId = normalizeBattleOnlyFormeId(speciesId);
  // An empty id (a name without Latin letters) is no key: it is a prefix of every species.
  if (speciesId === '') return findFirstAvailableSwitchSlot(battle, sideIdx);

  for (let i = 0; i < side.pokemon.length; i++) {
    const pokemon = side.pokemon[i];
    if (pokemon.isActive || pokemon.fainted) continue;
    if (matchesSpeciesId(pokemon, speciesId, normalizedSpeciesId)) return i + 1;
  }

  return findFirstAvailableSwitchSlot(battle, sideIdx);
}

export function findFirstAvailableSwitchSlot(battle: SimBattle, sideIdx: number): number {
  const side = battle.sides[sideIdx];
  for (let i = 0; i < side.pokemon.length; i++) {
    if (!side.pokemon[i].isActive && !side.pokemon[i].fainted) return i + 1;
  }
  return 2;
}

/** A body by the exact name the simulator carries (the replay's own), else by species or by the id of its name; an empty id is no key. */
export function findPokemonOnSide(side: SimSide, species: string): SimPokemon | null {
  const speciesId = toId(species);
  const normalizedSpeciesId = normalizeBattleOnlyFormeId(speciesId);
  const exact = species ? side.pokemon.find(pokemon => pokemon.name === species) : undefined;
  if (exact || speciesId === '') return exact ?? null;
  return side.pokemon.find(pokemon =>
    toId(pokemon.species?.name || '') === speciesId ||
    toId(pokemon.species?.name || '') === normalizedSpeciesId ||
    toId(pokemon.name || '') === speciesId ||
    toId(pokemon.name || '') === normalizedSpeciesId
  ) ?? null;
}

function protocolTargetLoc(
  battle: SimBattle,
  sourceSide: 'p1' | 'p2',
  sourceActiveSlot: number,
  targetIdent: string | undefined,
): number {
  const match = targetIdent?.match(/^(p[12])([a-d]):/);
  if (!match) return 0;

  const sourceSideIdx = sideIndex(sourceSide);
  const targetSideIdx = match[1] === 'p1' ? 0 : 1;
  const targetActiveSlot = match[2].charCodeAt(0) - 'a'.charCodeAt(0);
  const source = battle.sides[sourceSideIdx].active[sourceActiveSlot];
  const target = battle.sides[targetSideIdx].active[targetActiveSlot];

  if (source && target) return source.getLocOf(target);
  return targetSideIdx === sourceSideIdx ? -(targetActiveSlot + 1) : targetActiveSlot + 1;
}

export function targetTypeForMove(dex: RulesDex, active: SimPokemon | null | undefined, moveName: string): string {
  if (!active) return dex.moves.get(moveName).target || '';
  const moveId = toId(moveName);
  const request = active.getMoveRequestData();
  return request.moves.find(move => move.id === moveId)?.target || dex.moves.get(moveName).target || '';
}

function shouldAppendTargetLoc(
  battle: SimBattle,
  active: SimPokemon | null | undefined,
  moveName: string,
  targetLoc: number,
): boolean {
  if (!active || !targetLoc || active.side.active.length < 2) return false;
  const targetType = targetTypeForMove(battle.dex, active, moveName);
  return battle.actions.targetTypeChoices(targetType) && battle.validTargetLoc(targetLoc, active, targetType);
}

/**
 * A locked request (recharge, the release turn of Fly or Dig, a continued
 * rampage) carries one entry WITHOUT a `target`, and the sim rejects any loc
 * on it together with the whole side choice. The Dex fallback in
 * `targetTypeForMove` would still name a target type there.
 */
function requestEntryHasNoTarget(active: SimPokemon | null | undefined, moveName: string): boolean {
  if (!active) return false;
  const moveId = toId(moveName);
  const entry = active.getMoveRequestData().moves.find(move => move.id === moveId);
  return !!entry && !entry.target;
}

export function targetLocSuffixForChoice(
  battle: SimBattle,
  active: SimPokemon | null | undefined,
  moveName: string,
  protocolTargetLoc: number,
): string {
  if (requestEntryHasNoTarget(active, moveName)) return '';
  if (shouldAppendTargetLoc(battle, active, moveName, protocolTargetLoc)) {
    return ` ${formatTargetLoc(protocolTargetLoc)}`;
  }

  if (!active || active.side.active.length < 2) return '';
  const targetType = targetTypeForMove(battle.dex, active, moveName);
  if (!battle.actions.targetTypeChoices(targetType)) return '';

  const fallbackTargetLoc = firstLegalTargetLoc(battle, active, targetType);
  return fallbackTargetLoc ? ` ${formatTargetLoc(fallbackTargetLoc)}` : '';
}

function firstLegalTargetLoc(battle: SimBattle, active: SimPokemon, targetType: string): number | null {
  if (active.side.active.length < 2 || !battle.actions.targetTypeChoices(targetType)) return null;
  for (let loc = 1; loc <= battle.activePerHalf; loc++) {
    for (const targetLoc of [loc, -loc]) {
      if (battle.validTargetLoc(targetLoc, active, targetType)) return targetLoc;
    }
  }
  return null;
}

/**
 * The slot's default when its protocol shows no action: `pass` for a slot the sim itself passes (fainted, or a Tatsugiri
 * commanding a Dondozo: side.js getChoiceIndex, read through `nextChoosingSlot`), else the first enabled move. A `move`
 * for a commanding slot went to the partner's slot, the sim rejected the side's whole choice, and the half-built choice
 * counted as done, so no repair committed the turn (round 72, T246c).
 */
function defaultMoveChoice(battle: SimBattle, active: SimPokemon | null | undefined): string {
  if (!active || nextChoosingSlot(active.side, active.position) !== active.position) return 'pass';
  const firstMove = active.moveSlots[0];
  if (!firstMove) return 'pass';
  // `move N` resolves against the request's entries, not `moveSlots`: on a
  // locked request the two differ, and the entry has no target. The default
  // is the first ENABLED entry: a choice-locked body that flinched
  // (gen9vgc2026regi-2630452654 t4, Miraidon locked into Snarl) had `move 1`
  // disabled, and the rejected side choice cost its partner the Encore.
  const requestMoves = active.getMoveRequestData().moves;
  const enabledIndex = Math.max(0, requestMoves.findIndex(move => !move.disabled));
  const requestEntry = requestMoves[enabledIndex];
  const targetType = requestEntry
    ? (requestEntry.target || '')
    : targetTypeForMove(battle.dex, active, firstMove.id || firstMove.move);
  const targetLoc = firstLegalTargetLoc(battle, active, targetType);
  return `move ${enabledIndex + 1}${targetLoc ? ` ${formatTargetLoc(targetLoc)}` : ''}`;
}

function moveChoiceForActive(active: SimPokemon | null | undefined, moveName: string): string {
  if (!active) return `move ${toId(moveName)}`;
  const moveId = toId(moveName);
  const requestMoves = active.getMoveRequestData().moves;
  const requestMoveIndex = requestMoves.findIndex(move =>
    move.id === moveId || toId(move.move) === moveId
  );
  if (requestMoveIndex >= 0) return `move ${requestMoveIndex + 1}`;

  const moveIndex = active.moveSlots.findIndex(move =>
    toId(move.id || move.move) === moveId || toId(move.move) === moveId
  );
  return `move ${moveIndex >= 0 ? moveIndex + 1 : moveId}`;
}

/**
 * An Encore that lands BEFORE its target moves bends the click onto the
 * encored move, and the protocol shows that move, not the click. Sending it
 * back runs a Protect at +4 ahead of the Encore, and the sim counts an
 * Encore on a target that has already moved one turn longer
 * (gen9vgc2026regi-2629703929: locked t6 to t8 instead of t6 and t7, and the
 * second Encore failed against the first). The click is unknown; what is
 * known is that it ran after the Encore. The stand-in is the request's
 * lowest-priority other move at priority 0 or below, which the Encore then
 * bends exactly as it did in the game. No such move: the line stays the
 * choice, as before round 55.
 */
function clickBehindEncore(
  events: string[],
  moveLineIndex: number,
  ident: string,
  active: SimPokemon | null | undefined,
  shownMove: string,
): string | null {
  if (!active) return null;
  const encoredFirst = events.slice(0, moveLineIndex).some(line =>
    line.startsWith(`|-start|${ident}`) && line.split('|')[3] === 'Encore');
  if (!encoredFirst) return null;

  return slowestRequestMove(active.battle.dex, active, toId(shownMove));
}

/** Whether the body's request or move slots carry the move. */
function knowsMove(active: SimPokemon, moveName: string): boolean {
  const moveId = toId(moveName);
  return active.getMoveRequestData().moves.some(move => move.id === moveId || toId(move.move) === moveId) ||
    active.moveSlots.some(slot => toId(slot.id || slot.move) === moveId);
}

/**
 * The click behind a `|cant|` move the body's set lacks (round 67, T108). The
 * move never ran: its blocker stopped it. The stand-in is one of the body's
 * own moves the same blocker stops, the first enabled request move with the
 * shown move's Dex category and priority (752301 t1: Landorus, built without
 * Taunt, clicks Stealth Rock, and the same-turn Taunt stops it as it stopped
 * the Taunt in the game); else the slowest move. Null: no enabled move.
 */
function clickBehindBlockedMove(active: SimPokemon, shownMove: string): string | null {
  const dex = active.battle.dex;
  const shown = dex.moves.get(shownMove);
  const alike = active.getMoveRequestData().moves.find(entry => {
    const move = dex.moves.get(entry.id);
    return !entry.disabled && move.category === shown.category && move.priority === shown.priority;
  });
  return alike?.id ?? slowestRequestMove(dex, active);
}

/** The request's lowest-priority enabled move at priority 0 or below (other than `exceptId`), or null. */
function slowestRequestMove(dex: RulesDex, active: SimPokemon, exceptId = ''): string | null {
  let standIn: { id: string; priority: number } | null = null;
  for (const entry of active.getMoveRequestData().moves) {
    if (entry.id === exceptId || entry.disabled) continue;
    const priority = dex.moves.get(entry.id).priority;
    if (priority > 0) continue;
    if (!standIn || priority < standIn.priority) standIn = { id: entry.id, priority };
  }
  return standIn?.id ?? null;
}

/**
 * Replays the protocol's gimmick markers (Tera / Mega / Ultra Burst) as
 * choice modifiers. Without them the reconstructed sim never transforms —
 * every later position then carries an unspent gimmick on an untransformed
 * Pokémon, and the eval recommends a Mega that already happened. Gated on
 * the sim actually offering the gimmick so an unknown item can never
 * produce a rejected choice.
 */
function gimmickSuffixForSlot(events: string[], ident: string, active: SimPokemon | null | undefined): string {
  if (!active) return '';
  for (const line of events) {
    if (line.startsWith(`|-terastallize|${ident}`) && active.canTerastallize) return ' terastallize';
    if (line.startsWith(`|-mega|${ident}`) && active.canMegaEvo) return ' mega';
    if (line.startsWith(`|-burst|${ident}`) && active.canUltraBurst) return ' ultra';
  }
  return '';
}

function getChoiceForSlot(
  events: string[],
  side: 'p1' | 'p2',
  activeSlot: number,
  battle: SimBattle,
): string {
  const sideIdx = sideIndex(side);
  const ident = `${side}${slotLetter(activeSlot)}:`;

  for (const [lineIndex, line] of events.entries()) {
    if (line.startsWith(`|switch|${ident}`) && !line.includes('[from]')) {
      // The body left before it acted: its item ejected it (2658662321 t2:
      // Salt Cure hit Hatterene, its Eject Button brought Walking Wake) or it
      // fainted (gen 3 replaces before upkeep). The click is unknown and the
      // sim cancels it as the body leaves; the slowest move lets the hit
      // land first, as in the game.
      if (answersForcedRequest(events, lineIndex, ident, battle.dex)) {
        const active = battle.sides[sideIdx].active[activeSlot];
        const standIn = active ? slowestRequestMove(battle.dex, active) : null;
        if (!standIn) break;
        const suffix = targetLocSuffixForChoice(battle, active, standIn, 0);
        return `${moveChoiceForActive(active, standIn)}${suffix}${gimmickSuffixForSlot(events, ident, active)}`;
      }
      const species = line.split('|')[3].split(',')[0].trim();
      return `switch ${findSlotBySpecies(battle, sideIdx, species)}`;
    }

    if (line.startsWith(`|move|${ident}`)) {
      const active = battle.sides[sideIdx].active[activeSlot];
      const clicked = clickBehindEncore(events, lineIndex, ident, active, line.split('|')[3]);
      const moveName = clicked ?? line.split('|')[3];
      const targetLoc = clicked ? 0 : protocolTargetLoc(battle, side, activeSlot, line.split('|')[4]);
      const suffix = targetLocSuffixForChoice(
        battle,
        active,
        moveName,
        targetLoc,
      );
      return `${moveChoiceForActive(active, moveName)}${suffix}${gimmickSuffixForSlot(events, ident, active)}`;
    }

    if (line.startsWith(`|cant|${ident}`)) {
      const choice = choiceFromCant(events, line, ident, battle, battle.sides[sideIdx].active[activeSlot]);
      if (choice) return choice;
    }
  }

  return defaultChoiceForSlot(events, ident, battle, battle.sides[sideIdx].active[activeSlot]);
}

/**
 * No action line for the slot: the body flinched, slept, was fully
 * paralyzed, or fell before it moved. A gimmick clicked on that turn still
 * happened (the sim resolves it before any move runs), so the fallback
 * carries it like the branches above: 8 of 207 Tera clicks over the bank's
 * replays took this path and left 13 positions one Tera body short (round
 * 54). `pass` takes no modifier, the sim rejects it.
 */
function defaultChoiceForSlot(events: string[], ident: string, battle: SimBattle, active: SimPokemon | null | undefined): string {
  const fallback = defaultMoveChoice(battle, active);
  return fallback.startsWith('move ') ? `${fallback}${gimmickSuffixForSlot(events, ident, active)}` : fallback;
}

/**
 * A |cant| that names a move is the choice the player committed before it
 * was blocked (same-turn Taunt, Imprison, flinch). Falling through to
 * `move 1` instead played Uxie's U-turn on a taunted Stealth Rock turn and
 * pulled the pivot switch a turn early — the first domino of a replay-wide
 * desync. A reason-only |cant| (slp, par) keeps scanning: a Sleep Talk
 * turn carries both that line and the |move| line the scan should find, and
 * so does a |cant| with [of], the blocker's line (Dazzling, Queenly Majesty,
 * Armor Tail) about the foe's move (round 67, T108). Undefined: scan on.
 */
function choiceFromCant(
  events: string[], line: string, ident: string, battle: SimBattle, active: SimPokemon | null | undefined,
): string | undefined {
  const shownMove = line.includes('[of]') ? undefined : line.split('|')[4]?.trim();
  if (!shownMove) return undefined;
  const moveName = active && !knowsMove(active, shownMove) ? clickBehindBlockedMove(active, shownMove) : shownMove;
  if (!moveName) return defaultChoiceForSlot(events, ident, battle, active);
  const suffix = targetLocSuffixForChoice(battle, active, moveName, 0);
  return `${moveChoiceForActive(active, moveName)}${suffix}${gimmickSuffixForSlot(events, ident, active)}`;
}

export function getMainChoice(events: string[], side: 'p1' | 'p2', battle: SimBattle): string {
  const sideIdx = sideIndex(side);
  const actives = battle.sides[sideIdx].active;
  const choices = actives.map((_, activeSlot) => getChoiceForSlot(events, side, activeSlot, battle));
  return choices.length > 0 ? choices.join(', ') : 'move 1';
}

export { collectForcedSwitchSpecies } from './forced-request.ts';
