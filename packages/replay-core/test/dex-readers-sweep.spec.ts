import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import * as championsMod from '@pkmn/mods/champions';
import { createInferrerState } from '../src/inference/inferrer-state';
import { readLine } from '../src/inference/log-line';
import { contactLands } from '../src/inference/item-evidence';
import { dexOf, rulesDex, type RulesDex } from '../src/rules-dex';
import { factsOf } from '../src/set-coherence';
import { fillsOpenMove } from '../src/team/open-moves';
import { HP_TYPES, resolveHiddenPowerType } from '../src/hidden-power';
import { editedFields, resolveAbility, resolveSpread } from '../src/team/set-resolvers';
import { evBudget } from '../src/spreads/ev-budget';
import { unknownEvs, unknownField } from '../src/team-info';
import type { RevealedPokemonInfo } from '../src/types';
import type { SmogonUsageStats } from '../src/smogon/stats-types';

/**
 * Round 75 (T160, decision D1), the sweep of replay-core's half: the Dex a reader gets from its state is the Dex of the game,
 * entry by entry. Two halves, one for the mod and one for the older generations.
 *
 * The mod: every move, ability, item and condition the Champions mod changes (found by comparing the raw mod data with
 * Scarlet/Violet, not by our code) reads the mod's value through the Dex an inferrer state hands out for a Champions tier line,
 * in singles and in doubles, and the Scarlet/Violet value through the state of a Scarlet/Violet tier line. The readers that take
 * a move's fields (the veto facts, the open-move fit, the contact check) then run on every changed move.
 *
 * The generations: the readers of a species' base stats and abilities (the default spread, the default ability) and of the type
 * chart (the Hidden Power resolver) run over every species and type of every generation 1 to 9 and are compared with the
 * generation's own data; the sweep checks that older generations really differ from Generation 9 on what the readers read.
 */
Dex.mod('champions', championsMod as unknown as NonNullable<Parameters<typeof Dex.mod>[1]>);
const mod = Dex.dexes.champions;
const standard = Dex.forGen(9);

const TIERS = {
  'Champions singles': { tier: '[Gen 9 Champions] OU', champions: true },
  'Champions doubles': { tier: '[Gen 9 Champions] VGC 2026 Reg M-B', champions: true },
  'Scarlet/Violet singles': { tier: '[Gen 9] OU', champions: false },
  'Scarlet/Violet doubles': { tier: '[Gen 9] Doubles OU', champions: false },
} as const;
const stateOf = (tier: string) => createInferrerState(`|gen|9\n|tier|${tier}`.split('\n').map(readLine), 'p2');
const text = (_key: string, value: unknown) => (typeof value === 'function' ? `fn:${String(value)}` : value);
const same = (a: unknown, b: unknown) => JSON.stringify(a, text) === JSON.stringify(b, text);

interface Row { id: string; mod: unknown; standard: unknown }
type Kind = 'moves' | 'abilities' | 'items' | 'conditions';

/** The fields that carry text or listing data, not rules (and the ones the Dex derives from the mod's own data set). */
const PROSE = new Set(['desc', 'shortDesc', 'rating', 'isNonstandard', 'tier', 'doublesTier', 'natDexTier', 'gen', 'num', 'fullname', 'effectType', 'sourceEffect', 'toString']);

/** Per field, the entries of one kind whose value the mod changes. */
function changed(kind: Kind, fields: string[]): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  const read = (dex: RulesDex, id: string) => (kind === 'conditions' ? dex.conditions.get(id) : dex[kind].get(id)) as unknown as Record<string, unknown>;
  const ids = kind === 'conditions' ? Object.keys((championsMod as unknown as { Conditions: object }).Conditions) : (mod[kind].all() as { id: string }[]).map(entry => entry.id);
  for (const id of ids) {
    const a = read(mod, id);
    const b = read(standard, id);
    if (!b.exists) continue;
    const compared = fields.length > 0 ? fields : [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(field => !PROSE.has(field));
    for (const field of compared) if (!same(a[field], b[field])) (out[field] ??= []).push({ id, mod: a[field], standard: b[field] });
  }
  return out;
}

const MOVE_FIELDS = ['type', 'basePower', 'accuracy', 'pp', 'flags', 'secondaries', 'category', 'priority', 'onModifyMove', 'onDisableMove', 'basePowerCallback', 'self'];
const moves = changed('moves', MOVE_FIELDS);
const abilities = changed('abilities', []);
const items = changed('items', []);
const conditions = changed('conditions', []);

