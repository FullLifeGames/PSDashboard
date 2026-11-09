import type { BringList, BringSide } from '@fulllifegames/replay-core';

/**
 * Round 89 (#124): the worlds of a bring-limited game. A side that brought more bodies than it fielded still holds unknown
 * bodies: each choice of them from its team preview is one guess. A world is one set of guesses for both sides: its lists are the
 * fielded bodies plus the guesses (last), `guessed` counts the trailing guesses per side, `weight` is the world's share of the
 * game (the product of the sides' shares, renormalized over the worlds that stay). `trimTeamsToBring` fields exactly these lists.
 */
export interface BringWorld {
  p1: string[];
  p2: string[];
  /** How many trailing names of each list are guesses. */
  guessed: { p1: number; p2: number };
  weight: number;
}

/** The most worlds one game plays (ruling 15 of round 89: the three heaviest by usage weight, renormalized). */
export const BRING_WORLD_CAP = 3;

/** Two weights this close are one weight: the products of equal shares differ in the last bits by the order of the factors. */
const TIE = 1e-12;

interface SideWorld { guess: string[]; weight: number }

/** Every way a side's `open` bodies come from its candidates, in preview order, weighted by the product of the shares. */
function sideWorlds(side: BringSide): SideWorld[] {
  const worlds: SideWorld[] = [];
  const pick = (from: number, guess: string[], weight: number) => {
    if (guess.length === side.open) {
      worlds.push({ guess, weight });
      return;
    }
    for (let index = from; index < side.candidates.length; index++) {
      const candidate = side.candidates[index];
      pick(index + 1, [...guess, candidate.species], weight * candidate.weight);
    }
  };
  pick(0, [], 1);
  const total = worlds.reduce((sum, world) => sum + world.weight, 0);
  return worlds.map(world => ({ guess: world.guess, weight: total > 0 ? world.weight / total : 1 / worlds.length }));
}

/**
 * The worlds of a game, the heaviest first (ties by preview order), at most `cap` of them with their weights renormalized to
 * sum 1. Null for a bring-all game (no list). A game that pins both sides gives one world of weight 1 whose lists equal
 * `replayBringOnly`'s. Built once per game: in the app, in the bank and in a spec, from the list and the format's usage stats.
 */
export function bringWorlds(list: BringList | null | undefined, cap: number): BringWorld[] | null {
  if (!list) return null;
  const p1Worlds = sideWorlds(list.p1);
  const p2Worlds = sideWorlds(list.p2);
  const all: BringWorld[] = [];
  for (const first of p1Worlds) {
    for (const second of p2Worlds) {
      all.push({
        p1: [...list.p1.fielded, ...first.guess],
        p2: [...list.p2.fielded, ...second.guess],
        guessed: { p1: first.guess.length, p2: second.guess.length },
        weight: first.weight * second.weight,
      });
    }
  }
  if (all.length === 0) return null;
  all.sort((a, b) => (Math.abs(a.weight - b.weight) < TIE ? 0 : b.weight - a.weight));
  const kept = all.slice(0, Math.max(1, cap));
  const total = kept.reduce((sum, world) => sum + world.weight, 0);
  return kept.map(world => ({ ...world, weight: world.weight / total }));
}
