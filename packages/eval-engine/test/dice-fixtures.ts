import type { Battle, PokemonSet } from '@pkmn/sim';
import { set } from './move-oracle';
import { battleOf, fingerprint } from './power-oracle';

/**
 * Round 82 (forced dice): the boards the dice specs share. One scene is a small turn in every rule set the corpus plays
 * (Gens 1 to 9 and the Champions mod), singles and, from Gen 3 on, doubles. A scene whose move the generation lacks is
 * skipped, as the hook probe (lanes/A/p1-hooks.vt.ts) does.
 */

export interface Rules { name: string; generation: number; singles: string; doubles: string | null; level: number; evs?: PokemonSet['evs'] }

const gen = (generation: number): Rules => ({
  name: `Gen ${generation}`, generation, singles: `gen${generation}customgame`,
  doubles: generation >= 3 ? `gen${generation}doublescustomgame` : null, level: 100,
});

export const CHAMPIONS: Rules = {
  name: 'Champions', generation: 9, singles: 'gen9championscustomgame', doubles: 'gen9championsdoublescustomgame', level: 50,
  evs: { hp: 32, atk: 32, def: 0, spa: 32, spd: 2, spe: 0 },
};

export const RULES: Rules[] = [...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(gen), CHAMPIONS];
export const RULES_WITH_DOUBLES: Rules[] = RULES.filter(rules => rules.doubles);

export type Mode = 'singles' | 'doubles';

export interface Mon { species: string; moves: string[]; gender?: 'M' | 'F' }

export const mon = (rules: Rules, { species, moves, gender = 'F' }: Mon): PokemonSet =>
  set(species, moves, { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}), ...(rules.generation >= 2 ? { gender } : {}) });

export const seedOf = (index: number): string => [1, 2, 3, 4].map(offset => index * 4 + offset).join(',');

export interface Scene {
  id: string;
  /** The attacker (side p1) and the target (side p2); in doubles the partners splash beside them. */
  a: Mon;
  t: Mon;
  /** The foe's click when it does not splash; the attacker always uses its first move. */
  tMove?: boolean;
  /** The attacker's move hits several targets: in doubles its click names none. */
  spread?: boolean;
  /** Sets the position up before the turn (a status, a Substitute). */
  setup?(battle: Battle): void;
}

export const SNORLAX = (moves: string[]): Mon => ({ species: 'Snorlax', moves, gender: 'M' });
export const PIKACHU = (moves: string[]): Mon => ({ species: 'Pikachu', moves });

/** The board of a scene in one rule set and game type, or null when the rule set lacks a move of it. */
export function boardOf(rules: Rules, scene: Scene, mode: Mode, seed: string): Battle | null {
  const doubles = mode === 'doubles';
  const p1 = [mon(rules, scene.a)];
  const p2 = [mon(rules, scene.t)];
  if (doubles) {
    p1.push(mon(rules, { species: 'Blissey', moves: ['splash'] }));
    p2.push(mon(rules, { species: 'Chansey', moves: ['splash'] }));
  }
  const battle = battleOf(doubles ? rules.doubles! : rules.singles, p1, p2, seed);
  for (const entry of [scene.a, scene.t]) {
    for (const move of entry.moves) {
      const dex = battle.dex.moves.get(move);
      if (!dex.exists || dex.gen > battle.gen) return null;
    }
  }
  scene.setup?.(battle);
  return battle;
}

/** The two sides' clicks of the scene's turn: the attacker aims at the foe, the target splashes or aims back. */
export function clicksOf(scene: Scene, mode: Mode, aim = true): { p1: string; p2: string } {
  const doubles = mode === 'doubles';
  const p1 = doubles ? `move 1${aim && !scene.spread ? ' 1' : ''}, move 1` : 'move 1';
  const p2 = doubles ? `move 1${scene.tMove ? ' 1' : ''}, move 1` : 'move 1';
  return { p1, p2 };
}