describe('the sweep sees what the mod changes', () => {
  test('the changed entries are the ones the round-67 diff and the fact check counted', () => {
    // By id, not by row: the mod's 16 typed Hidden Power rows share one id (the fact check's 18 types and 23 flags count rows).
    expect(moves.type?.map(row => row.id).sort()).toEqual(['growth', 'snaptrap']);
    expect(moves.basePower?.length).toBe(23);
    expect(moves.accuracy?.length).toBe(5);
    expect(moves.flags?.length).toBe(7);
    expect(moves.onDisableMove?.length).toBe(4);
    expect(moves.secondaries?.length).toBe(4);
    expect(moves.pp?.length).toBe(103);
    expect(Object.keys(moves).filter(field => ['category', 'priority'].includes(field))).toEqual([]);
    expect([...new Set(Object.values(abilities).flat().map(row => row.id))].sort()).toEqual(['angershell', 'berserk', 'disguise', 'healer', 'naturalcure', 'regenerator', 'unseenfist']);
    expect([...new Set(Object.values(items).flat().map(row => row.id))]).toEqual(['whiteherb']);
    expect([...new Set(Object.values(conditions).flat().map(row => row.id))].sort()).toEqual(expect.arrayContaining(['frz', 'par', 'slp']));
  });
});

describe.each(Object.entries(TIERS))('the Dex of a state for %s reads the entry the game plays', (_name, { tier, champions }) => {
  const dex = dexOf(stateOf(tier));
  const expected = (row: Row) => (champions ? row.mod : row.standard);
  const gameDex = champions ? mod : standard;
  const otherDex = champions ? standard : mod;

  test('the state hands out the Champions Dex or the Dex of its generation', () => {
    expect(dex).toBe(gameDex);
  });

  test('every changed move reads the game\'s type, power, accuracy, PP, flags and secondary effects', () => {
    for (const [field, rows] of Object.entries(moves)) {
      const wrong = rows.filter(row => !same((dex.moves.get(row.id) as unknown as Record<string, unknown>)[field], expected(row))).map(row => `${field} ${row.id}`);
      expect(wrong).toEqual([]);
    }
  });

  test('every changed ability, item and condition reads the game\'s handlers', () => {
    const wrong: string[] = [];
    const check = (label: string, table: Record<string, Row[]>, read: (id: string) => unknown) => {
      for (const [field, rows] of Object.entries(table)) {
        for (const row of rows) if (!same((read(row.id) as Record<string, unknown>)[field], expected(row))) wrong.push(`${label} ${field} ${row.id}`);
      }
    };
    check('ability', abilities, id => dex.abilities.get(id));
    check('item', items, id => dex.items.get(id));
    check('condition', conditions, id => dex.conditions.get(id));
    expect(wrong).toEqual([]);
  });

  test('the veto facts read the game\'s power and type of every changed move', () => {
    const wrong = [...(moves.basePower ?? []), ...(moves.type ?? [])].filter(row => {
      const facts = factsOf(dex, row.id);
      const move = gameDex.moves.get(row.id);
      return !facts || facts.basePower !== move.basePower || facts.type !== move.type;
    }).map(row => row.id);
    expect(wrong).toEqual([]);
  });

  test('the open-move fit reads the game\'s type: a changed type fills an attack slot of that type only', () => {
    const attacks = (moves.type ?? []).filter(row => standard.moves.get(row.id).category !== 'Status');
    expect(attacks.length).toBeGreaterThan(0);
    const wrong = attacks.filter(row => {
      const own = gameDex.moves.get(row.id).type;
      const other = otherDex.moves.get(row.id).type;
      return !fillsOpenMove(dex, { kind: 'attack', type: own }, row.id) || fillsOpenMove(dex, { kind: 'attack', type: other }, row.id);
    }).map(row => row.id);
    expect(wrong).toEqual([]);
  });

  test('the contact check reads the game\'s contact flag of every move whose flags changed', () => {
    const wrong = (moves.flags ?? []).filter(row => contactLands(dex, row.id, '') !== !!gameDex.moves.get(row.id).flags.contact).map(row => row.id);
    expect(wrong).toEqual([]);
  });
});

