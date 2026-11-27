import { writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import { Dex, TeamValidator } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { buildTeamsFromReplay } from '@fulllifegames/replay-core';
import { checkGameTeams, loadSimMods, startGameLog } from '../src/index';
import { SWEEPS_FULL } from './dice-fixtures';
import { playableFormatIds } from './new-game-teams';

const FAMILIES = [
  'gen9ou', 'gen9doublesou', 'gen9vgc2025regi', 'gen9customgame', 'gen9doublescustomgame', 'gen9bssregi', 'gen9championsou',
  'gen9championsvgc2026regmc', 'gen9championscustomgame', 'gen8ou', 'gen4ou', 'gen3ou', 'gen7doublesou', 'gen9balancedhackmons',
];
const SLOTS = ['0', '1', 'H', 'S'] as const;

let formatIds: string[] = [];
beforeAll(async () => {
  await loadSimMods('gen9championsou');
  const all = playableFormatIds();
  formatIds = SWEEPS_FULL ? all : all.filter((id, index) => FAMILIES.includes(id) || index % 8 === 0);
}, 60_000);

const dexOf = (id: string) => Dex.forFormat(Dex.formats.get(id));

function slotAbilities(species: { abilities: Record<string, string | undefined> }): string[] {
  const names = SLOTS.map(slot => species.abilities[slot]).filter((name): name is string => !!name);
  return names.filter((name, index) => names.indexOf(name) === index);
}

function refuses(validator: TeamValidator, species: string, ability: string): boolean {
  const set = { name: species, species, item: '', ability, moves: [], nature: 'Hardy', gender: '', evs: {}, ivs: {}, level: 100 } as unknown as PokemonSet;
  const problems = validator.validateSet(set, {}) ?? [];
  // A refused ability reads "<set>'s ability <name> is ..."; event-origin lines name "its Hidden Ability": no ban.
  return problems.some(problem => problem.includes(`ability ${ability} `));
}

async function filledFor(id: string, speciesNames: string[]): Promise<Map<string, string>> {
  const sets = speciesNames.map(species => ({ name: species, species, item: '', ability: '', moves: ['Protect'], nature: 'Hardy', gender: '', evs: {}, ivs: {}, level: 100 }) as unknown as PokemonSet);
  const { p1 } = await checkGameTeams(id, { p1: sets, p2: [] });
  const found = new Map<string, string>();
  for (const line of p1) {
    const hit = /^(.+) has no ability: plays (.+)\.$/.exec(line);
    if (hit) found.set(hit[1], hit[2]);
  }
  return found;
}

describe('the ability a new game fills', () => {
  test('every species a format lets in gets the first ability the validator accepts, and slot 0 where none passes', async () => {
    const failures: string[] = [];
    const census: string[] = [];
    let probed = 0;
    for (const id of formatIds) {
      const dex = dexOf(id);
      if (dex.gen < 3) continue;
      const validator = TeamValidator.get(id);
      const played = dex.species.all().filter(species => {
        if (!species.exists || species.battleOnly || species.isNonstandard === 'CAP') return false;
        const set = { name: species.name, species: species.name } as PokemonSet;
        return !validator.checkSpecies(set, species, species, {});
      });
      let refused = 0;
      let moved = 0;
      let stuck = 0;
      const expectedFill = new Map<string, string>();
      for (const species of played) {
        const names = slotAbilities(species);
        if (names.length === 0) continue;
        const accepted = names.find(name => !refuses(validator, species.name, name));
        if (accepted !== names[0]) { refused += 1; if (accepted) moved += 1; else stuck += 1; }
        expectedFill.set(species.name, accepted ?? names[0]);
      }
      const all = [...expectedFill.keys()];
      for (let start = 0; start < all.length; start += 6) {
        const batch = all.slice(start, start + 6);
        const got = await filledFor(id, batch);
        for (const species of batch) {
          const expected = expectedFill.get(species);
          if (got.get(species) !== expected) failures.push(`${id} ${species}: the fill is "${got.get(species)}", the validator accepts "${expected}"`);
        }
      }
      probed += 1;
      census.push(`${id}: ${all.length} species, slot 0 refused for ${refused} (another slot passes for ${moved}, none for ${stuck})`);
    }
    const report = `ability fill census (${SWEEPS_FULL ? 'full' : 'sample'}):\n${census.join('\n')}`;
    console.info(report);
    if (process.env.FILL_CENSUS_FILE) writeFileSync(process.env.FILL_CENSUS_FILE, `${report}\n`);
    expect(probed).toBeGreaterThan(10);
    expect(failures.slice(0, 40)).toEqual([]);
  }, 1_800_000);

  test('the reported scenes: Garchomp, Dugtrio and Tatsugiri in the Gen 9 OU and the Doubles OU new game', async () => {
    const rows: Array<[string, string, string]> = [
      ['gen9ou', 'Garchomp', 'Rough Skin'],
      ['gen9ou', 'Dugtrio', 'Sand Force'],
      ['gen9doublesou', 'Garchomp', 'Rough Skin'],
      ['gen9doublesou', 'Dugtrio', 'Arena Trap'],
      ['gen9doublesou', 'Tatsugiri', 'Storm Drain'],
      ['gen9customgame', 'Garchomp', 'Sand Veil'],
      ['gen9doublescustomgame', 'Tatsugiri', 'Commander'],
    ];
    const failures: string[] = [];
    for (const [id, species, ability] of rows) {
      const filled = await filledFor(id, [species]);
      if (filled.get(species) !== ability) failures.push(`${id} ${species}: the check says "${filled.get(species)}", not "${ability}"`);
      const moves = ['Protect', 'Earthquake'];
      const mine = { name: species, species, item: '', ability: '', moves, nature: 'Hardy', gender: '', evs: {}, ivs: {}, level: 100 } as unknown as PokemonSet;
      const start = await startGameLog({ format: id, p1Team: [mine], p2Team: [mine], fillAbilities: true });
      if (start.teams.p1[0].ability !== ability) failures.push(`${id} ${species}: the saved team holds "${start.teams.p1[0].ability}", not "${ability}"`);
      if (start.bodies.p1[0].ability !== ability.toLowerCase().replace(/[^a-z0-9]/g, '')) failures.push(`${id} ${species}: the battle plays "${start.bodies.p1[0].ability}"`);
    }
    expect(failures).toEqual([]);
  }, 120_000);
});

describe('the new game and the replay build default to the same ability', () => {
  const FORMATS: Array<[string, 'singles' | 'doubles']> = [
    ['gen9ou', 'singles'], ['gen9doublesou', 'doubles'], ['gen9customgame', 'singles'], ['gen9doublescustomgame', 'doubles'],
    ['gen9championsou', 'singles'], ['gen9championsvgc2026regmc', 'doubles'], ['gen4ou', 'singles'],
  ];
  const SPECIES = ['Garchomp', 'Dugtrio', 'Tatsugiri', 'Gengar', 'Chansey', 'Ninetales', 'Aegislash'];

  function replayDefault(formatId: string, kind: 'singles' | 'doubles', species: string): string | undefined {
    const format = Dex.formats.get(formatId);
    const doubles = kind === 'doubles';
    const lead = (side: string, name: string) => [`|switch|${side}a: ${name}|${name}, M|100/100`, ...(doubles ? [`|switch|${side}b: Ditto|Ditto|100/100`] : [])];
    const log = [
      `|gametype|${kind}`, '|player|p1|Alice|', '|player|p2|Bob|', `|gen|${dexOf(formatId).gen}`, `|tier|${format.name}`, '|poke|p1|Chansey, F|', `|poke|p2|${species}, M|`,
      ...(doubles ? ['|poke|p2|Ditto|'] : []), '|start', ...lead('p1', 'Chansey'), ...lead('p2', species), '|turn|1',
    ].join('\n');
    return buildTeamsFromReplay(log).p2Team.find(set => set.species === species)?.ability;
  }

  test.each(FORMATS)('%s (%s): the fill is the build default for every sampled species', async (formatId, kind) => {
    const dex = dexOf(formatId);
    const failures: string[] = [];
    for (const species of SPECIES) {
      const entry = dex.species.get(species);
      if (!entry.exists || entry.gen > dex.gen) continue;
      const filled = (await filledFor(formatId, [entry.name])).get(entry.name);
      const built = replayDefault(formatId, kind, entry.name);
      if (filled && filled !== built) failures.push(`${formatId} ${entry.name}: the new game fills "${filled}", the build plays "${built}"`);
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
