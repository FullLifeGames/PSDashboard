import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { State } from '@pkmn/sim';
import { deserializeBattleExact } from '../src/forward/serialize';
import { createLocalTreeExecutor, searchTreesOrchestrated } from '../src/tree-orchestrator';
import { searchPosition } from '../src/search';
import { splitCombinedLabel } from '../src/turn-analysis/played-match';
import { benchOrder, choiceToCanonical, choiceToGiven } from '../src/search/bench-order';
import type { StaticRuleset } from '../src/eval-function';
import type { EvalResult, EvalSettings } from '../src/types';

/**
 * Round 67 (T129): a verdict must not depend on the order in which the
 * rebuild keeps the bench in the simulator's team list. 649664 t14 (round 64,
 * lane G): two boards with the same game state in two bench orders read the
 * switch to Ferrothorn as the best move and as a blunder. The static sums in
 * team order and a tie among replacement hints falls to the team order, so
 * the trees part at their first near tie. The search now runs every board
 * with its bench in one fixed order and names the choices back in the
 * board's own slots.
 */

interface Position {
  serialized: string;
  tera?: boolean;
  sleepClause?: boolean;
  ruleset?: StaticRuleset;
  keepPlayed?: EvalSettings['keepPlayed'] | null;
}

const fixture = (name: string): Position =>
  JSON.parse(readFileSync(new URL(`./fixtures/positions/${name}.json`, import.meta.url), 'utf-8')) as Position;

const settingsOf = (position: Position, mode: 'mcts' | 'matrix'): EvalSettings => ({
  depth: 1, samples: mode === 'mcts' ? 1 : 3, mode, tera: position.tera ?? false, sleepClause: position.sleepClause ?? false,
  ruleset: position.ruleset, keepPlayed: position.keepPlayed ?? undefined,
});

/** The board with each side's bench (the bodies past the active slots) in reverse order. */
function reverseBench(serialized: string): string {
  const battle = deserializeBattleExact(serialized);
  for (const side of battle.sides) {
    const actives = side.active.length;
    side.pokemon = [...side.pokemon.slice(0, actives), ...side.pokemon.slice(actives).reverse()];
    side.pokemon.forEach((pokemon, index) => { pokemon.position = index; });
  }
  return JSON.stringify(State.serializeBattle(battle));
}

const tree = (serialized: string, position: Position): Promise<EvalResult> =>
  searchTreesOrchestrated(createLocalTreeExecutor(serialized, position.ruleset), settingsOf(position, 'mcts'));
const matrix = (serialized: string, position: Position): Promise<EvalResult> =>
  Promise.resolve(searchPosition(serialized, settingsOf(position, 'matrix')));

/** A ranking in identity space: labels in rank order with their values (the choice ids name slots, and slots differ). */
const ranking = (result: EvalResult) => ({
  score: result.score,
  gameValue: result.gameValue,
  p1: result.perSide.p1.map(row => [row.label, row.ev, row.worstCase]),
  p2: result.perSide.p2.map(row => [row.label, row.ev, row.worstCase]),
});

/** Every switch a ranking names brings in, on the board it was asked about, the species its label names. */
function expectSlotsNameTheirSpecies(result: EvalResult, serialized: string): void {
  const battle = deserializeBattleExact(serialized);
  (['p1', 'p2'] as const).forEach((side, sideIndex) => {
    const species = (slot: string) => battle.sides[sideIndex].pokemon[Number(slot) - 1].species.name;
    for (const row of result.perSide[side]) {
      const labels = splitCombinedLabel(row.label);
      row.choice.split(',').forEach((part, index) => {
        const target = part.trim().match(/switch (\d+)$/);
        if (target) expect(labels[index]?.replace(/^.*→ /, ''), `${side} ${row.choice}`).toBe(species(target[1]));
      });
    }
  });
}

