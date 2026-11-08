import type { BranchSlotChoice } from '../branch-choices.ts';
import type { BranchChoiceErrorLog, BranchExecuteResult, BranchRuntime, SimBattle, SimPokemon } from './types.ts';
import type { PendingTurn } from '../dice/turn.ts';
import type { DiceReport } from '../dice/types.ts';
import { findByName, sameBodyName, slotLetter } from './team-order.ts';
import { sameBodyForme } from './body-forme.ts';
import { targetLocSuffixForChoice } from './protocol-choices.ts';
import { sideIndex, toId } from '@fulllifegames/replay-core';

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Guarded stream write: a sim crash inside write() (old-gen mods throw on
 * odd states) must surface via `record` — both the synchronous throw and
 * the async rejection — instead of escaping as an unhandled rejection.
 * write() returns void on the buffered path and a promise otherwise.
 */
export function safeStreamWrite(
  stream: { write(data: string): void | Promise<void> },
  payload: string,
  record: (error: unknown) => void,
): void {
  try {
    void Promise.resolve(stream.write(payload)).catch(record);
  } catch (error) {
    record(error);
  }
}

export type ResolvedSideCommand =
  | { ok: true; command: string }
  | { ok: false; error: string };

function resolveMoveSlotChoice(
  battle: SimBattle,
  side: 'p1' | 'p2',
  activeSlot: number,
  choice: Extract<BranchSlotChoice, { kind: 'move' }>,
): ResolvedSideCommand {
  const sideIdx = sideIndex(side);
  const active = battle.sides[sideIdx].active[activeSlot];
  if (!active || active.fainted) {
    return { ok: false, error: `No active Pokémon in ${side.toUpperCase()}${slotLetter(activeSlot).toUpperCase()} can use ${choice.moveName}.` };
  }

  const requestMoves = active.getMoveRequestData().moves;
  const requestIndex = requestMoves.findIndex(move =>
    move.id === choice.moveId || toId(move.move) === choice.moveId
  );
  if (requestIndex < 0) {
    return { ok: false, error: `${describePokemon(active)} no longer knows ${choice.moveName}.` };
  }
  // The slot's own flag counts too: a hidden disable stays out of a singles request (the player cannot know it), the simulator refuses it all the same.
  const ownSlot = active.moveSlots.find(slot => slot.id === requestMoves[requestIndex].id);
  if (requestMoves[requestIndex].disabled || ownSlot?.disabled) {
    return { ok: false, error: `${choice.moveName} is disabled for ${describePokemon(active)} right now.` };
  }

  const suffix = targetLocSuffixForChoice(battle, active, choice.moveName, choice.targetLoc ?? 0);
  const modifier = choice.modifier ? ` ${choice.modifier}` : '';
  return { ok: true, command: `move ${requestIndex + 1}${suffix}${modifier}` };
}

/** The slot's body when the simulator holds it: a held body cannot switch out in a move request (side.js chooseSwitch); a forced replacement is no switch out. */
function heldBody(battle: SimBattle, sideIdx: number, activeSlot: number): SimPokemon | null {
  const side = battle.sides[sideIdx];
  const body = side.active[activeSlot];
  return side.requestState === 'move' && body && !body.fainted && body.trapped ? body : null;
}

/**
 * Round 88 (#103): how well a bench body fits the clicked species, 0 best, -1 not at all. A body is the species' kin when the Dex ties the two
 * (one body in another forme: Ogerpon-Teal-Tera for Ogerpon, a Mega for its base) or its name is the species' id. The order: kin with the exact
 * name, kin with the same name by id, any kin, then a body by its name alone (Shaymin-Sky frozen back to Shaymin keeps its name and no Dex tie).
 */
function switchRank(battle: SimBattle, pokemon: SimPokemon, choice: Extract<BranchSlotChoice, { kind: 'switch' }>): number {
  const kin = sameBodyForme(battle.dex, pokemon.species?.name, choice.speciesId) || toId(pokemon.name || '') === choice.speciesId;
  const exactName = !!choice.pokemonName && pokemon.name === choice.pokemonName;
  const sameName = sameBodyName(pokemon.name, choice.pokemonName);
  if (kin) return exactName ? 0 : sameName ? 1 : 2;
  return exactName ? 3 : sameName ? 4 : -1;
}

