import { describe, expect, test } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import { parseReplayLog } from '@fulllifegames/replay-core';
import type { BranchSimState, BranchSlotChoice } from '@fulllifegames/eval-engine';
import { loadSimMods, startGameLog } from '@fulllifegames/eval-engine';
import * as branchEngine from '../../src/lib/lazy/branch-engine';
import type { BranchHistoryEntry } from '../../src/lib/branch-history';
import { assembleGameLog, bodyLines, newLines } from '../../src/lib/new-game/game-log';
import { appendTurn, gameReplayData, newGameRecord, type NewGameRecord } from '../../src/lib/new-game/record';
import { gameAdoptSnapshot, gamePositions, gameStartParams, rebuildGame } from '../../src/hooks/branch/game-rebuild';
import { leadHistoryEntry, replayHistoryEntry } from '../../src/hooks/branch/replay-entry';
import type { BranchRuntime } from '@fulllifegames/eval-engine';

/**
 * Round 89 (lane H, #105), stage H3: the invariant of a new game. The record is the truth and its log the replay: a game of eight
 * turns, played two ways through the calls the hooks make (a continuous runtime, and a runtime adopted from the stored position at
 * the tip before every turn, as when the user comes back from a variation), grows its record by promotion, and the log it grew
 * equals the log the rebuild writes from the record's entries, byte for byte. Every position serializes equal and the parser reads
 * one snapshot per turn plus the tip. One row per family, Scarlet/Violet and Champions; the Champions realm loads its mod first.
 */

const SIX: PokemonSet[] = ['Garchomp', 'Gengar', 'Dragonite', 'Tyranitar', 'Snorlax', 'Starmie'].map(species => ({
  name: species, species, item: '', ability: '', moves: ['Earthquake', 'Protect', 'Return', 'Substitute'], nature: '', gender: '',
  evs: { hp: 4, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
}));

const TURNS = 8;
type Side = 'p1' | 'p2';

/** The default picks of a side at a request: its forced replacements, else the first usable move of each live slot (the rotation varies the move). */
function picks(state: BranchSimState, side: Side, rotate: number): (BranchSlotChoice | null)[] {
  const forced = state[`${side}ForceSwitches`];
  const actives = state[`${side}ActiveSlots`];
  const moves = state[`${side}MovesBySlot`];
  const switches = state[`${side}SwitchesBySlot`];
  const taken = new Set<string>();
  return actives.map((active, slot) => {
    if (forced.some(Boolean)) {
      if (!forced[slot]) return null;
      const next = switches[slot].find(option => !option.fainted && !taken.has(option.name));
      if (!next) return null;
      taken.add(next.name);
      return { kind: 'switch', speciesId: next.species.toLowerCase().replace(/[^a-z0-9]/g, ''), pokemonName: next.name };
    }
    if (!active || active.fainted) return null;
    const usable = moves[slot].filter(option => !option.disabled);
    const move = usable[rotate % usable.length];
    if (!move) return null;
    const target = move.requiresTarget ? move.targetOptions.find(option => option.side !== side)?.targetLoc : undefined;
    return { kind: 'move', moveId: move.name.toLowerCase().replace(/[^a-z0-9]/g, ''), moveName: move.name, ...(target !== undefined ? { targetLoc: target } : {}) };
  });
}

const bare = (turnNumber: number, extra: Partial<BranchHistoryEntry>): BranchHistoryEntry => ({
  turnNumber, p1Choice: '', p2Choice: '', p1Active: null, p1ActiveSlots: [], p2Active: null, p2ActiveSlots: [], p1Pokemon: [], p2Pokemon: [], ...extra,
});

/** The entry the next request asks for: the one side that must replace alone, else one turn (a replacement on both sides is one entry of kind turn). */
function nextEntry(runtime: BranchRuntime, rotate: number): BranchHistoryEntry | null {
  const battle = runtime.battleStream.battle;
  if (!battle || battle.ended) return null;
  const state = branchEngine.createBranchState(runtime.battleStream, runtime.log, { p1Choices: [], p2Choices: [] });
  const forcedSide: Side | null = state.p1ForceSwitch === state.p2ForceSwitch ? null : state.p1ForceSwitch ? 'p1' : 'p2';
  if (forcedSide) {
    return bare(battle.turn, { kind: 'forced', forcedSide, [`${forcedSide}SlotChoices`]: picks(state, forcedSide, rotate) });
  }
  return bare(battle.turn, { kind: 'turn', p1SlotChoices: picks(state, 'p1', rotate), p2SlotChoices: picks(state, 'p2', rotate) });
}

interface Family { name: string; format: string; leads: number; bring?: number }
const FAMILIES: Family[] = [
  { name: 'Gen 9 OU', format: 'gen9ou', leads: 1 },
  { name: 'Doubles OU', format: 'gen9doublesou', leads: 2 },
  { name: 'VGC Scarlet/Violet', format: 'gen9vgc2025regi', leads: 2, bring: 4 },
  { name: 'Champions OU', format: 'gen9championsou', leads: 1 },
  { name: 'Champions VGC', format: 'gen9championsvgc2026regmc', leads: 2, bring: 4 },
  { name: 'Gen 4 OU, no team preview', format: 'gen4ou', leads: 1 },
];

const names = SIX.map(set => set.species);
const leadsOf = (family: Family) => {
  const list = names.slice(0, family.bring ?? family.leads);
  return { p1: list, p2: list, ...(family.bring ? { bring: true } : {}) };
};

async function startRecord(family: Family): Promise<NewGameRecord> {
  await loadSimMods(family.format);
  const start = await startGameLog({ format: family.format, p1Team: SIX, p2Team: SIX, playerNames: ['Alice', 'Bob'], seed: '7,8,9,10' });
  const record = newGameRecord({ start, formatName: family.format, players: ['Alice', 'Bob'], seed: '7,8,9,10', now: new Date('2026-11-12T10:00:00Z') });
  return { ...record, entries: [bare(0, { leadChoices: leadsOf(family) })] };
}

/**
 * The positions as the simulator holds them, without what only indexes or labels the log: the two cursors into it (`sentLogPos`,
 * `lastMoveLine`: an adopted battle counts the lines of its own clock-free log, a continuous one the clock lines too) and the
 * `formatid` an adopted battle's serialization adds. Everything else, the PRNG included, compares equal.
 */
const INERT = new Set(['sentLogPos', 'lastMoveLine', 'formatid']);
const strip = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !INERT.has(key)).map(([key, inner]) => [key, strip(inner)]));
  }
  return value;
};
const canonical = (positions: Map<number, string>) => [...positions].map(([turn, text]) => [turn, strip(JSON.parse(text))]);