describe('the canonical bench (round 67, T129)', () => {
  test('two bench orders of one board give one canonical board; a canonical board is searched as given', () => {
    for (const name of ['smogtours-gen6ou-649664-t14-g1', 'gen9vgc2026regi-2629703929-t6']) {
      const { serialized } = fixture(name);
      const given = benchOrder(serialized);
      const reversed = benchOrder(reverseBench(serialized));
      const canonical = given?.serialized ?? serialized;
      expect(reversed?.serialized ?? reverseBench(serialized), name).toBe(canonical);
      expect(benchOrder(canonical), name).toBeNull();
      const battle = deserializeBattleExact(canonical);
      for (const side of battle.sides) {
        side.active.forEach((pokemon, slot) => expect(side.pokemon[slot]).toBe(pokemon));
        const bench = side.pokemon.slice(side.active.length).map(pokemon => `${pokemon.species.id}\u0000${pokemon.set.name}`);
        expect(bench, name).toEqual([...bench].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
      }
    }
  });

  test('slots map both ways in every choice shape; move targets stay', () => {
    const order = benchOrder(reverseBench(fixture('smogtours-gen6ou-649664-t14-g1').serialized))!;
    const shapes = ['switch 3', 'move uturn > switch 4', 'move scald', 'move thunderbolt 1, switch 5', 'switch 3, pass', 'move pollenpuff -2', 'team 3', 'team 135'];
    for (const side of ['p1', 'p2'] as const) {
      for (const choice of shapes) {
        expect(choiceToCanonical(order, side, choiceToGiven(order, side, choice)), choice).toBe(choice);
      }
      expect(choiceToGiven(order, side, 'move scald')).toBe('move scald');
      expect(choiceToGiven(order, side, 'move pollenpuff -2')).toBe('move pollenpuff -2');
    }
    const slot = (choice: string, side: 'p1' | 'p2') => Number(choiceToGiven(order, side, choice).match(/\d+$/)![0]);
    expect(slot('switch 1', 'p1')).toBe(1);
    expect(new Set([2, 3, 4, 5, 6].map(n => slot(`switch ${n}`, 'p1'))).size).toBe(5);
  });
});

describe('one board in two bench orders (round 67, T129)', () => {
  test('649664 t14 (singles tree): the two boards of round 64 read the same ranking', { timeout: 120_000 }, async () => {
    const g1 = fixture('smogtours-gen6ou-649664-t14-g1');
    const g2 = fixture('smogtours-gen6ou-649664-t14-g2');
    expect(ranking(await tree(g2.serialized, g2))).toEqual(ranking(await tree(g1.serialized, g1)));
  });

  test('751466 t2 (singles matrix): the board and its reversed bench read the same ranking', { timeout: 120_000 }, async () => {
    const position = fixture('smogtours-gen9ou-751466-t2');
    expect(ranking(await matrix(reverseBench(position.serialized), position))).toEqual(ranking(await matrix(position.serialized, position)));
  });

  test('2629703929 t6 (VGC tree): the board and its reversed bench read the same ranking', { timeout: 120_000 }, async () => {
    const position = fixture('gen9vgc2026regi-2629703929-t6');
    expect(ranking(await tree(reverseBench(position.serialized), position))).toEqual(ranking(await tree(position.serialized, position)));
  });

  test('every switch a ranking names brings in the species of its label on the board it was asked about', { timeout: 120_000 }, async () => {
    const g2 = fixture('smogtours-gen6ou-649664-t14-g2');
    const reversed = reverseBench(g2.serialized);
    expectSlotsNameTheirSpecies(await tree(g2.serialized, g2), g2.serialized);
    expectSlotsNameTheirSpecies(await tree(reversed, g2), reversed);
    const singles = fixture('smogtours-gen9ou-751466-t2');
    expectSlotsNameTheirSpecies(await matrix(reverseBench(singles.serialized), singles), reverseBench(singles.serialized));
    const doubles = fixture('gen9vgc2026regi-2629703929-t6');
    expectSlotsNameTheirSpecies(await tree(reverseBench(doubles.serialized), doubles), reverseBench(doubles.serialized));
  });
});
