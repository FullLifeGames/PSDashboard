import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import type { Battle, Pokemon } from '@pkmn/sim';
import { resolveSideChoices } from '../src/branch/execute';
import type { BranchSlotChoice } from '../src/branch-choices';
import type { SimBattle } from '../src/branch/types';
import { toId } from '@fulllifegames/replay-core';
import { battleOf } from './power-oracle';
import { RULESETS, become, forcedBoard, fingerprint, mon } from './forme-boards';

/**
 * Round 88 (#103): a body keeps its identity across an in-battle forme change. The switch resolver once cut a suffix list ('tera',
 * 'stellar', 'terastal') off the bench body's id and compared the rest with the choice's id raw: an Ogerpon that had terastallized
 * (Ogerpon-Teal-Tera on the bench) could not be switched back in by the chip the app builds from the body it holds (`ogerpontealtera`),
 * and neither could a Terapagos that had stood on the field (Terapagos-Terastal, Terapagos-Stellar). The rule now comes from the
 * battle's Dex: two species are one body when their `battleOnly` families meet.
 *
 * Held here against the simulator, in every generation and mod the corpus plays (gen 3 to 9 and the Champions mod), singles and doubles,
 * for every species the Dex gives a `battleOnly` origin: the benched body takes the forme with the simulator's own `formeChange`, and the
 * resolver reads three choices (the chip of the body now, a choice recorded on the origin before the change, a choice recorded on the
 * forme once the body is back on the origin), with and without a nickname. Each resolves to the body's own bench position and leaves
 * the battle as it found it. The scene of #103 and the Terapagos scene are rows of their own, played through real choices.
 */

/** The slot's chip as the app builds it (state.ts, SwitchRow.tsx): the species the body holds now, its name. */
const chipOf = (body: Pokemon): Extract<BranchSlotChoice, { kind: 'switch' }> =>
  ({ kind: 'switch', speciesId: toId(body.species.name), pokemonName: body.name });

/** The forced slots of the side: the actives that fainted. */
const forcedSlots = (battle: Battle): boolean[] => battle.sides[0].active.map(body => !!body && body.fainted);

/** Resolves `choice` on every forced slot and returns the command, or the error. The battle is proven unchanged. */
function resolve(battle: Battle, choice: BranchSlotChoice): string {
  const required = forcedSlots(battle);
  const before = fingerprint(battle);
  const resolved = resolveSideChoices(battle as SimBattle, 'p1', required.map(on => (on ? choice : null)), required);
  expect(fingerprint(battle), 'the resolver reads the battle and changes nothing').toBe(before);
  // Doubles: the command passes the slots that need nothing ("pass, switch 3").
  return resolved.ok ? resolved.command.replace(/^(pass, )+/, '') : resolved.error;
}

const NICKNAME = 'Nick';

describe.each(RULESETS.flatMap(rules => (['singles', 'doubles'] as const).map(type => ({ rules, type }))))(
  '$rules.label $type: the switch resolver reads a body by its Dex family (#103)',
  ({ rules, type }) => {
    /** A board of its own per test: a forme change runs the simulator's events, and a row never inherits another's abilities. */
    const fresh = () => {
      const battle = forcedBoard(rules, type);
      return {
        battle,
        target: battle.sides[0].pokemon.find(body => body.set.species === 'Eevee')!,
        decoy: battle.sides[0].pokemon.find(body => body.set.species === 'Meowth')!,
        position: (body: Pokemon) => `switch ${battle.sides[0].pokemon.indexOf(body) + 1}`,
      };
    };
    const dex = forcedBoard(rules, type).dex;
    const formes = dex.species.all().filter(species => species.exists && species.isNonstandard !== 'Custom' && species.isNonstandard !== 'CAP' && species.battleOnly);

    test('the census reads every battleOnly forme the Dex has', () => {
      expect(formes.length).toBeGreaterThan(100);
    });

    test.each(['plain', 'nicknamed'])('every forme with its origin, %s: the chip, the choice before the change, the choice after the body is back', kind => {
      const { battle, target, position } = fresh();
      const failures: string[] = [];
      for (const forme of formes) {
        for (const originName of [forme.battleOnly].flat() as string[]) {
          const origin = dex.species.get(originName);
          const name = kind === 'plain' ? origin.baseSpecies || origin.name : NICKNAME;
          const scenes: [string, string, string][] = [
            // [scene, species the body holds, id the choice names]
            ['the chip of the body now', forme.name, toId(forme.name)],
            ['a choice recorded on the origin', forme.name, toId(origin.name)],
            ['a choice recorded on the forme', origin.name, toId(forme.name)],
          ];
          for (const [scene, held, choiceId] of scenes) {
            become(target, held, name);
            const answer = resolve(battle, { kind: 'switch', speciesId: choiceId, pokemonName: name });
            if (answer !== position(target)) failures.push(`${scene}: ${held} named ${name}, choice ${choiceId}: ${answer}`);
          }
        }
      }
      expect(failures).toEqual([]);
    });

    test('a body of another family under the same base is never picked for the other\'s chip', () => {
      const { battle, target, decoy, position } = fresh();
      const wellspring = dex.species.get('Ogerpon-Wellspring-Tera');
      const teal = dex.species.get('Ogerpon-Teal-Tera');
      expect(wellspring.exists && teal.exists).toBe(true);
      become(target, teal.name, 'Mask');
      become(decoy, wellspring.name, 'Mask2');
      expect(resolve(battle, { kind: 'switch', speciesId: toId(teal.name), pokemonName: 'Mask' })).toBe(position(target));
      expect(resolve(battle, { kind: 'switch', speciesId: toId(wellspring.name), pokemonName: 'Mask2' })).toBe(position(decoy));
      // The Wellspring-Tera chip with only the Teal-Tera body left: no switch, the error names the missing body.
      decoy.fainted = true;
      expect(resolve(battle, { kind: 'switch', speciesId: toId(wellspring.name), pokemonName: 'Mask2' })).toMatch(/no longer available/);
    });
  },
);

