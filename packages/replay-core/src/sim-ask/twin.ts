import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';

/** The one factory of the twin battle the engine asks the simulator on: the caller owns the sets, so no species or move name lives here. */

/** One side of a twin battle. */
export interface TwinSide {
  name: string;
  /** The side's bodies in team order; the first leads. */
  team: PokemonSet[];
}

/** Options of a twin battle. */
export interface TwinOptions {
  /** The battle's PRNG seed; the callers' fixed `1,2,3,4` by default. */
  seed?: string;
  /** The team preview choice per side; the whole team in order by default, `false` to leave the preview open. */
  preview?: { p1: string; p2: string } | false;
}

const inOrder = (team: readonly PokemonSet[]): string => `team ${team.map((_, index) => index + 1).join('')}`;

/** A seeded battle of the format between the two sides, past team preview (when it has one); a body the generation lacks throws as `new Battle` does. */
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
