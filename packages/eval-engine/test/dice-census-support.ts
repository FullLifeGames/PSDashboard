import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { DieKind } from '../src/dice/types';

/**
 * Round 82 (forced dice), step A4: the scan and the classes of the census (dice-census.spec.ts), shared with the ability sweep,
 * which holds every die of scope here to a proc it plays.
 */
const require = createRequire(import.meta.url);
const simRoot = join(dirname(require.resolve('@pkmn/sim')), '..');

type Table = Record<string, unknown>;
interface Source { name: string; tables: Record<string, Table>; whole: boolean }

const load = (path: string): Record<string, Table> => require(path) as Record<string, Table>;
const MODS = ['gen1', 'gen2', 'gen3', 'gen4', 'gen5', 'gen6', 'gen7', 'gen8'];
const FILES = [['Abilities', 'abilities'], ['Items', 'items'], ['Conditions', 'conditions'], ['Moves', 'moves']] as const;

function sources(): Source[] {
  const read = (dir: string): Record<string, Table> => {
    const tables: Record<string, Table> = {};
    for (const [key, file] of FILES) {
      try {
        const loaded = load(join(simRoot, dir, file));
        tables[key] = loaded[key];
      } catch { /* a mod without that file */ }
    }
    return tables;
  };
  const champions = load(require.resolve('@pkmn/mods/champions'));
  return [
    { name: 'base', tables: read('data'), whole: false },
    ...MODS.map(mod => ({ name: mod, tables: read(join('data', 'mods', mod)), whole: false })),
    { name: 'champions', tables: { ...champions }, whole: true },
  ];
}

/** A call of the simulator's PRNG, whitespace folded: `randomChance(3, 10)`, `random(2, 5)`, `sample(stats)`. */
export const DRAW = /\.(randomChance|random|sample|shuffle)\(((?:[^()]|\([^()]*\))*)\)/g;

function handlersOf(value: unknown, path: string, out: [string, string][], depth = 0): void {
  if (typeof value === 'function') {
    for (const match of value.toString().matchAll(DRAW)) out.push([path, `${match[1]}(${match[2].replace(/\s+/g, ' ').trim()})`]);
    return;
  }
  if (typeof value !== 'object' || value === null || depth > 4) return;
  for (const [key, inner] of Object.entries(value)) handlersOf(inner, path ? `${path}.${key}` : key, out, depth + 1);
}

/** Every handler with a draw: `table/entry/handler` mapped to the sorted distinct calls it makes, across all sources. */
export function scan(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const source of sources()) {
    for (const [tableName, table] of Object.entries(source.tables)) {
      if (!table || typeof table !== 'object') continue;
      for (const [id, entry] of Object.entries(table)) {
        const rows: [string, string][] = [];
        // data tables: a move's own draws belong to the move sweeps; its nested conditions (infatuation) are conditions. The Champions bundle is scanned whole.
        if (tableName === 'Moves' && !source.whole) {
          handlersOf((entry as { condition?: unknown })?.condition, 'condition', rows);
        } else {
          handlersOf(entry, '', rows);
        }
        for (const [path, call] of rows) {
          const key = `${tableName.toLowerCase()}/${id}/${path}`;
          if (!found.has(key)) found.set(key, new Set());
          found.get(key)!.add(call);
        }
      }
    }
  }
  return found;
}

export type Scope = 'action' | 'turn-order' | 'end-of-turn' | 'out';
/**
 * `kind` is the kind of die the module names for the draw (a `DieKind`), or `pick` and `duration` for the draws that stay out.
 * `open` marks a draw in scope that no kind names yet: the reason says why and what the user sees (nothing is offered, the draw
 * follows the stream).
 */
export interface Class { scope: Scope; kind: DieKind | 'pick' | 'duration'; calls: string[]; open?: string }

const proc = (...calls: string[]): Class => ({ scope: 'action', kind: 'ability-proc', calls });
const end = (...calls: string[]): Class => ({ scope: 'end-of-turn', kind: 'end-of-turn', calls });
const first = (...calls: string[]): Class => ({ scope: 'turn-order', kind: 'move-first', calls });
const check = (...calls: string[]): Class => ({ scope: 'action', kind: 'status-check', calls });
const pick = (...calls: string[]): Class => ({ scope: 'out', kind: 'pick', calls });
const duration = (...calls: string[]): Class => ({ scope: 'out', kind: 'duration', calls });

