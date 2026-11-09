import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Pokemon } from '@pkmn/sim';
import type { PokemonSnapshot } from '@fulllifegames/replay-core';
import { sameMon } from '../src/branch/corrections';
import { sameSpecies } from '../src/branch/entry-effects';
import { activeMatchesLog, parseLoggedActive } from '../src/branch/log-sync';
import { findPokemonOnSide, findSlotBySpecies } from '../src/branch/protocol-choices';
import { toId } from '@fulllifegames/replay-core';
import { RULESETS, become, forcedBoard, mon, type GameType, type Ruleset } from './forme-boards';

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
const OGERPON_APART: [string, string][] = [
  ['Ogerpon-Teal-Tera', 'Ogerpon-Wellspring-Tera'], ['Ogerpon-Wellspring-Tera', 'Ogerpon-Teal-Tera'], ['Ogerpon-Teal-Tera', 'Ogerpon-Wellspring'],
  ['Terapagos-Stellar', 'Ogerpon'],
];
const NEGATIVES: [string, string][] = [...OGERPON_APART, ['Rotom-Wash', 'Rotom'], ['Rotom', 'Rotom-Wash']];

/** The failures of `holds` over every forme of the Dex and every origin (as a list of readable rows), and over the negative rows. */
function sweep(
  rules: Ruleset, type: GameType, holds: (body: Pokemon, species: string) => boolean, { decoyFirst = false, negatives = NEGATIVES } = {},
): { failures: string[]; formes: number } {
  const battle = forcedBoard(rules, type, decoyFirst ? [mon(rules, 'Meowth', ['splash']), mon(rules, 'Eevee', ['splash'])] : []);
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
  for (const [held, named] of negatives) {
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

  test('protocol choices: the bench body of a species the protocol names (findPokemonOnSide)', () => {
    const { failures, formes } = sweep(rules, type, (body, species) => findPokemonOnSide(body.side, species) === body);
    expect(formes).toBeGreaterThan(100);
    expect(failures).toEqual([]);
  });

  test('protocol choices: the bench slot of a species the protocol names (findSlotBySpecies), a decoy ahead of the body', () => {
    // The decoy (a Meowth) sits before the target on the bench, so the fallback (the first living slot) is never the right one.
    const { failures, formes } = sweep(rules, type, (body, species) =>
      findSlotBySpecies(body.battle, body.side.n, species) === body.side.pokemon.indexOf(body) + 1, { decoyFirst: true, negatives: OGERPON_APART });
    expect(formes).toBeGreaterThan(100);
    expect(failures).toEqual([]);
  });

  test('protocol choices: a base species the protocol names reaches its own body before a longer name that starts with it', () => {
    const battle = forcedBoard(rules, type, [mon(rules, 'Rotom-Wash', ['splash'], { name: 'Wash' }), mon(rules, 'Rotom', ['splash'], { name: 'Heat' })]);
    const bench = battle.sides[0].pokemon;
    const rotom = bench.find(body => body.species.name === 'Rotom')!;
    const wash = bench.find(body => body.species.name === 'Rotom-Wash')!;
    expect(bench.indexOf(wash)).toBeLessThan(bench.indexOf(rotom));
    expect(findSlotBySpecies(battle, 0, 'Rotom')).toBe(bench.indexOf(rotom) + 1);
    expect(findSlotBySpecies(battle, 0, 'Rotom-Wash')).toBe(bench.indexOf(wash) + 1);
    expect(toId(findPokemonOnSide(battle.sides[0], 'Rotom')!.species.name)).toBe('rotom');
  });

  test('protocol choices: the bench slot follows the name the log shows for the origin (#118, the prefix pass is gone)', () => {
    // The simulator's own log (`getUpdatedDetails`) shows Greninja-Bond as "Greninja". Every forme whose origin the log shows under another
    // name ties to the body that name stands for; a forme whose origin the log shows by its own name never ties to the base species.
    const battle = forcedBoard(rules, type, [mon(rules, 'Meowth', ['splash']), mon(rules, 'Eevee', ['splash'])]);
    const target = battle.sides[0].pokemon.find(body => body.set.species === 'Eevee')!;
    const slotOf = (held: string, named: string): number => {
      become(target, held, NICKNAME);
      return findSlotBySpecies(battle, 0, named);
    };
    const place = battle.sides[0].pokemon.indexOf(target) + 1;
    const dex = battle.dex;
    const failures: string[] = [];
    const tied: string[] = [];
    let apart = 0;
    for (const forme of dex.species.all()) {
      if (!forme.exists || forme.isNonstandard === 'Custom' || forme.isNonstandard === 'CAP' || !forme.battleOnly) continue;
      const origins = [forme.battleOnly].flat() as string[];
      for (const originName of origins) {
        const origin = dex.species.get(originName);
        if (origin.name === origin.baseSpecies) continue;
        become(target, origin.name, NICKNAME);
        const shown = target.getUpdatedDetails().split(',')[0];
        if (shown !== origin.name) {
          tied.push(`${shown} / ${forme.name}`);
          if (slotOf(shown, forme.name) !== place) failures.push(`tied: ${shown} held, ${forme.name} named`);
          if (slotOf(forme.name, shown) !== place) failures.push(`tied: ${forme.name} held, ${shown} named`);
        } else if (!origins.includes(origin.baseSpecies)) {
          apart++;
          if (slotOf(origin.baseSpecies, forme.name) === place) failures.push(`apart: ${origin.baseSpecies} held, ${forme.name} named`);
        }
      }
    }
    expect(apart).toBeGreaterThan(5);
    // The real scene: smogtours-gen7ubers-317232 turn 28, the log asks Greninja-Ash and the slot holds Greninja. It is the one pair.
    expect(tied).toEqual(['Greninja / Greninja-Ash']);
    expect(failures).toEqual([]);
  });

  test('protocol choices: names that merely share a prefix stay apart (#118)', () => {
    const PAIRS: [string, string][] = [
      ['Mewtwo', 'Mew'], ['Mew', 'Mewtwo'], ['Porygon2', 'Porygon'], ['Porygon', 'Porygon2'], ['Porygon-Z', 'Porygon'], ['Porygon', 'Porygon-Z'], ['Porygon2', 'Porygon-Z'],
      ['Pawmot', 'Pawmo'], ['Pawmo', 'Pawmot'], ['Urshifu-Rapid-Strike', 'Urshifu'], ['Urshifu', 'Urshifu-Rapid-Strike'],
      ['Rotom-Wash', 'Rotom'], ['Rotom', 'Rotom-Wash'],
    ];
    const battle = forcedBoard(rules, type, [mon(rules, 'Meowth', ['splash']), mon(rules, 'Eevee', ['splash'])]);
    const target = battle.sides[0].pokemon.find(body => body.set.species === 'Eevee')!;
    const place = battle.sides[0].pokemon.indexOf(target) + 1;
    const failures: string[] = [];
    let played = 0;
    for (const [held, named] of PAIRS) {
      if (!battle.dex.species.get(held).exists || !battle.dex.species.get(named).exists) continue;
      played++;
      become(target, held, NICKNAME);
      if (findSlotBySpecies(battle, 0, named) === place) failures.push(`${held} held, ${named} named`);
    }
    expect(played).toBeGreaterThan(2);
    expect(failures).toEqual([]);
  });

  test('log sync: the body the log last switched into the slot (activeMatchesLog)', () => {
    const { failures, formes } = sweep(rules, type, (body, species) =>
      activeMatchesLog(body, parseLoggedActive(`|switch|p1a: Other|${species}, L50|100/100`) ?? undefined));
    expect(formes).toBeGreaterThan(100);
    expect(failures).toEqual([]);
  });
});

describe('no site reads a species suffix list (#103)', () => {
  // The suffix list of team-order.ts ('terastal', 'stellar', 'tera') is gone: the six sites ask `branch/body-forme.ts`, which reads the Dex.
  test('no source file of the packages or the app names the list, its helper or a Tera suffix test', () => {
    const roots = ['packages/eval-engine/src', 'packages/replay-core/src', 'src'];
    const files = roots.flatMap(root => readdirSync(root, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && /\.tsx?$/.test(entry.name))
      .map(entry => join(entry.parentPath, entry.name)));
    expect(files.length).toBeGreaterThan(200);
    const pattern = /normalizeBattleOnlyFormeId|BATTLE_ONLY_FORME_SUFFIXES|endsWith\((['"])(tera|stellar|terastal)\1\)/;
    expect(files.filter(file => pattern.test(readFileSync(file, 'utf8')))).toEqual([]);
  });
});
