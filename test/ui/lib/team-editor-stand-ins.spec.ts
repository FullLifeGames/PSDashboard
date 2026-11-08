import { describe, expect, test } from 'vitest';
import { withEditedStandIns } from '../../../src/lib/team-editor';
import { field, revealedPokemon } from '../fixtures/team-info';

/**
 * Round 88 (F, #101): a stand-in is a guess until the user edits it. Singles and doubles share the editor, so one body of each stands
 * for the rows: the species never decide the rule.
 */
describe('withEditedStandIns', () => {
  const guess = (species: string) => revealedPokemon(species, { standIn: true });

  test.each(['Tyranitar', 'Incineroar'])('a %s stand-in the editor left alone keeps its flag, an edited one loses it', species => {
    const original = [revealedPokemon('Azelf'), guess(species)];
    const untouched = withEditedStandIns(structuredClone(original), original);
    expect(untouched[1].standIn).toBe(true);

    const edited = structuredClone(original);
    edited[1] = { ...edited[1], item: field('Choice Scarf', 'manual') };
    const saved = withEditedStandIns(edited, original);
    expect('standIn' in saved[1]).toBe(false);
    expect(saved[1].item).toEqual({ value: 'Choice Scarf', source: 'manual' });
    expect(saved[0]).toEqual(original[0]);
  });

  test('a body that is no stand-in comes back as it went in', () => {
    const original = [revealedPokemon('Azelf')];
    const saved = withEditedStandIns([{ ...original[0], item: field('Leftovers', 'manual') }], original);
    expect(saved[0].item.source).toBe('manual');
    expect(saved[0].standIn).toBeUndefined();
  });
});
