import { Teams } from '@pkmn/sim';
import { toId } from '@fulllifegames/replay-core';
import type { BranchMoveModifier, BranchSlotChoice } from '@fulllifegames/eval-engine';
import type { BranchHistoryEntry } from '../branch-history';
import type { NewGameRecord } from './record';

/**
 * Round 89 (lane H, #105), stage H5: the share link of a game, format version 2 (version 1 is a replay's branch: its id, its choices
 * and the log it ends on). A game's link holds what the game is made of and nothing a reader can play again: the format, both teams
 * as `Teams.pack` text, the seed, the leads and every choice, a name beside its id only where the Dex cannot spell it. The log, the
 * positions and the header stay out; the reader starts the format's battle on the seed and plays the entries onto it
 * (`recordOfShare`), so its game is the sharer's to the byte. A game of 30 doubles turns measures under 8,000 characters.
 *
 * A slot choice is one string where it can be: a move is its name, `@<target>` when it has one and `#<modifier>` when it carries
 * one ("Close Combat@1#terastallize"); a switch is `>` and the Pokémon's name ("Rotom-Wash"). A choice that carries forced dice, a
 * move whose name does not spell its id and a switch whose name is a nickname stay as the object the app holds. An entry is a pair
 * of sides' slots (a turn), a side and its slots (a forced replacement) or `L` with the leads (the lead entry of turn 0).
 */

export const GAME_SHARE_VERSION = 2;

export type ShareSlot = string | BranchSlotChoice | null;
export type ShareEntry =
  | [ShareSlot[], ShareSlot[]]
  | ['p1' | 'p2', ShareSlot[]]
  | ['L', string[], string[]] | ['L', string[], string[], 1];

export interface GameSharePayload {
  version: typeof GAME_SHARE_VERSION;
  kind: 'game';
  /** The sharer's game id: a saved row of a game is keyed by it, and a link of the game that is open opens its branch in it. */
  gameId: string;
  format: string;
  formatName: string;
  players: [string, string];
  teams: { p1: string; p2: string };
  seed: string;
  /** The main line's entries in play order, the lead entry first. */
  entries: ShareEntry[];
  /** The open variation: the turn it starts from and its entries. */
  variation?: { startTurn: number; entries: ShareEntry[] };
  /** Where the sharer stood: the pointer's turn and line, and whether it was the team preview. */
  view?: { turn: number; line: 'main' | 'variation'; t0?: boolean };
  /** The turn the shared branch starts from (the variation's start, else the game's tip): the saved row's words. */
  branchTurn: number;
  createdAt: string;
}

const MODIFIERS: readonly BranchMoveModifier[] = ['terastallize', 'mega', 'zmove', 'ultra'];

