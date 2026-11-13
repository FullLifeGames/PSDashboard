import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { chainCount, chainResults, type DiceReport, type DieName, type DieOffer, type DieReport, type ForcedDie } from '@fulllifegames/eval-engine';
import { applyDie, diceTable, pullNotes, resultWord, wordsOf } from '../../../src/lib/branch-dice';
import { dieLines, type TurnWindow } from '../../../src/lib/branch-dice-lines';
import { diceMarksOf, sideMarkTexts } from '../../../src/lib/branch-dice-marks';
import { diceBattle, setOf } from '../fixtures/dice-battle';

/**
 * Round 89 (#114, F3; the user's ruling 31 on 13.11.2026): a move whose later hits roll accuracy (Dex `multiaccuracy`: Triple Axel,
 * Triple Kick, Population Bomb) shows one "Hits" row with the counts 1 to N under its "Hit" row, like the hit count of Bullet Seed. A
 * count k stands for the engine's per-hit dice as `chainResults` writes them (hits 2 to k land, hit k + 1 misses, count N is all
 * landing) and always sets the first hit. The history and the share link say "2 hits". The counts come from the Dex: no move name
 * stands in our code.
 */
const battle = diceBattle({ p1: [setOf('Snorlax', ['splash'], { name: 'Nova' })], p2: [setOf('Vaporeon', ['splash'], { name: 'Wave' })] });
const words = wordsOf(battle as never);

const nameOf = (moveId: string, kind: DieName['kind'], extra: Partial<DieName> = {}): DieName => ({ slot: 'p1a', moveId, targetSlot: 'p2a', kind, ...extra });
const YES_NO = [{ happens: true }, { happens: false }];
/** The offers of one target as the engine names them (F1): the plain accuracy die, hits 2 to N, then the crit. */
const offersOf = (moveId: string, hits: number, extra: Partial<DieName> = {}): DieOffer[] => [
  { name: nameOf(moveId, 'accuracy', extra), results: YES_NO },
  ...Array.from({ length: hits - 1 }, (_, index): DieOffer => ({ name: nameOf(moveId, 'accuracy', { ...extra, hit: index + 2 }), results: YES_NO })),
  { name: nameOf(moveId, 'crit', extra), results: YES_NO },
];
/** What a click on the chip "k hits" hands over: the hit count die of the move and the target, with no hit number. */
const count = (moveId: string, hits: number, extra: Partial<DieName> = {}): ForcedDie => ({ name: nameOf(moveId, 'hit-count', extra), result: { hits } });
const plain = (moveId: string, happens = true, extra: Partial<DieName> = {}): ForcedDie => ({ name: nameOf(moveId, 'accuracy', extra), result: { happens } });
const later = (moveId: string, hit: number, happens: boolean, extra: Partial<DieName> = {}): ForcedDie => ({ name: nameOf(moveId, 'accuracy', { ...extra, hit }), result: { happens } });
const tags = (dice: readonly ForcedDie[]) => dice.map(entry => `${entry.name.kind}${entry.name.hit ?? ''}:${JSON.stringify(entry.result)}`);

/** Every move of the Dex whose later hits roll accuracy, in every generation that has one: the counts are read from `multihit`. */
const multiAccuracy = [3, 4, 5, 6, 7, 8, 9].flatMap(generation => Dex.forGen(generation).moves.all()
  .filter(move => (move as unknown as { multiaccuracy?: boolean }).multiaccuracy && typeof move.multihit === 'number')
  .map(move => ({ generation, id: move.id, hits: move.multihit as number })));

describe('the Dex rows this spec stands on', () => {
  test('the three moves of the issue are among them, with their hits', () => {
    const gen9 = multiAccuracy.filter(entry => entry.generation === 9).map(entry => [entry.id, entry.hits]);
    expect(gen9).toEqual(expect.arrayContaining([['populationbomb', 10], ['tripleaxel', 3], ['triplekick', 3]]));
  });
});