export const CLASSES: Record<string, Class> = {
  // a proc of the move's hit: the holder was hit (DamagingHit) or hit (the source's DamagingHit)
  'abilities/cursedbody/onDamagingHit': proc('randomChance(3, 10)'),
  'abilities/cutecharm/onDamagingHit': proc('randomChance(1, 3)', 'randomChance(3, 10)'),
  'abilities/effectspore/onDamagingHit': proc('random(100)', 'randomChance(1, 10)', 'randomChance(3, 10)', "sample(['slp', 'par', 'psn'])"),
  'abilities/flamebody/onDamagingHit': proc('randomChance(1, 3)', 'randomChance(3, 10)'),
  'abilities/poisonpoint/onDamagingHit': proc('randomChance(1, 3)', 'randomChance(3, 10)'),
  'abilities/static/onDamagingHit': proc('randomChance(1, 3)', 'randomChance(3, 10)'),
  'abilities/poisontouch/onSourceDamagingHit': proc('randomChance(3, 10)'),
  'abilities/toxicchain/onSourceDamagingHit': proc('randomChance(3, 10)'),
  'items/focusband/onDamage': { scope: 'action', kind: 'item-proc', calls: ['randomChance(1, 10)', 'randomChance(30, 256)'] },
  // the end of the turn: the Residual event of the holder
  'abilities/harvest/onResidual': end('randomChance(1, 2)'),
  'abilities/healer/onResidual': end('randomChance(1, 2)', 'randomChance(3, 10)'),
  'abilities/shedskin/onResidual': end('randomChance(33, 100)'),
  'conditions/frz/onResidual': end('randomChance(25, 256)'),
  // the order of the turn: a holder that acts first in its bracket
  'abilities/quickdraw/onFractionalPriority': first('randomChance(3, 10)'),
  'items/quickclaw/onBeforeTurn': first('randomChance(1, 5)'),
  'items/quickclaw/onFractionalPriority': first('randomChance(1, 5)'),
  // the check of the body about to move (a condition's BeforeMove handler)
  'conditions/confusion/onBeforeMove': check('randomChance(1, 2)', 'randomChance(128, 256)', 'randomChance(33, 100)'),
  'conditions/frz/onBeforeMove': check('randomChance(1, 4)', 'randomChance(1, 5)'),
  'conditions/par/onBeforeMove': check('randomChance(1, 4)', 'randomChance(1, 8)', 'randomChance(63, 256)'),
  'moves/attract/condition.onBeforeMove': check('randomChance(1, 2)'),
  // a stalling move that succeeds again
  'conditions/stall/onStallMove': { scope: 'action', kind: 'stalling', calls: ['randomChance(1, 2 ** 32)', 'randomChance(1, counter)', 'randomChance(counter, 255)'] },
  // the Champions bundle's own hit loop: the count of a multi-hit move and the accuracy of each hit of a multi-accuracy move
  'scripts/actions/hitStepMoveHitLoop': {
    scope: 'action', kind: 'hit-count',
    calls: [
      'random(2)', 'random(7)', 'random(targetHits[0], targetHits[1] + 1)', 'randomChance(accuracy, 100)',
      'sample([2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 5, 5, 5])', 'sample([2, 2, 2, 3, 3, 3, 4, 5])',
    ],
  },
  // draws in scope that no kind names yet
  'moves/allyswitch/condition.onRestart': {
    scope: 'action', kind: 'stalling', calls: ['randomChance(1, counter)'],
    open: 'a second Ally Switch in a row succeeds with a falling chance; the draw runs under Restart, not StallMove, and the move has no stallingMove flag',
  },
  'moves/pursuit/condition.onFoeBeforeSwitchOut': {
    scope: 'turn-order', kind: 'speed-tie', calls: ['randomChance(1, 2)'],
    open: 'Gen 2 Pursuit settles a speed tie against a switching body with a coin; the shuffle of the order does not carry it',
  },
  'moves/substitute/condition.onTryHit': {
    scope: 'action', kind: 'secondary', calls: ['randomChance(Math.ceil(secondary.chance * 256 / 100) - 1, 256)'],
    open: 'Gen 1 draws a secondary effect against a Substitute inside the Substitute handler, which the secondary rule skips',
  },
  // out: a random pick (which one, never whether)
  'abilities/forewarn/onStart': pick('sample(warnMoves)'),
  'abilities/moody/onResidual': pick('sample(stats)'),
  'abilities/pickup/onResidual': pick('sample(pickupTargets)'),
  'abilities/trace/onUpdate': pick('sample(possibleTargets)'),
  'conditions/twoturnmove/onStart': pick('sample(attacker.foes(true))'),
  'items/starfberry/onEat': pick('sample(stats)'),
  'moves/direclaw/secondary.onHit': pick('sample(["psn", "par", "slp"])'),
  // out: a duration die (GLOSSARY.md), drawn when the condition starts
  'conditions/confusion/onStart': duration('random(2, 6)', 'random(min, 6)'),
  'conditions/lockedmove/durationCallback': duration('random(2, 4)'),
  'conditions/lockedmove/onStart': duration('random(2, 4)'),
  'conditions/partiallytrapped/durationCallback': duration('random(3, 6)', 'random(3, 7)', 'random(5, 7)'),
  'conditions/partialtrappinglock/durationCallback': duration('sample([2, 2, 2, 3, 3, 3, 4, 5])'),
  'conditions/slp/onStart': duration('random(1, 8)', 'random(2, 5)', 'random(2, 6)', 'random(2, 8)', 'sample([2, 3, 3])'),
  'moves/bide/condition.durationCallback': duration('random(3, 5)'),
  'moves/bide/condition.onStart': duration('random(2, 4)'),
  'moves/disable/condition.durationCallback': duration('random(2, 6)', 'random(4, 8)'),
  'moves/disable/condition.onStart': duration('random(1, 9)'),
  'moves/encore/condition.durationCallback': duration('random(3, 7)', 'random(4, 9)'),
  'moves/taunt/condition.durationCallback': duration('random(3, 6)'),
  'moves/uproar/condition.durationCallback': duration('random(2, 6)', 'random(3, 7)'),
};
