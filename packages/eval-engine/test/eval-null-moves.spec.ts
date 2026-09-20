import { test, expect, describe } from 'vitest';
import { nullMoveReason } from '../src/null-moves';

/**
 * Mechanical-null detection for recommended moves (round 5 ⑥, 653785 t19):
 * the guard must fire on definite type-chart nulls (Will-O-Wisp into a
 * Fire-type) and stay silent on everything uncertain — ability-granted
 * immunities, immunity-breaking attacker abilities, doubles, unknowns.
 */

const reason = (choice: string, defenderSpecies: string, gen = 6, attackerSpecies: string | null = null) =>
  nullMoveReason({ choice, gen, attackerSpecies, defenderSpecies });

describe('nullMoveReason', () => {
  test('Will-O-Wisp cannot burn a Fire-type', () => {
    expect(reason('move willowisp', 'Charizard-Mega-X')).toContain('cannot be burned');
    expect(reason('move willowisp', 'Charizard-Mega-X')).toContain('Fire-type');
  });

  test('Will-O-Wisp against a burnable target stays silent', () => {
    expect(reason('move willowisp', 'Rotom-Wash')).toBeNull();
  });

  test('Thunder Wave respects Ground immunity to Electric', () => {
    expect(reason('move thunderwave', 'Garchomp')).toContain('immune to Electric-type moves');
  });

  test('Thunder Wave cannot paralyze Electric-types from gen 6 on', () => {
    expect(reason('move thunderwave', 'Rotom-Wash', 6)).toContain('cannot be paralyzed');
    // Gen 5: Electric-types could still be paralyzed.
    expect(reason('move thunderwave', 'Rotom-Wash', 5)).toBeNull();
  });

  test('Toxic cannot poison Steel — unless the attacker may have Corrosion', () => {
    expect(reason('move toxic', 'Ferrothorn', 8)).toContain('cannot be badly poisoned');
    expect(reason('move toxic', 'Ferrothorn', 8, 'Salazzle')).toBeNull();
  });

  test('powder moves do not affect Grass-types from gen 6 on', () => {
    expect(reason('move spore', 'Amoonguss', 6)).toContain('powder');
    expect(reason('move spore', 'Amoonguss', 5)).toBeNull();
  });

  test('Leech Seed cannot affect Grass-types', () => {
    expect(reason('move leechseed', 'Venusaur')).toContain('Leech Seed');
  });

  test('a damaging move into a type immunity is null', () => {
    expect(reason('move earthquake', 'Skarmory')).toContain('immune to Ground-type moves');
    expect(reason('move shadowball', 'Blissey')).toContain('immune to Ghost-type moves');
  });

  // Round 54: the guard read the dex species. A terastallized defender
  // defends with its Tera type: the immunity can go, and a new one can come.
  test('a terastallized defender is read by its Tera type', () => {
    const live = (choice: string, defenderSpecies: string, defenderTera: string | null) =>
      nullMoveReason({ choice, gen: 9, attackerSpecies: null, defenderSpecies, defenderTera });
    expect(live('move closecombat', 'Gholdengo', null)).toContain('immune to Fighting-type moves');
    expect(live('move closecombat', 'Gholdengo', 'Normal')).toBeNull();
    expect(live('move closecombat', 'Snorlax', 'Ghost')).toContain('immune to Fighting-type moves');
    expect(live('move willowisp', 'Garchomp', 'Fire')).toContain('cannot be burned');
    // A Stellar Tera keeps the old types for defense.
    expect(live('move closecombat', 'Gholdengo', 'Stellar')).toContain('immune to Fighting-type moves');
  });
  test('an immunity-breaking attacker ability suppresses the verdict', () => {
    // Pangoro may carry Scrappy — Normal vs Ghost is not a definite null.
    expect(reason('move bodyslam', 'Gengar', 6, 'Pangoro')).toBeNull();
    expect(reason('move bodyslam', 'Gengar', 6, 'Snorlax')).toContain('immune to Normal-type moves');
  });

  test('non-moves, doubles choices, and unknowns stay silent', () => {
    expect(reason('switch 3', 'Charizard-Mega-X')).toBeNull();
    expect(reason('move willowisp 1, move protect', 'Charizard-Mega-X')).toBeNull();
    expect(reason('move willowisp', 'NotASpecies')).toBeNull();
    expect(reason('move notamove', 'Charizard-Mega-X')).toBeNull();
  });

  test('a gimmick-marked choice still resolves its move id', () => {
    expect(reason('move willowisp terastallize', 'Charizard-Mega-X')).toContain('cannot be burned');
  });
});