function resolveSwitchSlotChoice(
  battle: SimBattle,
  side: 'p1' | 'p2',
  activeSlot: number,
  choice: Extract<BranchSlotChoice, { kind: 'switch' }>,
): ResolvedSideCommand {
  const sideIdx = sideIndex(side);
  const bench = battle.sides[sideIdx].pokemon;
  const held = heldBody(battle, sideIdx, activeSlot);
  if (held) return { ok: false, error: `${describePokemon(held)} is trapped and cannot switch out right now.` };

  const ranked = bench.flatMap((pokemon, index) => {
    const rank = pokemon.isActive || pokemon.fainted ? -1 : switchRank(battle, pokemon, choice);
    return rank >= 0 ? [{ index, rank }] : [];
  });
  const picked = ranked.reduce<{ index: number; rank: number } | undefined>((best, entry) => (!best || entry.rank < best.rank ? entry : best), undefined);
  if (picked) return { ok: true, command: `switch ${picked.index + 1}` };
  const named = findByName(bench, pokemon => pokemon.name, choice.pokemonName);
  return { ok: false, error: `${named ? describePokemon(named) : choice.pokemonName} is no longer available to switch in.` };
}

/** "Sludge Shadow (Muk-Alola)" — draft nicknames alone explain nothing. */
function describePokemon(pokemon: SimPokemon): string {
  const species = pokemon.species?.name || '';
  if (!species || toId(pokemon.name || '') === toId(species)) return pokemon.name || species;
  return `${pokemon.name} (${species})`;
}

/**
 * Simulator error messages speak in nicknames — append the species after
 * every nicknamed Pokémon mentioned so the message stays decodable.
 */
export function annotateNicknames(message: string, battle: SimBattle | null | undefined): string {
  if (!battle) return message;
  let annotated = message;
  const nicknamed = battle.sides
    .flatMap(side => side.pokemon)
    .filter(pokemon => pokemon.name && pokemon.species?.name && toId(pokemon.name) !== toId(pokemon.species.name))
    .sort((a, b) => b.name.length - a.name.length);
  for (const pokemon of nicknamed) {
    if (annotated.includes(pokemon.name) && !annotated.includes(`${pokemon.name} (`)) {
      annotated = annotated.split(pokemon.name).join(`${pokemon.name} (${pokemon.species.name})`);
    }
  }
  return annotated;
}

/**
 * Resolves identity-based slot choices (move ids, switch species) into the
 * position-index commands the sim expects — always against the live request,
 * so rebuilt teams or forced-switch interludes can never make a stored index
 * point at the wrong move (B1).
 */
export function resolveSideChoices(
  battle: SimBattle,
  side: 'p1' | 'p2',
  choices: (BranchSlotChoice | null)[],
  required: boolean[],
): ResolvedSideCommand {
  const fragments: string[] = [];

  for (let slot = 0; slot < Math.max(required.length, 1); slot++) {
    if (!required[slot]) {
      fragments.push('pass');
      continue;
    }
    const choice = choices[slot];
    if (!choice) {
      return { ok: false, error: `Missing choice for ${side.toUpperCase()}${slotLetter(slot).toUpperCase()}.` };
    }
    const resolved = choice.kind === 'move'
      ? resolveMoveSlotChoice(battle, side, slot, choice)
      : resolveSwitchSlotChoice(battle, side, slot, choice);
    if (!resolved.ok) return resolved;
    fragments.push(resolved.command);
  }

  return { ok: true, command: fragments.join(', ') };
}

/** The commands on a copy of the battle, as the stream writes them to the live one; a refused choice ends the play. */
function chooseOnCopy(battle: SimBattle, commands: { side: 'p1' | 'p2'; command: string }[]): void {
  for (const { side, command } of commands) {
    if (battle.choose(side, command)) continue;
    throw new Error(battle.sides[sideIndex(side)].choice.error || 'The simulator rejected this choice.');
  }
}