interface Played { record: NewGameRecord; positions: Map<number, string>; log: string[] }

/** Plays the game the way the hooks do. `adopt`: before every turn the runtime is replaced by one adopted from the stored position. */
async function play(family: Family, adopt: boolean): Promise<Played> {
  const seed = await startRecord(family);
  let record: NewGameRecord = { ...seed, entries: [] };
  const params = gameStartParams(seed);
  if (!params) throw new Error('no lead');
  let runtime = await branchEngine.reconstructBranchRuntime(params);
  const lead = leadHistoryEntry(branchEngine, runtime, leadsOf(family), branchEngine.captureSerializedPosition(runtime.battleStream.battle));
  record = appendTurn(record, { entries: [lead], lines: bodyLines(runtime.log) });
  let known = runtime.log.length;
  const all: BranchHistoryEntry[] = [lead];
  for (let turn = 1; turn <= TURNS; turn += 1) {
    if (adopt) {
      const text = gameReplayData(record).log;
      const targetTurn = runtime.battleStream.battle?.turn ?? turn;
      const snapshot = gameAdoptSnapshot(parseReplayLog(text), targetTurn);
      runtime = branchEngine.adoptSerializedRuntime({
        serialized: all[all.length - 1].serializedPosition as string, replayLog: text, targetTurn, snapshot,
      });
      known = runtime.log.length;
    }
    // one turn: its entry and the interludes that finish it
    const finished: BranchHistoryEntry[] = [];
    for (let step = 0; step < 4; step += 1) {
      const wanted = nextEntry(runtime, turn);
      if (!wanted) break;
      const outcome = await replayHistoryEntry(runtime, branchEngine, wanted);
      if (!outcome.ok) throw new Error(`turn ${turn}: ${outcome.error} ${runtime.choiceErrors.last}`);
      finished.push(outcome.entry);
      const stateAfter = branchEngine.createBranchState(runtime.battleStream, runtime.log, { p1Choices: [], p2Choices: [] });
      if (!stateAfter.p1ForceSwitch && !stateAfter.p2ForceSwitch) break;
      if (runtime.battleStream.battle?.ended) break;
    }
    if (finished.length === 0) break;
    record = appendTurn(record, { entries: finished, lines: newLines(runtime.log, known) });
    known = runtime.log.length;
    all.push(...finished);
  }
  return { record, positions: gamePositions(all), log: runtime.log };
}

describe('a new game: the log it grows is the log its record rebuilds', () => {
  for (const family of FAMILIES) {
    test(`${family.name}: continuous, re-adopted at the tip, and rebuilt from the record agree`, async () => {
      const continuous = await play(family, false);
      const adopted = await play(family, true);
      expect(continuous.record.turns).toBeGreaterThanOrEqual(3);
      const rebuilt = await rebuildGame(branchEngine, continuous.record);
      expect(rebuilt?.failure).toBeNull();
      const rebuiltBody = bodyLines(rebuilt!.runtime.log);
      expect(rebuiltBody).toEqual(continuous.record.body);
      expect(bodyLines(continuous.log)).toEqual(continuous.record.body);
      expect(adopted.record.body).toEqual(continuous.record.body);
      expect(adopted.record.turns).toBe(continuous.record.turns);
      expect(canonical(gamePositions(rebuilt!.entries))).toEqual(canonical(continuous.positions));
      expect(canonical(adopted.positions)).toEqual(canonical(continuous.positions));
      const text = assembleGameLog(continuous.record.header, continuous.record.body);
      expect(gameReplayData(continuous.record).log).toBe(text);
      expect(text).not.toContain('|t:|');
      const snapshots = parseReplayLog(text);
      expect(snapshots.map(snapshot => snapshot.turn)).toEqual(Array.from({ length: snapshots.length }, (_, index) => index + 1));
      expect(snapshots.length).toBe(continuous.record.turns + 1);
    }, 180_000);
  }
});
