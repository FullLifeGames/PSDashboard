import { PRNG, type Battle } from '@pkmn/sim';
import type { FlipTurn } from '../src/dice/flip';
import { copyOf } from '../src/sim-ask/copy';
import { playClicks, standing } from './dice-fixtures';

// The oracle is the simulator's own `randomChance`: a spy over the stream of a plain turn records every call.

export function turnOf(board: Battle, clicks: { p1: string; p2: string }): FlipTurn {
  return {
    fork: () => {
      const copy = copyOf(board);
      (copy as unknown as { debugMode: boolean }).debugMode = false;
      copy.prng ??= board.prng.clone();
      return copy;
    },
    play: battle => playClicks(battle, clicks),
  };
}

export interface Called { chance: number; numerator: number; denominator: number; event: string | undefined; effect: string | undefined }

export function chancesCalled(board: Battle, clicks: { p1: string; p2: string }): Called[] {
  const battle = turnOf(board, clicks).fork();
  const natural = battle.prng;
  const called: Called[] = [];
  battle.prng = new (class extends PRNG {
    override random(from?: number, to?: number): number {
      return natural.random(from, to);
    }
    override randomChance(numerator: number, denominator: number): boolean {
      const event = battle.event as { id?: string } | undefined;
      const effect = battle.effect as { id?: string } | undefined;
      called.push({ chance: numerator / denominator, numerator, denominator, event: event?.id, effect: effect?.id });
      return natural.randomChance(numerator, denominator);
    }
  })(natural.getSeed());
  playClicks(battle, clicks);
  return called;
}

export const liveState = (board: Battle): string => `${standing(board)}|${board.log.length}|${board.prng.getSeed()}`;