describe.each(RULESETS.flatMap(rules => (['singles', 'doubles'] as const).map(type => ({ rules, type }))).filter(({ rules }) => rules.label === 'gen 9'))(
  'in-battle formes through real choices, $rules.label $type',
  ({ rules, type }) => {
    const doubles = type === 'doubles';
    /** The star enters on the fodder's slot, changes forme as the Dex says (Tera, Tera Shift), leaves, and its partner faints: the forced replacement. */
    function played(star: PokemonSet, tera: boolean) {
      const fodder = mon(rules, 'Magikarp', ['splash'], { level: 1 });
      const p1 = doubles ? [mon(rules, 'Pikachu', ['splash']), fodder, star, mon(rules, 'Eevee', ['splash'])] : [fodder, star, mon(rules, 'Eevee', ['splash'])];
      const p2 = doubles ? [mon(rules, 'Mewtwo', ['psychic', 'splash']), mon(rules, 'Mew', ['splash'])] : [mon(rules, 'Mewtwo', ['psychic', 'splash'])];
      const battle = battleOf(doubles ? rules.doubles : rules.singles, p1, p2);
      const idle = doubles ? 'move 2, move 1' : 'move 2';
      const splash = doubles ? 'move 1, move 1' : 'move 1';
      const starBody = () => battle.sides[0].pokemon.find(body => body.set.species === star.species)!;
      const turn = (p1Choice: string, p2Choice = idle) => {
        expect(battle.choose('p1', p1Choice), `p1 ${p1Choice}: ${battle.sides[0].choice.error}`).toBe(true);
        expect(battle.choose('p2', p2Choice), `p2 ${p2Choice}`).toBe(true);
      };
      turn(doubles ? 'move 1, switch 3' : 'switch 2');
      if (tera) turn(doubles ? 'move 1, move 1 terastallize' : 'move 1 terastallize');
      const fodderSlot = battle.sides[0].pokemon.findIndex(body => body.set.species === 'Magikarp') + 1;
      turn(doubles ? `move 1, switch ${fodderSlot}` : `switch ${fodderSlot}`);
      turn(splash, doubles ? 'move 1 2, move 1' : 'move 1');
      expect(battle.sides[0].requestState).toBe('switch');
      expect(starBody().isActive, 'the star is on the bench').toBe(false);
      return { battle, body: starBody() };
    }
    const where = (battle: Battle, body: Pokemon) => `switch ${battle.sides[0].pokemon.indexOf(body) + 1}`;

    test('#103 Ogerpon-Teal-Tera after Tera: the chip, and the choice recorded before Tera', () => {
      const { battle, body } = played(mon(rules, 'Ogerpon', ['splash'], { name: 'Mask', ability: 'Defiant', teraType: 'Grass' }), true);
      expect(body.species.name).toBe('Ogerpon-Teal-Tera');
      expect(resolve(battle, chipOf(body))).toBe(where(battle, body));
      expect(resolve(battle, { kind: 'switch', speciesId: 'ogerpon', pokemonName: 'Mask' })).toBe(where(battle, body));
    });

    test('Terapagos-Stellar after Tera Shift and Tera: the chip, and the choice recorded before the shift', () => {
      const { battle, body } = played(mon(rules, 'Terapagos', ['splash'], { ability: 'Tera Shift', teraType: 'Stellar' }), true);
      expect(body.species.name).toBe('Terapagos-Stellar');
      expect(resolve(battle, chipOf(body))).toBe(where(battle, body));
      expect(resolve(battle, { kind: 'switch', speciesId: 'terapagos', pokemonName: body.name })).toBe(where(battle, body));
      expect(resolve(battle, { kind: 'switch', speciesId: 'terapagosterastal', pokemonName: body.name })).toBe(where(battle, body));
    });

    test('Terapagos-Terastal after Tera Shift alone', () => {
      const { battle, body } = played(mon(rules, 'Terapagos', ['splash'], { ability: 'Tera Shift', teraType: 'Stellar' }), false);
      expect(body.species.name).toBe('Terapagos-Terastal');
      expect(resolve(battle, chipOf(body))).toBe(where(battle, body));
    });

    test('Shaymin-Sky frozen back to Shaymin: the choice recorded on the Sky forme finds the body by its name', () => {
      const { battle, body } = played(mon(rules, 'Shaymin', ['splash'], { name: 'Gratitude' }), false);
      body.formeChange('Shaymin-Sky', null, true);
      const chip = chipOf(body);
      body.formeChange('Shaymin', null, true);
      expect(chip.speciesId).toBe('shayminsky');
      expect(resolve(battle, chip)).toBe(where(battle, body));
    });
  },
);

describe('a battleOnly census row per generation: every origin names a species of the same Dex', () => {
  test.each(RULESETS)('$label', rules => {
    const dex = Dex.forGen(Number(rules.singles.match(/^gen(\d)/)![1]));
    const lost: string[] = [];
    for (const forme of dex.species.all()) {
      if (!forme.exists || !forme.battleOnly) continue;
      for (const origin of [forme.battleOnly].flat() as string[]) if (!dex.species.get(origin).exists) lost.push(`${forme.name} <- ${origin}`);
    }
    expect(lost).toEqual([]);
  });
});
