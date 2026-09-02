import { Battle, BattleStreams, Dex, Teams } from '@pkmn/sim';
import type { ID, PokemonSet } from '@pkmn/sim';
import type { TurnSnapshot } from '../types';
import type { BranchSlotChoice } from './branch-choices';
import type { ChoiceLockContext } from './choice-lock';
import { serializeBattleStable, trialAdvanceLog } from './eval/forward-model';
import {
  ALIGNMENT_SEEDS, chooseAlignedSeed, extractProtocolEvents, scoreAlignment,
  type SeedChoice, type TurnAlignmentRecord,
} from './hax-alignment';
import type {
  BranchChoiceErrorLog, BranchChoices, BranchExecuteResult, BranchMoveOption, BranchRuntime,
  BranchSimState, BranchSlotModifiers, BranchSwitchOption, BranchTargetOption, PokemonIdent, PokemonStatTable,
  SimBattle, SimPokemon, SimPokemonInfo, SimSide,
} from './branch/types';
import { normalizeBattleOnlyFormeId, reorderForLeads, slotLetter, toId, trimTeamToBring } from './branch/team-order';
import {
  collectForcedSwitchSpecies, extractLeads, getMainChoice, parseTurnBlocks, targetLocSuffixForChoice, targetTypeForMove,
} from './branch/protocol-choices';
import {
  buildForcedSwitchChoice, correctActivesFromProtocol, correctBattleFromSnapshot, forceSwitches, hasForceSwitch,
  hasStaleForcedSwitchRequest, refreshRequestsFromLiveState, repairStaleForcedSwitchRequest,
} from './branch/corrections';
import { replaceLogWithReplayPrefix, syncLogActivesFromBattle } from './branch/log-sync';

export { correctActivesFromProtocol } from './branch/corrections';

export type {
  BranchChoiceErrorLog, BranchExecuteResult, BranchFieldState, BranchMoveOption, BranchRuntime, BranchSimState,
  BranchSlotModifiers, BranchSwitchOption, BranchTargetOption, PokemonStatTable, SimPokemonInfo,
} from './branch/types';

