import { test, expect, describe } from 'vitest';
import { buildSetsExport, parseSetsImport, loadImportPools, validateSetsImport } from '../../src/lib/sets-io';
import {
  enrichTeamInfo,
  type OpponentTeamInfo,
  type SmogonSetAssumptions,
  generationsFor,
  type RevealedPokemonInfo,
} from '@fulllifegames/replay-core';

const p1Info: OpponentTeamInfo = {
  pokemon: [{
    species: 'Garchomp',
    moves: [
      { name: 'Earthquake', source: 'revealed' },
      { name: 'Scale Shot', source: 'guessed', probability: 0.6 },
    ],
    ability: { value: 'Rough Skin', source: 'revealed' },
    item: { value: 'Loaded Dice', source: 'guessed' },
    teraType: { value: 'Steel', source: 'guessed' },
    evs: { value: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 }, source: 'guessed' },
    nature: { value: 'Jolly', source: 'guessed' },
    level: 100,
    gender: 'M',
  }],
};
const p2Info: OpponentTeamInfo = {
  pokemon: [{
    species: 'Kingambit',
    moves: [{ name: 'Sucker Punch', source: 'revealed' }],
    ability: { value: '', source: 'unknown' },
    item: { value: '(has item)', source: 'revealed' },
    teraType: { value: '', source: 'unknown' },
    evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' },
    level: 78,
    gender: 'F',
  }],
};

