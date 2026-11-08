import { describe, expect, test } from 'vitest';
import { Dex, TeamValidator, Teams, Battle } from '@pkmn/sim';
import { loadSimMods } from '@fulllifegames/eval-engine';
import { toId, type OpponentTeamInfo, type RevealedPokemonInfo } from '@fulllifegames/replay-core';
import { getEveryAbilityPool, getEveryMovePool, getItemPool, type PoolUse } from '../../src/lib/pokemon-options';
import { loadImportPools, parseSetsImport, validateSetsImport } from '../../src/lib/sets-io';

/**
 * Round 88 (#102): the pools of the editor and the sets import follow what the format's simulator lets exist. A Custom
 * Game has no `-Nonexistent` rule, so it plays every Past, Future, Unobtainable, CAP, Legends and LGPE entry; a standard format
 * (`gen9ou`) refuses them; National Dex lifts the rule for what its own rule table names. An id the simulator does not list (a
 * draft league's, and every Scarlet/Violet VGC regulation but 2024 Reg G and 2025 Reg I in @pkmn/sim 0.10.15) keeps the standard
 * pools in the editor's lists, and the import accepts what the Custom Game of its generation plays (round 88, gate of 08.11.2026:
 * the editor of a VGC 2026 game offered about 620 Past, CAP and placeholder entries). The user report: P2 Landorus-Therian "Flying Gem", P2 Banette "Spectral Thief" and P2
 * Infernape "Fire Mane" were refused by the import, and the simulator plays all three in `gen9customgame`.
 *
 * The sweep compares the existence verdict of the simulator's own TeamValidator with the pools, per kind. Its other refusals
 * ("can't learn", "can't have") are no part of it: the app accepts those since round 83 (T308).
 */

const unknown = { value: '', source: 'unknown' as const };
const entry = (species: string): RevealedPokemonInfo => ({
  species, moves: [], ability: unknown, item: unknown, teraType: unknown,
  evs: { value: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, source: 'unknown' }, level: 100, gender: 'M',
});
const team = (...pokemon: RevealedPokemonInfo[]): OpponentTeamInfo => ({ pokemon });

const LANDORUS = 'Landorus-Therian @ Flying Gem\nAbility: Intimidate\n- Earthquake';
const BANETTE = 'Banette @ Leftovers\nAbility: Insomnia\n- Spectral Thief';
const INFERNAPE = 'Infernape @ Leftovers\nAbility: Fire Mane\n- Close Combat';
const THREE = [LANDORUS, BANETTE, INFERNAPE];
const SPECIES = ['Landorus-Therian', 'Banette', 'Infernape'];

async function importErrors(format: string, side: 'p1' | 'p2', blocks: string[]) {
  const mons = team(...SPECIES.map(entry));
  const pools = await loadImportPools(SPECIES, 9, format);
  const text = side === 'p1'
    ? `=== p1: A ===\n\n${blocks.join('\n\n')}\n\n=== p2: B ===\n`
    : `=== p1: A ===\n\n=== p2: B ===\n\n${blocks.join('\n\n')}\n`;
  return validateSetsImport(parseSetsImport(text), { p1: side === 'p1' ? mons : team(), p2: side === 'p2' ? mons : team() }, { gen: 9, pools });
}

const CUSTOM_FORMATS = [
  ['singles', 'gen9customgame'],
  ['doubles', 'gen9doublescustomgame'],
  ['singles draft league (an id the simulator does not list)', 'gen9natdexdraft'],
  ['doubles draft league (an id the simulator does not list)', 'gen9doublesdraftleague'],
] as const;

describe('a Custom Game imports the entries its simulator plays', () => {
  describe.each(CUSTOM_FORMATS)('%s: %s', (_kind, format) => {
    test.each(['p1', 'p2'] as const)('a fresh panel applies Flying Gem, Spectral Thief and Fire Mane on %s', async side => {
      expect(await importErrors(format, side, THREE)).toEqual([]);
    });
  });

  describe.each([['singles', 'gen9ou'], ['doubles', 'gen9doublesou']])('%s standard format %s', (_kind, format) => {
    test.each(['p1', 'p2'] as const)('still refuses all three on %s', async side => {
      const errors = (await importErrors(format, side, THREE)).join('\n');
      expect(errors).toMatch(/"Flying Gem" is not a known item/);
      expect(errors).toMatch(/"Spectral Thief" is not a known move/);
      expect(errors).toMatch(/"Fire Mane" is not a known ability/);
    });
  });

  test('a Custom Game still refuses a name the Dex does not know', async () => {
    const errors = (await importErrors('gen9customgame', 'p2', ['Landorus-Therian @ Foo Orb\nAbility: Foo Bar\n- Moon Landing'])).join('\n');
    expect(errors).toMatch(/Foo Orb/);
    expect(errors).toMatch(/Foo Bar/);
    expect(errors).toMatch(/Moon Landing/);
  });

  test('a call without a format reads the standard pools as before', () => {
    expect(getItemPool(9)).not.toContain('Flying Gem');
    expect(getEveryMovePool(9)).not.toContain('Spectral Thief');
    expect(getEveryAbilityPool(9)).not.toContain('Fire Mane');
  });

  test('the Champions pools stay the mod\'s own (no Custom Game reading)', async () => {
    await loadSimMods('gen9championsou');
    expect(getEveryAbilityPool(9, 'gen9championscustomgame')).not.toEqual(getEveryAbilityPool(9, 'gen9customgame'));
  });
});

