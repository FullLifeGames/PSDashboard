import { describe, expect, test } from 'vitest';
import { PRNG, type Battle, type PRNGSeed } from '@pkmn/sim';
import { loadSimMods } from '../src/forward/sim-mods';
import { serializeBattleStable } from '../src/forward/serialize';
import { ScriptedPRNG, type RollScript, type RollScripts } from '../src/forward/scripted-prng';
import { PairPRNG, type PairScript } from '../src/pair/prng';
import { boardOf, clicksOf, GRID_SCENES, playClicks, seedOf, stableLog, SWEEPS_FULL, type Mode, type Rules, type Scene } from './dice-fixtures';
import { sweepMoves, SWEEP_CASES } from './dice-sweep-support';
import { LegacyScriptedPRNG } from './scripted-prng-legacy';

/**
 * Round 86 (T299): the parity sweep of the tree's two scripted PRNGs. Both now ask the module's namer (`dice/namer.ts`) which
 * die a draw is, so the sweep holds the change to what must stay as it was, in every generation 1 to 9 and the Champions mod,
 * singles and (from Gen 3) doubles:
 *
 * 1. A script for a move that is not played changes nothing the simulator can see: the plain PRNG's log, end seed and stable
 *    serialization, and after the turn the battle has none of the watch's wrappers (the live battle unchanged: the namer calls
 *    no Dex handler, it reads `battle.event` and `battle.effect`, so this is the proof AGENTS.md asks of a stand-in).
 * 2. For Gens 3 to 9 and Champions, on scenes with no status check, the new `ScriptedPRNG` and a frozen copy of the class as
 *    it was before round 86 give the same log, end seed and serialization for the scripts `hit and crit`, `miss, no crit`,
 *    `roll 0` and `roll 15`: every cell that read right keeps its price.
 * 3. The roll mapping: a script's top roll hurts more than its bottom roll under `PairPRNG` too.
 * 4. Mid-turn arrival: the faster body's status move lands (every Dex move that inflicts paralysis, confusion or infatuation
 *    on a foe, read from the Dex of the rule set) and the slower body's scripted move still gets its accuracy, crit and
 *    damage roll answered while its status check follows the seed.
 */
await loadSimMods('gen9championsou');

const SEEDS = Array.from({ length: SWEEPS_FULL ? 32 : 8 }, (_, index) => seedOf(index));
const cases = SWEEP_CASES;

/** The dice a case plays with; `release` is the watch's exit. */
interface Dice extends PRNG { attach?(battle: Battle): void; release?(): void }

/** Plays the scene's turn under the dice (the plain PRNG when none). Null when the rule set lacks a move of the scene. */
function playScene(rules: Rules, scene: Scene, mode: Mode, seed: string, dice: Dice | null): Battle | null {
  const board = boardOf(rules, scene, mode, seed);
  if (!board) return null;
  const used = dice ?? new PRNG(seed as PRNGSeed);
  used.attach?.(board);
  board.prng = used;
  playClicks(board, clicksOf(scene, mode));
  used.release?.();
  return board;
}

const ownNames = (battle: Battle): string => JSON.stringify([
  Object.getOwnPropertyNames(battle).sort(),
  Object.getOwnPropertyNames((battle as unknown as { actions: object }).actions).sort(),
  battle.sides.flatMap(side => side.pokemon.map(body => Object.getOwnPropertyNames(body).sort())),
]);

const sameTurn = (ours: Battle, plain: Battle, label: string): void => {
  expect(stableLog(ours), label).toBe(stableLog(plain));
  expect(ours.prng.getSeed(), label).toEqual(plain.prng.getSeed());
  expect(serializeBattleStable(ours), label).toBe(serializeBattleStable(plain));
  expect(ownNames(ours), label).toBe(ownNames(plain));
};

/** A script for a move that no scene plays. */
const UNPLAYED: RollScript & PairScript = { hit: false, crit: true, roll: 3, doubled: true };

describe.each(cases)('a script for a move that is not played changes nothing: $name', ({ rules, mode }) => {
  test('the log, the end seed, the serialization and the own keys equal the plain PRNG\'s, over every scene', () => {
    let played = 0;
    for (const scene of GRID_SCENES) {
      for (const seed of SEEDS) {
        const plain = playScene(rules, scene, mode, seed, null);
        if (!plain) break;
        const scripted = new ScriptedPRNG(seed as PRNGSeed, new Map([['p1:thunderbolt', UNPLAYED]]));
        sameTurn(playScene(rules, scene, mode, seed, scripted)!, plain, `${scene.id} ${seed} ScriptedPRNG`);
        if (mode === 'doubles') {
          const pair = new PairPRNG(seed as PRNGSeed, new Map([['p1a:thunderbolt>p2a', UNPLAYED]]));
          sameTurn(playScene(rules, scene, mode, seed, pair)!, plain, `${scene.id} ${seed} PairPRNG`);
        }
        played++;
      }
    }
    expect(played).toBeGreaterThan(0);
  });
});

/** The scenes with no status check on the attacker: the cells that read right before round 86. */
const CHECK_FREE = GRID_SCENES.filter(scene => !scene.setup || scene.id === 'tackle into a Substitute');

