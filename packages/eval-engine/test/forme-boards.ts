import { expect } from 'vitest';
import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { battleOf } from './power-oracle';
import { set } from './move-oracle';

/**
 * Round 88 (#103): the boards of the forme sweeps (`switch-forme-sweep.spec.ts`, `body-forme-sites.spec.ts`): every generation and mod the
 * corpus plays, singles and doubles, a bench where a body takes any forme by the simulator's own `formeChange`.
 */
await loadSimMods('gen9championsou');

export interface Ruleset { label: string; singles: string; doubles: string; level: number; evs?: PokemonSet['evs'] }
export const RULESETS: Ruleset[] = [
  ...[3, 4, 5, 6, 7, 8, 9].map(gen => ({ label: `gen ${gen}`, singles: `gen${gen}customgame`, doubles: `gen${gen}doublescustomgame`, level: 100 })),
  { label: 'Champions', singles: 'gen9championscustomgame', doubles: 'gen9championsdoublescustomgame', level: 50, evs: { hp: 32, atk: 32, def: 0, spa: 32, spd: 2, spe: 0 } },
];

export const mon = (rules: Ruleset, species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet =>
  set(species, moves, { level: rules.level, ...(rules.evs ? { evs: rules.evs } : {}), ...extra });

export type GameType = 'singles' | 'doubles';

/**
 * A battle at p1's forced replacement: p1's level-1 Magikarp faints to Mewtwo's Psychic. The bench holds the target (an Eevee the
 * sweep turns into any forme) and a decoy of another species behind it, so a wrong pick shows as the wrong position.
 */
export function forcedBoard(rules: Ruleset, type: GameType, bench: PokemonSet[] = []): Battle {
  const fodder = mon(rules, 'Magikarp', ['splash'], { level: 1 });
  const spare = bench.length > 0 ? bench : [mon(rules, 'Eevee', ['splash']), mon(rules, 'Meowth', ['splash'])];
  const doubles = type === 'doubles';
  const p1 = doubles ? [mon(rules, 'Pikachu', ['splash']), fodder, ...spare] : [fodder, ...spare];
  const p2 = doubles ? [mon(rules, 'Mewtwo', ['psychic', 'splash']), mon(rules, 'Mew', ['splash'])] : [mon(rules, 'Mewtwo', ['psychic', 'splash'])];
  const battle = battleOf(type === 'doubles' ? rules.doubles : rules.singles, p1, p2);
  expect(battle.format.exists, `${type === 'doubles' ? rules.doubles : rules.singles} is a format of the Dex`).toBe(true);
  battle.choose('p1', doubles ? 'move 1, move 1' : 'move 1');
  battle.choose('p2', doubles ? 'move 1 2, move 1' : 'move 1');
  expect(battle.sides[0].requestState, 'the fodder fainted and p1 must replace it').toBe('switch');
  return battle;
}

/** What the resolver must leave alone: the log, the dice, the requests and every body's own state (read only). */
export function fingerprint(battle: Battle): string {
  return JSON.stringify({
    log: battle.log.length,
    seed: battle.prng.getSeed(),
    requests: battle.sides.map(side => side.requestState),
    bodies: battle.sides.map(side => side.pokemon.map(body => [body.name, body.species.name, body.hp, body.isActive, body.fainted, body.position])),
  });
}

/** The body takes a forme the way the simulator changes it in a battle (permanent, no source). */
export function become(body: Pokemon, species: string, name: string): void {
  expect(body.formeChange(species, null, true), `the simulator changes ${body.name} into ${species}`).toBeTruthy();
  body.name = name;
}

