import { Battle, State, Teams, toID } from '@pkmn/sim';
import type { PokemonSet, PRNGSeed } from '@pkmn/sim';
import { afterEach, describe, expect, test } from 'vitest';
import { advancePositionWithLog, createRootPosition, legalChoices } from '../src/forward-model';
import { deserializeFromParsed, parseSearchState } from '../src/forward/parsed-state';
import { setDispatchProbe } from '../src/forward/sim-fast/dispatch';
import { prepareBattle } from '../src/forward/sim-fast/index';
import {
  configureSimFast, resetSimFastForTests, takeSimFastReport, type SimFastLever, type SimFastReport,
} from '../src/forward/sim-fast/state';
import { loadPositions, SEEDS, stableLog, withSimFast, type FixturePosition } from './sim-fast-helpers';

const positions = loadPositions();

afterEach(() => {
  setDispatchProbe(null);
  resetSimFastForTests();
});

function makeSet(species: string, moves: string[], ability = 'No Ability'): PokemonSet {
  return {
    name: species, species, item: '', ability, moves, nature: 'Hardy',
    evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50, gender: '',
  };
}

function singles(p1: PokemonSet[], p2: PokemonSet[]): string {
  const battle = new Battle({
    formatid: toID('gen9customgame'), seed: '1,2,3,4',
    p1: { name: 'Alpha', team: Teams.pack(p1) }, p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', 'team 1');
    battle.choose('p2', 'team 1');
  }
  return JSON.stringify(State.serializeBattle(battle));
}

function turn(serialized: string, p1: string, p2: string, seed: PRNGSeed): string {
  const { child, log } = advancePositionWithLog(createRootPosition(serialized), p1, p2, seed);
  return `${child.serialized}\n${stableLog(log)}`;
}

/** First 3x3 options with Tera, both seeds: child and log of every turn, plus the layer's report. */
function turns(position: FixturePosition, levers: readonly SimFastLever[]): { lines: string[]; report: SimFastReport } {
  return withSimFast(levers, () => {
    const root = createRootPosition(position.serialized);
    const lines: string[] = [];
    for (const a of legalChoices(root, 'p1', { tera: true }).slice(0, 3)) {
      for (const b of legalChoices(root, 'p2', { tera: true }).slice(0, 3)) {
        for (const seed of SEEDS) {
          const { child, log } = advancePositionWithLog(root, a.choice, b.choice, seed);
          lines.push(child.serialized, stableLog(log));
        }
      }
    }
    return { lines, report: takeSimFastReport() };
  });
}

describe('lever dispatch: the pre-check', () => {
  test('turns with and without it are equal: child and log, every fixture, 3x3 options with Tera, both seeds', () => {
    for (const position of positions) {
      const on = turns(position, ['dispatch']);
      expect(on.lines, position.id).toEqual(turns(position, []).lines);
      expect(on.report.counters.dispatchAnswered, position.id).toBeGreaterThan(0);
    }
  }, 240_000);

  test('counter-check: a pre-check blind to abilities changes a Huge Power turn', () => {
    const serialized = singles([makeSet('Azumarill', ['Liquidation'], 'Huge Power')], [makeSet('Snorlax', ['Growl'])]);
    const today = withSimFast([], () => turn(serialized, 'move liquidation', 'move growl', SEEDS[0]));
    expect(withSimFast(['dispatch'], () => turn(serialized, 'move liquidation', 'move growl', SEEDS[0]))).toBe(today);
    setDispatchProbe('no-abilities');
    expect(withSimFast(['dispatch'], () => turn(serialized, 'move liquidation', 'move growl', SEEDS[0]))).not.toBe(today);
  });

  test('counter-check: the fixture identity above fails for a pre-check blind to abilities', () => {
    const today = new Map(positions.map(position => [position.id, turns(position, []).lines]));
    setDispatchProbe('no-abilities');
    const broken = positions.filter(position => JSON.stringify(turns(position, ['dispatch']).lines) !== JSON.stringify(today.get(position.id)));
    expect(broken.length).toBeGreaterThan(0);
  }, 240_000);

  test('a battle whose runEvent is already its own (format or mod script) keeps it', () => {
    const battle = deserializeFromParsed(parseSearchState(positions[0].serialized));
    const own = function (this: Battle, ...args: unknown[]) {
      return (Battle.prototype.runEvent as (...values: unknown[]) => unknown).apply(this, args);
    };
    (battle as unknown as { runEvent: unknown }).runEvent = own;
    configureSimFast(['dispatch']);
    prepareBattle(battle);
    expect((battle as unknown as { runEvent: unknown }).runEvent).toBe(own);
  });

  test('switched off in a long-lived process: templates and wrappers from before take the standard path', () => {
    const position = positions[0];
    configureSimFast(['clone', 'dispatch']);
    const root = createRootPosition(position.serialized);
    const [a] = legalChoices(root, 'p1');
    const [b] = legalChoices(root, 'p2');
    advancePositionWithLog(root, a.choice, b.choice, SEEDS[0]);
    // Clone stays on, dispatch goes off: the next fork copies the on-phase root template, which carries runEventFast as its own runEvent.
    configureSimFast(['clone']);
    takeSimFastReport();
    const stale = advancePositionWithLog(root, a.choice, b.choice, SEEDS[1]);
    const staleCounters = takeSimFastReport().counters;
    expect(staleCounters).toMatchObject({ ruleTables: 0, dispatchCalls: 0, dispatchAnswered: 0, fallbacks: 0 });
    expect(staleCounters.clones).toBeGreaterThan(0);
    // Everything off: today's path.
    configureSimFast([]);
    takeSimFastReport();
    const again = advancePositionWithLog(root, a.choice, b.choice, SEEDS[1]);
    expect(takeSimFastReport().counters).toEqual({ ruleTables: 0, clones: 0, dispatchCalls: 0, dispatchAnswered: 0, fallbacks: 0 });
    const today = withSimFast([], () => turn(position.serialized, a.choice, b.choice, SEEDS[1]));
    expect(`${stale.child.serialized}\n${stableLog(stale.log)}`).toBe(today);
    expect(`${again.child.serialized}\n${stableLog(again.log)}`).toBe(today);
  });
});