// @pkmn/sim's random-format rulesets reference Node's `global` object (e.g.
// `global.Config?.potd` in rulesets), which doesn't exist in browsers and made
// every Random Battle branch die with an uncaught ReferenceError (B2).
if (typeof (globalThis as Record<string, unknown>).global === 'undefined') {
  (globalThis as Record<string, unknown>).global = globalThis;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function statTableWithDefaults(
  value: Partial<PokemonStatTable> | undefined,
  fallback: PokemonStatTable,
): PokemonStatTable {
  return {
    hp: value?.hp ?? fallback.hp,
    atk: value?.atk ?? fallback.atk,
    def: value?.def ?? fallback.def,
    spa: value?.spa ?? fallback.spa,
    spd: value?.spd ?? fallback.spd,
    spe: value?.spe ?? fallback.spe,
  };
}

const DEFAULT_EVS: PokemonStatTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const DEFAULT_IVS: PokemonStatTable = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

function makePokemonInfo(
  pokemon: SimPokemon,
  isActive = pokemon.isActive,
  activeSlot: number | null = null,
): SimPokemonInfo {
  return {
    name: pokemon.name,
    species: pokemon.species.name,
    hp: pokemon.hp,
    maxhp: pokemon.maxhp,
    hpPercent: pokemon.maxhp > 0 ? Math.round(pokemon.hp / pokemon.maxhp * 100) : 0,
    status: pokemon.status || '',
    fainted: pokemon.fainted,
    isActive,
    activeSlot,
    moves: pokemon.moveSlots.map(move => ({
      name: move.move,
      type: Dex.moves.get(move.id || move.move)?.type || '',
    })),
    // Display names, not sim ids: @smogon/calc matches abilities/items by
    // display name ('Technician'), so ids ('technician') silently disable
    // every ability/item damage modifier (B6).
    ability: pokemon.ability ? (Dex.abilities.get(pokemon.ability)?.name || pokemon.ability) : '',
    item: pokemon.item ? (Dex.items.get(pokemon.item)?.name || pokemon.item) : '',
    stats: {
      atk: pokemon.storedStats?.atk || 0,
      def: pokemon.storedStats?.def || 0,
      spa: pokemon.storedStats?.spa || 0,
      spd: pokemon.storedStats?.spd || 0,
      spe: pokemon.storedStats?.spe || 0,
    },
    nature: pokemon.set.nature || 'Hardy',
    evs: statTableWithDefaults(pokemon.set.evs, DEFAULT_EVS),
    ivs: statTableWithDefaults(pokemon.set.ivs, DEFAULT_IVS),
    gender: pokemon.gender || pokemon.set.gender || '',
    teraType: pokemon.terastallized || '',
    boosts: { ...pokemon.boosts },
    level: pokemon.level || 100,
    types: pokemon.types ? [...pokemon.types] : [],
  };
}

function extractPokemonInfo(side: SimSide): SimPokemonInfo[] {
  return side.pokemon.map(pokemon => {
    const activeSlot = side.active.findIndex(active => active === pokemon);
    return makePokemonInfo(pokemon, pokemon.isActive, activeSlot >= 0 ? activeSlot : null);
  });
}

function makeMoves(
  active: SimPokemon | null | undefined,
  activeSlot: number,
  forceSwitch: boolean,
  battle: SimBattle,
): BranchMoveOption[] {
  if (!active || active.fainted || forceSwitch) return [];
  return active.moveSlots.map((move, index): BranchMoveOption => {
    const moveData = Dex.moves.get(move.id || move.move);
    const targetType = targetTypeForMove(active, move.id || move.move);
    const targetOptions = buildTargetOptions(battle, active, targetType);
    return {
      name: move.move,
      activeSlot,
      slot: index + 1,
      pp: move.pp,
      maxpp: move.maxpp,
      disabled: !!move.disabled,
      type: moveData?.type || '',
      targetType,
      requiresTarget: targetOptions.length > 0,
      targetOptions,
    };
  });
}

function buildTargetOptions(
  battle: SimBattle,
  active: SimPokemon,
  targetType: string,
): BranchTargetOption[] {
  if (active.side.active.length < 2 || !battle.actions.targetTypeChoices(targetType)) return [];
  const targetLocs = Array.from({ length: battle.activePerHalf }, (_, index) => index + 1)
    .flatMap(loc => [loc, -loc]);

  return targetLocs
    .filter(targetLoc => battle.validTargetLoc(targetLoc, active, targetType))
    .map(targetLoc => {
      const target = active.getAtLoc(targetLoc);
      if (!target || target.fainted) return null;
      const targetSide = target.side.id as 'p1' | 'p2';
      return {
        label: `${targetSide.toUpperCase()}${slotLetter(target.position).toUpperCase()}`,
        targetLoc,
        side: targetSide,
        activeSlot: target.position,
        name: target.name,
        species: target.species.name,
        hpPercent: target.maxhp > 0 ? Math.round(target.hp / target.maxhp * 100) : 0,
      };
    })
    .filter((target): target is BranchTargetOption => !!target);
}

const EMPTY_SLOT_MODIFIERS: BranchSlotModifiers = {
  teraType: null,
  canMegaEvo: false,
  canUltraBurst: false,
  zMoves: [],
};

function makeSlotModifiers(battle: SimBattle, active: SimPokemon | null | undefined): BranchSlotModifiers {
  if (!active || active.fainted) return EMPTY_SLOT_MODIFIERS;

  // The sim maintains once-per-battle availability on the Pokémon itself
  // (consumed gimmicks are nulled there); Z availability is a dynamic check.
  const teraType = active.canTerastallize || null;
  const canMegaEvo = !!active.canMegaEvo;
  const canUltraBurst = !!active.canUltraBurst;
  let zMoves: (string | null)[] = [];
  try {
    zMoves = (battle.actions.canZMove(active) ?? []).map(option => option?.move ?? null);
  } catch {
    zMoves = [];
  }

  return { teraType, canMegaEvo, canUltraBurst, zMoves };
}

function makeSwitches(side: SimSide, activeSlot: number): BranchSwitchOption[] {
  const activeNames = new Set(side.active.filter(Boolean).map(active => active.name));
  return side.pokemon
    .map((pokemon, index): BranchSwitchOption => ({
      name: pokemon.name,
      species: pokemon.species.name,
      activeSlot,
      slot: index + 1,
      hp: `${pokemon.maxhp > 0 ? Math.round(pokemon.hp / pokemon.maxhp * 100) : 0}%`,
      hpPercent: pokemon.maxhp > 0 ? Math.round(pokemon.hp / pokemon.maxhp * 100) : 0,
      fainted: pokemon.fainted,
    }))
    .filter(pokemon => !pokemon.fainted && !activeNames.has(pokemon.name));
}

function normalizeChoices(
  choices: (BranchSlotChoice | null)[] | undefined,
  legacyChoice: BranchSlotChoice | null | undefined,
  activeCount: number,
): (BranchSlotChoice | null)[] {
  const normalized = Array.from({ length: Math.max(activeCount, 1) }, (_, index) => choices?.[index] ?? null);
  if (!choices && legacyChoice) normalized[0] = legacyChoice;
  return normalized;
}

function emptyState(log: string[], choices: BranchChoices): BranchSimState {
  const p1Choices = normalizeChoices(choices.p1Choices, choices.p1Choice, 1);
  const p2Choices = normalizeChoices(choices.p2Choices, choices.p2Choice, 1);

  return {
    p1Moves: [],
    p1MovesBySlot: [],
    p1Switches: [],
    p1SwitchesBySlot: [],
    p2Moves: [],
    p2MovesBySlot: [],
    p2Switches: [],
    p2SwitchesBySlot: [],
    p1Pokemon: [],
    p2Pokemon: [],
    p1Active: null,
    p1ActiveSlots: [],
    p2Active: null,
    p2ActiveSlots: [],
    p1ModifiersBySlot: [],
    p2ModifiersBySlot: [],
    field: { weather: '', terrain: '', p1SideConditions: [], p2SideConditions: [] },
    log,
    ended: false,
    winner: null,
    waitingForChoice: false,
    turnNumber: 0,
    p1ForceSwitch: false,
    p1ForceSwitches: [],
    p2ForceSwitch: false,
    p2ForceSwitches: [],
    p1Choice: p1Choices[0] ?? null,
    p1Choices,
    p2Choice: p2Choices[0] ?? null,
    p2Choices,
  };
}

export function createBranchState(
  battleStream: BattleStreams.BattleStream | null,
  log: string[],
  choices: BranchChoices,
): BranchSimState {
  return createBranchStateFromBattle(battleStream?.battle, log, choices);
}

/** Same picker state, but from a bare Battle — used for stored positions
 *  (deserialized without a stream) by the unified timeline's pickers. */
export function createBranchStateFromBattle(
  battle: SimBattle | null | undefined,
  log: string[],
  choices: BranchChoices,
): BranchSimState {
  const effectiveLog = log.length > 0 ? log : (battle?.log ?? []);
  if (!battle) return emptyState([...effectiveLog], choices);

  const p1ForceSwitches = forceSwitches(battle, 0);
  const p2ForceSwitches = forceSwitches(battle, 1);
  const p1ActiveSlots = battle.sides[0].active.map((active, index) => active ? makePokemonInfo(active, true, index) : null);
  const p2ActiveSlots = battle.sides[1].active.map((active, index) => active ? makePokemonInfo(active, true, index) : null);
  const p1MovesBySlot = battle.sides[0].active.map((active, index) =>
    makeMoves(active, index, p1ForceSwitches[index] ?? false, battle)
  );
  const p2MovesBySlot = battle.sides[1].active.map((active, index) =>
    makeMoves(active, index, p2ForceSwitches[index] ?? false, battle)
  );
  const p1SwitchesBySlot = battle.sides[0].active.map((_, index) => makeSwitches(battle.sides[0], index));
  const p2SwitchesBySlot = battle.sides[1].active.map((_, index) => makeSwitches(battle.sides[1], index));
  const p1Choices = normalizeChoices(choices.p1Choices, choices.p1Choice, p1ActiveSlots.length);
  const p2Choices = normalizeChoices(choices.p2Choices, choices.p2Choice, p2ActiveSlots.length);

  return {
    p1Moves: p1MovesBySlot[0] ?? [],
    p1MovesBySlot,
    p1Switches: p1SwitchesBySlot[0] ?? [],
    p1SwitchesBySlot,
    p2Moves: p2MovesBySlot[0] ?? [],
    p2MovesBySlot,
    p2Switches: p2SwitchesBySlot[0] ?? [],
    p2SwitchesBySlot,
    p1Pokemon: extractPokemonInfo(battle.sides[0]),
    p2Pokemon: extractPokemonInfo(battle.sides[1]),
    p1Active: p1ActiveSlots[0] ?? null,
    p1ActiveSlots,
    p2Active: p2ActiveSlots[0] ?? null,
    p2ActiveSlots,
    p1ModifiersBySlot: battle.sides[0].active.map(active => makeSlotModifiers(battle, active)),
    p2ModifiersBySlot: battle.sides[1].active.map(active => makeSlotModifiers(battle, active)),
    field: {
      weather: battle.field.weather || '',
      terrain: battle.field.terrain || '',
      p1SideConditions: Object.keys(battle.sides[0].sideConditions),
      p2SideConditions: Object.keys(battle.sides[1].sideConditions),
    },
    log: [...effectiveLog],
    ended: battle.ended,
    winner: battle.winner || null,
    waitingForChoice: !battle.ended && !!battle.requestState,
    turnNumber: battle.turn,
    p1ForceSwitch: p1ForceSwitches.some(Boolean),
    p1ForceSwitches,
    p2ForceSwitch: p2ForceSwitches.some(Boolean),
    p2ForceSwitches,
    p1Choice: p1Choices[0] ?? null,
    p1Choices,
    p2Choice: p2Choices[0] ?? null,
    p2Choices,
  };
}

/**
 * Position record for the unified timeline: the state AFTER an executed
 * entry, in the eval engine's stable serialization. Failure degrades to
 * null — the entry stays navigable via the sim log, it just cannot be
 * evaluated or picked from without a rebuild.
 */
export function captureSerializedPosition(battle: SimBattle | null | undefined): string | null {
  if (!battle) return null;
  try {
    return serializeBattleStable(battle);
  } catch {
    return null;
  }
}

/**
 * The turn-0 position: a fresh battle sitting at team preview, before either
 * side has ordered its team — the lead decision the eval engine can search.
 * Null for formats without team preview (older gens). Deterministic seed so
 * every caller serializes the identical position.
 */
export function serializePreviewPosition(
  format: string,
  p1Team: PokemonSet[],
  p2Team: PokemonSet[],
  /** Bring-limited replays: the preview holds only the brought species, so
   *  the lead enumeration prices real pairs instead of a phantom pool.
   *  Callers pass both sides or nothing; an unmatchable list keeps its
   *  side whole (same trim as the branch reconstruction). */
  bringOnly?: { p1: string[]; p2: string[] } | null,
): string | null {
  try {
    const battle = new Battle({
      // The raw format string, never toID: clause suffixes ride along as
      // "@@@Sleep Clause Mod", and toID mangles them into an unknown format
      // WITHOUT team preview — every draft replay lost its turn 0 that way.
      formatid: format as ID,
      seed: '1,2,3,4',
      p1: { name: 'p1', team: Teams.pack(trimTeamToBring(p1Team, bringOnly?.p1)) },
      p2: { name: 'p2', team: Teams.pack(trimTeamToBring(p2Team, bringOnly?.p2)) },
    });
    if (battle.sides[0]?.requestState !== 'teampreview') return null;
    return serializeBattleStable(battle);
  } catch {
    return null;
  }
}

/**
 * Guarded stream write: a sim crash inside write() (old-gen mods throw on
 * odd states) must surface via `record` — both the synchronous throw and
 * the async rejection — instead of escaping as an unhandled rejection.
 * write() returns void on the buffered path and a promise otherwise.
 */
function safeStreamWrite(
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

export async function reconstructBranchRuntime(params: {
  format: string;
  p1Team: PokemonSet[];
  p2Team: PokemonSet[];
  replayLog: string;
  targetTurn: number;
  snapshot?: TurnSnapshot | null;
  /** Real replay player names — sim sides and the winner line use them (G10). */
  playerNames?: [string, string];
  onLogLines?: (lines: string[]) => void;
  /** Reports replay progress while rebuilding towards the target turn (B17). */
  onProgress?: (turn: number, targetTurn: number) => void;
  /** Aborts the turn-replay loop early (Cancel button, B17). */
  abort?: AbortSignal;
  /** Overall replay deadline; a wedged reconstruction stops instead of hanging. */
  deadlineMs?: number;
  /**
   * Single-pass position capture (eval sweeps): at every turn boundary
   * before targetTurn the battle is snapshot-corrected and handed out, so
   * one reconstruction yields the whole game instead of one per turn.
   */
  capturePositions?: {
    snapshotFor(turn: number): TurnSnapshot | null;
    onPosition(turn: number, battle: SimBattle): void;
  };
  /**
   * Raw boundary hand-out (the calibration harness's single-pass path):
   * fired at the START of every block iteration — the exact spot where a
   * per-target reconstruction with targetTurn ≤ this block's turn exits
   * its loop — and hands out the UNCORRECTED live battle. The caller
   * clones and applies applyTargetCorrections itself, so the hand-out can
   * never change the ongoing replay: it stays byte-identical to what any
   * per-target run of the same replay plays.
   */
  onRawBoundary?: (blockTurn: number, battle: SimBattle) => void;
  /** Protocol-truth lock context (③): boundary corrections re-stamp from it. */
  choiceLocks?: ChoiceLockContext;
  /**
   * Turn-0 branching: start the game with THESE leads instead of the
   * replay's (species/names per side, slot order preserved — doubles sends
   * two; null or empty keeps the replay leads). Only meaningful with
   * targetTurn 1 and no snapshot corrections — a corrected boundary would
   * put the original leads right back on the field.
   */
  leadOverride?: { p1: string[] | null; p2: string[] | null };
  /**
   * Bring-limited formats (VGC's 4 of 6, BSS's 3 of 6): field ONLY these
   * species per side. The branch runs on a bring-all base format, which
   * would otherwise bench never-brought Pokémon for the engine — and every
   * evaluation and play-out on the live battle — to switch into. Fail-open:
   * a list that does not match the team exactly leaves the team whole.
   */
  bringOnly?: { p1: string[]; p2: string[] } | null;
}): Promise<BranchRuntime> {
  const { format, p1Team, p2Team, replayLog, targetTurn, snapshot, onLogLines, onProgress, abort, capturePositions } = params;
  const overallDeadline = Date.now() + (params.deadlineMs ?? 60_000);
  let timedOut = false;
  const { p1Leads, p2Leads } = extractLeads(replayLog);
  const leadsFor = (replayLeads: PokemonIdent[], override: string[] | null | undefined): PokemonIdent[] =>
    override && override.length > 0 ? override.map(name => ({ name, species: name })) : replayLeads;
  const orderedP1 = trimTeamToBring(reorderForLeads(p1Team, leadsFor(p1Leads, params.leadOverride?.p1)), params.bringOnly?.p1);
  const orderedP2 = trimTeamToBring(reorderForLeads(p2Team, leadsFor(p2Leads, params.leadOverride?.p2)), params.bringOnly?.p2);

  const battleStream = new BattleStreams.BattleStream();
  const streams = BattleStreams.getPlayerStreams(battleStream);
  const collectedLog: string[] = [];
  const choiceErrors: BranchChoiceErrorLog = { count: 0, last: null };
  const haxAlignment: TurnAlignmentRecord[] = [];

  // A sim crash (old-gen mods throw on odd states) rejects these detached
  // stream pumps — record it as a choice error so the turn-sync guard reacts
  // instead of the rejection escaping as an unhandled promise.
  const recordStreamError = (error: unknown) => {
    choiceErrors.count += 1;
    choiceErrors.last = error instanceof Error ? error.message : String(error);
  };

  void (async () => {
    try {
      for await (const chunk of streams.omniscient) {
        const lines = chunk.split('\n').filter(line => line.trim());
        collectedLog.push(...lines);
        onLogLines?.(lines);
      }
    } catch (error) {
      recordStreamError(error);
    }
  })();

  for (const sideStream of [streams.p1, streams.p2]) {
    void (async () => {
      try {
        for await (const chunk of sideStream) {
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('|error|')) continue;
            choiceErrors.count += 1;
            choiceErrors.last = line
              .slice('|error|'.length)
              .replace(/^\[(?:Invalid|Unavailable) choice\]\s*/, '');
          }
        }
      } catch (error) {
        recordStreamError(error);
      }
    })();
  }

  const p1Packed = Teams.pack(orderedP1);
  const p2Packed = Teams.pack(orderedP2);

  const waitForBattle = async (
    predicate: (battle: SimBattle) => boolean,
    timeoutMs = 1500,
  ) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const battle = battleStream.battle;
      if (battle && predicate(battle)) return;
      await sleep(10);
    }
  };

  const waitForLog = async (
    predicate: (log: string[]) => boolean,
    timeoutMs = 1000,
  ) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (predicate(collectedLog)) return;
      await sleep(10);
    }
  };

  const waitForLogIdle = async (idleMs = 50, timeoutMs = 500) => {
    const startedAt = Date.now();
    let lastLength = collectedLog.length;
    let stableSince = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      await sleep(10);
      if (collectedLog.length !== lastLength) {
        lastLength = collectedLog.length;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= idleMs) {
        return;
      }
    }
  };

  // A sim crash inside a write must surface as a choice error so the
  // turn-sync guard skips or stops instead of taking the process down.
  const writeSim = (payload: string) => safeStreamWrite(streams.omniscient, payload, recordStreamError);

  // A rejected replay choice (a team edit can remove the very move the
  // protocol used) must not abandon the turn half-chosen: the sim keeps the
  // other side's accepted choice pending, and the next write would commit the
  // turn with that stale choice — the branch then plays the user's choices one
  // commit late and a leftover switch fails with "A switch failed because the
  // Pokémon trying to switch in is already in." (gen9draft-2058494320 turn 4).
  // Answering the rejected sides with `default` commits the turn and keeps the
  // replay in lockstep; the snapshot corrections repair the aftermath.
  const commitRejectedChoicesWithDefaults = async (turnBeforeChoice: number) => {
    const battle = battleStream.battle;
    if (!battle || battle.ended || battle.turn > turnBeforeChoice) return;
    const pendingSides = battle.sides.filter(side => side.requestState && !side.isChoiceDone());
    if (pendingSides.length === 0) return;
    const retryErrors = choiceErrors.count;
    writeSim(pendingSides.map(side => `>${side.id} default`).join('\n'));
    await waitForBattle(currentBattle =>
      currentBattle.ended ||
      currentBattle.turn > turnBeforeChoice ||
      hasForceSwitch(currentBattle, 0) ||
      hasForceSwitch(currentBattle, 1) ||
      choiceErrors.count > retryErrors,
    );
  };

  // Turn-sync guard: choices must land on the turn that produced them. Once a
  // block fails to commit its turn, every later block would feed the sim
  // choices from the wrong turn — the HP corrections mask the drift while
  // structural state diverges (the GPL replay lost a pending Future Sight and
  // opened turn 25 with the wrong active, five blocks ahead of the sim).
  // Feed defaults until the sim stands at `wantedTurn`; a false return means
  // the battle is wedged and replaying further blocks would corrupt it.
  const advanceSimToTurn = async (wantedTurn: number): Promise<boolean> => {
    for (let attempts = 0; attempts < 12; attempts++) {
      const battle = battleStream.battle;
      if (!battle || battle.ended) return false;
      if (battle.turn >= wantedTurn) return true;
      if (abort?.aborted || Date.now() > overallDeadline) return false;

      const turnBefore = battle.turn;
      const pendingSides = battle.sides.filter(side => side.requestState && !side.isChoiceDone());
      if (pendingSides.length === 0) {
        // No open request — give in-flight writes a beat to surface one.
        await waitForBattle(current =>
          current.ended ||
          current.turn > turnBefore ||
          current.sides.some(side => side.requestState && !side.isChoiceDone()),
        250);
        const current = battleStream.battle;
        if (!current) return false;
        if (current.turn === turnBefore && !current.sides.some(side => side.requestState && !side.isChoiceDone())) {
          return false;
        }
        continue;
      }

      const errorsBefore = choiceErrors.count;
      writeSim(pendingSides.map(side => `>${side.id} default`).join('\n'));
      await waitForBattle(current =>
        current.ended ||
        current.turn > turnBefore ||
        choiceErrors.count > errorsBefore,
      );
      if (battleStream.battle?.turn === turnBefore && choiceErrors.count > errorsBefore) return false;
    }
    return (battleStream.battle?.turn ?? 0) >= wantedTurn;
  };

  const p1Name = JSON.stringify(params.playerNames?.[0]?.trim() || 'Player 1');
  const p2Name = JSON.stringify(params.playerNames?.[1]?.trim() || 'Player 2');
  // FIXED seed: an unseeded battle rerolls damage/secondary outcomes every
  // reconstruction, so the same replay+turn yielded DIFFERENT positions run
  // to run (diverged fallback paths, shuffled bench slots, wrong choice
  // locks) — the sweep's cached eval and the branch a click executes in
  // could disagree about what "switch 3" even is (draft T48).
  writeSim(
    `>start {"formatid":"${format}","seed":"1,2,3,4"}\n>player p1 {"name":${p1Name},"team":"${p1Packed}"}\n>player p2 {"name":${p2Name},"team":"${p2Packed}"}`
  );
  await waitForBattle(battle => !!battle.sides[0] && !!battle.sides[1], 1000);

  const setupBattle = battleStream.battle;
  const teamPreviewCommands: string[] = [];
  if (setupBattle?.sides[0]?.requestState === 'teampreview') {
    teamPreviewCommands.push('>p1 default');
  }
  if (setupBattle?.sides[1]?.requestState === 'teampreview') {
    teamPreviewCommands.push('>p2 default');
  }

  if (teamPreviewCommands.length > 0) {
    writeSim(teamPreviewCommands.join('\n'));
  }
  await waitForBattle(
    battle =>
      battle.ended ||
      battle.turn > 0 ||
      battle.sides[0]?.requestState === 'move' ||
      battle.sides[1]?.requestState === 'move',
    1000,
  );

  const { turns } = parseTurnBlocks(replayLog);

  for (const turnBlock of turns) {
    if (params.onRawBoundary && battleStream.battle) {
      params.onRawBoundary(turnBlock.turn, battleStream.battle);
    }
    if (turnBlock.turn >= targetTurn) break;
    if (abort?.aborted) break;
    if (Date.now() > overallDeadline) {
      timedOut = true;
      break;
    }

    const battle = battleStream.battle;
    if (!battle || battle.ended) break;
    onProgress?.(turnBlock.turn, targetTurn);

    // Re-align before writing: a sim that ran ahead skips stale blocks, a sim
    // that fell behind advances on defaults first. Either way this block's
    // choices only ever reach the sim standing at this block's turn.
    if (battle.turn > turnBlock.turn) continue;
    if (battle.turn < turnBlock.turn) {
      if (!(await advanceSimToTurn(turnBlock.turn))) break;
      if (battle.turn !== turnBlock.turn) continue;
    }

    // Boundary capture: the battle sits at the start of turnBlock.turn —
    // exactly the position a per-turn reconstruction of this turn returns.
    // Corrections keep the ongoing replay in lockstep with the protocol.
    if (capturePositions && battle.turn === turnBlock.turn) {
      const turnSnapshot = capturePositions.snapshotFor(turnBlock.turn);
      if (turnSnapshot) correctBattleFromSnapshot(battle, turnSnapshot);
      repairStaleForcedSwitchRequest(battle);
      capturePositions.onPosition(turnBlock.turn, battle);
    }

    const turnBeforeChoice = battle.turn;

    const p1Choice = getMainChoice(turnBlock.preUpkeep, 'p1', battle);
    const p2Choice = getMainChoice(turnBlock.preUpkeep, 'p2', battle);

    // HAX ALIGNMENT: pick the candidate seed whose rolls reproduce this
    // block's protocol events (crits/misses/secondaries/faints — spec
    // 2026-08-15-hax-alignment-design.md), then reseed the live battle
    // before committing. Reseeding happens EVERY turn (also for candidate
    // 0) so one turn's RNG consumption never shifts the next turn's rolls.
    const blockLines = [...turnBlock.preUpkeep, ...turnBlock.postUpkeep];
    const expectedEvents = extractProtocolEvents(blockLines);
    const alignForced = {
      p1: collectForcedSwitchSpecies(turnBlock.preUpkeep, turnBlock.postUpkeep, 'p1'),
      p2: collectForcedSwitchSpecies(turnBlock.preUpkeep, turnBlock.postUpkeep, 'p2'),
    };
    let seedChoice: SeedChoice = {
      seed: ALIGNMENT_SEEDS[0], trialScore: null, trialPerfect: false,
      candidatesTried: 0, trialsFailed: 0,
    };
    try {
      const checkpoint = serializeBattleStable(battle);
      seedChoice = chooseAlignedSeed({
        expected: expectedEvents,
        trial: seed => {
          try {
            return trialAdvanceLog(
              { serialized: checkpoint }, p1Choice, p2Choice, seed,
              { p1: [...alignForced.p1], p2: [...alignForced.p2] },
            );
          } catch {
            return null;
          }
        },
        shouldStop: () => abort?.aborted === true || Date.now() > overallDeadline,
      });
    } catch {
      // Serialization failure on an odd state: run the block exactly as today.
    }
    battle.resetRNG(seedChoice.seed);
    const simLogStart = battle.log.length;

    // Waking up on choice rejections keeps wedged turns from burning the full
    // wait timeout on every retry (B17 — 30-60s "Preparing branch…" hangs).
    const mainChoiceErrors = choiceErrors.count;
    writeSim(`>p1 ${p1Choice}\n>p2 ${p2Choice}`);
    await waitForBattle(currentBattle =>
      currentBattle.ended ||
      currentBattle.turn > turnBeforeChoice ||
      hasForceSwitch(currentBattle, 0) ||
      hasForceSwitch(currentBattle, 1) ||
      choiceErrors.count > mainChoiceErrors,
    );

    if (choiceErrors.count > mainChoiceErrors) {
      const battleAfterChoice = battleStream.battle;
      if (battleAfterChoice && !hasForceSwitch(battleAfterChoice, 0) && !hasForceSwitch(battleAfterChoice, 1)) {
        await commitRejectedChoicesWithDefaults(turnBeforeChoice);
      }
    }

    const p1Forced = alignForced.p1;
    const p2Forced = alignForced.p2;
    const p1ForceIndex = { current: 0 };
    const p2ForceIndex = { current: 0 };

    let maxIterations = 10;
    while (maxIterations-- > 0) {
      const currentBattle = battleStream.battle;
      if (!currentBattle || currentBattle.ended) break;

      const p1Needs = hasForceSwitch(currentBattle, 0);
      const p2Needs = hasForceSwitch(currentBattle, 1);
      if (!p1Needs && !p2Needs) break;

      const commands: string[] = [];
      const p1ForcedChoice = buildForcedSwitchChoice(currentBattle, 0, p1Forced, p1ForceIndex);
      const p2ForcedChoice = buildForcedSwitchChoice(currentBattle, 1, p2Forced, p2ForceIndex);
      if (p1ForcedChoice) commands.push(`>p1 ${p1ForcedChoice}`);
      if (p2ForcedChoice) commands.push(`>p2 ${p2ForcedChoice}`);

      if (commands.length === 0) break;
      const forcedChoiceErrors = choiceErrors.count;
      writeSim(commands.join('\n'));
      await waitForBattle(currentBattle =>
        currentBattle.ended ||
        currentBattle.turn > turnBeforeChoice ||
        (!hasForceSwitch(currentBattle, 0) && !hasForceSwitch(currentBattle, 1)) ||
        choiceErrors.count > forcedChoiceErrors,
      );
      if (choiceErrors.count > forcedChoiceErrors) {
        await commitRejectedChoicesWithDefaults(turnBeforeChoice);
        break;
      }
    }

    const latestBattle = battleStream.battle;
    if (latestBattle) {
      // After this block's events the board sits at the START of the next
      // turn — that boundary's trail is the lock truth for the position.
      correctActivesFromProtocol(latestBattle, [
        ...turnBlock.preUpkeep,
        ...turnBlock.postUpkeep,
      ], params.choiceLocks ? { context: params.choiceLocks, turn: turnBlock.turn + 1 } : undefined);
      // Score the TRULY emitted block (battle.log is synchronous — the
      // async collectedLog pump may still lag) against the protocol.
      haxAlignment.push({
        turn: turnBlock.turn,
        seed: seedChoice.seed,
        trialPerfect: seedChoice.trialPerfect,
        trialsFailed: seedChoice.trialsFailed,
        candidatesTried: seedChoice.candidatesTried,
        actual: scoreAlignment(
          expectedEvents,
          extractProtocolEvents(latestBattle.log.slice(simLogStart)),
        ),
      });
    }
  }

  await waitForBattle(
    battle => battle.ended || !!battle.requestState || !!battle.sides[0].activeRequest || !!battle.sides[1].activeRequest,
    500,
  );
  await waitForLog(
    log => log.some(line => line === `|turn|${targetTurn}`) || !!battleStream.battle?.ended,
    1000,
  );
  await waitForLogIdle();

  if (snapshot && battleStream.battle) {
    correctBattleFromSnapshot(battleStream.battle, snapshot);
    replaceLogWithReplayPrefix(collectedLog, replayLog, targetTurn);
  }

  if (battleStream.battle) {
    refreshRequestsFromLiveState(battleStream.battle);
    const correctionLines = syncLogActivesFromBattle(collectedLog, battleStream.battle, targetTurn);
    if (correctionLines.length > 0) onLogLines?.(correctionLines);
  }

  return {
    battleStream,
    streams,
    log: collectedLog,
    choiceErrors,
    timedOut,
    haxAlignment,
  };
}

