import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { State } from '@pkmn/sim';
import type { Battle } from '@pkmn/sim';
import { searchOrchestrated } from '../src/orchestrator';
import { createLocalExecutor, searchPosition } from '../src/search';
import { loadSimMods } from '../src/forward/sim-mods';
import type { StaticRuleset } from '../src/eval-function';
import type { EvalResult, EvalSettings, SearchProgress } from '../src/types';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

await loadSimMods('gen9customgame');

const serialize = (battle: Battle) => JSON.stringify(State.serializeBattle(battle));
const board = (format: string, p1: ReturnType<typeof set>[], p2: ReturnType<typeof set>[]) => serialize(battleOf(format, p1, p2));
const cellsOf = (result: EvalResult): number => result.matrix!.values.length * result.matrix!.values[0].length;

interface SharedGame { settings: { tera: boolean; ruleset: StaticRuleset; sleepClause: boolean }; turn2: string }
const gholdengo = JSON.parse(readFileSync(new URL('./fixtures/sb-gholdengo.json', import.meta.url), 'utf-8')) as SharedGame;

describe('depth 2 deepens every live cell', () => {
  const singles = () => board(
    'gen9customgame',
    [set('Machamp', ['Seismic Toss', 'Protect', 'Karate Chop']), set('Chansey', ['Tackle'])],
    [set('Snorlax', ['Tackle', 'Rest', 'Protect']), set('Blissey', ['Tackle'])],
  );
  const doubles = () => board(
    'gen9doublescustomgame',
    [set('Machamp', ['Rock Slide', 'Karate Chop', 'Bulldoze']), set('Snorlax', ['Tackle', 'Protect']), set('Chansey', ['Protect'])],
    [set('Pikachu', ['Tackle', 'Growl']), set('Eevee', ['Tackle', 'Growl']), set('Vulpix', ['Protect'])],
  );
  const settings: EvalSettings = { depth: 2, samples: 1, tera: false };
  const levelTwo = (events: SearchProgress[]): SearchProgress[] => events.filter(event => event.depth === 2 && event.done > 0);

  test('singles: the progress of level 2 counts every cell of the matrix, sync and orchestrated alike', async () => {
    const sync: SearchProgress[] = [];
    const orchestrated: SearchProgress[] = [];
    const result = searchPosition(singles(), settings, { onProgress: event => sync.push(event) });
    await searchOrchestrated(createLocalExecutor(singles()), settings, { onProgress: event => orchestrated.push(event) });
    for (const events of [levelTwo(sync), levelTwo(orchestrated)]) {
      expect(events.length).toBe(cellsOf(result));
      expect(events.every(event => event.total === cellsOf(result))).toBe(true);
      expect(events[events.length - 1].done).toBe(cellsOf(result));
    }
  });

  test('singles: a stop in the middle of level 2 returns the depth-1 result, sync and orchestrated alike', async () => {
    const depth1 = searchPosition(singles(), { ...settings, depth: 1 });
    let seen = 0;
    const callbacks = { onProgress: (event: SearchProgress) => { if (event.depth === 2) seen += 1; }, shouldStop: () => seen > 0 };
    const sync = searchPosition(singles(), settings, callbacks);
    seen = 0;
    const orchestrated = await searchOrchestrated(createLocalExecutor(singles()), settings, callbacks);
    for (const result of [sync, orchestrated]) {
      expect(result.depthCompleted).toBe(1);
      expect(result.matrix!.values).toEqual(depth1.matrix!.values);
    }
  });

  test('doubles: the progress of level 2 counts every cell of the matrix', () => {
    const totals: number[] = [];
    const result = searchPosition(doubles(), settings, {
      onProgress: event => { if (event.depth === 2) totals.push(event.total); },
      shouldStop: () => totals.length > 0,
    });
    expect(cellsOf(result)).toBeGreaterThan(10);
    expect(totals).toEqual([cellsOf(result)]);
  });
});

describe('depth 2 prices every reply to a choice, singles', () => {
  const settings: EvalSettings = {
    depth: 2, samples: 3, mode: 'matrix', tera: gholdengo.settings.tera, sleepClause: gholdengo.settings.sleepClause,
    ruleset: gholdengo.settings.ruleset, prove: false,
  };

  test('on turn 2 of the shared Gholdengo game depth 2 sees Gholdengo answer Pawmot by switching to Dragonite', async () => {
    const sync = searchPosition(gholdengo.turn2, settings);
    const orchestrated = await searchOrchestrated(createLocalExecutor(gholdengo.turn2, gholdengo.settings.ruleset), settings);
    for (const result of [sync, orchestrated]) {
      const { matrix } = result;
      const row = result.perSide.p1.find(entry => entry.label === '→ Pawmot')!;
      expect(row.punishedBy).toBe('→ Dragonite');
      expect(row.worstCase).toBeLessThan(matrix!.values[matrix!.p1Labels.indexOf('→ Pawmot')][matrix!.p2Labels.indexOf('Make It Rain')]);
    }
  }, 240_000);
});
