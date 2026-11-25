import { beforeAll, describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { checkGameTeams, loadSimMods, startGameLog } from '../src/index';
import { SWEEPS_FULL } from './dice-fixtures';
import { legalTeams, playableFormatIds } from './new-game-teams';

const FAMILIES = [
  'gen9ou', 'gen9doublesou', 'gen9vgc2025regi', 'gen9customgame', 'gen9doublescustomgame', 'gen9bssregi', 'gen9championsou',
  'gen9championsvgc2026regmc', 'gen9championscustomgame', 'gen8ou', 'gen4ou', 'gen2ou', 'gen1ou', 'gen3ou', 'gen7doublesou', 'gen9balancedhackmons',
];

let formatIds: string[] = [];
beforeAll(async () => {
  await loadSimMods('gen9championsou');
  const all = playableFormatIds();
  formatIds = SWEEPS_FULL ? all : all.filter((id, index) => FAMILIES.includes(id) || index % 8 === 0);
}, 60_000);

const UNKNOWN = 'Zzqxvwk';

function futureSpecies(formatId: string): string | null {
  const format = Dex.formats.get(formatId);
  const dex = Dex.forFormat(format);
  const later = Dex.species.all().find(species => species.exists && !species.isNonstandard && species.gen > dex.gen && !dex.species.get(species.id).exists);
  return later ? later.name : null;
}

const withSet = (team: PokemonSet[], changes: Partial<PokemonSet>): PokemonSet[] => [{ ...team[0], ...changes }, ...team.slice(1)];

describe('a set the format\'s Dex does not know', () => {
  test('an unknown species: the simulator names it, and the start says in plain words that it cannot start', async () => {
    const failures: string[] = [];
    let probed = 0;
    for (const id of formatIds) {
      const base = legalTeams(id);
      if ('problems' in base) continue;
      const format = Dex.formats.get(id);
      const dex = Dex.forFormat(format);
      const names = [UNKNOWN, futureSpecies(id)].filter((name): name is string => name !== null);
      for (const name of names) {
        const team = withSet(base.p1, { species: name, name });
        const problems = await checkGameTeams(id, { p1: team, p2: base.p2 });
        if (problems.p1.length === 0) failures.push(`${id} ${name}: the simulator reports no problem`);
        if (problems.p2.length !== 0) failures.push(`${id} ${name}: the legal side reports problems`);
        const exists = dex.species.get(name).exists;
        const outcome = await startGameLog({ format: id, p1Team: team, p2Team: base.p2 }).then(() => 'started', (error: Error) => error.message);
        probed += 1;
        if (exists) {
          if (outcome !== 'started') failures.push(`${id} ${name}: the Dex knows it, the start said ${outcome}`);
          continue;
        }
        if (outcome === 'started') continue;
        const sentence = `${name} is no Pokémon of ${format.name}`;
        if (!outcome.includes(sentence) || /Cannot read|TypeError|undefined|null/.test(outcome)) failures.push(`${id} ${name}: "${outcome}"`);
      }
    }
    expect(probed).toBeGreaterThan(10);
    expect(failures).toEqual([]);
  }, 600_000);

  test('an unknown move, item or ability: the simulator names it and the battle starts', async () => {
    const failures: string[] = [];
    for (const id of formatIds) {
      const base = legalTeams(id);
      if ('problems' in base) continue;
      const dex = Dex.forFormat(Dex.formats.get(id));
      const cases: [string, Partial<PokemonSet>, boolean][] = [
        ['move', { moves: [UNKNOWN] }, dex.moves.get(UNKNOWN).exists],
        ['item', { item: UNKNOWN }, dex.items.get(UNKNOWN).exists],
        ['ability', { ability: UNKNOWN }, dex.abilities.get(UNKNOWN).exists],
      ];
      for (const [kind, changes, known] of cases) {
        if (known) continue;
        if (kind === 'ability' && dex.gen < 3) continue;
        if (kind === 'item' && dex.gen < 2) continue;
        const team = withSet(base.p1, changes);
        const problems = await checkGameTeams(id, { p1: team, p2: base.p2 });
        if (!problems.p1.some(problem => problem.toLowerCase().includes(UNKNOWN.toLowerCase()))) failures.push(`${id} ${kind}: no problem names it (${problems.p1.join(' / ')})`);
        const outcome = await startGameLog({ format: id, p1Team: team, p2Team: base.p2 }).then(() => 'started', (error: Error) => error.message);
        if (outcome !== 'started' && /Cannot read|TypeError|undefined|null/.test(outcome)) failures.push(`${id} ${kind}: "${outcome}"`);
      }
    }
    expect(failures).toEqual([]);
  }, 600_000);
});
