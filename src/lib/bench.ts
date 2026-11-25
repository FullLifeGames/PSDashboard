import type { BranchSimState, BranchSwitchOption, BringWorld } from '@fulllifegames/eval-engine';
import {
  broughtSpeciesFor, getReplayBringCount, replayRules, speciesBaseId, type GameRules, type TurnSnapshot,
} from '@fulllifegames/replay-core';

// Where ADR 0024 trims the rebuild the battle holds no more bodies than the list and `limitBench` leaves it whole.

type ReplaySource = Parameters<typeof getReplayBringCount>[0];

/** The species each side's bench may offer, by side; an empty list leaves that side whole. */
export interface BenchLists { p1: string[]; p2: string[] }

export interface Bench { lists: BenchLists; rules: GameRules }

/** The bench lists of a replay, or null when no side has one; a short side passes the world the user plays. */
export function replayBench(source: ReplaySource, snapshots: TurnSnapshot[], world?: Pick<BringWorld, 'p1' | 'p2'>): Bench | null {
  const count = getReplayBringCount(source);
  if (count === null) return null;
  const rules = replayRules(source);
  if (world) return { lists: { p1: world.p1, p2: world.p2 }, rules };
  const listOf = (side: 'p1' | 'p2') => {
    const fielded = broughtSpeciesFor(snapshots, side, rules);
    return fielded.length === count ? fielded : [];
  };
  const lists = { p1: listOf('p1'), p2: listOf('p2') };
  return lists.p1.length === 0 && lists.p2.length === 0 ? null : { lists, rules };
}

// A forced replacement keeps its options when none is brought, else the variation stalls.
function limitOptions(
  options: BranchSwitchOption[], allowed: ReadonlySet<string>, rules: GameRules, forced: boolean,
): BranchSwitchOption[] {
  const kept = options.filter(option => allowed.has(speciesBaseId(option.species, rules)));
  if (kept.length === options.length || (forced && kept.length === 0)) return options;
  return kept;
}

/** The state with the unbrought bodies out of both sides' switch options; slot numbers stay (party positions). */
export function limitBench(state: BranchSimState, bench: Bench | null): BranchSimState {
  if (!bench) return state;
  const next: BranchSimState = { ...state };
  let changed = false;
  for (const side of ['p1', 'p2'] as const) {
    if (bench.lists[side].length === 0) continue;
    // A battle with no more bodies than the selection already is the selection: the swapped-in body stays on the bench.
    const party = state[`${side}Pokemon`];
    if (party && party.length > 0 && party.length <= bench.lists[side].length) continue;
    const allowed = new Set(bench.lists[side].map(name => speciesBaseId(name, bench.rules)));
    const forcedBySlot = state[`${side}ForceSwitches`] ?? [];
    const bySlot = state[`${side}SwitchesBySlot`].map((options, slot) =>
      limitOptions(options, allowed, bench.rules, forcedBySlot[slot] ?? false));
    const first = limitOptions(state[`${side}Switches`], allowed, bench.rules, state[`${side}ForceSwitch`]);
    if (bySlot.some((options, slot) => options !== state[`${side}SwitchesBySlot`][slot]) || first !== state[`${side}Switches`]) {
      next[`${side}SwitchesBySlot`] = bySlot;
      next[`${side}Switches`] = first;
      changed = true;
    }
  }
  return changed ? next : state;
}
