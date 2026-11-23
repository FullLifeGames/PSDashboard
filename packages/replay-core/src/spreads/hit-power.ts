/** The base power a move takes from the battle's history (Last Respects, Rage Fist): a Dex `basePowerCallback` that reads only these two counts is a history power. */

export interface HistoryFacts {
  fainted: number;
  timesAttacked: number;
}

type PowerCallback = (this: unknown, pokemon: unknown, target: unknown, move: unknown) => unknown;

export interface PowerDex {
  gen: number;
  modid: string;
  moves: { get(id: string): { exists: boolean; basePowerCallback?: unknown } };
}

const HISTORY_READS = new Set(['pokemon.side', 'pokemon.side.totalFainted', 'pokemon.timesAttacked']);

/** A stand-in that records every property path read on it; `values` answer by path, anything else answers another stand-in. */
function recorder(path: string, reads: Set<string>, values: Record<string, unknown>): unknown {
  return new Proxy(function stand() { /* callable */ }, {
    get(_target, prop) {
      if (typeof prop === 'symbol') return undefined;
      const next = `${path}.${prop}`;
      reads.add(next);
      return next in values ? values[next] : recorder(next, reads, values);
    },
    apply: () => undefined,
  });
}

/** The paths the move's callback reads and what it returns, with the history stand-in; null when the move has no callback. */
function runCallback(dex: PowerDex, moveId: string, facts: HistoryFacts): { reads: Set<string>; power: unknown } | null {
  const callback = dex.moves.get(moveId).basePowerCallback;
  if (typeof callback !== 'function') return null;
  const reads = new Set<string>();
  const values = {
    'pokemon.side': recorder('pokemon.side', reads, { 'pokemon.side.totalFainted': facts.fainted }),
    'pokemon.timesAttacked': facts.timesAttacked,
  };
  const stand = (name: string) => recorder(name, reads, values);
  try {
    return { reads, power: (callback as PowerCallback).call(stand('this'), stand('pokemon'), stand('target'), stand('move')) };
  } catch {
    reads.add('threw');
    return { reads, power: undefined };
  }
}

const classes = new Map<string, boolean>();

/** Whether the move's callback reads the battle's history and nothing else (memoized per Dex and move). */
export function historyPowerMove(dex: PowerDex, moveId: string): boolean {
  const key = `${dex.modid}|${dex.gen}|${moveId}`;
  let known = classes.get(key);
  if (known === undefined) {
    const run = runCallback(dex, moveId, { fainted: 0, timesAttacked: 0 });
    known = !!run && run.reads.size > 0 && [...run.reads].every(path => HISTORY_READS.has(path)) && typeof run.power === 'number';
    classes.set(key, known);
  }
  return known;
}

/** The move's base power at these counts, or null when the move's power is no history power. */
export function historyPower(dex: PowerDex, moveId: string, facts: HistoryFacts): number | null {
  if (!historyPowerMove(dex, moveId)) return null;
  const power = runCallback(dex, moveId, facts)?.power;
  return typeof power === 'number' ? power : null;
}