const SCRIPTS: Record<string, RollScript> = {
  'hit and crit': { hit: true, crit: true },
  'miss, no crit': { hit: false, crit: false },
  'roll 0': { hit: true, crit: false, roll: 0 },
  'roll 15': { hit: true, crit: false, roll: 15 },
};

describe.each(cases.filter(({ rules }) => rules.generation >= 3))('the new ScriptedPRNG equals the class of the base where it read right: $name', ({ rules, mode }) => {
  for (const [label, script] of Object.entries(SCRIPTS)) {
    test(`script "${label}": log, end seed and serialization over every check-free scene`, () => {
      let played = 0;
      for (const scene of CHECK_FREE) {
        const scripts: RollScripts = new Map([[`p1:${scene.a.moves[0]}`, script]]);
        for (const seed of SEEDS) {
          const old = playScene(rules, scene, mode, seed, new LegacyScriptedPRNG(seed as PRNGSeed, scripts));
          if (!old) break;
          const ours = playScene(rules, scene, mode, seed, new ScriptedPRNG(seed as PRNGSeed, scripts))!;
          expect(stableLog(ours), `${scene.id} ${seed}`).toBe(stableLog(old));
          expect(ours.prng.getSeed(), `${scene.id} ${seed}`).toEqual(old.prng.getSeed());
          expect(serializeBattleStable(ours), `${scene.id} ${seed}`).toBe(serializeBattleStable(old));
          played++;
        }
      }
      expect(played).toBeGreaterThan(0);
    });
  }
});

describe.each(cases.filter(({ mode }) => mode === 'doubles'))('the roll mapping under PairPRNG: $name', ({ rules }) => {
  test('the top roll hurts more than the bottom roll on every seed', () => {
    const scene = GRID_SCENES[0];
    const damage = (seed: string, roll: number): number => {
      const dice = new PairPRNG(seed as PRNGSeed, new Map([['p1a:tackle>p2a', { hit: true, crit: false, roll }]]));
      const target = playScene(rules, scene, 'doubles', seed, dice)!.sides[1].active[0]!;
      return target.maxhp - target.hp;
    };
    expect(SEEDS.filter(seed => damage(seed, 0) <= damage(seed, 15)), 'seeds where the roll did not move the damage').toEqual([]);
  });
});

/** The status the faster body's move puts on the slower one, and the check that status draws in the slower body's action. */
const LANDED = /^\|-(?:status|start)\|p1a: Snorlax\|(?:par|confusion|(?:move: )?Attract)/;
const CHECKED = /^\|cant\|p1a: Snorlax\|(?:par|(?:move: )?Attract)|^\|-damage\|p1a: Snorlax\|[^|]*\|\[from\] confusion/;
const MOVED = /^\|move\|p1a: Snorlax\|Tackle/;
const shows = (log: readonly string[], pattern: RegExp): boolean => log.some(line => pattern.test(line));

describe.each(cases)('a status that lands mid-turn leaves the slower body\'s scripted dice to the script and its check to the seed: $name', ({ rules, mode }) => {
  const { moves } = sweepMoves(rules, move => move.category === 'Status' && move.target === 'normal'
    && (move.status === 'par' || move.volatileStatus === 'confusion' || move.volatileStatus === 'attract'));

  test('the Dex lists moves that inflict paralysis, confusion or infatuation on a foe', () => {
    expect(moves.length).toBeGreaterThan(0);
  });

  for (const move of moves) {
    test(`${move.name}: the check follows the plain seed, the move's accuracy, crit and roll follow the script`, () => {
      const scene: Scene = { id: move.id, a: { species: 'Snorlax', moves: ['tackle'], gender: 'M' }, t: { species: 'Pikachu', moves: [move.id] }, tMove: true };
      let landedSeeds = 0;
      for (const seed of SEEDS) {
        const plain = playScene(rules, scene, mode, seed, null);
        if (!plain || !shows(plain.log, LANDED) || !shows(plain.log, MOVED)) continue;
        landedSeeds++;
        for (const script of [{ hit: true, crit: true, roll: 0 }, { hit: false, crit: false }] as const) {
          const dice: Dice = mode === 'singles'
            ? new ScriptedPRNG(seed as PRNGSeed, new Map([['p1:tackle', script]]))
            : new PairPRNG(seed as PRNGSeed, new Map([['p1a:tackle>p2a', script]]));
          const ours = playScene(rules, scene, mode, seed, dice)!;
          const label = `${move.name} ${seed} ${JSON.stringify(script)}`;
          expect(shows(ours.log, CHECKED), label).toBe(shows(plain.log, CHECKED));
          expect(shows(ours.log, MOVED), label).toBe(true);
          expect(shows(ours.log, /^\|-miss\|p1a: Snorlax|^\|move\|p1a: Snorlax\|Tackle\|.*\[miss\]/), label).toBe(!script.hit);
          if (script.hit) expect(shows(ours.log, /^\|-crit\|p2a: Pikachu/), label).toBe(true);
        }
      }
      expect(landedSeeds, 'seeds where the status landed and the slower body moved').toBeGreaterThan(0);
    });
  }
});
