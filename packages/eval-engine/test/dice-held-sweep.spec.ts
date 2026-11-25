import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { offeredDice, offeredEndDice, offeredOrderDice } from '../src/dice/offer';
import { readsStartRoll } from '../src/dice/start-roll';
import { probeCheck } from '../src/dice/status-probe';
import { activeMoveReaders } from './dice-census-support';
import { nameOf, present } from './dice-ability-support';
import { playClicks, standing, sweepSelection, type Mode, type Rules } from './dice-fixtures';
import { dexOfRules, outfitBoard, SWEEP_CASES, sweepClicks } from './dice-sweep-support';

await loadSimMods('gen9championsou');

const logPath = process.env.DICE_SWEEP_LOG;
const summaries: string[] = [];
afterAll(() => {
  if (logPath) writeFileSync(logPath, summaries.join('\n') + '\n', 'utf8');
});

const READERS = activeMoveReaders();
const NEEDS_AIM = new Set(['normal', 'any', 'adjacentFoe']);
const MOVES = ['tackle', 'knockoff', 'doubleedge', 'uturn', 'rockslide', 'thunderbolt', 'furyattack', 'willowisp', 'swordsdance', 'trick'];

describe('the readers of the move in flight', () => {
  test('the data names the three handlers that throw without it, and the Choice items through their volatile', () => {
    const throwing = READERS.filter(reader => reader.throwing).map(reader => `${reader.kind}/${reader.id}`);
    for (const id of ['abilities/rockhead', 'abilities/stickyhold', 'items/choicespecs', 'items/choiceband', 'items/choicescarf']) expect(throwing).toContain(id);
  });
});

describe.each(SWEEP_CASES.filter(({ rules }) => READERS.some(reader => present(rules, reader.kind, reader.id))))('held items and abilities that read the move in flight: $name', ({ rules, mode, name }) => {
  const readers = READERS.filter(reader => present(rules, reader.kind, reader.id));
  const rows = [...readers.filter(reader => reader.throwing), ...sweepSelection(readers.filter(reader => !reader.throwing), 'rows')];
  let asked = 0;
  afterAll(() => summaries.push(`${name}: ${rows.length} readers, ${asked} questions`));

  const movesOf = (rules: Rules): string[] => {
    const dex = dexOfRules(rules);
    return MOVES.filter(id => dex.moves.get(id).exists && dex.moves.get(id).gen <= dex.gen);
  };

  describe.each(rows.flatMap(reader => (['attacker', 'foe'] as const).map(holder => [`${reader.kind}/${reader.id} on the ${holder}`, reader, holder] as const)))('%s', (_label, reader, holder) => {
    const board = () => {
      const outfit = { [reader.kind === 'abilities' ? 'ability' : 'item']: nameOf(rules, reader.kind, reader.id) };
      return outfitBoard(rules, mode as Mode, { species: 'Snorlax', moves: movesOf(rules), ...(holder === 'attacker' ? outfit : {}) }, { species: 'Vaporeon', ...(holder === 'foe' ? outfit : {}) });
    };

    test('offeredDice raises no handler out of context and leaves the battle as it was', () => {
      const battle = board();
      const dex = dexOfRules(rules);
      for (const moveId of movesOf(rules)) {
        const before = standing(battle);
        const target = dex.moves.get(moveId).target;
        const choice = { kind: 'move' as const, moveId, moveName: moveId, ...(mode === 'doubles' && NEEDS_AIM.has(target) ? { targetLoc: 1 } : {}) };
        expect(() => offeredDice(battle, 'p1a', choice), `${moveId}`).not.toThrow();
        asked++;
        expect(standing(battle), `${moveId} leaves the battle as it was`).toBe(before);
      }
    });

    test('the other questions: the order and end dice, the check probe, the start roll', () => {
      const battle = board();
      const clicks = sweepClicks(mode as Mode, 'normal');
      const before = standing(battle);
      const play = (copy: Parameters<typeof playClicks>[0]) => playClicks(copy, clicks);
      expect(() => offeredOrderDice(battle, play)).not.toThrow();
      expect(() => offeredEndDice(battle, play)).not.toThrow();
      expect(() => probeCheck(battle, 'p1a', 'par', 'tackle')).not.toThrow();
      expect(() => readsStartRoll(battle, 'p1a')).not.toThrow();
      asked += 4;
      expect(standing(battle)).toBe(before);
    });
  });
});
