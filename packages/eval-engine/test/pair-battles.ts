import { readFileSync } from 'node:fs';
import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { createRootPosition, type SimPosition } from '../src/forward-model';

/**
 * Round 56 test helpers for the doubles pair plan: the anchor position (VGC
 * 2634199230 turn 5, rebuilt over the bank's app build, probe
 * docs/perf/probes/2026-09-23-r56/plan-facts.vt.ts) with its three cells,
 * and a builder for small doubles battles.
 */
const ANCHOR = JSON.parse(readFileSync(
  new URL('./fixtures/positions/gen9championsvgc2026regmbbo3-2634199230-t5.json', import.meta.url), 'utf-8',
)) as { serialized: string };

export const anchorRoot = (): SimPosition => createRootPosition(ANCHOR.serialized);

/** The played pair of turn 5: Play Rough misses Incineroar on seed 1,2,3,4 and Flare Blitz kills Sinistcha. */
export const PLAYED = ['move lifedew, move playrough 2', 'move matchagotcha, move flareblitz 1'] as const;
/** Matcha Gotcha into both p1 bodies; nothing of p1 attacks, Incineroar leaves. */
export const SPREAD = ['move lifedew, move swordsdance', 'move matchagotcha, switch 3'] as const;
/** No roll at all: status moves against two switches. */
export const QUIET = ['move lifedew, move swordsdance', 'switch 3, switch 4'] as const;

export function pairSet(name: string, species: string, moves: string[], extra: Partial<PokemonSet> = {}): PokemonSet {
  return {
    name, species, item: '', ability: 'No Ability', moves, nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 252, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50, gender: '', ...extra,
  };
}

/** A doubles custom game past team preview (every set in team order); `setup` may change the battle before it is serialized. */
export function doublesRoot(p1: PokemonSet[], p2: PokemonSet[], setup?: (battle: Battle) => void): SimPosition {
  const battle = new Battle({
    formatid: toID('gen9doublescustomgame'),
    seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1) },
    p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  setup?.(battle);
  return createRootPosition(JSON.stringify(State.serializeBattle(battle)));
}