/** The log without its wall-clock lines (`|t:|` differs between two runs a second apart). */
export const stableLog = (battle: Battle): string => battle.log.filter(line => !line.startsWith('|t:|')).join('\n');

export function playClicks(battle: Battle, clicks: { p1: string; p2: string }): void {
  if (!battle.choose('p1', clicks.p1) || !battle.choose('p2', clicks.p2)) throw new Error(`choice refused "${clicks.p1}" / "${clicks.p2}"`);
}

/** The scenes the identity grids play: a plain hit, a spread move, a multi-hit move, three bodies that draw before they move, a Substitute, two attackers. */
export const GRID_SCENES: Scene[] = [
  { id: 'tackle', a: SNORLAX(['tackle']), t: PIKACHU(['splash']) },
  { id: 'rockslide', a: SNORLAX(['rockslide']), t: PIKACHU(['splash']), spread: true },
  { id: 'airslash', a: SNORLAX(['airslash']), t: PIKACHU(['splash']) },
  { id: 'furyattack', a: SNORLAX(['furyattack']), t: PIKACHU(['splash']) },
  { id: 'tackle from a paralysed body', a: SNORLAX(['tackle']), t: PIKACHU(['splash']), setup: battle => void battle.sides[0].active[0]!.setStatus('par') },
  { id: 'tackle from a confused body', a: SNORLAX(['tackle']), t: PIKACHU(['splash']), setup: battle => void battle.sides[0].active[0]!.addVolatile('confusion') },
  { id: 'tackle into a Substitute', a: SNORLAX(['tackle']), t: PIKACHU(['splash']), setup: battle => void battle.sides[1].active[0]!.addVolatile('substitute') },
  { id: 'both sides attack', a: SNORLAX(['tackle']), t: PIKACHU(['tackle']), tMove: true },
];

/**
 * Round 82 (gate answer 1b): the full sweeps (every move, every row, every seed) run only with `DICE_SWEEPS=full`, which the
 * final suite of a round and the upgrade check of the simulator set. Any other run plays the same small sample of each list.
 */
export const SWEEPS_FULL = process.env.DICE_SWEEPS === 'full';

/** How many of a list each sweep plays without `DICE_SWEEPS=full`: a handful of moves, a few rows, two seeds, and 40 of a pool of seeds that a spec searches. */
const SAMPLE_SIZE: Record<string, number> = { moves: 6, rows: 4, seeds: 2, pool: 40 };

/**
 * The choice of moves (or rows, or seeds) a sweep plays: every sweep file takes its list through this one function (`sweepMoves`
 * calls it for the moves). A `sweep` name picks the sample size; a call without one gives the whole list (the census checks
 * read the lists whole). The sample is spread evenly over the list in its own order, so it is the same on every run and in
 * every CI job, and a list that is short already stays whole.
 */
export function sweepSelection<T>(items: readonly T[], sweep?: string): T[] {
  const size = SAMPLE_SIZE[sweep ?? ''];
  if (SWEEPS_FULL || size === undefined || items.length <= size) return [...items];
  return Array.from({ length: size }, (_, index) => items[Math.floor(((index + 0.5) * items.length) / size)]);
}

/**
 * Round 82 (forced dice), step A4: everything a question to the simulator could leave behind on the battle it reads (AGENTS.md:
 * a stand-in that calls a Dex handler proves the live battle unchanged). `fingerprint` of `power-oracle.ts` over every body
 * of both sides, plus the turn, the start-of-turn roll, the queue and the move in flight.
 */
export function standing(battle: Battle): string {
  const state = battle as unknown as { turn: number; quickClawRoll?: boolean; queue: { list: unknown[] }; activeMove: { id: string } | null };
  return `${fingerprint(battle, battle.sides.flatMap(side => side.pokemon), 'tackle')}|${state.turn}|${state.quickClawRoll}|${state.queue.list.length}|${state.activeMove?.id ?? ''}`;
}
