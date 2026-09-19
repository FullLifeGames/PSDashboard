import { test, describe } from 'vitest';
import { State } from '@pkmn/sim';
import { ENDGAME_FIXTURES } from './endgame-fixtures';
import { solveEndgame, type EndgameCaps, type EndgameResult } from '../packages/eval-engine/src/endgame/solver';
import { createRootPosition, positionBattle } from '../packages/eval-engine/src/forward-model';
import { createMatchupCache } from '../packages/eval-engine/src/eval-function';
import { leafValue } from '../packages/eval-engine/src/search/leaf';
import { setLastPairSweep } from '../packages/eval-engine/src/score/last-pair';
import { AUTO_MCTS_FAINTED_FRACTION, battleFaintedFraction, searchPosition } from '../packages/eval-engine/src/search';
import { mctsSearch } from '../packages/eval-engine/src/mcts';

/**
 * The endgame truth bench (round 34): every estimator against the solver
 * on the bank's exported endgame positions and the synthetic fixtures.
 * EVAL_ENDGAME_TRUTH=1 runs it; EVAL_ENDGAME_POSITIONS names the export
 * directory (default .calibration/base-20260918-live/positions, written by
 * the bank run's EVAL_CALIBRATION_POSITIONS on the live instrument of round
 * 46; the round-34 export was lost in the 12 Sep worktree incident);
 * EVAL_ENDGAME_SLICE i/N splits the items; EVAL_ENDGAME_DUMP appends one
 * JSONL line per item; EVAL_ENDGAME_LIMIT caps the item count for dry runs;
 * EVAL_ENDGAME_CAPS widens the solver's caps for a long run, for this bench
 * only ("states=200000,wallMs=1200000,turns=60"; the production default
 * stays 20000 states, 120 s, 30 turns); EVAL_ENDGAME_SOURCE=bank leaves the
 * synthetic fixtures out; EVAL_ENDGAME_SOLVED names earlier dumps (comma
 * separated JSONL paths) whose solver rows are looked up by item name
 * instead of solved again, so a long run's truth can grade the estimators of
 * a later engine state in minutes (exact values end in won or lost games and
 * do not depend on K or the weights; capped rows carry the leaf values of
 * the run that solved them).
 */
interface BankPosition {
  id: string; turn: number; serialized: string; gameType: 'singles' | 'doubles';
  tranche: string; quality: string; p1Won: boolean; score: number; decided: 'p1' | 'p2' | null; lastPair: boolean;
}
interface Item { name: string; source: 'bank' | 'synthetic'; gameType: 'singles' | 'doubles'; decided: 'p1' | 'p2' | null; serialized: string }
interface Estimates {
  static: number; staticB: number; d1: number; d2: number; d3: number; mcts: number;
  /** Round 35: the sweep's auto mode with the forced-win bar, and the proven mass behind it. */
  prover: number; proverMass: number | null;
}

const DEFAULT_DIR = '.calibration/base-20260918-live/positions';

async function bankItems(dir: string): Promise<Item[]> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  if (!fs.existsSync(dir)) {
    console.log(`no bank positions at ${dir}: running the synthetic fixtures only`);
    return [];
  }
  return fs.readdirSync(dir).filter(file => file.endsWith('.json')).sort().map(file => {
    const bank = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as BankPosition;
    return { name: `${bank.id}#${bank.turn}`, source: 'bank' as const, gameType: bank.gameType, decided: bank.decided, serialized: bank.serialized };
  });
}

const syntheticItems = (): Item[] => ENDGAME_FIXTURES.map(fixture => ({
  name: fixture.name, source: 'synthetic', gameType: fixture.gameType, decided: null,
  serialized: JSON.stringify(State.serializeBattle(fixture.build())),
}));

function estimate(serialized: string): Estimates {
  const battle = positionBattle(createRootPosition(serialized));
  const staticValue = leafValue(battle, createMatchupCache());
  setLastPairSweep(true);
  const staticB = leafValue(battle, createMatchupCache());
  setLastPairSweep(false);
  const proverSettings = { depth: 1 as const, samples: 1 as const, tera: false as const };
  const proverScore = battleFaintedFraction(battle) >= AUTO_MCTS_FAINTED_FRACTION
    ? mctsSearch(serialized, proverSettings)
    : searchPosition(serialized, proverSettings);
  return {
    static: staticValue,
    staticB,
    d1: searchPosition(serialized, { depth: 1, samples: 1, tera: false }).score,
    d2: searchPosition(serialized, { depth: 2, samples: 3, tera: false }).score,
    d3: searchPosition(serialized, { depth: 3, samples: 3, tera: false }).score,
    mcts: mctsSearch(serialized, { depth: 1, samples: 1, tera: false }).score,
    prover: proverScore.score,
    proverMass: proverScore.forcedWin?.mass ?? null,
  };
}

