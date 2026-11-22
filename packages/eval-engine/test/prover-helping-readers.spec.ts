import { State } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { loadSimMods } from '../src/forward/sim-mods';
import { createRootPosition, positionBattle } from '../src/forward-model';
import { endgameChildren, type EndgameChildren } from '../src/endgame/children';
import { helpedSources } from '../src/endgame/prover-helping';
import { mon, standing } from './dice-fixtures';
import { dexOfRules, SWEEP_CASES } from './dice-sweep-support';
import { battleOf } from './power-oracle';

/**
 * Round 88 (T336, #72, E2b): a fired class takes its unfired sibling's proof only while no living body of the foe's side can click a
 * move that reads or moves the stages the class moved (Foul Play reads the target's Attack, Punishment its positive stages, Psych Up
 * and Spectral Thief copy or steal a gain, Topsy-Turvy and the Swap moves turn or hand over stages). Rows: the foe leads with such a
 * move, or carries it on the bench, and every row must play a fired class (or it proves nothing). The control row gives the foe the
 * same board with a move that reads nothing: the sources are named. The census behind the rule is held to the simulator by
 * `stage-readers-sweep.spec.ts`; the names here are the oracle, the code reads none.
 */
await loadSimMods('gen9championsou');

const READERS = ['foulplay', 'punishment', 'psychup', 'spectralthief', 'topsyturvy', 'powerswap', 'heartswap', 'guardswap'];
/** Boost secondaries under 100 percent that drop the foe's Special Defense, the scene's mover move: the first the rule set has. */
const MOVERS = ['shadowball', 'psychic', 'focusblast', 'energyball', 'flashcannon', 'crunch'];

const drawn = (dex: ReturnType<typeof dexOfRules>, id: string) => {
  const move = dex.moves.get(id);
  return move.exists && move.gen <= dex.gen && (move.isNonstandard === null || move.isNonstandard === undefined || move.isNonstandard === 'Past');
};

describe.each(SWEEP_CASES.filter(({ mode, rules }) => mode === 'singles' && rules.generation >= 3))('$name: a foe with a stage reader keeps the classes apart', ({ rules }) => {
  const dex = dexOfRules(rules);
  const mover = MOVERS.find(id => {
    if (!drawn(dex, id)) return false;
    const entry = dex.moves.get(id) as unknown as { secondary?: { chance?: number; boosts?: object } | null; secondaries?: { chance?: number; boosts?: object }[] | null };
    return [...(entry.secondaries ?? []), ...(entry.secondary ? [entry.secondary] : [])].some(one => one.boosts && (one.chance ?? 100) < 100);
  })!;

  /** `benchLevel` moves the bench body's level only: another position, so another cell seed (round 89, #148). */
  const cellOf = (lead: string[], bench: string[], benchLevel = 0): EndgameChildren => {
    const user = mon(rules, { species: 'Snorlax', moves: [mover], gender: 'M' });
    const foe = mon(rules, { species: 'Vaporeon', moves: lead });
    const battle = battleOf(rules.singles, [user], [foe, { ...mon(rules, { species: 'Blissey', moves: bench }), level: rules.level - benchLevel }]);
    const root = createRootPosition(JSON.stringify(State.serializeBattle(battle)));
    return endgameChildren(root, `move ${mover}`, 'move splash', 6);
  };
  const fired = (cell: EndgameChildren) => cell.children.filter(child => child.key?.startsWith('p1:hit-nokill+'));

  test('the control: a foe with nothing that reads a stage lets the fired class take the proof', () => {
    expect(mover).toBeDefined();
    const cell = cellOf(['splash'], ['splash']);
    expect(`fired ${fired(cell).length > 0}`).toBe('fired true');
    expect(helpedSources(cell, 'p1').some(source => source >= 0)).toBe(true);
  });

  // Round 89 (#148): the control over eight boards (the bench body's level differs, so each cell draws its own seeds): a crit that
  // lands on a representative child must not keep the fired class from its source.
  for (let level = 0; level < 8; level++) {
    test(`the control, board ${level}: the fired class takes the proof whatever the seed rolls`, () => {
      const cell = cellOf(['splash'], ['splash'], level);
      expect(`board ${level} fired ${fired(cell).length > 0}`).toBe(`board ${level} fired true`);
      expect(`board ${level} source ${helpedSources(cell, 'p1').some(source => source >= 0)}`).toBe(`board ${level} source true`);
    });
  }

  for (const reader of READERS) {
    if (!drawn(dex, reader)) continue;
    for (const where of ['lead', 'bench'] as const) {
      test(`${reader} on the ${where} keeps both classes on their own proofs`, () => {
        const cell = cellOf(where === 'lead' ? ['splash', reader] : ['splash'], where === 'lead' ? ['splash'] : [reader]);
        expect(`${reader} ${where} fired ${fired(cell).length > 0}`).toBe(`${reader} ${where} fired true`);
        const first = cell.children[0];
        const before = standing(positionBattle(first.position));
        expect(helpedSources(cell, 'p1').every(source => source < 0)).toBe(true);
        expect(standing(positionBattle(first.position))).toBe(before);
      });
    }
  }
});
