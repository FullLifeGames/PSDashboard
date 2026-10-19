import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { PRNG, type Battle, type Pokemon } from '@pkmn/sim';
import { bodyAsClicked } from '../src/calc/tera-click';
import { loadSimMods } from '../src/forward/sim-mods';
import { targetAtUse } from '../src/pair/odds';
import { AskLeak, fingerprint, playOnCopy, setAskCheck } from '../src/sim-ask';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 72 (T239): targetAtUse asks the move's onModifyMove from the Dex through the module's handler call. A sweep over
 * every move of the Dex that has one, in every generation and the Champions mod, in singles and doubles, on three
 * fields, with and without the Tera click: the answer is the one the hand-written stand-in it replaced gave (played on a
 * copy), it is the real copy's answer or the Dex target (never a third value), and the live battle is unchanged (the
 * development check of the module fingerprints it around every call). Gens 3 and 4 Beat Up added its volatile to the
 * live attacker through the old stand-in; the view keeps it off.
 */

await loadSimMods('gen9championsou');

beforeAll(() => setAskCheck(true));
afterAll(() => setAskCheck(null));

const RULE_SETS = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(gen => ({ name: `gen ${gen} singles`, format: `gen${gen}customgame`, doubles: false })),
  { name: 'Champions singles', format: 'gen9championsou', doubles: false },
  ...[3, 4, 5, 6, 7, 8, 9].map(gen => ({ name: `gen ${gen} doubles`, format: `gen${gen}doublescustomgame`, doubles: true })),
  { name: 'Champions doubles', format: 'gen9championsdoublescustomgame', doubles: true },
];

/**
 * The stand-ins targetAtUse had before the module (the handler on `{ field, debug }`, the attacker as a prototype view),
 * played on a copy of the board, since they wrote the live attacker in Gens 3 and 4.
 */
function byHand(live: Battle, moveId: string, tera: boolean): string {
  return playOnCopy(live, new PRNG('1,2,3,4'), battle => {
    const attacker = battle.sides[0].active[0] as Pokemon;
    const dexMove = battle.dex.moves.get(moveId);
    const handler = (dexMove as unknown as { onModifyMove: (this: unknown, ...args: unknown[]) => void }).onModifyMove;
    const body = bodyAsClicked(battle, attacker, tera);
    const user = Object.create(attacker, { species: { value: battle.dex.species.get(body.species) } });
    const field = body.abilityOn ? Object.create(battle.field, { weather: { value: '' }, terrain: { value: '' } }) : battle.field;
    const move = battle.dex.getActiveMove(moveId);
    try {
      handler.call({ field, debug: () => undefined }, move, user, null);
    } catch {
      return dexMove.target;
    }
    return move.target;
  });
}

const FIELDS: [string, (battle: Battle) => void][] = [
  ['no field', () => undefined],
  ['psychic terrain', battle => { battle.field.setTerrain('psychicterrain', battle.sides[0].active[0] as Pokemon, battle.dex.moves.get('splash')); }],
  ['rain', battle => { battle.field.setWeather('raindance', battle.sides[0].active[0] as Pokemon, battle.dex.moves.get('splash')); }],
];

describe('targetAtUse over every move with an onModifyMove', () => {
  test.each(RULE_SETS)('$name', ({ format, doubles }) => {
    let calls = 0;
    let fallbacks = 0;
    for (const species of ['Snorlax', 'Terapagos']) {
      const team = (name: string) => Array.from({ length: doubles ? 2 : 1 }, () => set(name, ['tackle', 'splash'], { teraType: 'Stellar' }));
      const probe = battleOf(format, team('Snorlax'), team('Pikachu'));
      if (!probe.dex.species.get(species).exists || probe.dex.species.get(species).gen > probe.dex.gen) continue;
      const moves = (probe.dex.moves.all() as unknown as { id: string; exists: boolean; gen: number; onModifyMove?: unknown }[])
        .filter(move => move.exists && move.gen <= probe.dex.gen && typeof move.onModifyMove === 'function');
      for (const [fieldName, makeField] of FIELDS) {
        for (const tera of [false, true]) {
          const battle = battleOf(format, team(species), team('Pikachu'));
          makeField(battle);
          const attacker = battle.sides[0].active[0] as Pokemon;
          const before = fingerprint(battle, moves.map(move => battle.dex.moves.get(move.id)));
          for (const { id } of moves) {
            const label = `${species} ${fieldName} tera ${tera} ${id}`;
            const answer = (() => {
              try {
                return targetAtUse(battle, attacker, { kind: 'move', moveId: id, tera, slot: 0, loc: null } as never);
              } catch (error) {
                throw new Error(`${label}: ${String(error)}`, { cause: error });
              }
            })();
            expect(answer, label).toBe(byHand(battle, id, tera));
            const real = battle.dex.getActiveMove(id);
            // The real handler, with the real battle behind it, on a copy: what the stand-in is trying to say.
            const onCopy = playOnCopy(battle, new PRNG('1,2,3,4'), (copy): string | null => {
              try {
                const move = copy.dex.getActiveMove(id);
                (copy.dex.moves.get(id) as unknown as { onModifyMove: (this: Battle, ...a: unknown[]) => void }).onModifyMove.call(copy, move, copy.sides[0].active[0], null);
                return move.target;
              } catch {
                return null;
              }
            });
            if (answer !== real.target) {
              fallbacks++;
              expect([onCopy, real.target].includes(answer) || onCopy === null, label).toBe(true);
            }
            calls++;
          }
          expect(fingerprint(battle, moves.map(move => battle.dex.moves.get(move.id))), `${species} ${fieldName} tera ${tera}`).toBe(before);
        }
      }
    }
    expect(calls).toBeGreaterThan(0);
    process.stdout.write(`target-at-use ${format}: ${calls} calls, ${fallbacks} answers that differ from the Dex target\n`);
  }, 120_000);
});

