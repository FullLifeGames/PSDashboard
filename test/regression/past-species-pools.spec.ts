import { describe, expect, test } from 'vitest';
import { Dex, TeamValidator } from '@pkmn/sim';
import { loadSimMods } from '@fulllifegames/eval-engine';
import { CHAMPIONS_MOD, rulesDex, toId } from '@fulllifegames/replay-core';
import { getAbilityPool, getEveryMovePool, getMovePool } from '../../src/lib/pokemon-options';
import { canonicalMove } from '../../src/lib/team-editor';

/**
 * Round 89 (#150, claim 3; user ruling 37, N1b). A species the generation marks Past (or CAP, Future, LGPE, Custom) is no entry of
 * the generation's standard Dex, and replay-core's Generations hide it: the editor's pool for Dracovish was every standard move
 * without Fishious Rend and its ability list was empty. The battle's own rules decide: a species the format's simulator lets
 * exist gets the simulator's own pool (`species.getMovePool(id, natDex)`) and the Dex entry's abilities. An id the simulator does
 * not list (a draft league's) plays as the Custom Game of its generation, as the rebuild does. The editor's standard lists stay;
 * typed names accept every move the battle plays.
 *
 * The sweep compares, for every non-standard species of every generation (and the Champions mod), the reader with the simulator.
 * Whether a species exists is the simulator's TeamValidator's verdict (the same existence reading as custom-game-pools.spec.ts).
 */

// A tier ban ("is tagged ND Uber, which is banned") answers after existence passed: it is no refusal of existence.
const EXISTENCE_REFUSAL = /does not exist|not obtainable|Smogon CAP|Let's Go|placeholder|Legends|not in the list of allowed|is tagged (Past|Future|CAP|LGPE|Unobtainable|Custom|Nonexistent)\b/;

const names = (dex: { moves: { get(id: string): { name: string } } }, ids: Iterable<string>) => [...ids].map(id => dex.moves.get(id).name);
const ids = (list: string[]) => list.map(toId).sort();

/** The simulator's pool of a species the battle plays; a species whose pool is empty offers the moves the battle plays (the editor never blocks). */
const simulatorPool = (
  dex: { moves: { get(id: string): { name: string } }; species: { getMovePool(id: string, natDex: boolean): Set<string> } },
  species: { id: string }, natDex: boolean, everything: string[],
): string[] => {
  const pool = ids(names(dex, dex.species.getMovePool(species.id, natDex)));
  return pool.length > 0 ? pool : ids(everything);
};

// A tag ban of a rule ("is tagged Restricted Legendary, which is banned by Flat Rules") answers before the existence rule is asked
// (checkTagRules returns the first tag rule that matches): no verdict on existence, the row is masked and counted.
const AMBIGUOUS = /, which is banned by /;
const masked: string[] = [];
const existsIn = (validator: TeamValidator, dex: { species: { get(name: string): never } }, species: { name: string }): boolean | null => {
  const entry = dex.species.get(species.name) as never;
  const problem = validator.checkSpecies({ name: 'T' } as never, entry, entry, {});
  if (problem && AMBIGUOUS.test(problem) && !EXISTENCE_REFUSAL.test(problem.replace(AMBIGUOUS, ''))) return null;
  return !problem || !EXISTENCE_REFUSAL.test(problem);
};

/** Whether the format plays Past species at all (National Dex rules for the simulator's pool). */
const playsPast = (validator: TeamValidator, dex: { species: { all(): readonly { exists: boolean; isNonstandard?: string | null; name: string }[]; get(name: string): never } }): boolean =>
  dex.species.all().some(species => species.exists && species.isNonstandard === 'Past' && existsIn(validator, dex, species) === true);

