import type { PokemonIdent, SimBattle, SimPokemon, SimSide, TurnBlock } from './types.ts';
import { formatTargetLoc, slotLetter } from './team-order.ts';
import { sameBodyForme } from './body-forme.ts';
import { answersForcedRequest } from './forced-request.ts';
import { cantStandIn } from './cant-stand-in.ts';
import { isRelayedMoveLine } from './relayed-move.ts';
import { actionPriority, activated } from '../sim-ask/index.ts';
import { firstLegalTargetLoc, hiddenTargetLoc, protocolTargetLoc, targetLocSuffixForChoice, targetTypeForMove, type Aiming } from './target-loc.ts';

export { targetLocSuffixForChoice, targetTypeForMove };
import { nextChoosingSlot } from '../forward/request-moves.ts';
import { sideIndex, toId } from '@fulllifegames/replay-core';

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

/** Round 88 (#103): whether a bench body is the species by the Dex of its battle (one body in another forme counts) or by its name. */
function isSpeciesBody(pokemon: SimPokemon, species: string): boolean {
  return sameBodyForme(pokemon.battle.dex, pokemon.species?.name, species) || toId(pokemon.name || '') === toId(species);
}

/**
 * The party slot (1-based) of the living bench body that is `species`, or null. `taken`: slots another answer of the same choice sent
 * already (the simulator refuses one body in two slots: "can only switch in once").
 */
export function findSpeciesSlot(battle: SimBattle, sideIdx: number, species: string, taken?: ReadonlySet<number>): number | null {
  const side = battle.sides[sideIdx];
  // An empty id (a name without Latin letters) is no key: it is a prefix of every species.
  if (toId(species) === '') return null;

  // Round 89 (#118): the Dex only. The second pass (a shared prefix of the ids) tied Mew to Mewtwo and Porygon to Porygon2; over 7,032 corpus
  // games it answered one lookup, Greninja-Ash against a "Greninja" slot, which `formeFamily` now ties through the Dex.
  const index = side.pokemon.findIndex((pokemon, at) => !pokemon.isActive && !pokemon.fainted && !taken?.has(at + 1) && isSpeciesBody(pokemon, species));
  return index >= 0 ? index + 1 : null;
}

export function findSlotBySpecies(battle: SimBattle, sideIdx: number, species: string, taken?: ReadonlySet<number>): number {
  return findSpeciesSlot(battle, sideIdx, species, taken) ?? findFirstAvailableSwitchSlot(battle, sideIdx, taken);
}

/** Round 89 (#144, b): `taken` skips the bench bodies another answer of the same choice sent. */
export function findFirstAvailableSwitchSlot(battle: SimBattle, sideIdx: number, taken?: ReadonlySet<number>): number {
  const side = battle.sides[sideIdx];
  for (let i = 0; i < side.pokemon.length; i++) {
    if (!side.pokemon[i].isActive && !side.pokemon[i].fainted && !taken?.has(i + 1)) return i + 1;
  }
  return 2;
}

/**
 * Round 89 (#131): the party slot (1-based) of the fainted body a Revival Blessing request brings back: the body the log names (by the
 * name the simulator carries, else by species), else the first fainted body that is not taken, which is the body the simulator's own
 * `default` revives. Null where the party has none.
 */
export function findFaintedSlot(battle: SimBattle, sideIdx: number, name: string | undefined, taken?: ReadonlySet<number>): number | null {
  const side = battle.sides[sideIdx];
  const fainted = (pokemon: SimPokemon, at: number) => !pokemon.isActive && pokemon.fainted && !taken?.has(at + 1);
  const named = name ? side.pokemon.findIndex((pokemon, at) => fainted(pokemon, at) && pokemon.name === name) : -1;
  const kin = named >= 0 || !name || toId(name) === '' ? named : side.pokemon.findIndex((pokemon, at) => fainted(pokemon, at) && isSpeciesBody(pokemon, name));
  const index = kin >= 0 ? kin : side.pokemon.findIndex(fainted);
  return index >= 0 ? index + 1 : null;
}

