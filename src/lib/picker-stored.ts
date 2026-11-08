import type { BranchSimState } from '@fulllifegames/eval-engine';
import { limitBench, type Bench } from './bench';

/**
 * Exact pickers from a recorded position: the position's serialized battle revives, the picker state is read off it. Round 82
 * (forced dice), step A7b: the battle stays with the state, because the dice chips of a viewed replay position ask it which dice a
 * move draws.
 */

/** The battle a stored position revives to. */
export type PickerBattle = Awaited<ReturnType<typeof reviveBattle>>;

async function reviveBattle(serialized: string) {
  const { deserializeBattleExact } = await import('./lazy/forward-model');
  const { loadSimModsFor } = await import('./lazy/branch-engine');
  // Round 67 (T145): a Champions position revives on the Champions mod, which nothing before this lazy module loads.
  await loadSimModsFor(serialized);
  return deserializeBattleExact(serialized);
}

/**
 * The picker state of a recorded position with the battle it was read from. Round 88 (T314, #55): the state's bench offers only the
 * bodies the bring allows (`bench`, from `replayBench`); the battle keeps the whole team the rebuild built.
 */
export async function pickerFromSerialized(
  serialized: string, bench: Bench | null = null,
): Promise<{ state: BranchSimState; battle: PickerBattle }> {
  const { createBranchStateFromBattle } = await import('./lazy/branch-engine');
  const battle = await reviveBattle(serialized);
  const state = createBranchStateFromBattle(battle, battle.log ?? [], { p1Choices: [], p2Choices: [] });
  return { state: limitBench(state, bench), battle };
}

/** Exact pickers from a recorded position — no live stream needed. */
export async function pickerStateFromSerialized(serialized: string, bench: Bench | null = null): Promise<BranchSimState> {
  return (await pickerFromSerialized(serialized, bench)).state;
}
