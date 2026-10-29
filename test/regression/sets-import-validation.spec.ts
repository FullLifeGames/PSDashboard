import { describe, expect, test } from 'vitest';
import { generationsFor, type OpponentTeamInfo, type RevealedPokemonInfo } from '@fulllifegames/replay-core';
import { loadImportPools, parseSetsImport, validateSetsImport } from '../../src/lib/sets-io';

// Round 77 (D5): the sets import names what the game cannot use and applies nothing until the text is fixed. The checks are the
// team editor's own (canonicalMove over the species' move pool, the ability, item, nature and Tera type pools of
// pokemon-options), so the sweep below holds the import to the same pools the editor offers.

const unknown = { value: '', source: 'unknown' as const };
const entry = (species: string, overrides: Partial<RevealedPokemonInfo> = {}): RevealedPokemonInfo => ({
  species, moves: [], ability: unknown, item: unknown, teraType: unknown,
  evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' }, level: 100, gender: 'M', ...overrides,
});
const team = (...pokemon: RevealedPokemonInfo[]): OpponentTeamInfo => ({ pokemon });
const textOf = (p1: string, p2 = '') => `=== p1: A ===\n\n${p1}\n\n=== p2: B ===\n\n${p2}\n`;

async function check(format: string, gen: number, p1: OpponentTeamInfo, p2: OpponentTeamInfo, text: string) {
  const pools = await loadImportPools([...p1.pokemon, ...p2.pokemon].map(pokemon => pokemon.species), gen, format);
  return validateSetsImport(parseSetsImport(text), { p1, p2 }, { gen, pools });
}

const CORVIKNIGHT = 'Corviknight @ Leftovers\nAbility: Pressure\nTera Type: Steel\nImpish Nature\n- Roost\n- Brave Bird';

describe.each([
  ['singles', 'gen9ou'],
  ['doubles', 'gen9doublesou'],
])('sets import validation (%s)', (_kind, format) => {
  test('an import of legal values passes', async () => {
    expect(await check(format, 9, team(entry('Corviknight')), team(), textOf(CORVIKNIGHT))).toEqual([]);
  });

  test('names a move, an ability, an item, a nature and a Tera type the game does not have', async () => {
    const text = textOf([
      'Corviknight @ Foo Orb', 'Ability: Foo Bar', 'Tera Type: Moonlight', 'Wobbly Nature', '- Moon Landing', '- Hydro Cannon', '- Roost',
    ].join('\n'));
    const errors = await check(format, 9, team(entry('Corviknight')), team(), text);
    const all = errors.join('\n');
    expect(all).toMatch(/Moon Landing/);
    expect(all).toMatch(/Hydro Cannon/);
    expect(all).toMatch(/Foo Bar/);
    expect(all).toMatch(/Foo Orb/);
    expect(all).toMatch(/Wobbly/);
    expect(all).toMatch(/Moonlight/);
    expect(all).not.toMatch(/Roost/);
    expect(errors.every(message => message.startsWith('P1 Corviknight'))).toBe(true);
  });

  test('names a set whose species is not on the side, on either side', async () => {
    const errors = await check(format, 9, team(entry('Corviknight')), team(entry('Kingambit')),
      textOf('Foo Mon @ Leftovers\n- Roost', 'Kingambit\n- Sucker Punch\n\nMissingno\n- Splash'));
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/P1 foomon/i);
    expect(errors[1]).toMatch(/P2 missingno/i);
  });

  test('a value the panel already holds passes unchanged (a swapped ability, a move the pool lacks)', async () => {
    const held = entry('Corviknight', {
      ability: { value: 'Mummy', source: 'revealed' }, moves: [{ name: 'Moon Landing', source: 'revealed' }],
      item: { value: 'Foo Orb', source: 'revealed' },
    });
    const text = textOf('Corviknight @ Foo Orb\nAbility: Mummy\n- Moon Landing\n- Roost');
    expect(await check(format, 9, team(held), team(), text)).toEqual([]);
  });

  test('a value the panel shows from its solved sets passes, though the knowledge does not hold it', async () => {
    // Round 77 (the suite of the acceptance): the export reads the stats view (the solved sets, round 70 T205), the check
    // read the knowledge. Champions VGC 2695803506: Basculegion's guessed Head Smash stands in the export, not in the
    // knowledge, and the editor's pool lacks it, so the panel's own export imported nothing. Moon Landing stands in here.
    const shown = entry('Corviknight', { moves: [{ name: 'Moon Landing', source: 'guessed' }], ability: { value: 'Mummy', source: 'guessed' } });
    const text = textOf('Corviknight\nAbility: Mummy\n- Moon Landing\n- Roost');
    const pools = await loadImportPools(['Corviknight'], 9, format);
    const parsed = parseSetsImport(text);
    expect(validateSetsImport(parsed, { p1: team(entry('Corviknight')), p2: team() }, { gen: 9, pools }, { p1: team(shown), p2: team() })).toEqual([]);
    // Without the shown sets the same text is refused, and a value neither view holds is refused with them.
    expect(validateSetsImport(parsed, { p1: team(entry('Corviknight')), p2: team() }, { gen: 9, pools }).join('\n')).toMatch(/Moon Landing/);
    const other = parseSetsImport(textOf('Corviknight\n- Hydro Cannon'));
    expect(validateSetsImport(other, { p1: team(entry('Corviknight')), p2: team() }, { gen: 9, pools }, { p1: team(shown), p2: team() }).join('\n'))
      .toMatch(/Hydro Cannon/);
  });

  test('before the pools load, the species check still runs and the pool checks wait', async () => {
    const parsed = parseSetsImport(textOf('Foo Mon\n- Roost\n\nCorviknight\nAbility: Foo Bar\n- Moon Landing'));
    const errors = validateSetsImport(parsed, { p1: team(entry('Corviknight')), p2: team() }, { gen: 9, pools: null });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/foomon/i);
  });
});

