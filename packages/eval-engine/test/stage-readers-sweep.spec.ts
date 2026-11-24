import { describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { foeReadsStages, readsStages } from '../src/endgame/stage-readers';
import { mon, standing } from './dice-fixtures';
import { dexOfRules, SWEEP_CASES } from './dice-sweep-support';
import { battleOf } from './power-oracle';

await loadSimMods('gen9championsou');

const READERS = ['foulplay', 'punishment', 'psychup', 'spectralthief', 'topsyturvy', 'powerswap', 'heartswap', 'guardswap', 'transform'];

describe.each(SWEEP_CASES.filter(({ mode }) => mode === 'singles'))('$name: every move against the census', ({ rules }) => {
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

describe.each(SWEEP_CASES)('$name: a foe board with a reader reads as one', ({ rules, mode }) => {
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
