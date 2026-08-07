import { Battle, BattleStreams, Dex, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import type { TurnSnapshot } from '../types';
import type { BranchSlotChoice } from './branch-choices';
import { serializeBattleStable } from './eval/forward-model';

// @pkmn/sim's random-format rulesets reference Node's `global` object (e.g.
// `global.Config?.potd` in rulesets), which doesn't exist in browsers and made
// every Random Battle branch die with an uncaught ReferenceError (B2).
if (typeof (globalThis as Record<string, unknown>).global === 'undefined') {
  (globalThis as Record<string, unknown>).global = globalThis;
}

type SimBattle = NonNullable<BattleStreams.BattleStream['battle']>;
type SimSide = SimBattle['sides'][number];
type SimPokemon = SimSide['pokemon'][number];

export interface PokemonStatTable {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface BranchMoveOption {
  name: string;
  activeSlot: number;
  slot: number;
  pp: number;
  maxpp: number;
  disabled: boolean;
  type: string;
  targetType: string;
  requiresTarget: boolean;
  targetOptions: BranchTargetOption[];
}

export interface BranchTargetOption {
  label: string;
  targetLoc: number;
  side: 'p1' | 'p2';
  activeSlot: number;
  name: string;
  species: string;
  hpPercent: number;
}

export interface BranchSwitchOption {
  name: string;
  species: string;
  activeSlot: number;
  slot: number;
  hp: string;
  hpPercent: number;
  fainted: boolean;
}

export interface SimPokemonInfo {
  name: string;
  species: string;
  hp: number;
  maxhp: number;
  hpPercent: number;
  status: string;
  fainted: boolean;
  isActive: boolean;
  activeSlot: number | null;
  moves: { name: string; type: string }[];
  ability: string;
  item: string;
  stats: { atk: number; def: number; spa: number; spd: number; spe: number };
  nature?: string;
  evs?: PokemonStatTable;
  ivs?: PokemonStatTable;
  gender?: string;
  teraType?: string;
  boosts: Record<string, number>;
  level: number;
  types: string[];
}

export interface BranchFieldState {
  weather: string;
  terrain: string;
  p1SideConditions: string[];
  p2SideConditions: string[];
}

/** Per-active-slot availability of battle gimmicks (Tera/Mega/Z/Ultra, G7). */
export interface BranchSlotModifiers {
  teraType: string | null;
  canMegaEvo: boolean;
  canUltraBurst: boolean;
  /** Z-move name per move slot (index 0 = move slot 1), null when the move has no Z option. */
  zMoves: (string | null)[];
}

export interface BranchSimState {
  p1Moves: BranchMoveOption[];
  p1MovesBySlot: BranchMoveOption[][];
  p1Switches: BranchSwitchOption[];
  p1SwitchesBySlot: BranchSwitchOption[][];
  p2Moves: BranchMoveOption[];
  p2MovesBySlot: BranchMoveOption[][];
  p2Switches: BranchSwitchOption[];
  p2SwitchesBySlot: BranchSwitchOption[][];
  p1Pokemon: SimPokemonInfo[];
  p2Pokemon: SimPokemonInfo[];
  p1Active: SimPokemonInfo | null;
  p1ActiveSlots: (SimPokemonInfo | null)[];
  p2Active: SimPokemonInfo | null;
  p2ActiveSlots: (SimPokemonInfo | null)[];
  p1ModifiersBySlot: BranchSlotModifiers[];
  p2ModifiersBySlot: BranchSlotModifiers[];
  field: BranchFieldState;
  log: string[];
  ended: boolean;
  winner: string | null;
  waitingForChoice: boolean;
  turnNumber: number;
  p1ForceSwitch: boolean;
  p1ForceSwitches: boolean[];
  p2ForceSwitch: boolean;
  p2ForceSwitches: boolean[];
  p1Choice: BranchSlotChoice | null;
  p1Choices: (BranchSlotChoice | null)[];
  p2Choice: BranchSlotChoice | null;
  p2Choices: (BranchSlotChoice | null)[];
}

export interface BranchRuntime {
  battleStream: BattleStreams.BattleStream;
  streams: ReturnType<typeof BattleStreams.getPlayerStreams>;
  log: string[];
  choiceErrors: BranchChoiceErrorLog;
  /** True when the overall reconstruction deadline was hit before the target turn (B17). */
  timedOut: boolean;
}

/**
 * Choice rejections arrive as `|error|` sideupdates on the per-player streams,
 * never on the omniscient stream — this collects them so executes can fail loudly.
 */
export interface BranchChoiceErrorLog {
  count: number;
  last: string | null;
}

export type BranchExecuteResult =
  | { ok: true }
  | { ok: false; error: string };

interface BranchChoices {
  p1Choice?: BranchSlotChoice | null;
  p2Choice?: BranchSlotChoice | null;
  p1Choices?: (BranchSlotChoice | null)[];
  p2Choices?: (BranchSlotChoice | null)[];
}

interface TurnBlock {
  turn: number;
  preUpkeep: string[];
  postUpkeep: string[];
}

interface PokemonIdent {
  name: string;
  species: string;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const BATTLE_ONLY_FORME_SUFFIXES = ['terastal', 'stellar', 'tera'];

function normalizeBattleOnlyFormeId(id: string): string {
  for (const suffix of BATTLE_ONLY_FORME_SUFFIXES) {
    if (id.endsWith(suffix)) return id.slice(0, -suffix.length);
  }
  return id;
}

function slotLetter(index: number): string {
  return String.fromCharCode('a'.charCodeAt(0) + index);
}

function formatTargetLoc(targetLoc: number): string {
  return targetLoc > 0 ? `+${targetLoc}` : `${targetLoc}`;
}

function parseTurnBlocks(log: string): { preGame: string[]; turns: TurnBlock[] } {
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

function extractLeads(log: string): { p1Leads: PokemonIdent[]; p2Leads: PokemonIdent[] } {
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
    if (!target.some(existing => toId(existing.name) === toId(name) && toId(existing.species) === toId(species))) {
      target.push({ name, species });
    }
  }

  return { p1Leads, p2Leads };
}

function reorderForLeads(team: PokemonSet[], leads: PokemonIdent[]): PokemonSet[] {
  if (leads.length === 0) return [...team];

  const remaining = [...team];
  const orderedLeads: PokemonSet[] = [];
  for (const lead of leads) {
    const leadNameId = toId(lead.name);
    const leadSpeciesId = toId(lead.species);
    let idx = remaining.findIndex(pokemon => toId(pokemon.name || '') === leadNameId);
    if (idx < 0) {
      idx = remaining.findIndex(pokemon =>
        toId(pokemon.species) === leadSpeciesId ||
        toId(pokemon.name || '') === leadSpeciesId
      );
    }
    if (idx >= 0) {
      const [pokemon] = remaining.splice(idx, 1);
      orderedLeads.push(pokemon);
    }
  }

  return [...orderedLeads, ...remaining];
}

function findSlotBySpecies(battle: SimBattle, sideIdx: number, species: string): number {
  const side = battle.sides[sideIdx];
  const speciesId = toId(species);
  const normalizedSpeciesId = normalizeBattleOnlyFormeId(speciesId);

  for (let i = 0; i < side.pokemon.length; i++) {
    const pokemon = side.pokemon[i];
    if (pokemon.isActive || pokemon.fainted) continue;
    const speciesName = toId(pokemon.species?.name || '');
    const displayName = toId(pokemon.name || '');
    if (
      speciesName === speciesId ||
      speciesName === normalizedSpeciesId ||
      displayName === speciesId ||
      displayName === normalizedSpeciesId ||
      speciesName.startsWith(speciesId) ||
      speciesId.startsWith(speciesName) ||
      speciesName.startsWith(normalizedSpeciesId) ||
      normalizedSpeciesId.startsWith(speciesName)
    ) {
      return i + 1;
    }
  }

  return findFirstAvailableSwitchSlot(battle, sideIdx);
}

function findFirstAvailableSwitchSlot(battle: SimBattle, sideIdx: number): number {
  const side = battle.sides[sideIdx];
  for (let i = 0; i < side.pokemon.length; i++) {
    if (!side.pokemon[i].isActive && !side.pokemon[i].fainted) return i + 1;
  }
  return 2;
}

function findPokemonOnSide(side: SimSide, species: string): SimPokemon | null {
  const speciesId = toId(species);
  const normalizedSpeciesId = normalizeBattleOnlyFormeId(speciesId);
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

  const sourceSideIdx = sourceSide === 'p1' ? 0 : 1;
  const targetSideIdx = match[1] === 'p1' ? 0 : 1;
  const targetActiveSlot = match[2].charCodeAt(0) - 'a'.charCodeAt(0);
  const source = battle.sides[sourceSideIdx].active[sourceActiveSlot];
  const target = battle.sides[targetSideIdx].active[targetActiveSlot];

  if (source && target) return source.getLocOf(target);
  return targetSideIdx === sourceSideIdx ? -(targetActiveSlot + 1) : targetActiveSlot + 1;
}

function targetTypeForMove(active: SimPokemon | null | undefined, moveName: string): string {
  if (!active) return Dex.moves.get(moveName).target || '';
  const moveId = toId(moveName);
  const request = active.getMoveRequestData();
  return request.moves.find(move => move.id === moveId)?.target || Dex.moves.get(moveName).target || '';
}

function shouldAppendTargetLoc(
  battle: SimBattle,
  active: SimPokemon | null | undefined,
  moveName: string,
  targetLoc: number,
): boolean {
  if (!active || !targetLoc || active.side.active.length < 2) return false;
  const targetType = targetTypeForMove(active, moveName);
  return battle.actions.targetTypeChoices(targetType) && battle.validTargetLoc(targetLoc, active, targetType);
}

function targetLocSuffixForChoice(
  battle: SimBattle,
  active: SimPokemon | null | undefined,
  moveName: string,
  protocolTargetLoc: number,
): string {
  if (shouldAppendTargetLoc(battle, active, moveName, protocolTargetLoc)) {
    return ` ${formatTargetLoc(protocolTargetLoc)}`;
  }

  if (!active || active.side.active.length < 2) return '';
  const targetType = targetTypeForMove(active, moveName);
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

function defaultMoveChoice(battle: SimBattle, active: SimPokemon | null | undefined): string {
  if (!active || active.fainted) return 'pass';
  const firstMove = active.moveSlots[0];
  if (!firstMove) return 'pass';
  const targetType = targetTypeForMove(active, firstMove.id || firstMove.move);
  const targetLoc = firstLegalTargetLoc(battle, active, targetType);
  return `move 1${targetLoc ? ` ${formatTargetLoc(targetLoc)}` : ''}`;
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
  const sideIdx = side === 'p1' ? 0 : 1;
  const ident = `${side}${slotLetter(activeSlot)}:`;

  for (const line of events) {
    if (line.startsWith(`|switch|${ident}`) && !line.includes('[from]')) {
      const species = line.split('|')[3].split(',')[0].trim();
      return `switch ${findSlotBySpecies(battle, sideIdx, species)}`;
    }

    if (line.startsWith(`|move|${ident}`)) {
      const moveName = line.split('|')[3];
      const active = battle.sides[sideIdx].active[activeSlot];
      const targetLoc = protocolTargetLoc(battle, side, activeSlot, line.split('|')[4]);
      const suffix = targetLocSuffixForChoice(
        battle,
        active,
        moveName,
        targetLoc,
      );
      return `${moveChoiceForActive(active, moveName)}${suffix}${gimmickSuffixForSlot(events, ident, active)}`;
    }
  }

  const active = battle.sides[sideIdx].active[activeSlot];
  return defaultMoveChoice(battle, active);
}

function getMainChoice(events: string[], side: 'p1' | 'p2', battle: SimBattle): string {
  const sideIdx = side === 'p1' ? 0 : 1;
  const actives = battle.sides[sideIdx].active;
  const choices = actives.map((_, activeSlot) => getChoiceForSlot(events, side, activeSlot, battle));
  return choices.length > 0 ? choices.join(', ') : 'move 1';
}

function collectForcedSwitchSpecies(
  preUpkeep: string[],
  postUpkeep: string[],
  side: 'p1' | 'p2',
): string[] {
  const species: string[] = [];
  const matcher = new RegExp(`^\\|switch\\|${side}[a-d]:`);

  for (const line of preUpkeep) {
    if (matcher.test(line) && line.includes('[from]')) {
      species.push(line.split('|')[3].split(',')[0].trim());
    }
  }

  for (const line of postUpkeep) {
    if (matcher.test(line)) {
      species.push(line.split('|')[3].split(',')[0].trim());
    }
  }

  return species;
}

export function correctActivesFromProtocol(battle: SimBattle, events: string[]) {
  for (const line of events) {
    const match = line.match(/^\|(switch|drag)\|(p[12])([a-d]):[^|]*\|([^,|]+)/);
    if (!match) continue;

    const sideIdx = match[2] === 'p1' ? 0 : 1;
    const activeSlot = match[3].charCodeAt(0) - 'a'.charCodeAt(0);
    const species = match[4].trim();
    const side = battle.sides[sideIdx];
    const target = findPokemonOnSide(side, species);
    if (!target || side.active[activeSlot] === target) continue;

    const previous = side.active[activeSlot];
    if (previous) previous.isActive = false;

    const duplicateActiveSlot = side.active.findIndex(active => active === target);
    if (duplicateActiveSlot >= 0 && duplicateActiveSlot !== activeSlot && previous) {
      side.active[duplicateActiveSlot] = previous;
      previous.isActive = true;
    }

    // Mirror BattleActions#switchIn's array swap: the sim keeps
    // side.pokemon[i] === side.active[i], and its next real switch swaps via
    // the position fields. Repointing active without reordering side.pokemon
    // makes that swap duplicate one team member and erase another.
    const targetIndex = side.pokemon.indexOf(target);
    if (targetIndex >= 0 && targetIndex !== activeSlot) {
      const occupant = side.pokemon[activeSlot];
      side.pokemon[targetIndex] = occupant;
      if (occupant) occupant.position = targetIndex;
      side.pokemon[activeSlot] = target;
    }

    target.isActive = true;
    target.position = activeSlot;
    side.active[activeSlot] = target;
  }
}

function forceSwitches(battle: SimBattle, sideIdx: number): boolean[] {
  const requests = battle.sides[sideIdx].activeRequest?.forceSwitch;
  const activeCount = battle.sides[sideIdx].active.length;
  return Array.from({ length: activeCount }, (_, index) => requests?.[index] ?? false);
}

function hasForceSwitch(battle: SimBattle, sideIdx: number): boolean {
  return forceSwitches(battle, sideIdx).some(Boolean);
}

function buildForcedSwitchChoice(
  battle: SimBattle,
  sideIdx: number,
  forcedSpecies: string[],
  cursor: { current: number },
): string | null {
  const needs = forceSwitches(battle, sideIdx);
  if (!needs.some(Boolean)) return null;

  const choices = needs.map(need => {
    if (!need) return 'pass';
    const species = forcedSpecies[cursor.current++];
    if (species) return `switch ${findSlotBySpecies(battle, sideIdx, species)}`;
    return `switch ${findFirstAvailableSwitchSlot(battle, sideIdx)}`;
  });

  return choices.join(', ');
}

/**
 * Status residuals read their state from `statusState` (Toxic damage is
 * `stage * maxhp/16`, sleep counts down `time`) — a bare `status` assignment
 * leaves that state empty, so corrected Toxic dealt NaN (= no) damage for the
 * rest of the branch. Mirror Pokemon#setStatus instead, and only when the
 * snapshot disagrees, so a matching reconstruction keeps its own toxic stage
 * and sleep counter.
 */
function correctStatusFromSnapshot(battlePokemon: SimPokemon, snapshotStatus: string) {
  const status = snapshotStatus as SimPokemon['status'];
  if (battlePokemon.status === status) return;

  battlePokemon.status = status;
  const statusState = battlePokemon.statusState as {
    id: string;
    target?: unknown;
    stage?: number;
    time?: number;
    startTime?: number;
  };
  statusState.id = status;
  statusState.target = battlePokemon;
  delete statusState.stage;
  delete statusState.time;
  delete statusState.startTime;
  if (status === 'tox') statusState.stage = 0;
  if (status === 'slp') {
    // The snapshot does not carry remaining sleep turns — use the average.
    statusState.startTime = 3;
    statusState.time = 3;
  }
}

function correctHpFromSnapshot(battle: SimBattle, snapshot: TurnSnapshot) {
  for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
    const snapshotSide = sideIndex === 0 ? snapshot.p1 : snapshot.p2;
    const battleSide = battle.sides[sideIndex];

    for (const snapshotPokemon of snapshotSide.pokemon) {
      const battlePokemon = battleSide.pokemon.find((pokemon: SimPokemon) =>
        toId(pokemon.species?.name || '') === toId(snapshotPokemon.speciesForme) ||
        toId(pokemon.name || '') === toId(snapshotPokemon.name)
      );

      if (battlePokemon && snapshotPokemon.maxhp > 0) {
        const ratio = snapshotPokemon.hpPercent / 100;
        battlePokemon.hp = Math.max(0, Math.round(ratio * battlePokemon.maxhp));
        battlePokemon.fainted = snapshotPokemon.fainted;
        battlePokemon.faintQueued = snapshotPokemon.fainted;
        if (snapshotPokemon.fainted) battlePokemon.hp = 0;
        if (!snapshotPokemon.fainted && battlePokemon.hp <= 0 && snapshotPokemon.hpPercent > 0) {
          battlePokemon.hp = 1;
        }
        correctStatusFromSnapshot(battlePokemon, snapshotPokemon.status || '');
        for (const stat of ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'] as const) {
          battlePokemon.boosts[stat] = snapshotPokemon.boosts[stat] ?? 0;
        }
      }
    }
  }
}

function snapshotConditionDuration(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const maybeDuration = value as { minDuration?: unknown; maxDuration?: unknown; duration?: unknown };
  for (const duration of [maybeDuration.duration, maybeDuration.minDuration, maybeDuration.maxDuration]) {
    if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) return duration;
  }
  return undefined;
}

function syncEffectTableFromSnapshot(
  table: Record<string, { id?: string; duration?: number; effectOrder?: number }>,
  snapshotTable: Record<string, unknown>,
) {
  const desiredIds = new Set(Object.keys(snapshotTable).map(key => toId(key)));
  for (const key of Object.keys(table)) {
    if (!desiredIds.has(toId(key))) delete table[key];
  }

  for (const [key, value] of Object.entries(snapshotTable)) {
    const id = toId(key);
    const duration = snapshotConditionDuration(value);
    table[id] = {
      ...(table[id] ?? {}),
      id,
      effectOrder: table[id]?.effectOrder ?? 0,
      ...(duration ? { duration } : {}),
    };
  }
}

function terrainIdFromSnapshot(terrain: string): string {
  if (!terrain) return '';
  const terrainCondition = Dex.conditions.get(`${terrain} Terrain`);
  return terrainCondition.exists ? terrainCondition.id : toId(terrain);
}

/**
 * @pkmn/client snapshots report weather by display name (its WEATHERS map:
 * "Sand", "Sun", …) — the sim only knows condition ids. Writing an untranslated
 * name into the sim silently disables every weather residual (the gen 3
 * Sandstorm-does-no-damage report).
 */
const CLIENT_WEATHER_IDS: Record<string, string> = {
  sand: 'sandstorm',
  sun: 'sunnyday',
  rain: 'raindance',
  hail: 'hail',
  snow: 'snowscape',
  harshsunshine: 'desolateland',
  heavyrain: 'primordialsea',
  strongwinds: 'deltastream',
};

function weatherIdFromSnapshot(weather: string): string {
  if (!weather) return '';
  const mapped = CLIENT_WEATHER_IDS[toId(weather)];
  if (mapped) return mapped;
  const weatherCondition = Dex.conditions.get(weather);
  return weatherCondition.exists ? weatherCondition.id : toId(weather);
}

function correctFieldFromSnapshot(battle: SimBattle, snapshot: TurnSnapshot) {
  battle.turn = snapshot.turn;
  const weather = weatherIdFromSnapshot(snapshot.field.weather);
  if ((battle.field.weather as string) !== weather) {
    // Only touch weather the sim disagrees about — matching weather keeps its
    // reconstructed weatherState (source, remaining duration) untouched.
    battle.field.weather = weather as SimBattle['field']['weather'];
    battle.field.weatherState.id = weather as typeof battle.field.weatherState.id;
    delete battle.field.weatherState.duration;
  }
  battle.field.terrain = terrainIdFromSnapshot(snapshot.field.terrain) as SimBattle['field']['terrain'];
  syncEffectTableFromSnapshot(
    battle.field.pseudoWeather as Record<string, { id?: string; duration?: number; effectOrder?: number }>,
    snapshot.field.pseudoWeather,
  );
  syncEffectTableFromSnapshot(
    battle.sides[0].sideConditions as Record<string, { id?: string; duration?: number; effectOrder?: number }>,
    snapshot.p1.sideConditions,
  );
  syncEffectTableFromSnapshot(
    battle.sides[1].sideConditions as Record<string, { id?: string; duration?: number; effectOrder?: number }>,
    snapshot.p2.sideConditions,
  );
}

function replayLogPrefixThroughTurn(replayLog: string, targetTurn: number): string[] {
  const prefix: string[] = [];
  let foundTargetTurn = false;

  for (const rawLine of replayLog.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) continue;
    prefix.push(line);
    if (line === `|turn|${targetTurn}`) {
      foundTargetTurn = true;
      break;
    }
  }

  if (!foundTargetTurn) prefix.push(`|turn|${targetTurn}`);
  return prefix;
}

function replaceLogWithReplayPrefix(log: string[], replayLog: string, targetTurn: number) {
  log.splice(0, log.length, ...replayLogPrefixThroughTurn(replayLog, targetTurn));
}

function correctBattleFromSnapshot(battle: SimBattle, snapshot: TurnSnapshot) {
  correctHpFromSnapshot(battle, snapshot);
  correctFieldFromSnapshot(battle, snapshot);
}

/**
 * After snapshot/active corrections the emitted request can go stale: it still
 * demands a forced switch although no active Pokémon carries a switchFlag
 * anymore (B7 — the gen3 "phantom forced switch" deadlock). The battle itself
 * is consistent, so regenerating the request from the live state repairs it.
 */
function hasStaleForcedSwitchRequest(battle: SimBattle): boolean {
  if (battle.ended) return false;
  return battle.sides.some(side =>
    side.activeRequest?.forceSwitch?.some((forced, index) => forced && !side.active[index]?.switchFlag)
  );
}

function repairStaleForcedSwitchRequest(battle: SimBattle) {
  if (!hasStaleForcedSwitchRequest(battle)) return;
  try {
    battle.makeRequest('move');
  } catch {
    // Leave the wedged state to validateBranchRuntime to report.
  }
}

interface LoggedActive {
  side: 'p1' | 'p2';
  activeSlot: number;
  nameId: string;
  speciesId: string;
}

function parseLoggedActive(line: string): LoggedActive | null {
  const match = line.match(/^\|(switch|drag|replace)\|(p[12])([a-d]):\s*([^|]*)\|([^|]*)\|/);
  if (!match) return null;

  return {
    side: match[2] as 'p1' | 'p2',
    activeSlot: match[3].charCodeAt(0) - 'a'.charCodeAt(0),
    nameId: toId(match[4]),
    speciesId: normalizeBattleOnlyFormeId(toId(match[5].split(',')[0] || '')),
  };
}

function activeMatchesLog(pokemon: SimPokemon, logged: LoggedActive | undefined): boolean {
  if (!logged) return false;
  const speciesId = normalizeBattleOnlyFormeId(toId(pokemon.species?.name || ''));
  return logged.nameId === toId(pokemon.name || '') || logged.speciesId === speciesId;
}

function formatPokemonDetails(pokemon: SimPokemon): string {
  const details = [pokemon.species.name];
  if (pokemon.gender === 'M' || pokemon.gender === 'F') details.push(pokemon.gender);
  if (pokemon.level && pokemon.level !== 100) details.push(`L${pokemon.level}`);
  return details.join(', ');
}

function formatPokemonHpStatus(pokemon: SimPokemon): string {
  if (pokemon.fainted || pokemon.hp <= 0) return '0 fnt';
  const hp = pokemon.maxhp > 0 ? `${pokemon.hp}/${pokemon.maxhp}` : '100/100';
  return pokemon.status ? `${hp} ${pokemon.status}` : hp;
}

function activeSwitchLine(side: 'p1' | 'p2', activeSlot: number, pokemon: SimPokemon): string {
  return `|switch|${side}${slotLetter(activeSlot)}: ${pokemon.name}|${formatPokemonDetails(pokemon)}|${formatPokemonHpStatus(pokemon)}`;
}

function insertBeforeTurn(log: string[], targetTurn: number, lines: string[]) {
  if (lines.length === 0) return;

  let turnIndex = -1;
  for (let index = log.length - 1; index >= 0; index--) {
    if (log[index] === `|turn|${targetTurn}`) {
      turnIndex = index;
      break;
    }
  }

  if (turnIndex >= 0) {
    log.splice(turnIndex, 0, ...lines);
  } else {
    log.push(...lines);
  }
}

function syncLogActivesFromBattle(log: string[], battle: SimBattle, targetTurn: number): string[] {
  const latestLogged = new Map<string, LoggedActive>();
  for (const line of log) {
    const logged = parseLoggedActive(line);
    if (!logged) continue;
    latestLogged.set(`${logged.side}:${logged.activeSlot}`, logged);
  }

  const corrections: string[] = [];
  for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
    const side = sideIndex === 0 ? 'p1' : 'p2';
    for (const [activeSlot, pokemon] of battle.sides[sideIndex].active.entries()) {
      if (!pokemon || pokemon.fainted) continue;
      const logged = latestLogged.get(`${side}:${activeSlot}`);
      if (activeMatchesLog(pokemon, logged)) continue;
      corrections.push(activeSwitchLine(side, activeSlot, pokemon));
    }
  }

  insertBeforeTurn(log, targetTurn, corrections);
  return corrections;
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
  const battle = battleStream?.battle;
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
 * The turn-0 position: a fresh battle sitting at team preview, before either
 * side has ordered its team — the lead decision the eval engine can search.
 * Null for formats without team preview (older gens). Deterministic seed so
 * every caller serializes the identical position.
 */
export function serializePreviewPosition(
  format: string,
  p1Team: PokemonSet[],
  p2Team: PokemonSet[],
): string | null {
  try {
    const battle = new Battle({
      formatid: toID(format),
      seed: '1,2,3,4',
      p1: { name: 'p1', team: Teams.pack(p1Team) },
      p2: { name: 'p2', team: Teams.pack(p2Team) },
    });
    if (battle.sides[0]?.requestState !== 'teampreview') return null;
    return serializeBattleStable(battle);
  } catch {
    return null;
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
}): Promise<BranchRuntime> {
  const { format, p1Team, p2Team, replayLog, targetTurn, snapshot, onLogLines, onProgress, abort, capturePositions } = params;
  const overallDeadline = Date.now() + (params.deadlineMs ?? 60_000);
  let timedOut = false;
  const { p1Leads, p2Leads } = extractLeads(replayLog);
  const orderedP1 = reorderForLeads(p1Team, p1Leads);
  const orderedP2 = reorderForLeads(p2Team, p2Leads);

  const battleStream = new BattleStreams.BattleStream();
  const streams = BattleStreams.getPlayerStreams(battleStream);
  const collectedLog: string[] = [];
  const choiceErrors: BranchChoiceErrorLog = { count: 0, last: null };

  void (async () => {
    for await (const chunk of streams.omniscient) {
      const lines = chunk.split('\n').filter(line => line.trim());
      collectedLog.push(...lines);
      onLogLines?.(lines);
    }
  })();

  for (const sideStream of [streams.p1, streams.p2]) {
    void (async () => {
      for await (const chunk of sideStream) {
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('|error|')) continue;
          choiceErrors.count += 1;
          choiceErrors.last = line
            .slice('|error|'.length)
            .replace(/^\[(?:Invalid|Unavailable) choice\]\s*/, '');
        }
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
    void streams.omniscient.write(pendingSides.map(side => `>${side.id} default`).join('\n'));
    await waitForBattle(currentBattle =>
      currentBattle.ended ||
      currentBattle.turn > turnBeforeChoice ||
      hasForceSwitch(currentBattle, 0) ||
      hasForceSwitch(currentBattle, 1) ||
      choiceErrors.count > retryErrors,
    );
  };

  const p1Name = JSON.stringify(params.playerNames?.[0]?.trim() || 'Player 1');
  const p2Name = JSON.stringify(params.playerNames?.[1]?.trim() || 'Player 2');
  void streams.omniscient.write(
    `>start {"formatid":"${format}"}\n>player p1 {"name":${p1Name},"team":"${p1Packed}"}\n>player p2 {"name":${p2Name},"team":"${p2Packed}"}`
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
    void streams.omniscient.write(teamPreviewCommands.join('\n'));
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
    if (turnBlock.turn >= targetTurn) break;
    if (abort?.aborted) break;
    if (Date.now() > overallDeadline) {
      timedOut = true;
      break;
    }

    const battle = battleStream.battle;
    if (!battle || battle.ended) break;
    onProgress?.(turnBlock.turn, targetTurn);

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

    // Waking up on choice rejections keeps wedged turns from burning the full
    // wait timeout on every retry (B17 — 30-60s "Preparing branch…" hangs).
    const mainChoiceErrors = choiceErrors.count;
    void streams.omniscient.write(`>p1 ${p1Choice}\n>p2 ${p2Choice}`);
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

    const p1Forced = collectForcedSwitchSpecies(turnBlock.preUpkeep, turnBlock.postUpkeep, 'p1');
    const p2Forced = collectForcedSwitchSpecies(turnBlock.preUpkeep, turnBlock.postUpkeep, 'p2');
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
      void streams.omniscient.write(commands.join('\n'));
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
      correctActivesFromProtocol(latestBattle, [
        ...turnBlock.preUpkeep,
        ...turnBlock.postUpkeep,
      ]);
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
    repairStaleForcedSwitchRequest(battleStream.battle);
    const correctionLines = syncLogActivesFromBattle(collectedLog, battleStream.battle, targetTurn);
    if (correctionLines.length > 0) onLogLines?.(correctionLines);
  }

  return {
    battleStream,
    streams,
    log: collectedLog,
    choiceErrors,
    timedOut,
  };
}

/**
 * Post-reconstruction sanity check (B7): detects wedged states — no pending
 * request on a live battle, or a forced switch that has no eligible switch-in —
 * so the UI can offer a way out instead of silently dead-ending.
 */
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
    return 'The simulator demands a switch that no longer matches the battle state — the reconstruction diverged at this turn. Try a nearby turn.';
  }

  for (const side of battle.sides) {
    const needsSwitch = side.activeRequest?.forceSwitch?.some(Boolean);
    if (!needsSwitch) continue;
    const hasBench = side.pokemon.some(pokemon => !pokemon.isActive && !pokemon.fainted);
    if (!hasBench) {
      return `${side.name} must switch but has no healthy Pokémon left to send in — the reconstruction diverged at this turn. Try a nearby turn.`;
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

  void streams.omniscient.write(
    commands.map(({ side, command }) => `>${side} ${command}`).join('\n'),
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