/**
 * The end-of-reconstruction correction chain a per-target run applies to
 * its final battle — for a caller-owned battle (the clone-and-correct
 * single-pass path, see onRawBoundary). Mirrors the tail of
 * reconstructBranchRuntime exactly: snapshot correction when a snapshot
 * exists, then the request refresh, in that order.
 */
export function applyTargetCorrections(battle: SimBattle, snapshot: TurnSnapshot | null | undefined): void {
  if (snapshot) correctBattleFromSnapshot(battle, snapshot);
  refreshRequestsFromLiveState(battle);
}

/**
 * Post-reconstruction sanity check (B7): detects wedged states — no pending
 * request on a live battle, or a forced switch that has no eligible switch-in —
 * so the UI can offer a way out instead of silently dead-ending.
 */
/**
 * Did this reconstruction actually ARRIVE at `turn` as a live position?
 * `validateBranchRuntime` deliberately accepts an ended battle (branching
 * into a finished line is a legal, explained state), so callers that use
 * the final battle AS a specific turn's position need this stricter test:
 *
 * - short of the turn  → the replay wedged on the way there;
 * - `ended`            → always an artifact for a sampled turn, because a
 *   sampled turn lies BEFORE the real game's end; an ended arrival means
 *   the diverging choice replay killed a side the real game kept (the
 *   premature-end cascade, gen9draft-2058494320 from turn 56 unhealed).
 *   The calibration harness applies the same invariant when scoring.
 *
 * Without it the eval sweep stored a prematurely-ended battle as the LAST
 * turn's position, and the graph showed a single phantom ±1.00 point at
 * the far right with every other turn a gap (2026-08-12 report).
 */
