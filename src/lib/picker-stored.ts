import type { BranchSimState } from '@fulllifegames/eval-engine';
import { limitBench, type Bench } from './bench';

// The battle stays with the state: the dice chips ask it which dice a move draws.

export type PickerBattle = Awaited<ReturnType<typeof reviveBattle>>;

async function reviveBattle(serialized: string) {
  const { deserializeBattleExact } = await import('./lazy/forward-model');
  const { loadSimModsFor } = await import('./lazy/branch-engine');
  await loadSimModsFor(serialized);
  return deserializeBattleExact(serialized);
}

export async function pickerFromSerialized(
  serialized: string, bench: Bench | null = null,
): Promise<{ state: BranchSimState; battle: PickerBattle }> {
  const { createBranchStateFromBattle } = await import('./lazy/branch-engine');
  const battle = await reviveBattle(serialized);
  const state = createBranchStateFromBattle(battle, battle.log ?? [], { p1Choices: [], p2Choices: [] });
  return { state: limitBench(state, bench), battle };
}

export async function pickerStateFromSerialized(serialized: string, bench: Bench | null = null): Promise<BranchSimState> {
  return (await pickerFromSerialized(serialized, bench)).state;
}