/** EVAL_ENDGAME_CAPS as partial solver caps; unknown keys and non-numbers are dropped. */
function capsFromEnv(): Partial<EndgameCaps> {
  const caps: Partial<EndgameCaps> = {};
  for (const part of (process.env.EVAL_ENDGAME_CAPS ?? '').split(',')) {
    const [key, raw] = part.split('=');
    const value = Number(raw);
    if ((key === 'turns' || key === 'states' || key === 'wallMs') && Number.isFinite(value) && value > 0) caps[key] = value;
  }
  return caps;
}

/** Solver rows of earlier dumps by item name (EVAL_ENDGAME_SOLVED), with the wall clock they took. */
async function solvedRows(): Promise<Map<string, EndgameResult & { ms: number }>> {
  const rows = new Map<string, EndgameResult & { ms: number }>();
  const paths = (process.env.EVAL_ENDGAME_SOLVED ?? '').split(',').filter(Boolean);
  if (paths.length === 0) return rows;
  const fs = await import('node:fs');
  for (const path of paths) {
    for (const line of fs.readFileSync(path, 'utf-8').split('\n').filter(text => text.trim())) {
      const row = JSON.parse(line) as EndgameResult & { name: string; ms: number };
      rows.set(row.name, { scope: row.scope, value: row.value, exact: row.exact, flags: row.flags, states: row.states, depth: row.depth, pv: row.pv, ms: row.ms });
    }
  }
  return rows;
}

function sliceOf<T>(items: T[]): T[] {
  const slice = process.env.EVAL_ENDGAME_SLICE?.match(/^(\d+)\/(\d+)$/);
  const sliced = slice ? items.filter((_, index) => index % parseInt(slice[2], 10) === parseInt(slice[1], 10)) : items;
  const limit = parseInt(process.env.EVAL_ENDGAME_LIMIT ?? '', 10);
  return Number.isFinite(limit) ? sliced.slice(0, limit) : sliced;
}

describe.skipIf(process.env.EVAL_ENDGAME_TRUTH !== '1')('endgame truth bench (round 34)', () => {

  test('every estimator against the solver', { timeout: 43200000 }, async () => {
    const bank = await bankItems(process.env.EVAL_ENDGAME_POSITIONS ?? DEFAULT_DIR);
    const items = sliceOf(process.env.EVAL_ENDGAME_SOURCE === 'bank' ? bank : [...bank, ...syntheticItems()]);
    const caps = capsFromEnv();
    if (Object.keys(caps).length > 0) console.log(`solver caps for this run: ${JSON.stringify(caps)}`);
    const fs = process.env.EVAL_ENDGAME_DUMP ? await import('node:fs') : null;
    const solved = await solvedRows();
    if (solved.size > 0) console.log(`solver rows looked up from earlier dumps: ${solved.size}`);
    for (const item of items) {
      const started = Date.now();
      const earlier = solved.get(item.name);
      let exact: EndgameResult;
      try {
        exact = earlier ?? solveEndgame(item.serialized, caps);
      } catch (error) {
        console.log(`${item.name}: solver error ${error instanceof Error ? error.message : error}`);
        continue;
      }
      const ms = earlier ? earlier.ms : Date.now() - started;
      const estimators = exact.scope ? estimate(item.serialized) : null;
      const row = { name: item.name, source: item.source, gameType: item.gameType, decided: item.decided, ...exact, ms, estimators };
      console.log(`${item.name} ${item.gameType} exact=${exact.exact} flags=${exact.flags.join(',') || '-'} value=${exact.value.toFixed(3)} states=${exact.states} depth=${exact.depth} ${ms}ms`);
      if (fs) fs.appendFileSync(process.env.EVAL_ENDGAME_DUMP!, JSON.stringify(row) + '\n');
    }
  });
});