/** A slot as one string, or as the object itself where the string cannot hold it. */
function shareSlot(choice: BranchSlotChoice | null | undefined): ShareSlot {
  if (!choice) return null;
  if (choice.dice && choice.dice.length > 0) return choice;
  if (choice.kind === 'switch') return toId(choice.pokemonName) === choice.speciesId && !choice.pokemonName.includes('|') ? `>${choice.pokemonName}` : choice;
  if (toId(choice.moveName) !== choice.moveId || /[@#]/.test(choice.moveName) || choice.moveName.startsWith('>')) return choice;
  return `${choice.moveName}${choice.targetLoc !== undefined ? `@${choice.targetLoc}` : ''}${choice.modifier ? `#${choice.modifier}` : ''}`;
}

function slotOfShare(slot: ShareSlot): BranchSlotChoice | null {
  if (slot === null || slot === undefined) return null;
  if (typeof slot !== 'string') return slot;
  if (slot.startsWith('>')) {
    const pokemonName = slot.slice(1);
    return { kind: 'switch', speciesId: toId(pokemonName), pokemonName };
  }
  const [rest, modifier] = slot.split('#');
  const [moveName, target] = rest.split('@');
  return {
    kind: 'move', moveId: toId(moveName), moveName,
    ...(target !== undefined ? { targetLoc: Number(target) } : {}),
    ...(modifier && (MODIFIERS as readonly string[]).includes(modifier) ? { modifier: modifier as BranchMoveModifier } : {}),
  };
}

const slotsOf = (choices: (BranchSlotChoice | null)[] | undefined): ShareSlot[] => (choices ?? []).map(shareSlot);

/** One history entry as the link keeps it. */
export function shareEntry(entry: BranchHistoryEntry): ShareEntry {
  if (entry.leadChoices) {
    const { p1, p2, bring } = entry.leadChoices;
    return bring ? ['L', p1, p2, 1] : ['L', p1, p2];
  }
  if (entry.kind === 'forced' && entry.forcedSide) {
    return [entry.forcedSide, slotsOf(entry.forcedSide === 'p1' ? entry.p1SlotChoices : entry.p2SlotChoices)];
  }
  return [slotsOf(entry.p1SlotChoices), slotsOf(entry.p2SlotChoices)];
}

/** The history entries a list of shared entries stands for: what a rebuild replays; `firstTurn` numbers the first turn (the rebuild writes the rest again). */
export function historyOfShare(entries: ShareEntry[], firstTurn = 1): BranchHistoryEntry[] {
  let turn = firstTurn;
  const bare = (turnNumber: number): BranchHistoryEntry => ({
    turnNumber, p1Choice: '', p2Choice: '', p1Active: null, p1ActiveSlots: [], p2Active: null, p2ActiveSlots: [], p1Pokemon: [], p2Pokemon: [],
  });
  return entries.map((entry): BranchHistoryEntry => {
    if (entry[0] === 'L') {
      return { ...bare(0), leadChoices: { p1: entry[1], p2: entry[2], ...(entry[3] === 1 ? { bring: true } : {}) } };
    }
    if (entry[0] === 'p1' || entry[0] === 'p2') {
      const side = entry[0];
      return { ...bare(Math.max(firstTurn, turn - 1)), kind: 'forced', forcedSide: side, [`${side}SlotChoices`]: entry[1].map(slotOfShare) };
    }
    const made: BranchHistoryEntry = { ...bare(turn), kind: 'turn', p1SlotChoices: entry[0].map(slotOfShare), p2SlotChoices: entry[1].map(slotOfShare) };
    turn += 1;
    return made;
  });
}

export interface GameShareInputs {
  record: NewGameRecord;
  /** The open variation (its history may be empty: no variation then). */
  variation?: { startTurn: number; history: BranchHistoryEntry[] };
  view?: GameSharePayload['view'];
  now?: Date;
}

export function makeGameSharePayload({ record, variation, view, now = new Date() }: GameShareInputs): GameSharePayload {
  const branch = variation && variation.history.length > 0 ? variation : null;
  return {
    version: GAME_SHARE_VERSION,
    kind: 'game',
    gameId: record.id,
    format: record.format,
    formatName: record.formatName,
    players: record.players,
    teams: { p1: Teams.pack(record.teams.p1), p2: Teams.pack(record.teams.p2) },
    seed: record.seed,
    entries: record.entries.map(shareEntry),
    ...(branch ? { variation: { startTurn: branch.startTurn, entries: branch.history.map(shareEntry) } } : {}),
    ...(view ? { view } : {}),
    branchTurn: branch ? branch.startTurn : record.turns + 1,
    createdAt: now.toISOString(),
  };
}

/**
 * Whether a saved game is the game a link holds: the same format, seed, players, teams (by their packed text), leads and entries,
 * entry for entry. A link whose main line goes past the game, or differs anywhere, is another game (H7: opening a link twice made
 * a copy each time, and the cap of saved games then dropped real games for them).
 */
export function sameGameAsShare(record: NewGameRecord, payload: GameSharePayload): boolean {
  return record.format === payload.format && record.seed === payload.seed
    && record.players[0] === payload.players[0] && record.players[1] === payload.players[1]
    && record.entries.length === payload.entries.length
    && Teams.pack(record.teams.p1) === payload.teams.p1 && Teams.pack(record.teams.p2) === payload.teams.p2
    && record.entries.every((entry, index) => JSON.stringify(shareEntry(entry)) === JSON.stringify(payload.entries[index]));
}

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const isEntryList = (value: unknown): value is ShareEntry[] => Array.isArray(value) && value.every(Array.isArray);

const isShareTeams = (value: unknown): boolean => {
  const teams = value as Partial<GameSharePayload['teams']> | undefined;
  return !!teams && typeof teams.p1 === 'string' && typeof teams.p2 === 'string';
};

const isShareVariation = (value: unknown): boolean => {
  if (value === undefined) return true;
  const variation = value as Partial<NonNullable<GameSharePayload['variation']>> | null;
  return !!variation && typeof variation.startTurn === 'number' && isEntryList(variation.entries);
};

/** Whether a decoded version 2 value holds every field the reader needs; the entries' inner shape is read when they are played. */
export function isGameSharePayload(value: unknown): value is GameSharePayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<GameSharePayload>;
  return v.version === GAME_SHARE_VERSION && v.kind === 'game'
    && [v.format, v.formatName, v.seed, v.gameId, v.createdAt].every(text => typeof text === 'string')
    && isStringList(v.players) && v.players.length === 2
    && isShareTeams(v.teams) && isEntryList(v.entries) && isShareVariation(v.variation);
}
