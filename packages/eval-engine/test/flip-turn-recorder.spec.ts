import { readdirSync, readFileSync } from 'node:fs';
import { State, type Battle, type PRNGSeed } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { recordTurn } from '../src/dice/flip';
import { createRootPosition, legalChoices, positionBattle, type SimPosition } from '../src/forward-model';
import { forkBattle } from '../src/forward/position';
import { applyChoice, resolveForcedSwitches } from '../src/forward/switches';
import { loadSimMods } from '../src/forward/sim-mods';
import { drawChild } from '../src/search/outcome-children';
import { cellSeeds } from '../src/search/root-quantile';
import { totalHp } from '../src/search/outcome-children';
import { sweepSelection } from './dice-fixtures';

/**
 * Round 89 (A6-1, ruling 24): the lossless recorder row. The plain path of the endgame children will take the median draw's seed
 * again under the dice module's recorder; the recorder must change nothing. On the cells of the fixture positions the recorded
 * redraw is `drawChild`'s child for the same seed: the same state of the battle (the stream's seed included) and the same log.
 * A plain run plays a fixed sample of the cells of each position; `DICE_SWEEPS=full` plays every cell.
 */
await loadSimMods('gen9championsou');

interface Fixture { id: string; turn: number; serialized: string; tera: boolean | string; ruleset: 'standard' | 'vgc' | 'champions' }

const DIR = new URL('./fixtures/positions/', import.meta.url);
const FILES = readdirSync(DIR).filter(file => file.endsWith('.json')).sort();

/** The same turn as `advancePositionWithLog` plays it (the choices, then the forced switches). */
function playCell(battle: Battle, p1Choice: string, p2Choice: string, seed: PRNGSeed): void {
  applyChoice(battle, 'p1', p1Choice);
  applyChoice(battle, 'p2', p2Choice);
  resolveForcedSwitches(battle, seed, { p1: p1Choice.split(' > ')[1], p2: p2Choice.split(' > ')[1] });
}

/** The battle's state without its wall-clock lines (`|t:|` differs between two runs a second apart). */
function stateOf(battle: Battle): unknown {
  const state = JSON.parse(JSON.stringify(State.serializeBattle(battle))) as { log: string[] };
  state.log = state.log.filter(line => !line.startsWith('|t:|'));
  return state;
}
const timeless = (lines: string[]): string[] => lines.filter(line => !line.startsWith('|t:|'));

/** The first path where two states differ, or null (the message of a red row). */
function firstDiff(a: unknown, b: unknown, path = ''): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return `${path}: ${JSON.stringify(a)?.slice(0, 60)} | ${JSON.stringify(b)?.slice(0, 60)}`;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const found = firstDiff((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
    if (found) return found;
  }
  return path;
}

function cellsOf(root: SimPosition): [string, string][] {
  const p1 = legalChoices(root, 'p1', { tera: false }).map(option => option.choice);
  const p2 = legalChoices(root, 'p2', { tera: false }).map(option => option.choice);
  return sweepSelection(p1.flatMap(a => p2.map((b): [string, string] => [a, b])), 'pool');
}

let dicePlayed = 0;

describe('the recorder leaves the turn as it was', () => {
  test.each(FILES)('%s', file => {
    const fixture = JSON.parse(readFileSync(new URL(file, DIR), 'utf-8')) as Fixture;
    const root = createRootPosition(fixture.serialized, fixture.ruleset);
    const rootHp = totalHp(positionBattle(root));
    let played = 0;
    for (const [p1Choice, p2Choice] of cellsOf(root)) {
      const seed = cellSeeds(root, p1Choice, p2Choice)[0];
      const draw = drawChild(root, rootHp, p1Choice, p2Choice, seed);
      const recorded = recordTurn({
        fork: () => forkBattle(root, seed),
        play: battle => playCell(battle, p1Choice, p2Choice, seed),
      });
      const label = `${file} ${p1Choice} / ${p2Choice}`;
      expect(firstDiff(stateOf(recorded.battle), stateOf(positionBattle(draw.position))), label).toBeNull();
      expect(timeless(recorded.battle.log.slice(recorded.logStart)), label).toEqual(timeless(draw.log));
      played++;
      dicePlayed += recorded.dice.length;
    }
    expect(played).toBeGreaterThan(0);
  });

  test('the cells drew chance dice, so the rows above compared real recordings', () => {
    expect(dicePlayed).toBeGreaterThan(100);
  });
});
