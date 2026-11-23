import { Battle, PRNG, Teams, type PokemonSet } from '@pkmn/sim';
import { executeBranchChoices, reconstructBranchRuntime, type BranchRuntime } from '../src/branch-engine';
import type { BranchSlotChoice } from '../src/branch-choices';
import type { ForcedDie } from '../src/dice/types';
import { set } from './move-oracle';

/** Small branches for the specs of the execution path: the runtime is the app's own (`reconstructBranchRuntime` on the log of a fresh game). */

export const mon = (species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet => set(species, moves, { level: 50, ...extra });

/** The public log of a fresh game past team preview: the leads are in, turn 1 is asked for. */
function freshLog(format: string, p1: PokemonSet[], p2: PokemonSet[]): string {
  const battle = new Battle({ formatid: format as never, seed: [1, 2, 3, 4], p1: { name: 'A', team: Teams.pack(p1) }, p2: { name: 'B', team: Teams.pack(p2) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return battle.log.filter((line, index, all) => !line.startsWith('|split|') && !all[index - 1]?.startsWith('|split|') && !line.startsWith('|t:|')).join('\n');
}

export async function branchOf(format: string, p1Team: PokemonSet[], p2Team: PokemonSet[], seed: string): Promise<BranchRuntime> {
  const runtime = await reconstructBranchRuntime({ format, p1Team, p2Team, replayLog: freshLog(format, p1Team, p2Team), targetTurn: 1 });
  runtime.battleStream.battle!.prng = new PRNG(seed as ConstructorParameters<typeof PRNG>[0]);
  return runtime;
}

export type Commands = { side: 'p1' | 'p2'; command: string }[];
export interface SlotChoices { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] }

export const clickWith = (moveId: string, dice: ForcedDie[] = [], extra: Partial<Extract<BranchSlotChoice, { kind: 'move' }>> = {}): BranchSlotChoice =>
  ({ kind: 'move', moveId, moveName: moveId, ...extra, ...(dice.length > 0 ? { dice } : {}) });

export const switchTo = (speciesId: string): BranchSlotChoice => ({ kind: 'switch', speciesId, pokemonName: speciesId });

export const accuracy = (slot: string, moveId: string, targetSlot: string, happens: boolean): ForcedDie =>
  ({ name: { slot, moveId, targetSlot, kind: 'accuracy' }, result: { happens } });

export function runTurn(runtime: BranchRuntime, commands: Commands, choices: SlotChoices | null) {
  return executeBranchChoices({
    streams: runtime.streams, log: runtime.log, choiceErrors: runtime.choiceErrors, commands,
    ...(choices ? { dice: { battle: runtime.battleStream.battle!, p1Choices: choices.p1, p2Choices: choices.p2 } } : {}),
  });
}

export const turnLines = (runtime: BranchRuntime, start: number): string[] =>
  runtime.battleStream.battle!.log.slice(start).filter(line => !line.startsWith('|t:|'));

export const seedOfBranch = (runtime: BranchRuntime): string => String(runtime.battleStream.battle!.prng.getSeed());
