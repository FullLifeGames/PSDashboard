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
    // The sentence names the Tera: Snorlax the species is no Ghost.
    expect(live('move closecombat', 'Snorlax', 'Ghost')).toBe('Snorlax (Tera Ghost) is immune to Fighting-type moves');
    expect(live('move willowisp', 'Garchomp', 'Fire')).toBe('Garchomp (Tera Fire) cannot be burned (Fire-type)');
    expect(live('move spore', 'Garchomp', 'Grass')).toBe('powder moves do not affect Grass-types like Garchomp (Tera Grass)');
    expect(live('move leechseed', 'Garchomp', 'Grass')).toBe('Leech Seed cannot affect Grass-types like Garchomp (Tera Grass)');
    expect(live('move thunderwave', 'Snorlax', 'Ground')).toBe('Snorlax (Tera Ground) is immune to Electric-type moves');
    // A Stellar Tera keeps the old types for defense.
    expect(live('move closecombat', 'Gholdengo', 'Stellar')).toContain('immune to Fighting-type moves');
  });
  // The sim retypes these at use time (the user's Tera type, weather, a held
  // plate): the dex type decides nothing, so the guard stays silent.
  test('a move retyped on use is never called null', () => {
    // Each of them carries a dex type some defender is immune to.
    const immuneTo: Record<string, string> = {
      terablast: 'Gengar', terastarstorm: 'Gengar', revelationdance: 'Gengar', judgment: 'Gengar',
      technoblast: 'Gengar', multiattack: 'Gengar', naturalgift: 'Gengar', weatherball: 'Gengar',
      terrainpulse: 'Gengar', aurawheel: 'Garchomp', ragingbull: 'Gengar',
    };
    for (const [move, defender] of Object.entries(immuneTo)) {
      expect(reason(`move ${move}`, defender, 9), move).toBeNull();
    }
    expect(reason('move terablast terastallize', 'Gengar', 9)).toBeNull();
    // An ordinary Normal move into a Ghost still is.
    expect(reason('move bodyslam', 'Gengar', 6)).toContain('immune to Normal-type moves');
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

describe('the null-move sentence asks the move table (round 57)', () => {
  test('a type the move may take at use is no definite null', () => {
    // Primarina may carry Liquid Voice (Water), Sylveon Pixilate (Fairy), Delcatty Normalize.
    expect(nullMoveReason({ choice: 'move hypervoice', gen: 9, attackerSpecies: 'Primarina', defenderSpecies: 'Sneasler', defenderTera: 'Ghost' })).toBeNull();
    expect(reason('move hypervoice', 'Gengar', 6, 'Sylveon')).toBeNull();
    expect(reason('move thunderbolt', 'Garchomp', 7, 'Delcatty')).toBeNull();
  });

  test('a Mega choice reads the Mega forme abilities', () => {
    // Lopunny-Mega carries Scrappy: Return into a Ghost is no definite null.
    expect(reason('move return mega', 'Gengar', 6, 'Lopunny')).toBeNull();
    // Without the Mega click Lopunny has no Scrappy, and Return stays Normal (its power rule never blocks the type).
    expect(reason('move return', 'Gengar', 6, 'Lopunny')).toContain('immune to Normal-type moves');
  });

  test('Hidden Power and Struggle are never called null', () => {
    expect(reason('move hiddenpower', 'Gengar', 7, 'Magnezone')).toBeNull();
    expect(reason('move struggle', 'Gengar', 9, 'Dragonite')).toBeNull();
  });

  test('a fixed forme type is judged: Morpeko Aura Wheel into a Ground-type', () => {
    expect(reason('move aurawheel', 'Garchomp', 9, 'Morpeko')).toContain('immune to Electric-type moves');
  });

  test('an ordinary Normal move into a Ghost still is', () => {
    expect(reason('move bodyslam', 'Gengar', 6, 'Snorlax')).toContain('immune to Normal-type moves');
  });
});

describe('the null-move sentence after the final review (round 57)', () => {
  test('a Tera click in the same choice leaves the forme and the type undecided', () => {
    // The click turns Terapagos-Terastal into Terapagos-Stellar before Tera Starstorm, which then lands as Stellar.
    expect(nullMoveReason({ choice: 'move terastarstorm terastallize', gen: 9, attackerSpecies: 'Terapagos-Terastal', defenderSpecies: 'Gholdengo' })).toBeNull();
  });

  test('an unknown attacker leaves its Tera unknown, even when the app passes null', () => {
    expect(nullMoveReason({ choice: 'move terablast', gen: 9, attackerSpecies: null, defenderSpecies: 'Gengar', attackerTera: null })).toBeNull();
  });
});
