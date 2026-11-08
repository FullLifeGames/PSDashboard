import { describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { foeReadsStages, readsStages } from '../src/endgame/stage-readers';
import { mon, standing } from './dice-fixtures';
import { dexOfRules, SWEEP_CASES } from './dice-sweep-support';
import { battleOf } from './power-oracle';

/**
 * Round 88 (T336, #72, E2b): the census of the moves that read or move stat stages (`endgame/stage-readers.ts`), played on a twin
 * battle per move, against every Dex move of every rule set the corpus plays (Gens 1 to 9 and the Champions mod; the twin is a
 * singles battle of the generation, and the rule it serves fires only in singles: a doubles cell draws no class). The census must
 * name exactly the moves that read the target's stages (Foul Play, Punishment), copy or steal them (Psych Up, Spectral Thief,
 * Transform) or turn or hand them over (Topsy-Turvy, the three Swap moves), where the rule set has them: the Dex fields of the two
 * that carry one (`overrideOffensivePokemon`, `stealsBoosts`) say it independently. Every move the Dex plays at all is asked, no
 * sample: the census costs about 3 ms a move. A board of either game type with such a move on a foe's bench or lead reads as a reader,
 * and every question leaves the battle it reads standing.
 */
await loadSimMods('gen9championsou');

/** What the simulator shows, by name: the oracle of the census (the code reads no name). */
const READERS = ['foulplay', 'punishment', 'psychup', 'spectralthief', 'topsyturvy', 'powerswap', 'heartswap', 'guardswap', 'transform'];

describe.each(SWEEP_CASES.filter(({ mode }) => mode === 'singles'))('$name: every move against the census (round 88, T336)', ({ rules }) => {
  const dex = dexOfRules(rules);
  const moves = dex.moves.all().filter(move => move.exists && !move.isZ && !move.isMax && move.gen <= dex.gen
    && (move.isNonstandard === null || move.isNonstandard === undefined || move.isNonstandard === 'Past'));

  test('the moves the census names are the readers the rule set has, and no others', () => {
    const flagged = moves.filter(move => readsStages(rules.singles, move.id)).map(move => move.id).sort();
    const expected = READERS.filter(id => moves.some(move => move.id === id)).sort();
    expect(flagged).toEqual(expected);
  });

  test('the Dex fields that say it name a reader too', () => {
    const fielded = moves.filter(move => {
      const raw = move as unknown as { overrideOffensivePokemon?: string; stealsBoosts?: boolean };
      return raw.overrideOffensivePokemon === 'target' || raw.stealsBoosts;
    });
    for (const move of fielded) expect(`${move.id} ${readsStages(rules.singles, move.id)}`).toBe(`${move.id} true`);
    expect(fielded.length > 0).toBe(rules.generation >= 5);
  });
});

describe.each(SWEEP_CASES)('$name: a foe board with a reader reads as one (round 88, T336)', ({ rules, mode }) => {
  const dex = dexOfRules(rules);
  const readers = READERS.filter(id => dex.moves.get(id).exists && dex.moves.get(id).gen <= dex.gen);
  const board = (leadMoves: string[], benchMoves: string[]) => {
    const user = [mon(rules, { species: 'Snorlax', moves: ['splash'], gender: 'M' })];
    const foes = [mon(rules, { species: 'Vaporeon', moves: leadMoves }), mon(rules, { species: 'Blissey', moves: ['splash'] }), mon(rules, { species: 'Chansey', moves: benchMoves })];
    if (mode === 'singles') return battleOf(rules.singles, user, foes);
    return battleOf(rules.doubles!, [...user, mon(rules, { species: 'Blissey', moves: ['splash'] })], foes);
  };

  test('a lead or a bench body with the move reads as a reader, a board of Splash does not, and the battle stands', () => {
    expect(readers.length).toBeGreaterThan(0);
    const plain = board(['splash'], ['splash']);
    const plainBefore = standing(plain);
    expect(foeReadsStages(plain, 'p1')).toBe(false);
    expect(standing(plain)).toBe(plainBefore);
    for (const reader of readers) {
      for (const battle of [board(['splash', reader], ['splash']), board(['splash'], [reader])]) {
        const before = standing(battle);
        expect(`${reader} ${foeReadsStages(battle, 'p1')}`).toBe(`${reader} true`);
        expect(standing(battle)).toBe(before);
      }
    }
  });

  test('a fainted body does not count, and the other side is the one asked', () => {
    const battle = board(['splash'], [readers[0]]);
    expect(foeReadsStages(battle, 'p2')).toBe(false);
    const bench = battle.sides[1].pokemon.find(pokemon => pokemon.moveSlots.some(slot => slot.id === readers[0]));
    expect(bench).toBeDefined();
    expect(foeReadsStages(battle, 'p1')).toBe(true);
    bench!.fainted = true;
    expect(foeReadsStages(battle, 'p1')).toBe(false);
  });
});
