import { describe, expect, test } from 'vitest';
import { calcGenerationFor, dexOfCalc, rulesDex, CHAMPIONS_MOD, type CalcGeneration } from '@fulllifegames/replay-core';
import { loadSimMods } from '../src/forward/sim-mods';
import { calcMove } from '../src/calc/move';
import { itemAtUse } from '../src/calc/typeless';
import { diceEventTurns } from '../src/dice-events';
import { randomCallMoves } from '../src/ko-odds';
import { setupMovesOf } from '../src/turn-analysis/played-match';
import { detectStreakOdds } from '../src/streaks';
import { nullMoveReason } from '../src/null-moves';
import { ALL_VIEWS } from './sim-views';

/**
 * Round 75 (T160, decision D1), the sweep of eval-engine's half. The Dex a reader gets is the Dex of the game: the Champions
 * mod's for a Champions game, the generation's own for an older one, entry by entry. Replay-core's half is
 * packages/replay-core/test/dex-readers-sweep.spec.ts (it compares the raw mod data with Scarlet/Violet to find the changed
 * entries); this half reads the same changed entries through eval-engine's readers:
 *  - the damage calculator's move (calc/move.ts: the power and type of each changed move, 23 and 2 of the mod's 159);
 *  - the dice markers of a turn (dice-events.ts: the 5 changed accuracies and the 4 changed secondary effects decide whether a
 *    status line is a roll), in singles and doubles log shapes;
 *  - the lists the engine keeps per Dex (the calling moves, the setup moves), which view by view equal the Dex's own data;
 *  - the older generations (the item a typeless Struggle meets, the streak and null-move readers' generation gate and type chart).
 * Red proof by hand: with `dexOfCalc` replaced by the Generation 9 Dex the Champions rows fail, with `rulesDex(gen, mod)` in
 * dice-events.ts replaced by `rulesDex(gen)` the dice rows fail.
 */
await loadSimMods('gen9championsou');

const mod = rulesDex(9, CHAMPIONS_MOD);
const standard = rulesDex(9);
const champions: CalcGeneration = calcGenerationFor(9, CHAMPIONS_MOD);
const base = { mod: CHAMPIONS_MOD } as Parameters<typeof calcMove>[2];

const changedMoves = (field: 'basePower' | 'type' | 'accuracy') => mod.moves.all()
  .filter(move => move.exists && !move.isNonstandard && standard.moves.get(move.id).exists && move[field] !== standard.moves.get(move.id)[field]);

describe('the calculator reads the move of the game', () => {
  test('every move the mod gives another power prices at the mod\'s power', () => {
    const powers = changedMoves('basePower').filter(move => move.category !== 'Status' && !move.basePowerCallback && move.basePower > 0);
    expect(powers.length).toBeGreaterThanOrEqual(10);
    const wrong = powers.filter(move => calcMove(champions, move.name, base).bp !== move.basePower).map(move => move.id);
    expect(wrong).toEqual([]);
  });

  test('Growth and Snap Trap land with the mod\'s type', () => {
    const typed = changedMoves('type');
    expect(typed.map(move => move.id).sort()).toEqual(expect.arrayContaining(['growth', 'snaptrap']));
    for (const move of typed.filter(entry => ['growth', 'snaptrap'].includes(entry.id))) {
      expect(calcMove(champions, move.name, base).type, move.id).toBe(move.type);
      expect(move.type, move.id).not.toBe(standard.moves.get(move.id).type);
    }
  });

  test('the calculator generation of a Champions game is the mod\'s Dex, a numbered one its own generation\'s', () => {
    expect(dexOfCalc(champions)).toBe(mod);
    for (const gen of [1, 2, 3, 4, 5, 6, 7, 8, 9]) expect(dexOfCalc(calcGenerationFor(gen)).gen, `Gen ${gen}`).toBe(gen);
  });
});

