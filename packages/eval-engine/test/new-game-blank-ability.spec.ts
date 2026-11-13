import { beforeAll, describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { checkGameTeams, loadSimMods, startGameLog } from '../src/index';
import { SWEEPS_FULL } from './dice-fixtures';
import { legalTeams, playableFormatIds } from './new-game-teams';

/**
 * Round 89 (lane H, #105, H20a, user ruling 13.11.2026): a pasted set without an ability. The simulator plays such a set with no
 * ability at all (the packed team writes "-" for it), while the team knowledge guesses the species' first ability. Start fills the
 * gap once, from the format's own Dex (the first ability of the species, as Showdown's team import and its packed-team reader do),
 * writes it into the saved team, and the team check names it before Start ("<species> has no ability: plays <ability>."). Generations
 * 1 and 2 have no abilities and fill nothing. The sweep reads each format's Dex as the oracle and plays the filled battle in the
 * simulator: singles, doubles, VGC, Champions and the older generations.
 */

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

const blank = (team: PokemonSet[]): PokemonSet[] => team.map(set => ({ ...set, ability: '' }));
const toId = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

describe('a pasted set without an ability (H20a)', () => {
  test('the team check names the ability each blank set will play, in every generation that has abilities, and the validator\'s own complaint goes', async () => {
    const failures: string[] = [];
    let probed = 0;
    for (const id of formatIds) {
      const base = legalTeams(id);
      if ('problems' in base) continue;
      const dex = Dex.forFormat(Dex.formats.get(id));
      const problems = await checkGameTeams(id, { p1: blank(base.p1), p2: base.p2 });
      probed += 1;
      const notes = problems.p1.filter(line => line.includes('has no ability'));
      if (dex.gen < 3) {
        if (notes.length > 0) failures.push(`${id}: generation ${dex.gen} has no abilities, yet ${notes[0]}`);
        continue;
      }
      for (const set of base.p1) {
        const expected = `${dex.species.get(set.species).name} has no ability: plays ${dex.species.get(set.species).abilities['0']}.`;
        if (!notes.includes(expected)) failures.push(`${id}: no line "${expected}" in ${JSON.stringify(notes)}`);
      }
      if (problems.p1.some(line => line.includes('needs to have an ability'))) failures.push(`${id}: the validator still asks for an ability`);
      if (problems.p2.some(line => line.includes('has no ability'))) failures.push(`${id}: the side with abilities got a note`);
    }
    expect(probed).toBeGreaterThan(10);
    expect(failures).toEqual([]);
  }, 600_000);

  test('Start with the fill writes the first ability into the saved team and the battle plays it; without it the simulator plays none', async () => {
    const failures: string[] = [];
    let probed = 0;
    for (const id of formatIds) {
      const base = legalTeams(id);
      if ('problems' in base) continue;
      const dex = Dex.forFormat(Dex.formats.get(id));
      const names = (team: PokemonSet[]) => team.map(set => dex.species.get(set.species).name);
      const plain = await startGameLog({ format: id, p1Team: blank(base.p1), p2Team: base.p2 });
      const filled = await startGameLog({ format: id, p1Team: blank(base.p1), p2Team: base.p2, fillAbilities: true });
      probed += 1;
      // what the simulator does with the blank set as pasted: no ability
      if (plain.bodies.p1.some(body => body.ability !== '')) failures.push(`${id}: the simulator plays an ability for a blank set (${plain.bodies.p1.map(body => body.ability)})`);
      for (const [index, species] of names(base.p1).entries()) {
        const expected = dex.gen >= 3 ? dex.species.get(species).abilities['0'] : '';
        if (filled.teams.p1[index].ability !== expected) failures.push(`${id} ${species}: the saved team holds "${filled.teams.p1[index].ability}", not "${expected}"`);
        if (filled.bodies.p1[index].ability !== toId(expected)) failures.push(`${id} ${species}: the battle plays "${filled.bodies.p1[index].ability}", not "${toId(expected)}"`);
      }
      // a set that has its ability keeps it
      if (JSON.stringify(filled.teams.p2.map(set => set.ability)) !== JSON.stringify(base.p2.map(set => set.ability))) failures.push(`${id}: the other side's abilities changed`);
    }
    expect(probed).toBeGreaterThan(10);
    expect(failures).toEqual([]);
  }, 600_000);
});