describe('the reported rows (#150): Dracovish and Zygarde under National Dex rules', () => {
  const PLAYING = [
    ['singles draft league, an id the simulator does not list', 'gen9natdexdraft'],
    ['doubles draft league, an id the simulator does not list', 'gen9doublesdraftleague'],
    ['singles National Dex', 'gen9nationaldex'],
    ['singles Custom Game', 'gen9customgame'],
    ['doubles Custom Game', 'gen9doublescustomgame'],
  ] as const;

  describe.each(PLAYING)('%s: %s', (_kind, format) => {
    test('Dracovish has the simulator\'s 50 moves with Fishious Rend and its three abilities', async () => {
      const pool = await getMovePool('Dracovish', 9, format);
      expect(pool).toHaveLength(50);
      expect(pool).toContain('Fishious Rend');
      expect(ids(pool)).toEqual(ids(names(Dex.forGen(9), Dex.forGen(9).species.getMovePool('dracovish', true))));
      expect(getAbilityPool('Dracovish', 9, format).sort()).toEqual(['Sand Rush', 'Strong Jaw', 'Water Absorb']);
    });

    test('Zygarde has 70 moves with Thousand Arrows', async () => {
      const pool = await getMovePool('Zygarde', 9, format);
      expect(pool).toHaveLength(70);
      expect(pool).toContain('Thousand Arrows');
      expect(getAbilityPool('Zygarde', 9, format).length).toBeGreaterThan(0);
    });

    test('the moves the battle plays hold both signature moves for a typed name, the editor\'s list stays standard where the id is unlisted', () => {
      const played = getEveryMovePool(9, format, 'import');
      expect(played).toContain('Fishious Rend');
      expect(played).toContain('Thousand Arrows');
      if (!Dex.formats.get(format).exists) {
        expect(getEveryMovePool(9, format, 'editor')).not.toContain('Fishious Rend');
        expect(getEveryMovePool(9, format)).toEqual(getEveryMovePool(9, ''));
      }
    });
  });

  describe.each([['singles', 'gen9ou'], ['doubles', 'gen9doublesou'], ['Ubers', 'gen9ubers']])('%s standard format %s keeps refusing both', (_kind, format) => {
    test('no Fishious Rend, no Thousand Arrows, no abilities for the Past species', async () => {
      for (const species of ['Dracovish', 'Zygarde']) {
        const pool = await getMovePool(species, 9, format);
        expect(pool).not.toContain('Fishious Rend');
        expect(pool).not.toContain('Thousand Arrows');
        expect(getAbilityPool(species, 9, format)).toEqual([]);
      }
      expect(getEveryMovePool(9, format, 'import')).not.toContain('Fishious Rend');
    });
  });

  test('a typed name: accepted in the played pool, shown as not learnable outside the species\' pool, refused in a standard format', async () => {
    const format = 'gen9natdexdraft';
    const editorList = getEveryMovePool(9, format);
    const played = getEveryMovePool(9, format, 'import');
    const dracovish = await getMovePool('Dracovish', 9, format);
    const garchomp = await getMovePool('Garchomp', 9, format);
    // The species' own pool takes the name first.
    expect(canonicalMove(dracovish, 'fishious rend', editorList, played)).toEqual({ canonical: 'Fishious Rend', outside: false });
    // A species without it takes the battle's move as not learnable.
    expect(canonicalMove(garchomp, 'fishious rend', editorList, played)).toEqual({ canonical: 'Fishious Rend', outside: true });
    expect(canonicalMove(dracovish, 'Moon Landing', editorList, played)).toEqual({ unknown: true });
    // Without the played list (the import's call) the answer is as before.
    expect(canonicalMove(garchomp, 'fishious rend', editorList)).toEqual({ unknown: true });
    // A standard format: the played list is the standard one.
    const ou = getEveryMovePool(9, 'gen9ou');
    expect(canonicalMove(garchomp, 'fishious rend', ou, getEveryMovePool(9, 'gen9ou', 'import'))).toEqual({ unknown: true });
  });
});

// The sweep.
const RULE_FORMATS = (gen: number): [string, string][] => [
  ...['customgame', 'doublescustomgame', 'ou', 'doublesou', 'nationaldex', 'ubers']
    .filter(kind => Dex.formats.get(`gen${gen}${kind}`).exists)
    .map(kind => [`gen${gen}${kind}`, `gen${gen}${kind}`] as [string, string]),
  // An unlisted id (singles and doubles draft leagues) plays as the Custom Game of its generation.
  [`gen${gen}natdexdraft`, `gen${gen}customgame`],
  [`gen${gen}doublesdraftleague`, `gen${gen}customgame`],
];

const SWEPT: [number, string, string][] = [];
for (let gen = 1; gen <= 9; gen++) for (const [format, rules] of RULE_FORMATS(gen)) SWEPT.push([gen, format, rules]);