describe('the table folds the later hits into one Hits row (singles and doubles)', () => {
  test.each([
    ['singles: slot p1a', 'p1a'],
    ['doubles: slot p1b of a four-slot dock', 'p1b'],
  ])('%s: one row of counts 1 to N under the Hit row, no row per hit', (_label, slot) => {
    const table = diceTable(offersOf('tripleaxel', 3, { slot }));
    expect(table.heads).toEqual([]);
    expect(table.rows.map(row => row.cells[0]!.name.kind)).toEqual(['accuracy', 'hit-count', 'crit']);
    const hits = table.rows[1].cells[0]!;
    expect(hits.name).toEqual({ slot, moveId: 'tripleaxel', targetSlot: 'p2a', kind: 'hit-count' });
    expect(hits.results).toEqual([{ hits: 1 }, { hits: 2 }, { hits: 3 }]);
    expect(table.shared).toEqual([]);
  });

  test('every multi-accuracy move of the Dex folds to the counts 1 to its hits, in every generation from 3', () => {
    for (const { generation, id, hits } of multiAccuracy) {
      const table = diceTable(offersOf(id, hits));
      const rows = table.rows.filter(row => row.cells[0]!.name.kind === 'hit-count');
      expect(rows, `${generation} ${id}`).toHaveLength(1);
      expect(rows[0].cells[0]!.results.map(result => ('hits' in result ? result.hits : 0)), `${generation} ${id}`).toEqual(Array.from({ length: hits }, (_, index) => index + 1));
      expect(table.rows.some(row => row.cells[0]!.name.hit !== undefined), `${generation} ${id}`).toBe(false);
    }
  });

  test('a target column each (a spread dock) gets the counts in the cell of its own target, right under the Hit row', () => {
    const offers = [...offersOf('tripleaxel', 3), ...offersOf('tripleaxel', 3, { targetSlot: 'p2b' })];
    const table = diceTable(offers);
    expect(table.heads).toEqual(['p2a', 'p2b']);
    expect(table.rows.map(row => row.cells.map(cell => cell?.name.kind))).toEqual([
      ['accuracy', 'accuracy'], ['hit-count', 'hit-count'], ['crit', 'crit'],
    ]);
    expect(table.rows[1].cells.map(cell => cell?.name.targetSlot)).toEqual(['p2a', 'p2b']);
  });

  test('a move with no later hit dice (Skill Link or Loaded Dice holder, any other move) has no Hits row', () => {
    const table = diceTable(offersOf('tripleaxel', 1));
    expect(table.rows.map(row => row.cells[0]!.name.kind)).toEqual(['accuracy', 'crit']);
  });

  test('the hit count die of Bullet Seed stays a row of its own, as before', () => {
    const bullet: DieOffer = { name: { slot: 'p1a', moveId: 'bulletseed', kind: 'hit-count' }, results: [{ hits: 2 }, { hits: 3 }, { hits: 4 }, { hits: 5 }] };
    const table = diceTable([...offersOf('bulletseed', 1), bullet]);
    expect(table.rows.map(row => row.cells[0]!.name.kind)).toEqual(['accuracy', 'crit', 'hit-count']);
    expect(table.rows[2].cells[0]).toBe(bullet);
  });

  test('a count die names its target; the real hit count names none, and a click on it sets the first hit as before', () => {
    const bullet: DieOffer = { name: { slot: 'p1a', moveId: 'bulletseed', kind: 'hit-count' }, results: [{ hits: 2 }, { hits: 3 }] };
    const set = applyDie([], { name: bullet.name, result: { hits: 3 } }, [...offersOf('bulletseed', 1), bullet]);
    expect(tags(set)).toEqual(['hit-count:{"hits":3}', 'accuracy:{"happens":true}']);
  });
});

describe('the chips say the counts', () => {
  test('1 hit reads in the singular, the rest in the plural', () => {
    expect(resultWord(count('tripleaxel', 1), words)).toBe('1 hit');
    expect(resultWord(count('tripleaxel', 2), words)).toBe('2 hits');
    expect(resultWord(count('populationbomb', 10), words)).toBe('10 hits');
  });
});