export function reconstructionReached(runtime: BranchRuntime, turn: number): boolean {
  if (runtime.timedOut) return false;
  const battle = runtime.battleStream.battle;
  if (!battle || battle.ended) return false;
  return battle.turn >= turn;
}

export function validateBranchRuntime(runtime: BranchRuntime): string | null {
  if (runtime.timedOut) {
    return 'Reconstruction timed out before reaching this turn. Try branching from a nearby turn.';
  }

  const battle = runtime.battleStream.battle;
  if (!battle) return 'The simulator could not start this battle.';
  if (battle.ended) return null;

  if (!battle.requestState) {
    return 'The simulator got stuck while rebuilding this turn. Try branching from a nearby turn.';
  }

  if (hasStaleForcedSwitchRequest(battle)) {
    return 'The simulator demands a switch that no longer matches the battle state: the reconstruction diverged at this turn. Try a nearby turn.';
  }

  for (const side of battle.sides) {
    const needsSwitch = side.activeRequest?.forceSwitch?.some(Boolean);
    if (!needsSwitch) continue;
    const hasBench = side.pokemon.some(pokemon => !pokemon.isActive && !pokemon.fainted);
    if (!hasBench) {
      return `${side.name} must switch but has no healthy Pokémon left to send in: the reconstruction diverged at this turn. Try a nearby turn.`;
    }
  }

  return null;
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
  const sideIdx = side === 'p1' ? 0 : 1;
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
  if (requestMoves[requestIndex].disabled) {
    return { ok: false, error: `${choice.moveName} is disabled for ${describePokemon(active)} right now.` };
  }

  const suffix = targetLocSuffixForChoice(battle, active, choice.moveName, choice.targetLoc ?? 0);
  const modifier = choice.modifier ? ` ${choice.modifier}` : '';
  return { ok: true, command: `move ${requestIndex + 1}${suffix}${modifier}` };
}

