import type { BranchSimState } from '@fulllifegames/eval-engine';
import { limitBench, type Bench } from './bench';

// Exact pickers from a recorded position: the serialized battle revives and the picker state is read off it. The battle stays with the state because the dice chips ask it which dice a move draws.

/** The battle a stored position revives to. */
export type PickerBattle = Awaited<ReturnType<typeof reviveBattle>>;

async function reviveBattle(serialized: string) {
  const { deserializeBattleExact } = await import('./lazy/forward-model');
  const { loadSimModsFor } = await import('./lazy/branch-engine');
  // A Champions position revives on the Champions mod, which nothing before this lazy module loads.
  await loadSimModsFor(serialized);
  return deserializeBattleExact(serialized);
}

/** The picker state of a recorded position with its battle; the state's bench offers only the bodies the bring allows (`bench`, from `replayBench`), the battle keeps the whole team. */
export async function pickerFromSerialized(
  serialized: string, bench: Bench | null = null,
): Promise<{ state: BranchSimState; battle: PickerBattle }> {
  const { createBranchStateFromBattle } = await import('./lazy/branch-engine');
  const battle = await reviveBattle(serialized);
  const state = createBranchStateFromBattle(battle, battle.log ?? [], { p1Choices: [], p2Choices: [] });
  return { state: limitBench(state, bench), battle };
}

/** `pickerFromSerialized` without the battle. */
export async function pickerStateFromSerialized(serialized: string, bench: Bench | null = null): Promise<BranchSimState> {
  return (await pickerFromSerialized(serialized, bench)).state;
}