async function playWithDice(
  dice: BranchDiceTurn, pending: PendingTurn | undefined, commands: { side: 'p1' | 'p2'; command: string }[],
  play: (battle: SimBattle) => void,
): Promise<{ ok: true; report: DiceReport | undefined; pending: PendingTurn | null } | { ok: false; error: string }> {
  const { playBranchTurn } = await import('../dice/turn.ts');
  try {
    const played = playBranchTurn({ battle: dice.battle, commands, p1Choices: dice.p1Choices, p2Choices: dice.p2Choices, pending, play });
    return { ok: true, report: played.report, pending: played.pending };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Round 82 (forced dice): the turns that paused for a switch in the middle, by battle. The forced dice of the turn wait here for
 * the call that goes on (the forced replacement), which plays the rest of the turn.
 */
const pendingTurns = new WeakMap<object, PendingTurn>();

/** What a call needs to play a turn with forced dice: the live battle and the slot choices the dice ride on. */
export interface BranchDiceTurn {
  battle: SimBattle;
  p1Choices: (BranchSlotChoice | null)[];
  p2Choices: (BranchSlotChoice | null)[];
}

const carriesDice = (turn: BranchDiceTurn): boolean => [...turn.p1Choices, ...turn.p2Choices].some(choice => (choice?.dice?.length ?? 0) > 0);

/**
 * Round 82 (forced dice), gate answer 2a: a branch's first turn always joins the log's visible results. The first turn is the
 * move request of the turn the live PRNG (a `LoggedRollPRNG`) knows the logged lines of; the dice module reads the rest from it.
 * Read by shape: this file keeps type-only imports of the dice module and of the PRNG classes.
 */
function joinsLog(battle: SimBattle): boolean {
  const logged = (battle.prng as { loggedTurn?: { turn: number } | null }).loggedTurn;
  return battle.requestState === 'move' && !!logged && logged.turn === battle.turn;
}

/**
 * Writes the turn's commands to the sim: through the stream as always, or, for a turn with forced dice (the slot choices carry
 * one, dice are pending from a turn that paused for a switch, or it is the branch's first turn and joins the log), through the dice module, which plays the turn on a copy of the
 * battle first and then on the live one.
 */
async function dispatchTurn(
  params: Parameters<typeof executeBranchChoices>[0], record: (error: unknown) => void,
): Promise<{ ok: true; report?: DiceReport } | { ok: false; error: string }> {
  const { streams, commands, dice } = params;
  const payload = commands.map(({ side, command }) => `>${side} ${command}`).join('\n');
  const pending = dice ? pendingTurns.get(dice.battle) : undefined;
  if (!dice || (!pending && !carriesDice(dice) && !joinsLog(dice.battle))) {
    if (dice) pendingTurns.delete(dice.battle);
    safeStreamWrite(streams.omniscient, payload, record);
    return { ok: true };
  }
  const outcome = await playWithDice(dice, pending, commands, battle => {
    if (battle === dice.battle) safeStreamWrite(streams.omniscient, payload, record);
    else chooseOnCopy(battle, commands);
  });
  if (!outcome.ok) return outcome;
  if (outcome.pending) pendingTurns.set(dice.battle, outcome.pending);
  else pendingTurns.delete(dice.battle);
  return { ok: true, report: outcome.report };
}

/**
 * Writes side commands to the sim and waits for the outcome. Succeeds when the
 * omniscient log grows (the sim committed and simulated); fails when the sim
 * rejects a choice (`|error|` sideupdate) or never responds within the timeout,
 * so callers can keep the user's choices and surface the message instead of
 * failing silently.
 *
 * `dice` (round 82, forced dice) names the live battle and the slot choices of both sides. A turn whose choices carry a forced
 * die, that goes on after a pause for a switch with dice pending, or that is the branch's first turn (it joins the log's results,
 * gate answer 2a), plays through the dice module (a dynamic import: a later turn without a forced die runs the code below as
 * it always did). The result then carries the report of the user's dice.
 */
export async function executeBranchChoices(params: {
  streams: BranchRuntime['streams'];
  log: string[];
  choiceErrors: BranchChoiceErrorLog;
  commands: { side: 'p1' | 'p2'; command: string }[];
  timeoutMs?: number;
  dice?: BranchDiceTurn;
}): Promise<BranchExecuteResult> {
  const { log, choiceErrors, timeoutMs = 1500 } = params;
  const previousLogLength = log.length;
  const previousErrorCount = choiceErrors.count;

  // Surface sim crashes as choice errors instead of unhandled rejections.
  const record = (error: unknown) => {
    choiceErrors.count += 1;
    choiceErrors.last = error instanceof Error ? error.message : String(error);
  };
  const dispatched = await dispatchTurn(params, record);
  if (!dispatched.ok) return dispatched;
  const report = dispatched.report;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (choiceErrors.count > previousErrorCount) {
      return { ok: false, error: choiceErrors.last || 'The simulator rejected this choice.' };
    }
    if (log.length > previousLogLength) {
      // Wait for the log to go quiet so end-of-turn residuals (poison faints,
      // weather) are included before the caller snapshots state/log.
      let lastLength = log.length;
      let stableSince = Date.now();
      while (Date.now() - stableSince < 60 && Date.now() < deadline) {
        await sleep(15);
        if (log.length !== lastLength) {
          lastLength = log.length;
          stableSince = Date.now();
        }
      }
      return report ? { ok: true, dice: report } : { ok: true };
    }
    await sleep(25);
  }

  return { ok: false, error: 'The simulator did not respond to this choice.' };
}
