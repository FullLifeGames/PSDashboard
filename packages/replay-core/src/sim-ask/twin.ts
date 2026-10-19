import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';

/**
 * Round 72 (T239): the twin battle the engine asks the simulator on. Six places built it by hand with the same
 * lines (a seeded custom game of one generation, a side of one or two bodies, the team preview taken in team
 * order); this is the one factory. A twin answers a question the replay's own battle cannot: what a body does with
 * an item, a Tera click or a move the replay never played. The caller owns the sets, so no species or move name
 * lives here. A body the generation lacks throws as `new Battle` does; the caller decides what that means.
 */

export interface TwinSide {
  name: string;
  /** The side's bodies in team order; the first leads. */
  team: PokemonSet[];
}

export interface TwinOptions {
  /** The battle's PRNG seed; the callers' fixed `1,2,3,4` by default. */
  seed?: string;
  /** The team preview choice per side; the whole team in order by default, `false` to leave the preview open. */
  preview?: { p1: string; p2: string } | false;
}

const inOrder = (team: readonly PokemonSet[]): string => `team ${team.map((_, index) => index + 1).join('')}`;

/** A battle of the format between the two sides, past team preview (when it has one), seeded and ready to be played. */
export function twinBattle(format: string, sides: { p1: TwinSide; p2: TwinSide }, options: TwinOptions = {}): Battle {
  const battle = new Battle({
    formatid: toID(format), seed: (options.seed ?? '1,2,3,4') as never,
    p1: { name: sides.p1.name, team: Teams.pack(sides.p1.team) },
    p2: { name: sides.p2.name, team: Teams.pack(sides.p2.team) },
  });
  if (options.preview !== false && battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', options.preview?.p1 ?? inOrder(sides.p1.team));
    battle.choose('p2', options.preview?.p2 ?? inOrder(sides.p2.team));
  }
  return battle;
}
