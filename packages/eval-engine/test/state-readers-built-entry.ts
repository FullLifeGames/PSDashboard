import { Battle, Dex, Teams } from '@pkmn/sim';
import * as champions from '@pkmn/mods/champions';
import { entryReads, methodsOf, tokensOf, type Consumer, type Methods } from '../src/dex-facts/state-readers';

/**
 * Round 89 (#149): the entry of packages/eval-engine/test/state-readers-built.spec.ts. The spec bundles this file with the app's own
 * Vite configuration (its minifier, its target, its resolve rules) and runs the bundle next to the source in Node: the scan of
 * `dex-facts/state-readers.ts` reads `String(handler)` of the simulator's Dex, and a build that rewrites a handler's source
 * (renamed or removed properties, folded branches) would change what the memos key in the browser and not in Node.
 */

/** What the scan finds in each Dex entry of every generation and the Champions mod: keyed `<dex>|<kind>|<id>|<consumer or event>`, the values sorted. */
export type Census = Record<string, string[]>;

const KINDS = ['moves', 'abilities', 'items'] as const;
const SUB_EFFECTS = ['condition', 'self', 'secondary', 'secondaries'] as const;

/** The handler sources of an entry by their path (`onResidual`, `condition.onStart`, `secondaries.0.self.onHit`), through the same sub-effects the scan follows. */
function handlersOf(entry: Record<string, unknown>, path: string, depth: number, out: Map<string, string>): void {
  for (const key of Object.keys(entry)) {
    const value = entry[key];
    if (typeof value === 'function') out.set(`${path}${key}`, String(value));
    else if (depth < 3 && value && typeof value === 'object' && (SUB_EFFECTS as readonly string[]).includes(key)) {
      (Array.isArray(value) ? value : [value]).forEach((part, index) => {
        if (part && typeof part === 'object') handlersOf(part as Record<string, unknown>, `${path}${key}${Array.isArray(value) ? `.${index}` : ''}.`, depth + 1, out);
      });
    }
  }
}

function scanDex(label: string, dex: typeof Dex, methods: Methods, census: Census): void {
  const entries: [string, string, object][] = [];
  for (const kind of KINDS) for (const entry of dex[kind].all()) entries.push([kind, entry.id, entry]);
  for (const id of Object.keys(dex.data.Conditions)) {
    const condition = dex.conditions.getByID(id as never);
    if (condition.exists) entries.push(['conditions', id, condition]);
  }
  for (const [kind, id, entry] of entries) {
    const base = `${label}|${kind}|${id}|`;
    const handlers = new Map<string, string>();
    handlersOf(entry as Record<string, unknown>, '', 0, handlers);
    for (const [path, source] of handlers) census[`${base}source:${path}`] = [...tokensOf(source)].sort();
    for (const consumer of ['hit', 'residual'] as Consumer[]) {
      const found = entryReads(entry, consumer, methods);
      census[`${base}${consumer}:fields`] = [...found.fields].sort();
      census[`${base}${consumer}:names`] = [...found.names].sort();
    }
  }
}

/** The methods of the simulator's body, side and field, with what each reads once closed over the calls of the others. */
function methodsOfBattle(): Methods {
  const team = Teams.pack([{ name: 'A', species: 'Pikachu', item: '', ability: 'Static', moves: ['splash'], nature: 'Hardy', gender: 'M', evs: {}, ivs: {}, level: 50 } as never]);
  const battle = new Battle({ formatid: 'gen9customgame' as never, seed: [1, 2, 3, 4], p1: { name: 'p1', team }, p2: { name: 'p2', team } });
  return methodsOf(battle);
}

export function censusOf(): Census {
  const census: Census = {};
  const methods = methodsOfBattle();
  for (const [name, reads] of methods) census[`methods|${name}`] = [...reads].sort();
  for (let gen = 1; gen <= 9; gen++) scanDex(`gen${gen}`, Dex.forGen(gen), methods, census);
  Dex.mod('champions', champions as never);
  scanDex('champions', Dex.mod('champions'), methods, census);
  return census;
}
