import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Dex } from '@pkmn/sim';
import { describe, expect, test } from 'vitest';
import { inferOpponentTeam } from '../src/opponent-inferrer';
import { buildTeamsFromReplay } from '../src/team-builder';
import { guessedField } from '../src/team-info';
import type { SpreadCandidate } from '../src/spread-inference';
import type { OpponentTeamInfo, PokemonEvs } from '../src/types';

/**
 * Issue 150, claim 1 (round 89): a body whose EVs the user set plays the nature its info shows. The solver still
 * solves such a body and answers with a nature fitted to its own EVs; joined to the user's EVs, that nature played
 * a spread nobody chose (gen9natdexdraft-2713067801: the panel showed Jolly, the battle played Hardy, Quaquaval tied
 * Cramorant at Speed 269 and lost a coin flip the real game never showed). The decision lives in `editedFields`
 * (`shownNature`) and the panel's overlay keeps the same nature, so one table covers singles and doubles.
 */
const log = readFileSync(join(__dirname, 'fixtures', 'gen9natdexdraft-2713067801.txt'), 'utf-8');
const userEvs: PokemonEvs = { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 };
const solved = (nature: string): Map<string, SpreadCandidate> => new Map([[
  'p1:quaquaval', { evs: { hp: 140, atk: 112, def: 0, spa: 0, spd: 4, spe: 252 }, nature, origin: 'order' } as SpreadCandidate,
]]);

/** The reporter's edit: EVs typed in (manual), the nature the panel showed (guessed Jolly). */
function editedInfo(evsSource: 'manual' | 'revealed', nature: ReturnType<typeof guessedField> | undefined): OpponentTeamInfo {
  const info = inferOpponentTeam(log, 'p1');
  const mon = info.pokemon.find(pokemon => pokemon.species === 'Quaquaval')!;
  mon.evs = { value: { ...userEvs }, source: evsSource };
  if (nature) mon.nature = nature; else delete mon.nature;
  return info;
}
const quaquaval = (info: OpponentTeamInfo, spread: Map<string, SpreadCandidate>) =>
  buildTeamsFromReplay(log, { p1Info: info, inferredSpreads: spread }).p1Team.find(set => set.species === 'Quaquaval')!;

const speedOf = (set: { nature?: string; evs: PokemonEvs; ivs: PokemonEvs }) => {
  const nature = Dex.natures.get(set.nature ?? 'Hardy');
  const base = Math.floor((2 * 85 + set.ivs.spe + Math.floor(set.evs.spe / 4)) + 5);
  return Math.floor(nature.plus === 'spe' ? base * 1.1 : nature.minus === 'spe' ? base * 0.9 : base);
};

describe('a body with set EVs plays the nature its info shows (claim 1 of issue 150)', () => {
  test.each(['manual', 'revealed'] as const)('the solver\'s Hardy never replaces the shown Jolly (%s EVs)', source => {
    const set = quaquaval(editedInfo(source, guessedField('Jolly', undefined, 'fits observed damage')), solved('Hardy'));
    expect(set.nature).toBe('Jolly');
    expect(set.evs).toEqual(userEvs);
    // Cramorant plays Modest 252 Spe at 269: Quaquaval stays strictly ahead, as both turns of the log show.
    expect(speedOf(set as never)).toBe(295);
  });

  test('a nature the user typed still wins', () => {
    const set = quaquaval(editedInfo('manual', { value: 'Adamant', source: 'manual' }), solved('Hardy'));
    expect(set.nature).toBe('Adamant');
  });

  test('a body with no nature in its info keeps the solver\'s answer', () => {
    expect(quaquaval(editedInfo('manual', undefined), solved('Hardy')).nature).toBe('Hardy');
  });

  test('guessed EVs still take the solver\'s nature and EVs together', () => {
    const info = inferOpponentTeam(log, 'p1');
    const mon = info.pokemon.find(pokemon => pokemon.species === 'Quaquaval')!;
    mon.nature = guessedField('Jolly', undefined, 'fits observed damage');
    const set = quaquaval(info, solved('Hardy'));
    expect(set.nature).toBe('Hardy');
    expect(set.evs.hp).toBe(140);
  });
});