function resolveSwitchSlotChoice(
  battle: SimBattle,
  side: 'p1' | 'p2',
  choice: Extract<BranchSlotChoice, { kind: 'switch' }>,
): ResolvedSideCommand {
  const sideIdx = side === 'p1' ? 0 : 1;
  const bench = battle.sides[sideIdx].pokemon;
  const nameId = toId(choice.pokemonName);

  let speciesMatch = -1;
  for (let index = 0; index < bench.length; index++) {
    const pokemon = bench[index];
    if (pokemon.isActive || pokemon.fainted) continue;
    const benchSpecies = normalizeBattleOnlyFormeId(toId(pokemon.species?.name || ''));
    if (benchSpecies !== choice.speciesId && toId(pokemon.name || '') !== choice.speciesId) continue;
    if (toId(pokemon.name || '') === nameId) {
      return { ok: true, command: `switch ${index + 1}` };
    }
    if (speciesMatch < 0) speciesMatch = index;
  }

  if (speciesMatch >= 0) return { ok: true, command: `switch ${speciesMatch + 1}` };
  const named = bench.find(pokemon => toId(pokemon.name || '') === nameId);
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
      : resolveSwitchSlotChoice(battle, side, choice);
    if (!resolved.ok) return resolved;
    fragments.push(resolved.command);
  }

  return { ok: true, command: fragments.join(', ') };
}

/**
 * Writes side commands to the sim and waits for the outcome. Succeeds when the
 * omniscient log grows (the sim committed and simulated); fails when the sim
 * rejects a choice (`|error|` sideupdate) or never responds within the timeout,
 * so callers can keep the user's choices and surface the message instead of
 * failing silently.
 */
export async function executeBranchChoices(params: {
  streams: BranchRuntime['streams'];
  log: string[];
  choiceErrors: BranchChoiceErrorLog;
  commands: { side: 'p1' | 'p2'; command: string }[];
  timeoutMs?: number;
}): Promise<BranchExecuteResult> {
  const { streams, log, choiceErrors, commands, timeoutMs = 1500 } = params;
  const previousLogLength = log.length;
  const previousErrorCount = choiceErrors.count;

  // Surface sim crashes as choice errors instead of unhandled rejections.
  safeStreamWrite(
    streams.omniscient,
    commands.map(({ side, command }) => `>${side} ${command}`).join('\n'),
    (error: unknown) => {
      choiceErrors.count += 1;
      choiceErrors.last = error instanceof Error ? error.message : String(error);
    },
  );

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
      return { ok: true };
    }
    await sleep(25);
  }

  return { ok: false, error: 'The simulator did not respond to this choice.' };
}
