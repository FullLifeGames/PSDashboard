import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import type { BranchSlotChoice, DieOffer, ForcedDie } from '@fulllifegames/eval-engine';
import { STATUS_WORDS, applyDie, captionOf, diceTable, pullNotes, resultWord, toggleDie, wordsOf, withDice } from '../../../src/lib/branch-dice';
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

describe('the table the dice show (round 84, A4)', () => {
  const offer = (kind: ForcedDie['name']['kind'], extra: Partial<ForcedDie['name']> = {}, results: DieOffer['results'] = [{ happens: true }, { happens: false }]): DieOffer => ({
    name: { slot: 'p1a', moveId: 'rockslide', targetSlot: 'p2a', kind, ...extra }, results,
  });

  test('a spread move gets one column per target and one row per kind of die; the dice that name no target stand apart', () => {
    const offers = [
      offer('accuracy'), offer('crit'), offer('accuracy', { targetSlot: 'p2b' }), offer('crit', { targetSlot: 'p2b' }),
      offer('hit-count', { targetSlot: undefined }, [{ hits: 2 }, { hits: 3 }]),
    ];
    const table = diceTable(offers);
    expect(table.heads).toEqual(['p2a', 'p2b']);
    expect(table.rows.map(row => row.cells.map(cell => cell && [cell.name.targetSlot, cell.name.kind]))).toEqual([
      [['p2a', 'accuracy'], ['p2b', 'accuracy']], [['p2a', 'crit'], ['p2b', 'crit']],
    ]);
    expect(table.shared.map(entry => entry.name.kind)).toEqual(['hit-count']);
  });

  test('a die only one target has leaves a gap in the other column', () => {
    const table = diceTable([offer('accuracy'), offer('accuracy', { targetSlot: 'p2b' }), offer('secondary', { effectId: 'flinch', targetSlot: 'p2b' })]);
    expect(table.rows.map(row => row.cells.map(cell => cell?.name.kind ?? null))).toEqual([['accuracy', 'accuracy'], [null, 'secondary']]);
  });

  test('one target gives one column without a heading, every die a row', () => {
    const table = diceTable([offer('accuracy'), offer('crit')]);
    expect(table.heads).toEqual([]);
    expect(table.rows.map(row => row.cells.map(cell => cell?.name.kind))).toEqual([['accuracy'], ['crit']]);
    expect(diceTable([])).toEqual({ heads: [], rows: [], shared: [] });
  });
});

describe('the dice a forced die needs (decision 5a)', () => {
  const offer = (kind: ForcedDie['name']['kind'], extra: Partial<ForcedDie['name']> = {}): DieOffer => ({
    name: { slot: 'p1a', moveId: 'airslash', targetSlot: 'p2a', kind, ...extra }, results: [{ happens: true }, { happens: false }],
  });
  const offers = [
    offer('accuracy'), offer('crit'), offer('secondary', { effectId: 'flinch' }),
    offer('accuracy', { moveId: 'splash', targetSlot: 'p2b' }),
    offer('status-check', { targetSlot: undefined, effectId: 'par' }),
    offer('hit-count', { targetSlot: undefined }),
  ];
  const yes = (kind: ForcedDie['name']['kind'], extra: Partial<ForcedDie['name']> = {}): ForcedDie => die(kind, { happens: true }, extra);
  const no = (kind: ForcedDie['name']['kind'], extra: Partial<ForcedDie['name']> = {}): ForcedDie => die(kind, { happens: false }, extra);
  const kinds = (dice: ForcedDie[]) => dice.map(entry => `${entry.name.kind}:${JSON.stringify(entry.result)}`);

  test('a crit, a roll, a secondary effect or a hit count sets the hit and passes the attacker status checks', () => {
    const checked = (kind: ForcedDie['name']['kind'], extra: Partial<ForcedDie['name']> = {}) => kinds(applyDie([], die(kind, { happens: false }, extra), offers));
    expect(checked('crit')).toEqual(['crit:{"happens":false}', 'accuracy:{"happens":true}', 'status-check:{"happens":true}']);
    expect(kinds(applyDie([], die('damage-roll', { step: 4 }), offers))).toEqual(['damage-roll:{"step":4}', 'accuracy:{"happens":true}', 'status-check:{"happens":true}']);
    expect(checked('secondary', { effectId: 'flinch' })[1]).toBe('accuracy:{"happens":true}');
    expect(kinds(applyDie([], die('hit-count', { hits: 3 }, { targetSlot: undefined }), offers))).toContain('accuracy:{"happens":true}');
  });

  test('the pulled dice replace a result that contradicts them and leave other moves alone', () => {
    const held = [no('accuracy'), no('status-check', { targetSlot: undefined, effectId: 'par' }), no('accuracy', { moveId: 'splash', targetSlot: 'p2b' })];
    const next = applyDie(held, yes('crit'), offers);
    expect(kinds(next)).toEqual(['accuracy:{"happens":true}', 'status-check:{"happens":true}', 'accuracy:{"happens":false}', 'crit:{"happens":true}']);
  });

  test('a die with no offered hit pulls nothing', () => {
    expect(kinds(applyDie([], yes('crit'), offers.filter(entry => entry.name.kind !== 'accuracy' && entry.name.kind !== 'status-check')))).toEqual(['crit:{"happens":true}']);
  });

  test('a miss or a stopped body takes the dice that need the hit back', () => {
    const crit = yes('crit');
    const flinch = yes('secondary', { effectId: 'flinch' });
    const count = die('hit-count', { hits: 2 }, { targetSlot: undefined });
    expect(kinds(applyDie([crit, flinch], no('accuracy'), offers))).toEqual(['accuracy:{"happens":false}']);
    expect(kinds(applyDie([crit, count], no('status-check', { targetSlot: undefined, effectId: 'par' }), offers))).toEqual(['status-check:{"happens":false}']);
  });

  test('clearing a die changes no other die', () => {
    const pulled = applyDie([], yes('crit'), offers);
    expect(kinds(applyDie(pulled, yes('crit'), offers))).toEqual(['accuracy:{"happens":true}', 'status-check:{"happens":true}']);
  });

  test('the notes say which die needs the hit and the passed check, with the names of the battle', () => {
    expect(pullNotes(applyDie([], yes('crit'), offers), offers, words)).toEqual([
      'Air Slash hits Snorlax because the crit needs a hit.',
      'Nova passes the Paralysis check because the crit needs it to move.',
    ]);
    expect(pullNotes(applyDie([], yes('secondary', { effectId: 'brn' }), offers), offers, words)[0]).toBe('Air Slash hits Snorlax because the burn needs a hit.');
    expect(pullNotes([yes('accuracy')], offers, words)).toEqual([]);
  });
});