/** A body by the exact name the simulator carries (the replay's own), else by species or by the id of its name; an empty id is no key. */
export function findPokemonOnSide(side: SimSide, species: string): SimPokemon | null {
  const exact = species ? side.pokemon.find(pokemon => pokemon.name === species) : undefined;
  if (exact || toId(species) === '') return exact ?? null;
  return side.pokemon.find(pokemon => isSpeciesBody(pokemon, species)) ?? null;
}

/**
 * The slot's default when its protocol shows no action: `pass` for a slot the sim itself passes (fainted, or a Tatsugiri
 * commanding a Dondozo: side.js getChoiceIndex, read through `nextChoosingSlot`), else the enabled move of the lowest priority
 * at 0 or below, else the first enabled move. A `move` for a commanding slot went to the partner's slot, the sim rejected the
 * side's whole choice, and the half-built choice counted as done, so no repair committed the turn (round 72, T246c).
 * Round 88 (T325, #61): the log shows no action because the body fainted before it moved or flinched, so the foe acted first,
 * and the first move (Fake Out, Shadow Sneak, Protect) could run ahead of the foe the log shows first (653785 t23, 2628340185
 * t23, 2663093831 t9 and t10, 2695803506 t1, 2629703929 t9). The slowest move keeps the logged order, as it does for a body that
 * switched out before it acted.
 * Round 89 (#111): "slowest" is the simulator's priority of the action, not the Dex's (`actionPriority`: Prankster, Gale Wings, Triage,
 * Stall, Quick Draw and the rest of the handlers change the queue's order), and there is no cut at 0: a body that knows only priority
 * moves takes the slowest of them, as its order is the nearest to the logged one.
 * Round 88 (X2): a body whose turn shows a `|cant|` line (a flinch, a full paralysis) has its place in the log's order, so the
 * slowest move can put it behind an action the log shows after that line (2663093831 t9: Trick Room, -7, put p1's Sinistcha behind
 * the Shadow Ball that knocked it out, and its flinch never came): `cantStandIn` reads the move that keeps its place.
 */
