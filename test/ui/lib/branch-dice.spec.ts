import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import type { BranchSlotChoice, DieOffer, ForcedDie } from '@fulllifegames/eval-engine';
import { STATUS_WORDS, captionOf, chipGroups, resultWord, toggleDie, wordsOf, withDice } from '../../../src/lib/branch-dice';
import { diceBattle, setOf } from '../fixtures/dice-battle';

/**
 * Round 82 (forced dice), step A7a: the words and the edits of the panel's dice chips. The words come from the battle's own Dex
 * (`battle.dex`), the bodies' names from the battle, so no move, ability or item name stands in our code.
 */
const battle = diceBattle({ p1: [setOf('Noivern', ['airslash', 'splash'], { name: 'Nova' })], p2: [setOf('Snorlax', ['splash'])] });
const words = wordsOf(battle as never);

const die = (kind: ForcedDie['name']['kind'], result: ForcedDie['result'], extra: Partial<ForcedDie['name']> = {}): ForcedDie => ({
  name: { slot: 'p1a', moveId: 'airslash', targetSlot: 'p2a', kind, ...extra }, result,
});

describe('words of a die', () => {
  test('moves, effects and bodies read the battle', () => {
    expect(words.move('airslash')).toBe('Air Slash');
    expect(words.slot('p1a')).toBe('Nova');
    expect(words.effect('flinch')).toBe('Flinch');
    expect(words.effect('static')).toBe('Static');
    expect(words.effect('leftovers')).toBe('Leftovers');
    expect(words.effect('boosts:spd')).toBe('Special Defense change');
    expect(words.effect('boosts:atk+def')).toBe('Attack + Defense change');
    expect(words.effect('self:spa')).toBe('Own Special Attack change');
  });

  test('the status words cover every status condition of the Dex and no other', () => {
    const statuses = Object.keys(Dex.data.Conditions).filter(id => Dex.conditions.get(id).effectType === 'Status');
    expect(Object.keys(STATUS_WORDS).sort()).toEqual([...statuses].sort());
    for (const [id, word] of Object.entries(STATUS_WORDS)) expect(words.effect(id)).toBe(word);
  });

  test('a chip says the result and nothing else', () => {
    expect(resultWord(die('accuracy', { happens: true }), words)).toBe('Hits');
    expect(resultWord(die('accuracy', { happens: false }), words)).toBe('Misses');
    expect(resultWord(die('crit', { happens: true }), words)).toBe('Crit');
    expect(resultWord(die('crit', { happens: false }), words)).toBe('No crit');
    expect(resultWord(die('secondary', { happens: true }, { effectId: 'flinch' }), words)).toBe('Flinch');
    expect(resultWord(die('secondary', { happens: false }, { effectId: 'brn' }), words)).toBe('No Burn');
    expect(resultWord(die('hit-count', { hits: 3 }), words)).toBe('3 hits');
    expect(resultWord(die('ability-proc', { option: 'slp' }, { effectId: 'effectspore:option' }), words)).toBe('Sleep');
    expect(resultWord(die('speed-tie', { first: 'p2a' }, { moveId: '' }), words)).toBe('Snorlax first');
  });

  test('a caption names the die the chips decide', () => {
    const caption = (kind: ForcedDie['name']['kind'], extra: Partial<ForcedDie['name']> = {}) => captionOf(die(kind, { happens: true }, extra).name, words);
    expect(caption('accuracy')).toBe('Hit');
    expect(caption('crit')).toBe('Crit');
    expect(caption('damage-roll')).toBe('Damage roll');
    expect(caption('secondary', { effectId: 'flinch' })).toBe('Flinch');
    expect(caption('hit-count')).toBe('Hits');
    expect(caption('status-check', { effectId: 'par', targetSlot: undefined })).toBe('Paralysis check');
    expect(caption('ability-proc', { effectId: 'static' })).toBe('Static');
    expect(caption('end-of-turn', { moveId: '', effectId: 'shedskin', targetSlot: undefined })).toBe('Shed Skin');
    expect(caption('speed-tie', { moveId: '' })).toBe('Speed tie');
  });
});

describe('editing the dice of a slot choice', () => {
  const crit = die('crit', { happens: true });
  const noCrit = die('crit', { happens: false });
  const flinch = die('secondary', { happens: true }, { effectId: 'flinch' });

  test('a die is set, replaced by the other result of its key and cleared by a second click on the same result', () => {
    expect(toggleDie([], crit)).toEqual([crit]);
    expect(toggleDie([crit], flinch)).toEqual([crit, flinch]);
    expect(toggleDie([crit, flinch], noCrit)).toEqual([noCrit, flinch]);
    expect(toggleDie([crit, flinch], crit)).toEqual([flinch]);
  });

  test('withDice puts the list on a move choice, a switch choice and leaves no empty list behind', () => {
    const move: BranchSlotChoice = { kind: 'move', moveId: 'airslash', moveName: 'Air Slash', targetLoc: 1 };
    expect(withDice(move, [crit])).toEqual({ ...move, dice: [crit] });
    expect('dice' in withDice({ ...move, dice: [crit] }, [])).toBe(false);
    const swap: BranchSlotChoice = { kind: 'switch', speciesId: 'snorlax', pokemonName: 'Snorlax' };
    expect(withDice(swap, [crit])).toEqual({ ...swap, dice: [crit] });
  });
});

describe('the groups the chips show', () => {
  const offer = (kind: ForcedDie['name']['kind'], extra: Partial<ForcedDie['name']> = {}, results: DieOffer['results'] = [{ happens: true }, { happens: false }]): DieOffer => ({
    name: { slot: 'p1a', moveId: 'rockslide', targetSlot: 'p2a', kind, ...extra }, results,
  });

  test('a spread move gets one set per target, each target named; one target names none', () => {
    const offers = [
      offer('accuracy'), offer('crit'), offer('accuracy', { targetSlot: 'p2b' }), offer('crit', { targetSlot: 'p2b' }),
      offer('hit-count', { targetSlot: undefined }, [{ hits: 2 }, { hits: 3 }]),
    ];
    const groups = chipGroups(offers);
    expect(groups.map(group => [group.target, group.offers.map(entry => entry.name.kind)])).toEqual([
      ['p2a', ['accuracy', 'crit']], ['p2b', ['accuracy', 'crit']], [undefined, ['hit-count']],
    ]);
    expect(chipGroups(offers.slice(0, 2)).map(group => group.target)).toEqual([undefined]);
  });
});