describe('the dice markers read the move of the game', () => {
  // A status line right after the move: a roll when the move's accuracy is under 100 or its secondary effect chance is.
  const rolls = (name: string, doubles: boolean, mods: typeof CHAMPIONS_MOD | undefined) => {
    const target = doubles ? 'p2b: Blissey' : 'p2a: Blissey';
    return diceEventTurns([[], [`|move|p1a: Garchomp|${name}|${target}`, `|-status|${target}|brn`]], 9, mods).has(1);
  };
  const expected = (dex: typeof mod, id: string): boolean => {
    const move = dex.moves.get(id);
    if (typeof move.accuracy === 'number' && move.accuracy < 100) return true;
    const effects = move.secondaries ?? (move.secondary ? [move.secondary] : []);
    return effects.some(effect => (effect.chance ?? 100) < 100
      && (effect.status !== undefined || Object.entries(effect).every(([key, value]) => key === 'chance' || typeof value === 'function')));
  };
  const touched = mod.moves.all().filter(move => move.exists && !move.isNonstandard && standard.moves.get(move.id).exists
    && (move.accuracy !== standard.moves.get(move.id).accuracy || JSON.stringify(move.secondaries ?? null) !== JSON.stringify(standard.moves.get(move.id).secondaries ?? null)));

  test.each([false, true])('doubles %s: each changed move rolls as the mod says in Champions and as Scarlet/Violet says outside it', doubles => {
    expect(touched.length).toBeGreaterThanOrEqual(5);
    const wrongMod = touched.filter(move => rolls(move.name, doubles, CHAMPIONS_MOD) !== expected(mod, move.id)).map(move => move.id);
    const wrongStandard = touched.filter(move => rolls(move.name, doubles, undefined) !== expected(standard, move.id)).map(move => move.id);
    expect({ wrongMod, wrongStandard }).toEqual({ wrongMod: [], wrongStandard: [] });
  });

  test('the sweep sees a move whose answer differs between the mod and Scarlet/Violet', () => {
    expect(touched.some(move => expected(mod, move.id) !== expected(standard, move.id))).toBe(true);
  });
});

describe('the lists kept per Dex are the Dex\'s own, view by view', () => {
  test.each(ALL_VIEWS)('$name', view => {
    const calling = view.dex.moves.all().filter(move => move.exists && (move as unknown as { callsMove?: boolean }).callsMove).map(move => move.id).sort();
    expect([...randomCallMoves(view.dex)].sort()).toEqual(calling);
    expect(setupMovesOf(view.dex).size).toBeGreaterThan(10);
  });

  test('the older generations differ from Generation 9 in what the lists hold', () => {
    const setups = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9].map(gen => [...setupMovesOf(rulesDex(gen))].sort().join()));
    expect(setups.size).toBeGreaterThan(1);
  });
});

describe('the older generations read their own data', () => {
  test('a Normal-boost item does nothing for Struggle in Generations 2 to 4 (typeless) and boosts it from Generation 5 on', () => {
    const answers = [2, 3, 4, 5, 6, 7, 8, 9].map(gen => [gen, itemAtUse(rulesDex(gen), 'Silk Scarf', 'Struggle')] as const);
    expect(answers.filter(([gen, item]) => (gen <= 4) !== (item === '')).map(([gen]) => gen)).toEqual([]);
  });

  test('the streak reader\'s generation gate and the Dex it reads come from the game', () => {
    const entry = { moveId: 'icebeam', attackerSpecies: 'Garchomp', defenderSpecies: 'Blissey', hit: true } as unknown as Parameters<typeof detectStreakOdds>[1][number];
    expect(detectStreakOdds(2, [entry, entry, entry, entry, entry])).toBeNull();
    expect(() => detectStreakOdds(6, [entry, entry, entry, entry, entry], CHAMPIONS_MOD)).not.toThrow();
    expect(() => detectStreakOdds(6, [entry, entry, entry, entry, entry])).not.toThrow();
  });

  test('a Dragon move has no effect on Clefable from Generation 6 (Fairy) and is plain damage before (Normal)', () => {
    const reasonIn = (gen: number) => nullMoveReason({ choice: 'move dragonclaw', gen, attackerSpecies: null, defenderSpecies: 'Clefable' });
    expect([5, 6, 7, 8, 9].map(gen => reasonIn(gen) === null)).toEqual([true, false, false, false, false]);
    expect(reasonIn(9)).toEqual(reasonIn(6));
  });
});