function defaultMoveChoice(battle: SimBattle, active: SimPokemon | null | undefined, events: string[] = [], ident = ''): string {
  if (!active || nextChoosingSlot(active.side, active.position) !== active.position) return 'pass';
  const firstMove = active.moveSlots[0];
  if (!firstMove) return 'pass';
  // `move N` resolves against the request's entries, not `moveSlots`: on a
  // locked request the two differ, and the entry has no target. The default
  // is the first ENABLED entry: a choice-locked body that flinched
  // (gen9vgc2026regi-2630452654 t4, Miraidon locked into Snarl) had `move 1`
  // disabled, and the rejected side choice cost its partner the Encore.
  const requestMoves = active.getMoveRequestData().moves;
  const slowest = cantStandIn(battle, active, events, ident) ?? slowestRequestMove(active, events);
  const slowestIndex = slowest ? requestMoves.findIndex(move => move.id === slowest) : -1;
  const enabledIndex = slowestIndex >= 0 ? slowestIndex : Math.max(0, requestMoves.findIndex(move => !move.disabled));
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
 * choice, as before round 55. Round 89 (#111): "priority 0 or below" is the simulator's bracket of the action (`actionPriority`), so a
 * Prankster status move (Dex 0, queue +1) is cut like a Protect.
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

  return slowestRequestMove(active, events, { exceptId: toId(shownMove), cutAtZero: true });
}

/** Whether the body's request or move slots carry the move. */
function knowsMove(active: SimPokemon, moveName: string): boolean {
  const moveId = toId(moveName);
  return active.getMoveRequestData().moves.some(move => move.id === moveId || toId(move.move) === moveId) ||
    active.moveSlots.some(slot => toId(slot.id || slot.move) === moveId);
}

/**
 * Round 89 (#143): the move to send for a move the log shows. The simulator refuses a move the body's request lacks and a move the request
 * marks disabled (`side.js` chooseMove), and a refusal sends the whole side's `default`: a logged switch does not happen, a Tera or Mega
 * click is lost, and the partner loses its action. The Struggle of a Choice-locked body, a move an Encore then a Disable ended, a drifted
 * volatile and a move at 0 PP reach it. A move the request offers enabled stays. One it lacks or disables becomes a stand-in of the
 * request by the rule of `clickBehindBlockedMove` (the first enabled move of the shown move's Dex category and the simulator's
 * `actionPriority`, else the slowest). A Z-move or Max move that the request offers (`canZMove`, `maxMoves`) stays: the simulator maps its
 * name onto the base move (`side.js` 423-434). No stand-in (no enabled move): the shown move, refused as before.
 */
function playableMove(active: SimPokemon | null | undefined, moveName: string, events: string[]): string {
  if (!active) return moveName;
  const moveId = toId(moveName);
  const request = active.getMoveRequestData() as ReturnType<SimPokemon['getMoveRequestData']> & {
    canZMove?: ({ move: string } | null)[]; maxMoves?: { maxMoves?: { move: string }[] };
  };
  const entry = request.moves.find(move => move.id === moveId || toId(move.move) === moveId);
  if (entry) return entry.disabled ? clickBehindBlockedMove(active, moveName, events) ?? moveName : moveName;
  const gimmickMoves = [...(request.canZMove ?? []).map(move => move?.move), ...(request.maxMoves?.maxMoves ?? []).map(move => move.move)];
  if (gimmickMoves.some(move => move && toId(move) === moveId)) return moveName;
  return clickBehindBlockedMove(active, moveName, events) ?? moveName;
}

/**
 * The click behind a `|cant|` move the body's set lacks (round 67, T108). The
 * move never ran: its blocker stopped it. The stand-in is one of the body's
 * own moves the same blocker stops, the first enabled request move with the
 * shown move's Dex category and the simulator's priority of the action, `actionPriority` (752301 t1: Landorus, built without
 * Taunt, clicks Stealth Rock, and the same-turn Taunt stops it as it stopped
 * the Taunt in the game); else the slowest move. Null: no enabled move.
 */
function clickBehindBlockedMove(active: SimPokemon, shownMove: string, events: string[]): string | null {
  const dex = active.battle.dex;
  const shown = dex.moves.get(shownMove);
  const chance = activated(active.battle, active, events);
  const shownPriority = actionPriority(active.battle, active, shown.id, chance);
  const alike = active.getMoveRequestData().moves.find(entry => {
    const move = dex.moves.get(entry.id);
    return !entry.disabled && move.category === shown.category && actionPriority(active.battle, active, entry.id, chance) === shownPriority;
  });
  return alike?.id ?? slowestRequestMove(active, events);
}

/**
 * Round 89 (#111): the request's enabled move that stands last in the simulator's queue (`actionPriority` of the body, the first of a tie),
 * the order a body whose log shows no action keeps behind the foe's logged one. The chance answer is the turn's own: yes when its lines show
 * the activation of the body's Quick Claw, Custap Berry or Quick Draw (`activated`). No cut at 0 unless `cutAtZero` (the Encore stand-in:
 * its click ran after the Encore, so a move of a higher bracket is no click), and `exceptId` leaves one move out. Null: no such move.
 */
function slowestRequestMove(active: SimPokemon, events: string[], { exceptId = '', cutAtZero = false } = {}): string | null {
  const chance = activated(active.battle, active, events);
  let standIn: { id: string; priority: number } | null = null;
  for (const entry of active.getMoveRequestData().moves) {
    if (entry.id === exceptId || entry.disabled) continue;
    const priority = actionPriority(active.battle, active, entry.id, chance);
    if (cutAtZero && Math.floor(priority) > 0) continue;
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

/**
 * The click a `|move|` line of the slot shows. The aim is the log's target; a line that hides its target (a move the game stopped before it
 * animated) asks the simulator which aim makes the move fail as logged (round 89, #136), and an aim answered earlier stands.
 */
function choiceFromMoveLine(
  events: string[], lineIndex: number, line: string, side: 'p1' | 'p2', activeSlot: number, battle: SimBattle, aiming: Aiming,
): string {
  const ident = `${side}${slotLetter(activeSlot)}:`;
  const active = battle.sides[sideIndex(side)].active[activeSlot];
  const shown = line.split('|')[3];
  const clicked = clickBehindEncore(events, lineIndex, ident, active, shown);
  const moveName = playableMove(active, clicked ?? shown, events);
  const loggedLoc = clicked ? 0 : protocolTargetLoc(battle, side, activeSlot, line.split('|')[4]);
  const asked = loggedLoc === 0 && !clicked && moveName === shown
    ? hiddenTargetLoc(line, side, activeSlot, battle, moveName, aiming, (owner, slot, inner) => getChoiceForSlot(events, owner, slot, battle, inner))
    : loggedLoc;
  const targetLoc = aiming.resolved.get(ident.slice(0, -1)) ?? asked;
  const suffix = targetLocSuffixForChoice(battle, active, moveName, targetLoc);
  return `${moveChoiceForActive(active, moveName)}${suffix}${gimmickSuffixForSlot(events, ident, active)}`;
}

function getChoiceForSlot(
  events: string[],
  side: 'p1' | 'p2',
  activeSlot: number,
  battle: SimBattle,
  aiming: Aiming = { ask: false, resolved: new Map() },
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
        const standIn = active ? slowestRequestMove(active, events) : null;
        if (!standIn) break;
        const suffix = targetLocSuffixForChoice(battle, active, standIn, 0);
        return `${moveChoiceForActive(active, standIn)}${suffix}${gimmickSuffixForSlot(events, ident, active)}`;
      }
      const species = line.split('|')[3].split(',')[0].trim();
      return `switch ${findSlotBySpecies(battle, sideIdx, species)}`;
    }

    // A move another effect dispatched for the body (Magic Bounce, Dancer, Magic Coat, Snatch) is no click: the body's own line comes
    // later in the block, or the body did not click a move (round 89, #135).
    if (line.startsWith(`|move|${ident}`) && !isRelayedMoveLine(line, battle.dex)) {
      return choiceFromMoveLine(events, lineIndex, line, side, activeSlot, battle, aiming);
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
  const fallback = defaultMoveChoice(battle, active, events, ident);
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
  // Round 89 (#143): an Encore before the `cant` line bent the click, and the line shows the encored move, not the click.
  const encored = clickBehindEncore(events, events.indexOf(line), ident, active, shownMove);
  const asked = encored ?? (active && !knowsMove(active, shownMove) ? clickBehindBlockedMove(active, shownMove, events) : shownMove);
  if (!asked) return defaultChoiceForSlot(events, ident, battle, active);
  const moveName = playableMove(active, asked, events);
  const suffix = targetLocSuffixForChoice(battle, active, moveName, 0);
  return `${moveChoiceForActive(active, moveName)}${suffix}${gimmickSuffixForSlot(events, ident, active)}`;
}

export function getMainChoice(events: string[], side: 'p1' | 'p2', battle: SimBattle): string {
  const sideIdx = sideIndex(side);
  const actives = battle.sides[sideIdx].active;
  const aiming: Aiming = { ask: true, resolved: new Map() };
  const choices = actives.map((_, activeSlot) => getChoiceForSlot(events, side, activeSlot, battle, aiming));
  return choices.length > 0 ? choices.join(', ') : 'move 1';
}

export { collectForcedSwitchSpecies } from './forced-request.ts';
