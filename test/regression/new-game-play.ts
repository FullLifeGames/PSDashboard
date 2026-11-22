import type { PokemonSet } from '@pkmn/sim';
import type { BranchRuntime, BranchSimState, BranchSlotChoice } from '@fulllifegames/eval-engine';
import { loadSimMods, startGameLog } from '@fulllifegames/eval-engine';
import * as branchEngine from '../../src/lib/lazy/branch-engine';
import type { BranchHistoryEntry } from '../../src/lib/branch-history';
import { bodyLines, newLines } from '../../src/lib/new-game/game-log';
import { appendTurn, newGameRecord, type NewGameRecord } from '../../src/lib/new-game/record';
import { gameStartParams } from '../../src/hooks/branch/game-rebuild';
import { leadHistoryEntry, replayHistoryEntry } from '../../src/hooks/branch/replay-entry';

/**
 * Round 89 (lane H, #105), stage H5: a new game played through the calls the hooks make, for the specs of the share link and the
 * state file (the invariant spec of H3, `new-game-log.spec.ts`, keeps its own copy of the loop with the re-adopting mode).
 */

export const SIX: PokemonSet[] = ['Garchomp', 'Gengar', 'Dragonite', 'Tyranitar', 'Snorlax', 'Starmie'].map(species => ({
  name: species, species, item: '', ability: '', moves: ['Earthquake', 'Protect', 'Return', 'Substitute'], nature: '', gender: '',
  evs: { hp: 4, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 100,
}));

export interface Family { name: string; format: string; leads: number; bring?: number }
export const FAMILIES: Family[] = [
  { name: 'Gen 9 OU', format: 'gen9ou', leads: 1 },
  { name: 'Doubles OU', format: 'gen9doublesou', leads: 2 },
  { name: 'VGC Scarlet/Violet', format: 'gen9vgc2025regi', leads: 2, bring: 4 },
  { name: 'Champions VGC', format: 'gen9championsvgc2026regmc', leads: 2, bring: 4 },
];

type Side = 'p1' | 'p2';
const id = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The default picks of a side at a request: its forced replacements, else a usable move of each live slot (the rotation varies the move). */
function picks(state: BranchSimState, side: Side, rotate: number): (BranchSlotChoice | null)[] {
  const forced = state[`${side}ForceSwitches`];
  const taken = new Set<string>();
  return state[`${side}ActiveSlots`].map((active, slot) => {
    if (forced.some(Boolean)) {
      if (!forced[slot]) return null;
      const next = state[`${side}SwitchesBySlot`][slot].find(option => !option.fainted && !taken.has(option.name));
      if (!next) return null;
      taken.add(next.name);
      return { kind: 'switch', speciesId: id(next.species), pokemonName: next.name };
    }
    if (!active || active.fainted) return null;
    const usable = state[`${side}MovesBySlot`][slot].filter(option => !option.disabled);
    const move = usable[rotate % usable.length];
    if (!move) return null;
    const target = move.requiresTarget ? move.targetOptions.find(option => option.side !== side)?.targetLoc : undefined;
    return { kind: 'move', moveId: id(move.name), moveName: move.name, ...(target !== undefined ? { targetLoc: target } : {}) };
  });
}

export const bareEntry = (turnNumber: number, extra: Partial<BranchHistoryEntry>): BranchHistoryEntry => ({
  turnNumber, p1Choice: '', p2Choice: '', p1Active: null, p1ActiveSlots: [], p2Active: null, p2ActiveSlots: [], p1Pokemon: [], p2Pokemon: [], ...extra,
});

function nextEntry(runtime: BranchRuntime, rotate: number): BranchHistoryEntry | null {
  const battle = runtime.battleStream.battle;
  if (!battle || battle.ended) return null;
  const state = branchEngine.createBranchState(runtime.battleStream, runtime.log, { p1Choices: [], p2Choices: [] });
  const forcedSide: Side | null = state.p1ForceSwitch === state.p2ForceSwitch ? null : state.p1ForceSwitch ? 'p1' : 'p2';
  if (forcedSide) return bareEntry(battle.turn, { kind: 'forced', forcedSide, [`${forcedSide}SlotChoices`]: picks(state, forcedSide, rotate) });
  return bareEntry(battle.turn, { kind: 'turn', p1SlotChoices: picks(state, 'p1', rotate), p2SlotChoices: picks(state, 'p2', rotate) });
}

export const leadsOf = (family: Family) => {
  const list = SIX.map(set => set.species).slice(0, family.bring ?? family.leads);
  return { p1: list, p2: list, ...(family.bring ? { bring: true } : {}) };
};

/** A game of up to `turns` finished turns on `seed`, played the way the hooks play it, as the record the app would have saved. */
export async function playRecord(family: Family, turns: number, seed = '7,8,9,10', teams: { p1: PokemonSet[]; p2: PokemonSet[] } = { p1: SIX, p2: SIX }): Promise<NewGameRecord> {
  await loadSimMods(family.format);
  const start = await startGameLog({ format: family.format, p1Team: teams.p1, p2Team: teams.p2, playerNames: ['Alice', 'Bob'], seed });
  const seedRecord = newGameRecord({ start, formatName: family.name, players: ['Alice', 'Bob'], seed, now: new Date('2026-11-13T10:00:00Z') });
  const runtime = await branchEngine.reconstructBranchRuntime(gameStartParams({ ...seedRecord, entries: [bareEntry(0, { leadChoices: leadsOf(family) })] })!);
  const lead = leadHistoryEntry(branchEngine, runtime, leadsOf(family), branchEngine.captureSerializedPosition(runtime.battleStream.battle));
  let record = appendTurn(seedRecord, { entries: [lead], lines: bodyLines(runtime.log) });
  let known = runtime.log.length;
  for (let turn = 1; turn <= turns; turn += 1) {
    const finished: BranchHistoryEntry[] = [];
    for (let step = 0; step < 4; step += 1) {
      const wanted = nextEntry(runtime, turn);
      if (!wanted) break;
      const outcome = await replayHistoryEntry(runtime, branchEngine, wanted);
      if (!outcome.ok) throw new Error(`turn ${turn}: ${outcome.error}`);
      finished.push(outcome.entry);
      const after = branchEngine.createBranchState(runtime.battleStream, runtime.log, { p1Choices: [], p2Choices: [] });
      if ((!after.p1ForceSwitch && !after.p2ForceSwitch) || runtime.battleStream.battle?.ended) break;
    }
    if (finished.length === 0) break;
    record = appendTurn(record, { entries: finished, lines: newLines(runtime.log, known) });
    known = runtime.log.length;
  }
  return record;
}