describe('a count click sets the per-hit dice the engine offers (singles and doubles)', () => {
  test.each([['p1a'], ['p1b']])('slot %s: count k sets the first hit, hits 2 to k and the miss of hit k + 1; count N is all landing', slot => {
    const offers = offersOf('tripleaxel', 3, { slot });
    const extra = { slot };
    expect(tags(applyDie([], count('tripleaxel', 2, extra), offers))).toEqual(['accuracy:{"happens":true}', 'accuracy2:{"happens":true}', 'accuracy3:{"happens":false}']);
    expect(tags(applyDie([], count('tripleaxel', 1, extra), offers))).toEqual(['accuracy:{"happens":true}', 'accuracy2:{"happens":false}']);
    expect(tags(applyDie([], count('tripleaxel', 3, extra), offers))).toEqual(['accuracy:{"happens":true}', 'accuracy2:{"happens":true}', 'accuracy3:{"happens":true}']);
  });

  test('every count of every multi-accuracy move of the Dex maps to chainResults, and chainCount reads it back', () => {
    for (const { generation, id, hits } of multiAccuracy) {
      const offers = offersOf(id, hits);
      for (let k = 1; k <= hits; k++) {
        const set = applyDie([], count(id, k), offers);
        const hitDice = set.filter(entry => entry.name.hit !== undefined);
        const label = `${generation} ${id} ${k}`;
        expect(hitDice.map(entry => ({ hit: entry.name.hit, happens: 'happens' in entry.result && entry.result.happens })), label)
          .toEqual(chainResults(k, hits).map(({ hit, happens }) => ({ hit, happens })));
        expect(chainCount(hitDice.map(entry => ({ hit: entry.name.hit!, happens: 'happens' in entry.result && entry.result.happens }))), label).toBe(k);
        expect(set.filter(entry => entry.name.hit === undefined).map(entry => entry.result), label).toEqual([{ happens: true }]);
      }
    }
  });

  test('another count replaces the first, and a second click on the same count gives the hit dice back (the first hit stays set)', () => {
    const offers = offersOf('populationbomb', 10);
    const two = applyDie([], count('populationbomb', 2), offers);
    const six = applyDie(two, count('populationbomb', 6), offers);
    expect(six.filter(entry => entry.name.hit !== undefined)).toHaveLength(6);
    expect(chainCount(six.filter(entry => entry.name.hit !== undefined).map(entry => ({ hit: entry.name.hit!, happens: 'happens' in entry.result && entry.result.happens })))).toBe(6);
    expect(tags(applyDie(six, count('populationbomb', 6), offers))).toEqual(['accuracy:{"happens":true}']);
  });

  test('a count leaves the dice of other moves and other kinds alone', () => {
    const offers = offersOf('tripleaxel', 3);
    const crit: ForcedDie = { name: nameOf('tripleaxel', 'crit'), result: { happens: true } };
    const other = plain('splash', true, { moveId: 'splash', targetSlot: 'p2b' });
    expect(tags(applyDie([crit, other], count('tripleaxel', 2), offers))).toEqual(['crit:{"happens":true}', 'accuracy:{"happens":true}', 'accuracy:{"happens":true}', 'accuracy2:{"happens":true}', 'accuracy3:{"happens":false}']);
  });

  test('a crit sets the first hit only: it does not read as a forced chain', () => {
    const offers = offersOf('tripleaxel', 3);
    const set = applyDie([], { name: nameOf('tripleaxel', 'crit'), result: { happens: true } }, offers);
    expect(tags(set)).toEqual(['crit:{"happens":true}', 'accuracy:{"happens":true}']);
  });

  test('a miss of the first hit takes the later hits back; a chip of a later hit that stands apart does not take the crit', () => {
    const offers = offersOf('tripleaxel', 3);
    const chain = applyDie([], count('tripleaxel', 3), offers);
    const crit: ForcedDie = { name: nameOf('tripleaxel', 'crit'), result: { happens: true } };
    expect(tags(applyDie([...chain, crit], plain('tripleaxel', false), offers))).toEqual(['accuracy:{"happens":false}']);
    expect(tags(applyDie([crit, plain('tripleaxel'), later('tripleaxel', 2, true)], later('tripleaxel', 3, false), offers))).toEqual([
      'crit:{"happens":true}', 'accuracy:{"happens":true}', 'accuracy2:{"happens":true}', 'accuracy3:{"happens":false}',
    ]);
  });

  test('the notes say why a hit stands set once, whatever the later hits hold', () => {
    const offers = offersOf('tripleaxel', 3);
    const dice = [{ name: nameOf('tripleaxel', 'crit'), result: { happens: true } } as ForcedDie, plain('tripleaxel'), later('tripleaxel', 2, true), later('tripleaxel', 3, true)];
    expect(pullNotes(dice, offers, words)).toEqual(['Triple Axel hits Wave because the crit needs a hit.']);
  });
});