// A branch battle of a Custom Game plays the three once imported.
describe('a branch battle of a Custom Game plays the three entries', () => {
  test.each([['singles', 'gen9customgame'], ['doubles', 'gen9doublescustomgame']])('%s: %s', (_kind, format) => {
    const sets = Teams.import([
      'Landorus-Therian @ Flying Gem\nAbility: Intimidate\n- Earthquake\n- Protect',
      'Banette @ Leftovers\nAbility: Insomnia\n- Spectral Thief\n- Protect',
      'Infernape @ Leftovers\nAbility: Fire Mane\n- Close Combat\n- Protect',
      'Garchomp @ Leftovers\nAbility: Rough Skin\n- Earthquake\n- Protect',
    ].join('\n\n'))!;
    const battle = new Battle({ formatid: format as never, seed: [1, 2, 3, 4] });
    battle.setPlayer('p1', { name: 'A', team: Teams.pack(sets) });
    battle.setPlayer('p2', { name: 'B', team: Teams.pack(sets) });
    // Team preview: lead with the first two (doubles) or the first one (singles).
    battle.makeChoices('team 1234', 'team 1234');
    const turn = format.includes('doubles') ? 'move 1, move 1 1' : 'move 1';
    battle.makeChoices(turn, turn);
    const mons = battle.p1.pokemon;
    expect(mons.map(mon => mon.item)).toContain('flyinggem');
    expect(mons.map(mon => mon.ability)).toContain('firemane');
    expect(mons.some(mon => mon.moves.includes('spectralthief'))).toBe(true);
    expect(battle.log.join('\n')).not.toMatch(/\|error\|/);
  });
});

// The sweep: the pools hold exactly what the simulator's TeamValidator lets exist, kind by kind.
const EXISTENCE_REFUSAL = /does not exist|not obtainable|Smogon CAP|Let's Go|placeholder|is tagged|Legends|not in the list of allowed/;

const KINDS = {
  item: { all: (gen: number) => [...Dex.forGen(gen).items.all()], pool: (gen: number, format: string, use?: PoolUse) => getItemPool(gen, format, use), minGen: 2 },
  move: { all: (gen: number) => [...Dex.forGen(gen).moves.all()], pool: (gen: number, format: string, use?: PoolUse) => getEveryMovePool(gen, format, use), minGen: 1 },
  ability: { all: (gen: number) => [...Dex.forGen(gen).abilities.all()], pool: (gen: number, format: string, use?: PoolUse) => getEveryAbilityPool(gen, format, use), minGen: 3 },
} as const;

const setOf = (kind: keyof typeof KINDS, name: string, gen: number) => {
  const set: Record<string, unknown> = { name: 'T', species: 'Pikachu', moves: ['thunderbolt'], ability: gen >= 3 ? 'static' : '', item: '', evs: {}, ivs: {} };
  if (kind === 'item') set.item = name;
  if (kind === 'move') set.moves = [name];
  if (kind === 'ability') set.ability = name;
  return set;
};

const listed = (id: string) => Dex.formats.get(id).exists;
const SWEPT: [number, string][] = [];
for (let gen = 1; gen <= 9; gen++) {
  for (const id of [`gen${gen}customgame`, `gen${gen}doublescustomgame`, `gen${gen}ou`, `gen${gen}doublesou`, `gen${gen}nationaldex`, `gen${gen}nationaldexdoubles`, `gen${gen}ubers`]) {
    if (listed(id)) SWEPT.push([gen, id]);
  }
}

