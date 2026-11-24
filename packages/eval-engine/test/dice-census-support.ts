import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { DieKind } from '../src/dice/types';

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

export const DRAW = /\.(randomChance|random|sample|shuffle)\(((?:[^()]|\([^()]*\))*)\)/g;

function handlersOf(value: unknown, path: string, out: [string, string][], depth = 0): void {
  if (typeof value === 'function') {
    for (const match of value.toString().matchAll(DRAW)) out.push([path, `${match[1]}(${match[2].replace(/\s+/g, ' ').trim()})`]);
    return;
  }
  if (typeof value !== 'object' || value === null || depth > 4) return;
  for (const [key, inner] of Object.entries(value)) handlersOf(inner, path ? `${path}.${key}` : key, out, depth + 1);
}

// The simulator sets `battle.activeMove` in `runMove` before BeforeMove and ModifyMove: a stand-in must set it too.
export function activeMoveReaders(): { kind: 'abilities' | 'items'; id: string; throwing: boolean }[] {
  const sourceOf = (value: unknown, depth = 0): string => {
    if (typeof value === 'function') return value.toString();
    if (typeof value !== 'object' || value === null || depth > 4) return '';
    return Object.values(value).map(inner => sourceOf(inner, depth + 1)).join(' ');
  };
  const all = sources();
  const THROWS = /if \(!this\.activeMove\)\s*throw/;
  const reading = new Map<string, boolean>();
  for (const source of all) {
    for (const [id, entry] of Object.entries(source.tables.Conditions ?? {})) {
      const text = sourceOf(entry);
      if (/\bactiveMove\b/.test(text)) reading.set(id, THROWS.test(text) || (reading.get(id) ?? false));
    }
  }
  const found = new Map<string, { kind: 'abilities' | 'items'; id: string; throwing: boolean }>();
  for (const source of all) {
    for (const [kind, table] of [['abilities', source.tables.Abilities], ['items', source.tables.Items]] as const) {
      for (const [id, entry] of Object.entries(table ?? {})) {
        const text = sourceOf(entry);
        const added = [...text.matchAll(/addVolatile\(['"](\w+)['"]/g)].map(match => match[1]).filter(name => reading.has(name));
        if (!/\bactiveMove\b/.test(text) && added.length === 0) continue;
        const throwing = THROWS.test(text) || added.some(name => reading.get(name));
        const key = `${kind}/${id}`;
        found.set(key, { kind, id, throwing: throwing || (found.get(key)?.throwing ?? false) });
      }
    }
  }
  return [...found.values()];
}

export function scan(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const source of sources()) {
    for (const [tableName, table] of Object.entries(source.tables)) {
      if (!table || typeof table !== 'object') continue;
      for (const [id, entry] of Object.entries(table)) {
        const rows: [string, string][] = [];
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
export interface Class { scope: Scope; kind: DieKind | 'pick' | 'duration'; calls: string[]; open?: string }

const proc = (...calls: string[]): Class => ({ scope: 'action', kind: 'ability-proc', calls });
const end = (...calls: string[]): Class => ({ scope: 'end-of-turn', kind: 'end-of-turn', calls });
const first = (...calls: string[]): Class => ({ scope: 'turn-order', kind: 'move-first', calls });
const check = (...calls: string[]): Class => ({ scope: 'action', kind: 'status-check', calls });
const pick = (...calls: string[]): Class => ({ scope: 'out', kind: 'pick', calls });
const duration = (...calls: string[]): Class => ({ scope: 'out', kind: 'duration', calls });

export const CLASSES: Record<string, Class> = {
  'abilities/cursedbody/onDamagingHit': proc('randomChance(3, 10)'),
  'abilities/cutecharm/onDamagingHit': proc('randomChance(1, 3)', 'randomChance(3, 10)'),
  'abilities/effectspore/onDamagingHit': proc('random(100)', 'randomChance(1, 10)', 'randomChance(3, 10)', "sample(['slp', 'par', 'psn'])"),
  'abilities/flamebody/onDamagingHit': proc('randomChance(1, 3)', 'randomChance(3, 10)'),
  'abilities/poisonpoint/onDamagingHit': proc('randomChance(1, 3)', 'randomChance(3, 10)'),
  'abilities/static/onDamagingHit': proc('randomChance(1, 3)', 'randomChance(3, 10)'),
  'abilities/poisontouch/onSourceDamagingHit': proc('randomChance(3, 10)'),
  'abilities/toxicchain/onSourceDamagingHit': proc('randomChance(3, 10)'),
  'items/focusband/onDamage': { scope: 'action', kind: 'item-proc', calls: ['randomChance(1, 10)', 'randomChance(30, 256)'] },
  'abilities/harvest/onResidual': end('randomChance(1, 2)'),
  'abilities/healer/onResidual': end('randomChance(1, 2)', 'randomChance(3, 10)'),
  'abilities/shedskin/onResidual': end('randomChance(33, 100)'),
  'conditions/frz/onResidual': end('randomChance(25, 256)'),
  'abilities/quickdraw/onFractionalPriority': first('randomChance(3, 10)'),
  'items/quickclaw/onBeforeTurn': first('randomChance(1, 5)'),
  'items/quickclaw/onFractionalPriority': first('randomChance(1, 5)'),
  'conditions/confusion/onBeforeMove': check('randomChance(1, 2)', 'randomChance(128, 256)', 'randomChance(33, 100)'),
  'conditions/frz/onBeforeMove': check('randomChance(1, 4)', 'randomChance(1, 5)'),
  'conditions/par/onBeforeMove': check('randomChance(1, 4)', 'randomChance(1, 8)', 'randomChance(63, 256)'),
  'moves/attract/condition.onBeforeMove': check('randomChance(1, 2)'),
  'conditions/stall/onStallMove': { scope: 'action', kind: 'stalling', calls: ['randomChance(1, 2 ** 32)', 'randomChance(1, counter)', 'randomChance(counter, 255)'] },
  'scripts/actions/hitStepMoveHitLoop': {
    scope: 'action', kind: 'hit-count',
    calls: [
      'random(2)', 'random(7)', 'random(targetHits[0], targetHits[1] + 1)', 'randomChance(accuracy, 100)',
      'sample([2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 5, 5, 5])', 'sample([2, 2, 2, 3, 3, 3, 4, 5])',
    ],
  },
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
  'abilities/forewarn/onStart': pick('sample(warnMoves)'),
  'abilities/moody/onResidual': pick('sample(stats)'),
  'abilities/pickup/onResidual': pick('sample(pickupTargets)'),
  'abilities/trace/onUpdate': pick('sample(possibleTargets)'),
  'conditions/twoturnmove/onStart': pick('sample(attacker.foes(true))'),
  'items/starfberry/onEat': pick('sample(stats)'),
  'moves/direclaw/secondary.onHit': pick('sample(["psn", "par", "slp"])'),
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