describe('the history and the share link read one entry per chain', () => {
  const entry = (die: ForcedDie, rest: Partial<DieReport> = {}): DieReport => ({ die, took: 'applied', chance: 0.9, ...rest });
  const report = (...forced: DieReport[]): DiceReport => ({ forced, naturalEndSeed: '1,2,3,4' });

  test('hit dice of one move and target fold into "Triple Axel: 2 hits" beside the first hit\'s mark', () => {
    const marks = diceMarksOf(report(entry(plain('tripleaxel')), entry(later('tripleaxel', 2, true)), entry(later('tripleaxel', 3, false))), words)!;
    expect(sideMarkTexts(marks, 'p1')).toEqual(['Triple Axel: hits', 'Triple Axel: 2 hits']);
  });

  test('count 1 reads in the singular, count N has no miss die', () => {
    expect(sideMarkTexts(diceMarksOf(report(entry(later('tripleaxel', 2, false))), words), 'p1')).toEqual(['Triple Axel: 1 hit']);
    expect(sideMarkTexts(diceMarksOf(report(entry(later('populationbomb', 2, true)), entry(later('populationbomb', 3, true))), words), 'p1')).toEqual(['Population Bomb: 3 hits']);
  });

  test('a hit that was never drawn says no effect with the report\'s reason; two targets or two sides stay two marks', () => {
    const marks = diceMarksOf(report(
      entry(later('tripleaxel', 2, true), { took: 'no-draw', reason: 'the target fainted' }), entry(later('tripleaxel', 3, false), { took: 'no-draw', reason: 'the target fainted' }),
      entry(later('tripleaxel', 2, false, { targetSlot: 'p2b' })), entry(later('tripleaxel', 2, true, { slot: 'p2a', targetSlot: 'p1a' })),
    ), words)!;
    expect(marks.p1).toEqual([{ label: 'Triple Axel: 2 hits', noEffect: 'the target fainted' }, { label: 'Triple Axel: 1 hit' }]);
    expect(sideMarkTexts(marks, 'p2')).toEqual(['Triple Axel: 2 hits']);
  });

  test('the hit that ended the chain was never drawn when the target fainted before it: the count still stands applied', () => {
    const marks = diceMarksOf(report(entry(later('tripleaxel', 2, true)), entry(later('tripleaxel', 3, false), { took: 'no-draw', reason: 'the target fainted' })), words)!;
    expect(marks.p1).toEqual([{ label: 'Triple Axel: 2 hits' }]);
  });

  const WINDOW: TurnWindow = {
    battleLog: ['|old', '|old two', '|move|p1a: Nova|Triple Axel|p2a: Wave', '|-damage|p2a: Wave|80/100', '|-damage|p2a: Wave|60/100', '|-damage|p2a: Wave|40/100', '|-hitcount|p2a: Wave|3', '|upkeep'],
    battleStart: 2, shownLog: ['|old', '|old two', '|move|p1a: Nova|Triple Axel|p2a: Wave', '|-damage|p2a: Wave|80/100', '|-damage|p2a: Wave|60/100', '|-damage|p2a: Wave|40/100', '|-hitcount|p2a: Wave|3', '|upkeep'],
    shownStart: 2, complete: true,
  };

  test('a count that played in part (the target fainted on hit 3 of a forced 4) says so with the report\'s reason', () => {
    const stopped = { took: 'no-draw' as const, reason: 'Triple Axel ended after 3 hits', landed: 3 };
    const forced = report(entry(later('populationbomb', 2, true), { logIndex: 4 }), entry(later('populationbomb', 3, true), { logIndex: 5 }), entry(later('populationbomb', 4, true), stopped), entry(later('populationbomb', 5, false), stopped));
    // round 89 (F5): the hits that landed are named; "(no effect)" is false for a chain that played three hits
    expect(diceMarksOf(forced, words)!.p1).toEqual([{ label: 'Population Bomb: 4 hits', noEffect: 'Triple Axel ended after 3 hits', played: 3 }]);
    expect(sideMarkTexts(diceMarksOf(forced, words), 'p1')).toEqual(['Population Bomb: 4 hits (3 played)']);
    const lines = dieLines(forced, WINDOW, words);
    expect(lines.map(line => line.text)).toEqual(['Forced: Population Bomb 4 hits', 'Forced 4 hits, 3 played: Triple Axel ended after 3 hits']);
    expect(lines[0].at).toBe(4);
  });

  test('a count the first hit already cut short names the one hit that landed; a count with no hit played keeps "no effect"', () => {
    const ended = { took: 'no-draw' as const, reason: 'Triple Axel ended after 1 hit, so hit 2 was never rolled', landed: 1 };
    const forced = report(entry(later('tripleaxel', 2, true), ended), entry(later('tripleaxel', 3, false), ended));
    expect(sideMarkTexts(diceMarksOf(forced, words), 'p1')).toEqual(['Triple Axel: 2 hits (1 played)']);
    expect(dieLines(forced, WINDOW, words).map(line => line.text)).toEqual(['Forced 2 hits, 1 played: Triple Axel ended after 1 hit, so hit 2 was never rolled']);
    const none = { took: 'no-draw' as const, reason: 'p1a did not use Triple Axel this turn' };
    const unplayed = report(entry(later('tripleaxel', 2, true), none), entry(later('tripleaxel', 3, false), none));
    expect(sideMarkTexts(diceMarksOf(unplayed, words), 'p1')).toEqual(['Triple Axel: 2 hits (no effect)']);
    expect(dieLines(unplayed, WINDOW, words).map(line => line.text)).toEqual(['Forced 2 hits had no effect: p1a did not use Triple Axel this turn']);
  });

  test('the frame says "Forced: Triple Axel 2 hits" once, before the second hit', () => {
    const lines = dieLines(report(
      entry(plain('tripleaxel'), { logIndex: 3 }), entry(later('tripleaxel', 2, true), { logIndex: 4 }), entry(later('tripleaxel', 3, false), { logIndex: 5 }),
    ), WINDOW, words);
    expect(lines.map(line => line.text)).toEqual(['Forced: Triple Axel hits, 90 %', 'Forced: Triple Axel 2 hits']);
    expect(lines[1].at).toBe(4);
  });

  test('a chain that took no effect gets one line at the end of the action', () => {
    const lines = dieLines(report(entry(later('tripleaxel', 2, true), { took: 'no-draw', reason: 'Triple Axel stopped' }), entry(later('tripleaxel', 3, false), { took: 'no-draw', reason: 'Triple Axel stopped' })), WINDOW, words);
    expect(lines.map(line => line.text)).toEqual(['Forced 2 hits had no effect: Triple Axel stopped']);
  });
});