describe('targetAtUse writes nothing to the live attacker', () => {
  // The two generations whose Beat Up handler adds a volatile to its user in ModifyMove: the question must not leave it.
  test.each([3, 4])('gen %i singles and doubles: Beat Up leaves the volatile off the live body', gen => {
    for (const doubles of [false, true]) {
      const team = (name: string) => Array.from({ length: doubles ? 2 : 1 }, () => set(name, ['tackle', 'splash']));
      const battle = battleOf(doubles ? `gen${gen}doublescustomgame` : `gen${gen}customgame`, team('Snorlax'), team('Pikachu'));
      const attacker = battle.sides[0].active[0] as Pokemon;
      const dex = battle.dex.moves.get('beatup');
      expect(typeof (dex as unknown as { onModifyMove?: unknown }).onModifyMove).toBe('function');
      const before = fingerprint(battle, [dex]);
      const answer = targetAtUse(battle, attacker, { kind: 'move', moveId: 'beatup', tera: false, slot: 0, loc: null } as never);
      expect(answer).toBe(dex.target);
      expect(Object.keys(attacker.volatiles)).toEqual([]);
      expect(fingerprint(battle, [dex])).toBe(before);
    }
  });
});

describe('targetAtUse asks the handler once per body, move and click', () => {
  // An option list of a doubles position asks the same slot move once per option; the reader battle never changes.
  test.each([['gen 9 doubles', 'gen9doublescustomgame'], ['Champions doubles', 'gen9championsdoublescustomgame']])('%s: a repeated question is answered from the first', (_name, format) => {
    const team = (name: string) => [set(name, ['tackle', 'splash']), set(name, ['tackle', 'splash'])];
    const battle = battleOf(format, team('Snorlax'), team('Pikachu'));
    const attacker = battle.sides[0].active[0] as Pokemon;
    const action = { kind: 'move', moveId: 'expandingforce', tera: false, slot: 0, loc: null } as never;
    // The development check asks a hit again; the question is how the code runs without it.
    setAskCheck(false);
    const asked = vi.spyOn(battle.dex, 'getActiveMove');
    const questions = () => asked.mock.calls.filter(([id]) => id === 'expandingforce').length;
    const first = targetAtUse(battle, attacker, action);
    expect(questions()).toBe(1);
    for (let again = 0; again < 3; again++) expect(targetAtUse(battle, attacker, action)).toBe(first);
    expect(questions()).toBe(1);
    // The Tera click is its own question, and so is another move; a move without a handler never reaches the stand-in.
    targetAtUse(battle, attacker, { ...(action as object), tera: true } as never);
    expect(questions()).toBe(2);
    expect(targetAtUse(battle, attacker, { ...(action as object), moveId: 'tackle' } as never)).toBe('normal');
    expect(questions()).toBe(2);
    asked.mockRestore();
    setAskCheck(true);
  });

  test('with the development check on, a battle mutated after its first question fails loudly', () => {
    const team = (name: string) => [set(name, ['tackle', 'splash']), set(name, ['tackle', 'splash'])];
    const battle = battleOf('gen9doublescustomgame', team('Snorlax'), team('Pikachu'));
    const attacker = battle.sides[0].active[0] as Pokemon;
    const action = { kind: 'move', moveId: 'expandingforce', tera: false, slot: 0, loc: null } as never;
    expect(targetAtUse(battle, attacker, action)).toBe('normal');
    battle.field.setTerrain('psychicterrain', attacker, battle.dex.moves.get('splash'));
    expect(() => targetAtUse(battle, attacker, action)).toThrow(AskLeak);
  });
});
