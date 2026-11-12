import { describe, expect, test } from 'vitest';
import { rulesDex } from '@fulllifegames/replay-core';
import { dieLabel, type DieWords } from '../src/dice/die-label';
import { DIE_KINDS, type DieKind, type DieName, type ForcedDie } from '../src/dice/types';

/**
 * Round 82 (forced dice), step A5: one text per forced die for history rows, shares and frame lines (A6) and for the chips
 * (A7). The text says what the die decided in the user's words; names of moves, effects and bodies come from a reader the
 * caller hands in (the Dex of the game's rule set), so the file holds no move, ability or item name.
 */

const WORDS: DieWords = { move: id => `Move ${id}`, effect: id => `Effect ${id}`, slot: slot => `Body ${slot}` };
const name = (kind: DieKind, extra: Partial<DieName> = {}): DieName => ({ slot: 'p1a', moveId: 'tackle', targetSlot: 'p2a', kind, ...extra });
const label = (die: ForcedDie): string => dieLabel(die, WORDS);

describe('the label of a forced die', () => {
  test('a chance reads yes and no in different words, for every kind that has one', () => {
    for (const kind of DIE_KINDS) {
      if (kind === 'damage-roll' || kind === 'hit-count') continue;
      const extra = kind === 'ability-proc' || kind === 'item-proc' || kind === 'end-of-turn' || kind === 'move-first' || kind === 'status-check' || kind === 'power' || kind === 'secondary'
        ? { effectId: 'someeffect' } : {};
      const yes = label({ name: name(kind, extra), result: { happens: true } });
      const no = label({ name: name(kind, extra), result: { happens: false } });
      expect([kind, yes.length > 0, no.length > 0, yes !== no]).toEqual([kind, true, true, true]);
    }
  });

  test('accuracy, crit, secondary, hits, the damage roll and a tie read as the plan words them', () => {
    expect(label({ name: name('accuracy'), result: { happens: false } })).toBe('Move tackle: misses');
    expect(label({ name: name('crit'), result: { happens: true } })).toBe('Move tackle: crit');
    expect(label({ name: name('crit'), result: { happens: false } })).toBe('Move tackle: no crit');
    expect(label({ name: name('secondary', { effectId: 'flinch' }), result: { happens: false } })).toBe('Move tackle: no Effect flinch');
    expect(label({ name: name('hit-count', { targetSlot: undefined }), result: { hits: 4 } })).toBe('Move tackle: 4 hits');
    expect(label({ name: name('damage-roll'), result: { step: 0 } })).toBe('Move tackle: damage roll 1');
    expect(label({ name: { slot: 'p1a', moveId: '', targetSlot: 'p2a', kind: 'speed-tie' }, result: { first: 'p2a' } })).toBe('Speed tie: Body p2a first');
  });

  test('a die of an ability, an item or the end of the turn names the effect, and a result with an option names the option', () => {
    const holder = { slot: 'p2a', moveId: '' };
    expect(label({ name: { ...holder, targetSlot: 'p1a', kind: 'ability-proc', effectId: 'static' }, result: { happens: true } })).toBe('Effect static: triggers');
    expect(label({ name: { ...holder, kind: 'end-of-turn', effectId: 'shedskin' }, result: { happens: false } })).toBe('Effect shedskin: does not trigger');
    expect(label({ name: { ...holder, targetSlot: 'p1a', kind: 'ability-proc', effectId: 'effectspore:option' }, result: { option: 'slp' } })).toBe('Effect effectspore: slp');
    expect(label({ name: { ...holder, kind: 'move-first', effectId: 'quickclaw' }, result: { happens: true } })).toBe('Effect quickclaw: acts first');
    expect(label({ name: { slot: 'p1a', moveId: 'tackle', kind: 'status-check', effectId: 'par' }, result: { happens: false } })).toBe('Move tackle: Effect par stops it');
  });

  test('the accuracy die of a later hit names its hit, the first hit keeps the plain label', () => {
    expect(label({ name: name('accuracy', { hit: 2 }), result: { happens: false } })).toBe('Move tackle hit 2: misses');
    expect(label({ name: name('accuracy', { hit: 3 }), result: { happens: true } })).toBe('Move tackle hit 3: hits');
    expect(label({ name: name('accuracy'), result: { happens: false } })).toBe('Move tackle: misses');
    expect(dieLabel({ name: name('accuracy', { hit: 4 }), result: { happens: false } })).toBe('tackle hit 4: misses');
  });

  test('without a reader the ids stand in for the names', () => {
    expect(dieLabel({ name: name('accuracy'), result: { happens: true } })).toBe('tackle: hits');
  });

  test('the Dex of the game gives the move its name', () => {
    const dex = rulesDex(9);
    const words: DieWords = { move: id => dex.moves.get(id).name, effect: id => dex.conditions.get(id).name, slot: slot => slot };
    expect(dieLabel({ name: name('accuracy', { moveId: 'firefang' }), result: { happens: false } }, words)).toBe('Fire Fang: misses');
  });
});