describe('every non-standard species: the own pool is the simulator\'s, the ability list is the Dex entry\'s', () => {
  test('the sweep covers listed and unlisted ids, singles and doubles, in every generation', () => {
    const formats = SWEPT.map(([, format]) => format);
    for (const id of ['gen9customgame', 'gen9doublescustomgame', 'gen9ou', 'gen9nationaldex', 'gen9natdexdraft', 'gen9doublesdraftleague', 'gen8natdexdraft', 'gen1ou']) expect(formats).toContain(id);
  });

  test.each(SWEPT)('generation %i, %s', async (gen, format, rules) => {
    const dex = Dex.forGen(gen);
    const validator = new TeamValidator(rules);
    const wrong: string[] = [];
    let played = 0;
    let refused = 0;
    const natDex = playsPast(validator, dex);
    for (const species of dex.species.all()) {
      if (!species.exists || !species.isNonstandard) continue;
      const pool = await getMovePool(species.name, gen, format);
      const abilities = getAbilityPool(species.name, gen, format);
      const verdict = existsIn(validator, dex as never, species);
      if (verdict === null) { masked.push(`${format} ${species.name}`); continue; }
      if (verdict) {
        played++;
        const expected = simulatorPool(dex, species, natDex, getEveryMovePool(gen, format, 'import'));
        if (JSON.stringify(ids(pool)) !== JSON.stringify(expected)) wrong.push(`${species.name} (${species.isNonstandard}): pool ${pool.length}, simulator ${expected.length}`);
        const entryAbilities = Object.values(species.abilities).filter(Boolean).map(toId).sort();
        if (gen >= 3 && JSON.stringify(abilities.map(toId).sort()) !== JSON.stringify(entryAbilities)) wrong.push(`${species.name}: abilities ${abilities.join('/')}`);
        if (gen < 3 && abilities.length > 0) wrong.push(`${species.name}: abilities before Generation 3`);
      } else {
        refused++;
        // A format that refuses the species keeps the reading of a call without a format.
        if (JSON.stringify(ids(pool)) !== JSON.stringify(ids(await getMovePool(species.name, gen)))) wrong.push(`${species.name}: refused, but its pool moved`);
        if (abilities.length > 0) wrong.push(`${species.name}: refused, but it has abilities`);
      }
    }
    expect(wrong.slice(0, 20)).toEqual([]);
    // A Custom Game plays every one of them; the others refuse at least the CAP species.
    if (rules.endsWith('customgame')) expect(refused).toBe(0);
    expect(played + refused).toBeGreaterThan(0);
  }, 120_000);
});

describe('the Champions mod reads its own species through the mod\'s pool', () => {
  const FORMATS: [string, string][] = [
    ['gen9championscustomgame', 'gen9championscustomgame'],
    ['gen9championsdoublescustomgame', 'gen9championsdoublescustomgame'],
    ['gen9championsou', 'gen9championsou'],
    ['gen9championsvgc2026regmcbo3', 'gen9championsvgc2026regmcbo3'],
    // An unlisted Champions id plays as the Champions Custom Game.
    ['gen9championsdraftleague', 'gen9championscustomgame'],
  ];

  test.each(FORMATS)('%s', async (format, rules) => {
    await loadSimMods('gen9championsou');
    const dex = rulesDex(9, CHAMPIONS_MOD);
    const validator = new TeamValidator(rules);
    const natDex = playsPast(validator, dex);
    const wrong: string[] = [];
    let played = 0;
    for (const species of dex.species.all()) {
      if (!species.exists || !species.isNonstandard) continue;
      const verdict = existsIn(validator, dex as never, species);
      if (verdict === null) { masked.push(`${format} ${species.name}`); continue; }
      if (!verdict) continue;
      played++;
      const pool = await getMovePool(species.name, 9, format);
      const expected = simulatorPool(dex, species, natDex, getEveryMovePool(9, format, 'import'));
      if (JSON.stringify(ids(pool)) !== JSON.stringify(expected)) wrong.push(`${species.name} (${species.isNonstandard}): pool ${pool.length}, simulator ${expected.length}`);
      const entryAbilities = Object.values(species.abilities).filter(Boolean).map(toId).sort();
      if (JSON.stringify(getAbilityPool(species.name, 9, format).map(toId).sort()) !== JSON.stringify(entryAbilities)) wrong.push(`${species.name}: abilities`);
    }
    expect(wrong.slice(0, 20)).toEqual([]);
    expect(played > 0).toBe(rules.endsWith('customgame'));
  }, 120_000);
});

test('only the Champions VGC regulation masks rows (its Flat Rules ban the restricted and mythical species by tag)', () => {
  const formats = new Set(masked.map(row => row.split(' ')[0]));
  expect([...formats].filter(format => format !== 'gen9championsvgc2026regmcbo3')).toEqual([]);
});
