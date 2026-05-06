import { BattleStreams, Dex, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import type { TurnSnapshot } from '../types';

type SimBattle = NonNullable<BattleStreams.BattleStream['battle']>;
type SimSide = SimBattle['sides'][number];
type SimPokemon = SimSide['pokemon'][number];

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
  boosts: Record<string, number>;
  level: number;
  types: string[];
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
  log: string[];
  ended: boolean;
  winner: string | null;
  waitingForChoice: boolean;
  turnNumber: number;
  p1ForceSwitch: boolean;
  p1ForceSwitches: boolean[];
  p2ForceSwitch: boolean;
  p2ForceSwitches: boolean[];
  p1Choice: string | null;
  p1Choices: (string | null)[];
  p2Choice: string | null;
  p2Choices: (string | null)[];
}

export interface BranchRuntime {
  battleStream: BattleStreams.BattleStream;
  streams: ReturnType<typeof BattleStreams.getPlayerStreams>;
  log: string[];
}

interface BranchChoices {
  p1Choice?: string | null;
  p2Choice?: string | null;
  p1Choices?: (string | null)[];
  p2Choices?: (string | null)[];
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
      const suffix = shouldAppendTargetLoc(
        battle,
        active,
        moveName,
        targetLoc,
      ) ? ` ${formatTargetLoc(targetLoc)}` : '';
      return `${moveChoiceForActive(active, moveName)}${suffix}`;
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

function correctActivesFromProtocol(battle: SimBattle, events: string[]) {
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
        if (snapshotPokemon.fainted) {
          battlePokemon.hp = 0;
          battlePokemon.fainted = true;
        }
        if (snapshotPokemon.status && snapshotPokemon.status !== '') {
          battlePokemon.status = snapshotPokemon.status as SimPokemon['status'];
        }
      }
    }
  }
}

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
    ability: pokemon.ability || '',
    item: pokemon.item || '',
    stats: {
      atk: pokemon.storedStats?.atk || 0,
      def: pokemon.storedStats?.def || 0,
      spa: pokemon.storedStats?.spa || 0,
      spd: pokemon.storedStats?.spd || 0,
      spe: pokemon.storedStats?.spe || 0,
    },
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
  choices: (string | null)[] | undefined,
  legacyChoice: string | null | undefined,
  activeCount: number,
): (string | null)[] {
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

export async function reconstructBranchRuntime(params: {
  format: string;
  p1Team: PokemonSet[];
  p2Team: PokemonSet[];
  replayLog: string;
  targetTurn: number;
  snapshot?: TurnSnapshot | null;
  onLogLines?: (lines: string[]) => void;
}): Promise<BranchRuntime> {
  const { format, p1Team, p2Team, replayLog, targetTurn, snapshot, onLogLines } = params;
  const { p1Leads, p2Leads } = extractLeads(replayLog);
  const orderedP1 = reorderForLeads(p1Team, p1Leads);
  const orderedP2 = reorderForLeads(p2Team, p2Leads);

  const battleStream = new BattleStreams.BattleStream();
  const streams = BattleStreams.getPlayerStreams(battleStream);
  const collectedLog: string[] = [];

  void (async () => {
    for await (const chunk of streams.omniscient) {
      const lines = chunk.split('\n').filter(line => line.trim());
      collectedLog.push(...lines);
      onLogLines?.(lines);
    }
  })();

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

  void streams.omniscient.write(
    `>start {"formatid":"${format}"}\n>player p1 {"name":"Player 1","team":"${p1Packed}"}\n>player p2 {"name":"Player 2","team":"${p2Packed}"}`
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

    const battle = battleStream.battle;
    if (!battle || battle.ended) break;
    const turnBeforeChoice = battle.turn;

    const p1Choice = getMainChoice(turnBlock.preUpkeep, 'p1', battle);
    const p2Choice = getMainChoice(turnBlock.preUpkeep, 'p2', battle);

    void streams.omniscient.write(`>p1 ${p1Choice}\n>p2 ${p2Choice}`);
    await waitForBattle(currentBattle =>
      currentBattle.ended ||
      currentBattle.turn > turnBeforeChoice ||
      hasForceSwitch(currentBattle, 0) ||
      hasForceSwitch(currentBattle, 1),
    );

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
      void streams.omniscient.write(commands.join('\n'));
      await waitForBattle(currentBattle =>
        currentBattle.ended ||
        currentBattle.turn > turnBeforeChoice ||
        (!hasForceSwitch(currentBattle, 0) && !hasForceSwitch(currentBattle, 1)),
      );
    }

    const latestBattle = battleStream.battle;
    if (latestBattle) {
      correctActivesFromProtocol(latestBattle, [
        ...turnBlock.preUpkeep,
        ...turnBlock.postUpkeep,
      ]);
    }
  }

  if (snapshot && battleStream.battle) {
    correctHpFromSnapshot(battleStream.battle, snapshot);
  }

  await waitForBattle(
    battle => battle.ended || !!battle.requestState || !!battle.sides[0].activeRequest || !!battle.sides[1].activeRequest,
    500,
  );
  await waitForLog(
    log => log.some(line => line === `|turn|${targetTurn}`) || !!battleStream.battle?.ended,
    1000,
  );

  return {
    battleStream,
    streams,
    log: collectedLog,
  };
}