describe('sets import/export', () => {
  test('exports both sides as side-headered Showdown blocks', () => {
    const text = buildSetsExport({ p1Name: 'Alice', p2Name: 'Bob', p1Info, p2Info });

    expect(text).toContain('=== p1: Alice ===');
    expect(text).toContain('=== p2: Bob ===');
    expect(text).toContain('Garchomp (M) @ Loaded Dice');
    expect(text).toContain('Ability: Rough Skin');
    expect(text).toContain('Tera Type: Steel');
    expect(text).toContain('EVs: 252 Atk / 4 SpD / 252 Spe');
    expect(text).toContain('Jolly Nature');
    expect(text).toContain('- Earthquake');
    // Unknown fields stay out of the export entirely:
    expect(text).toContain('Kingambit (F)');
    expect(text).not.toContain('(has item)');
    expect(text).toContain('Level: 78');
    expect(text).not.toContain('Level: 100');
  });

  test('round-trips: parse(export) recovers the sets per side', () => {
    const text = buildSetsExport({ p1Name: 'Alice', p2Name: 'Bob', p1Info, p2Info });
    const parsed = parseSetsImport(text);

    expect(parsed.p1).toHaveLength(1);
    expect(parsed.p1[0]).toMatchObject({
      species: 'Garchomp',
      item: 'Loaded Dice',
      ability: 'Rough Skin',
      teraType: 'Steel',
      nature: 'Jolly',
      moves: ['Earthquake', 'Scale Shot'],
    });
    expect(parsed.p2[0]).toMatchObject({ species: 'Kingambit', level: 78 });
  });

  test('strips the "(consumed)" annotation from exported items', () => {
    const consumedInfo: OpponentTeamInfo = {
      pokemon: [{
        species: 'Sneasler',
        moves: [{ name: 'Close Combat', source: 'revealed' }],
        ability: { value: 'Unburden', source: 'revealed' },
        item: { value: 'Heavy-Duty Boots (consumed)', source: 'revealed' },
        teraType: { value: '', source: 'unknown' },
        evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' },
        level: 100,
        gender: 'M',
      }],
    };
    const text = buildSetsExport({ p1Name: 'A', p2Name: 'B', p1Info: consumedInfo, p2Info: null });

    expect(text).toContain('Sneasler (M) @ Heavy-Duty Boots');
    expect(text).not.toContain('(consumed)');

    const parsed = parseSetsImport(text);
    expect(parsed.p1[0].item).toBe('Heavy-Duty Boots');
  });
  // Round 69 (T136): the export carries the IVs the build plays (2663093831 Sinistcha: published IV 0 in Attack and Speed).
  for (const format of ['gen9ou', 'gen9doublesou']) {
    test(`exports the IVs of a published Trick Room set and round-trips them (${format})`, () => {
      const assumptions: SmogonSetAssumptions = {
        format, source: 'test',
        pokemon: { sinistcha: {
          species: 'Sinistcha', sourceDetail: 'Smogon sets',
          ability: { value: 'Hospitality', sourceDetail: 'Smogon sets' }, item: { value: 'Sitrus Berry', sourceDetail: 'Smogon sets' },
          moves: ['Rage Powder', 'Trick Room', 'Matcha Gotcha', 'Protect'].map(value => ({ value, sourceDetail: 'Smogon sets' })),
          spread: { value: 'Bold', sourceDetail: 'Smogon sets', nature: 'Quiet', evs: { hp: 252, atk: 0, def: 4, spa: 252, spd: 0, spe: 0 } },
          ivs: { atk: 0, spe: 0 },
        } },
      };
      const raw: OpponentTeamInfo = { pokemon: [{
        species: 'Sinistcha', moves: [], ability: { value: '', source: 'unknown' }, item: { value: '', source: 'unknown' },
        teraType: { value: '', source: 'unknown' }, evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' },
        level: 100, gender: 'F',
      }] };
      const text = buildSetsExport({ p1Name: 'A', p2Name: 'B', p1Info: enrichTeamInfo(raw, null, assumptions), p2Info: null });
      expect(text).toContain('IVs: 0 Atk / 0 Spe');
      expect(parseSetsImport(text).p1[0].ivs).toEqual({ hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 0 });
    });
  }

  // Round 76 (T234): the library's import gives a set with a typed Hidden Power the type's own IVs (Ice: 30 Atk, 30 Def) unless the
  // text lists IVs, while the build plays a listed Hidden Power at the IVs it has. An export of IVs that are all 31 stays explicit.
  test.each([
    ['singles', 'Tornadus-Therian', ['U-turn', 'Hidden Power Ice', 'Hurricane', 'Knock Off']],
    ['doubles', 'Incineroar', ['Fake Out', 'Hidden Power Ice', 'Parting Shot', 'Knock Off']],
  ])('%s: a set with a typed Hidden Power and IVs of 31 imports at IVs of 31', (_kind, species, moves) => {
    const info: OpponentTeamInfo = { pokemon: [{
      species, moves: moves.map(name => ({ name, source: 'guessed' as const })), ability: { value: '', source: 'unknown' },
      item: { value: '', source: 'unknown' }, teraType: { value: '', source: 'unknown' },
      evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' }, level: 100,
    }] };
    const text = buildSetsExport({ p1Name: 'A', p2Name: 'B', p1Info: info, p2Info: null });
    expect(parseSetsImport(text).p1[0].ivs).toEqual({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 });
  });

  test('accepts a one-sided import and rejects headerless text with guidance', () => {
    const oneSided = parseSetsImport('=== p2 ===\n\nKingambit @ Leftovers\n- Sucker Punch');
    expect(oneSided.p1).toHaveLength(0);
    expect(oneSided.p2).toHaveLength(1);

    expect(() => parseSetsImport('Kingambit @ Leftovers\n- Sucker Punch'))
      .toThrow(/=== p1/);
  });
});

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
      'Corviknight @ Foo Orb', 'Ability: Foo Bar', 'Tera Type: Moonlight', 'Wobbly Nature', '- Moon Landing', '- Sky Cannon', '- Roost',
    ].join('\n'));
    const errors = await check(format, 9, team(entry('Corviknight')), team(), text);
    const all = errors.join('\n');
    expect(all).toMatch(/Moon Landing/);
    expect(all).toMatch(/Sky Cannon/);
    expect(all).toMatch(/Foo Bar/);
    expect(all).toMatch(/Foo Orb/);
    expect(all).toMatch(/Wobbly/);
    expect(all).toMatch(/Moonlight/);
    expect(all).not.toMatch(/Roost/);
    expect(errors.every(message => message.startsWith('P1 Corviknight'))).toBe(true);
  });

  // Round 83 (T308, GitHub issue #2): a move or an ability the species cannot have imports, the Dex decides what exists.
  test('a move and an ability the species cannot have import; the editor marks them with a note', async () => {
    const text = textOf('Corviknight @ Leftovers\nAbility: Intimidate\n- Power Whip\n- Spore\n- Roost');
    expect(await check(format, 9, team(entry('Corviknight')), team(), text)).toEqual([]);
    const pools = await loadImportPools(['Corviknight'], 9, format);
    expect(pools.movesBySpecies.Corviknight).not.toContain('Power Whip');
    expect(pools.allMoves).toContain('Power Whip');
    expect(pools.abilitiesBySpecies.Corviknight).not.toContain('Intimidate');
    expect(pools.allAbilities).toContain('Intimidate');
  });

  test('a name the Dex does not know stays an error next to values the species cannot have', async () => {
    const text = textOf('Corviknight\nAbility: Foo Bar\n- Power Whip\n- Moon Landing');
    const errors = await check(format, 9, team(entry('Corviknight')), team(), text);
    expect(errors).toHaveLength(2);
    expect(errors.join('\n')).toMatch(/Foo Bar/);
    expect(errors.join('\n')).toMatch(/Moon Landing/);
    expect(errors.join('\n')).not.toMatch(/Power Whip/);
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
    const other = parseSetsImport(textOf('Corviknight\n- Sky Cannon'));
    expect(validateSetsImport(other, { p1: team(entry('Corviknight')), p2: team() }, { gen: 9, pools }, { p1: team(shown), p2: team() }).join('\n'))
      .toMatch(/Sky Cannon/);
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
      const foreign = pools.allMoves.find(name => !(pools.movesBySpecies[mon.name] ?? []).includes(name));
      const foreignAbility = pools.allAbilities.find(name => !abilities.includes(name));
      const outside = validateSetsImport(parseSetsImport(textOf(`${mon.name}\nAbility: ${foreignAbility}\n- ${foreign}`)), { p1: team(entry(mon.name)), p2: team() }, { gen, pools });
      expect(outside, mon.name).toEqual([]);
      const broken = validateSetsImport(parseSetsImport(textOf(`${mon.name}\nAbility: Foo Bar\n- Moon Landing`)), { p1: team(entry(mon.name)), p2: team() }, { gen, pools });
      expect(broken.join('\n'), mon.name).toMatch(/Foo Bar/);
      expect(broken.join('\n'), mon.name).toMatch(/Moon Landing/);
    }
  });
});