describe('the generations: a reader reads the species and the type chart of its own generation', () => {
  const GENS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const speciesOf = (dex: RulesDex, gen: number) => dex.species.all().filter(entry => entry.gen <= gen && entry.num > 0);
  const info = (species: string): RevealedPokemonInfo => ({
    species, moves: [], ability: unknownField(), item: unknownField(), teraType: unknownField(), evs: unknownEvs(), level: 100, gender: '',
  } as RevealedPokemonInfo);
  const edited = editedFields(info('Pikachu'));

  test('the default spread follows the generation\'s base stats of every species, and older generations differ from Generation 9', () => {
    const budget = evBudget('gen9ou');
    let differing = 0;
    const wrong: string[] = [];
    for (const gen of GENS) {
      const dex = rulesDex(gen);
      for (const entry of speciesOf(dex, gen)) {
        const stats = entry.baseStats;
        const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 4, spe: 0 };
        evs[stats.spa > stats.atk ? 'spa' : 'atk'] = 252;
        evs[stats.spe >= 80 ? 'spe' : 'hp'] = 252;
        const read = resolveSpread(dex, entry.name, edited, undefined, null, null, undefined, [], budget).evs;
        if (!same(read, evs)) wrong.push(`gen ${gen} ${entry.name}`);
        const modern = resolveSpread(standard, entry.name, edited, undefined, null, null, undefined, [], budget).evs;
        if (gen < 9 && !same(read, modern)) differing++;
      }
    }
    expect(wrong).toEqual([]);
    expect(differing).toBeGreaterThan(0);
  });

  test('the default ability follows the generation\'s first slot, and older generations differ from Generation 9', () => {
    let differing = 0;
    const wrong: string[] = [];
    for (const gen of GENS.filter(value => value >= 3)) {
      const dex = rulesDex(gen);
      for (const entry of speciesOf(dex, gen)) {
        const read = resolveAbility(dex, info(entry.name), null, null, undefined);
        if (read !== (entry.abilities[0] || entry.abilities[1] || entry.abilities.H || '')) wrong.push(`gen ${gen} ${entry.name}`);
        if (gen < 9 && read !== resolveAbility(standard, info(entry.name), null, null, undefined)) differing++;
      }
    }
    expect(wrong).toEqual([]);
    expect(differing).toBeGreaterThan(0);
  });

  test('the Hidden Power resolver reads the generation\'s type chart', () => {
    const usage: SmogonUsageStats = {
      format: 'gen9ou', month: 'test', source: 'test',
      pokemon: {
        pikachu: {
          species: 'Pikachu', rawCount: 100, abilities: [], items: [], spreads: [],
          moves: HP_TYPES.map((type, index) => ({ value: `hiddenpower${type.toLowerCase()}`, probability: 0.9 - index * 0.05, sourceDetail: 'test' })),
        },
      },
    };
    const markerOf = (dex: RulesDex, attack: string, defenderTypes: readonly string[]) => {
      let multiplier = 1;
      for (const type of defenderTypes) {
        const code = (dex.types.get(type).damageTaken as Record<string, number>)[attack];
        if (code === 3) return 'immune';
        multiplier *= code === 1 ? 2 : code === 2 ? 0.5 : 1;
      }
      return multiplier > 1 ? 'super' : multiplier < 1 ? 'resisted' : 'neutral';
    };
    const evidence = (defender: string, marker: 'super' | 'resisted' | 'immune' | 'neutral') =>
      [{ attackerSide: 'p1' as const, attackerSpecies: 'Pikachu', defenderSpecies: defender, marker }];
    const wrong: string[] = [];
    let differing = 0;
    for (const gen of GENS.filter(value => value >= 2)) {
      const dex = rulesDex(gen);
      const defenders = new Map<string, string>();
      for (const entry of speciesOf(dex, gen)) if (!defenders.has(entry.types.join())) defenders.set(entry.types.join(), entry.name);
      for (const [types, defender] of defenders) {
        for (const marker of ['super', 'resisted', 'immune', 'neutral'] as const) {
          const expectedType = HP_TYPES.find(type => markerOf(dex, type, types.split(',')) === marker) ?? HP_TYPES[0];
          const read = resolveHiddenPowerType(evidence(defender, marker), usage, 'Pikachu', { gen, mod: undefined });
          if (read !== `Hidden Power ${expectedType}`) wrong.push(`gen ${gen} ${defender} ${marker}`);
          if (gen < 9 && read !== resolveHiddenPowerType(evidence(defender, marker), usage, 'Pikachu', { gen: 9, mod: undefined })) differing++;
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(differing).toBeGreaterThan(0);
  });
});
