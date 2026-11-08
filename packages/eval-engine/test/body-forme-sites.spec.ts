import { describe, expect, test } from 'vitest';
import type { Pokemon } from '@pkmn/sim';
import type { PokemonSnapshot } from '@fulllifegames/replay-core';
import { sameMon } from '../src/branch/corrections';
import { sameSpecies } from '../src/branch/entry-effects';
import { RULESETS, become, forcedBoard, type GameType, type Ruleset } from './forme-boards';

/**
 * Round 88 (#103): the other sites that tell whether two names are one body in another forme. Each used to cut the suffix list ('tera',
 * 'stellar', 'terastal') off the ids it compared; each now asks the battle's Dex (`sameBodyForme`, `branch/body-forme.ts`). Held here the way
 * `switch-forme-sweep.spec.ts` holds the resolver: in every generation and mod the corpus plays, singles and doubles (the predicates read a
 * species and a name and do not depend on the game type, the boards are built for both anyway), for every species with a `battleOnly`
 * origin: the body on the bench holds the forme and the other side names the origin, the other way round, and the forme itself. The body's
 * name is a nickname and the other side's name another, so only the species can tie them. Negative rows: two bodies of one base that the
 * Dex keeps apart (Ogerpon-Teal-Tera and Ogerpon-Wellspring-Tera, Rotom-Wash and Rotom) never match.
 */

const NICKNAME = 'Nick';
const NEGATIVES: [string, string][] = [
  ['Ogerpon-Teal-Tera', 'Ogerpon-Wellspring-Tera'], ['Ogerpon-Wellspring-Tera', 'Ogerpon-Teal-Tera'], ['Ogerpon-Teal-Tera', 'Ogerpon-Wellspring'],
  ['Rotom-Wash', 'Rotom'], ['Rotom', 'Rotom-Wash'], ['Terapagos-Stellar', 'Ogerpon'],
];

/** The failures of `holds` over every forme of the Dex and every origin (as a list of readable rows), and over the negative rows. */
function sweep(rules: Ruleset, type: GameType, holds: (body: Pokemon, species: string) => boolean): { failures: string[]; formes: number } {
  const battle = forcedBoard(rules, type);
  const target = battle.sides[0].pokemon.find(body => body.set.species === 'Eevee')!;
  const dex = battle.dex;
  const failures: string[] = [];
  let formes = 0;
  for (const forme of dex.species.all()) {
    if (!forme.exists || forme.isNonstandard === 'Custom' || forme.isNonstandard === 'CAP' || !forme.battleOnly) continue;
    formes++;
    for (const originName of [forme.battleOnly].flat() as string[]) {
      const origin = dex.species.get(originName);
      const rows: [string, string, string][] = [
        ['forme named by its origin', forme.name, origin.name],
        ['origin named by its forme', origin.name, forme.name],
        ['forme named by itself', forme.name, forme.name],
      ];
      for (const [scene, held, named] of rows) {
        become(target, held, NICKNAME);
        if (!holds(target, named)) failures.push(`${scene}: ${held} against ${named}`);
      }
    }
  }
  for (const [held, named] of NEGATIVES) {
    become(target, held, NICKNAME);
    if (holds(target, named)) failures.push(`apart: ${held} against ${named}`);
  }
  return { failures, formes };
}

const BOARDS = RULESETS.flatMap(rules => (['singles', 'doubles'] as const).map(type => ({ rules, type })));

describe.each(BOARDS)('$rules.label $type: sites read a body by its Dex family (#103)', ({ rules, type }) => {
  test('corrections: the active body of the snapshot (sameMon)', () => {
    const { failures, formes } = sweep(rules, type, (body, species) => sameMon(body, { speciesForme: species, name: 'Other' } as PokemonSnapshot));
    expect(formes).toBeGreaterThan(100);
    expect(failures).toEqual([]);
  });

  test('entry effects: the body the protocol switched in (sameSpecies)', () => {
    const { failures, formes } = sweep(rules, type, sameSpecies);
    expect(formes).toBeGreaterThan(100);
    expect(failures).toEqual([]);
  });
});