describe('the pools hold what the simulator lets exist (sweep over every non-standard entry)', () => {
  test('the sweep covers a Custom Game, a standard format and National Dex, singles and doubles', () => {
    const ids = SWEPT.map(([, id]) => id);
    for (const id of ['gen9customgame', 'gen9doublescustomgame', 'gen9ou', 'gen9doublesou', 'gen9nationaldex', 'gen8customgame', 'gen4ou', 'gen1ou']) expect(ids).toContain(id);
  });

  test.each(SWEPT)('generation %i, %s: existence verdict per kind equals the validator\'s', (gen, format) => {
    const validator = new TeamValidator(format);
    const wrong: string[] = [];
    let masked = 0;
    for (const [kind, spec] of Object.entries(KINDS) as [keyof typeof KINDS, (typeof KINDS)[keyof typeof KINDS]][]) {
      if (gen < spec.minGen) continue;
      const pool = new Set(spec.pool(gen, format).map(toId));
      for (const thing of spec.all(gen)) {
        if (!thing.exists || !thing.isNonstandard || thing.id === 'noability') continue;
        const problems = validator.validateTeam([setOf(kind, thing.name, gen) as never]) ?? [];
        // A ban of the entry itself (Evasion Moves Clause, Moody Clause) answers before the existence rule is asked: no verdict.
        if (problems.some(problem => problem.includes(thing.name) && /banned/.test(problem))) { masked++; continue; }
        const exists = !problems.some(problem => problem.includes(thing.name) && EXISTENCE_REFUSAL.test(problem));
        if (pool.has(thing.id) !== exists) wrong.push(`${kind} ${thing.name} (${thing.isNonstandard}): pool ${pool.has(thing.id)}, validator ${exists}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(masked).toBeLessThan(20);
  });

  test.each(SWEPT)('generation %i, %s: no standard entry leaves the pool', (gen, format) => {
    for (const [kind, spec] of Object.entries(KINDS) as [keyof typeof KINDS, (typeof KINDS)[keyof typeof KINDS]][]) {
      if (gen < spec.minGen) continue;
      const pool = new Set(spec.pool(gen, format).map(toId));
      const standard = spec.pool(gen, '').map(toId);
      expect(standard.filter(id => !pool.has(id)), `${kind} of ${format}`).toEqual([]);
    }
  });

  test('the reported rows: Flying Gem, Spectral Thief and Fire Mane', () => {
    for (const format of ['gen9customgame', 'gen9doublescustomgame']) {
      expect(getItemPool(9, format)).toContain('Flying Gem');
      expect(getEveryMovePool(9, format)).toContain('Spectral Thief');
      expect(getEveryAbilityPool(9, format)).toContain('Fire Mane');
    }
    for (const format of ['gen9ou', 'gen9doublesou', 'gen9ubers']) {
      expect(getItemPool(9, format)).not.toContain('Flying Gem');
      expect(getEveryMovePool(9, format)).not.toContain('Spectral Thief');
      expect(getEveryAbilityPool(9, format)).not.toContain('Fire Mane');
    }
    // National Dex lifts the existence rule for moves (its rule table says +Past) and keeps refusing the Past items.
    expect(getEveryMovePool(9, 'gen9nationaldex')).toContain('Spectral Thief');
    expect(getItemPool(9, 'gen9nationaldex')).not.toContain('Flying Gem');
  });

  test('an unlisted id: the editor lists the standard pool, the import accepts the Custom Game of its generation, singles and doubles', () => {
    for (const gen of [5, 8, 9]) {
      for (const id of ['natdexdraft', 'doublesdraftleague', ...(gen === 9 ? ['vgc2026regi', 'vgc2026regf'] : [])]) {
        expect(listed(`gen${gen}${id}`)).toBe(false);
        for (const spec of Object.values(KINDS)) {
          if (gen < spec.minGen) continue;
          expect(spec.pool(gen, `gen${gen}${id}`)).toEqual(spec.pool(gen, ''));
          expect(spec.pool(gen, `gen${gen}${id}`, 'editor')).toEqual(spec.pool(gen, ''));
          expect(spec.pool(gen, `gen${gen}${id}`, 'import')).toEqual(spec.pool(gen, `gen${gen}customgame`));
        }
      }
    }
  });

  test('a listed format reads its own rule table in the editor and the import alike', () => {
    for (const format of ['gen9customgame', 'gen9doublescustomgame', 'gen9nationaldex', 'gen9ou', 'gen9vgc2025regi']) {
      for (const spec of Object.values(KINDS)) expect(spec.pool(9, format, 'import')).toEqual(spec.pool(9, format, 'editor'));
    }
  });
});
