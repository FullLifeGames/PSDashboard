import { test, describe } from 'vitest';
import { State } from '@pkmn/sim';
import { ENDGAME_FIXTURES } from './endgame-fixtures';
import { solveEndgame, type EndgameResult } from '../packages/eval-engine/src/endgame/solver';
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
 * directory (default .calibration/r34-after/positions); EVAL_ENDGAME_SLICE
 * i/N splits the items; EVAL_ENDGAME_DUMP appends one JSONL line per item;
 * EVAL_ENDGAME_LIMIT caps the item count for dry runs.
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

const DEFAULT_DIR = '.calibration/r34-after/positions';

async function bankItems(dir: string): Promise<Item[]> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  if (!fs.existsSync(dir)) return [];
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

function sliceOf<T>(items: T[]): T[] {
  const slice = process.env.EVAL_ENDGAME_SLICE?.match(/^(\d+)\/(\d+)$/);
  const sliced = slice ? items.filter((_, index) => index % parseInt(slice[2], 10) === parseInt(slice[1], 10)) : items;
  const limit = parseInt(process.env.EVAL_ENDGAME_LIMIT ?? '', 10);
  return Number.isFinite(limit) ? sliced.slice(0, limit) : sliced;
}

describe.skipIf(process.env.EVAL_ENDGAME_TRUTH !== '1')('endgame truth bench (round 34)', () => {

  test('every estimator against the solver', { timeout: 14400000 }, async () => {
    const items = sliceOf([...(await bankItems(process.env.EVAL_ENDGAME_POSITIONS ?? DEFAULT_DIR)), ...syntheticItems()]);
    const fs = process.env.EVAL_ENDGAME_DUMP ? await import('node:fs') : null;
    for (const item of items) {
      const started = Date.now();
      let exact: EndgameResult;
      try {
        exact = solveEndgame(item.serialized);
      } catch (error) {
        console.log(`${item.name}: solver error ${error instanceof Error ? error.message : error}`);
        continue;
      }
      const ms = Date.now() - started;
      const estimators = exact.scope ? estimate(item.serialized) : null;
      const row = { name: item.name, source: item.source, gameType: item.gameType, decided: item.decided, ...exact, ms, estimators };
      console.log(`${item.name} ${item.gameType} exact=${exact.exact} flags=${exact.flags.join(',') || '-'} value=${exact.value.toFixed(3)} states=${exact.states} depth=${exact.depth} ${ms}ms`);
      if (fs) fs.appendFileSync(process.env.EVAL_ENDGAME_DUMP!, JSON.stringify(row) + '\n');
    }
  });
});