describe('sets import validation by generation', () => {
  test('a Tera type is refused where the generation has none, an ability where it has none', async () => {
    const tera = await check('gen8ou', 8, team(entry('Corviknight')), team(), textOf('Corviknight\nTera Type: Steel\n- Roost'));
    expect(tera.join('\n')).toMatch(/Tera/);
    const ability = await check('gen2ou', 2, team(entry('Snorlax')), team(), textOf('Snorlax\nAbility: Immunity\n- Rest'));
    expect(ability.join('\n')).toMatch(/Immunity/);
    expect(await check('gen2ou', 2, team(entry('Snorlax')), team(), textOf('Snorlax\n- Rest\n- Body Slam'))).toEqual([]);
  });
});

// The sweep: every ability and a sample of the learnset of species of every generation passes, a made-up one fails.
describe('sets import validation sweep over the generations', () => {
  const generations = [3, 4, 5, 6, 7, 8, 9] as const;
  test.each(generations)('generation %i: the species\' own abilities and moves pass, made-up ones fail', async gen => {
    const dex = generationsFor('').get(gen);
    const species = [...dex.species].slice(0, 12);
    const pools = await loadImportPools(species.map(entryOf => entryOf.name), gen, `gen${gen}ou`);
    for (const mon of species) {
      const abilities = Object.values(mon.abilities).filter((name): name is string => !!name);
      const moves = (pools.movesBySpecies[mon.name] ?? []).slice(0, 3);
      const lines = [mon.name, `Ability: ${abilities[0]}`, ...moves.map(move => `- ${move}`)];
      const valid = validateSetsImport(parseSetsImport(textOf(lines.join('\n'))), { p1: team(entry(mon.name)), p2: team() }, { gen, pools });
      expect(valid, mon.name).toEqual([]);
      const broken = validateSetsImport(parseSetsImport(textOf(`${mon.name}\nAbility: Foo Bar\n- Moon Landing`)), { p1: team(entry(mon.name)), p2: team() }, { gen, pools });
      expect(broken.join('\n'), mon.name).toMatch(/Foo Bar/);
      expect(broken.join('\n'), mon.name).toMatch(/Moon Landing/);
    }
  });
});
