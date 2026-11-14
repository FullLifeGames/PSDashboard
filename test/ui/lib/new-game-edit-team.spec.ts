import { describe, expect, test } from 'vitest';
import { readTeamPaste } from '../../../src/lib/new-game/start';
import { teamOfInfo } from '../../../src/lib/new-game/edit-team';
import { infoOfTeam } from '../../../src/hooks/useNewGame';

/**
 * Round 89 (lane H, #105), stage H4: Edit Player on a game converts the editor's team info back to the sets the record holds. A
 * team goes to the stats panel's info and back unchanged in every field the simulator plays: species, item, ability, moves,
 * nature, EVs, IVs, level and Tera type.
 */

const TEAM = `Garchomp (M) @ Rocky Helmet
Ability: Rough Skin
Level: 50
Tera Type: Steel
EVs: 252 HP / 4 Def / 252 Spe
Jolly Nature
- Earthquake
- Dragon Tail
- Stealth Rock
- Spikes

Gholdengo @ Choice Scarf
Ability: Good as Gold
Tera Type: Steel
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
IVs: 0 Atk
- Make It Rain
- Shadow Ball
- Trick
- Focus Blast

Clefable
Ability: Magic Guard
- Moonblast
- Moonlight`;

const played = (set: ReturnType<typeof readTeamPaste>['sets'][number]) => ({
  species: set.species, item: set.item, ability: set.ability, moves: set.moves, nature: set.nature, evs: set.evs, ivs: set.ivs,
  level: set.level, teraType: set.teraType, gender: set.gender,
});

describe('a team through the editor and back', () => {
  test('every field the simulator plays comes back as it went in', () => {
    const sets = readTeamPaste(TEAM).sets;
    const back = teamOfInfo(infoOfTeam(sets), sets);
    expect(back.map(played)).toEqual(sets.map(played));
  });

  test('a set keeps the gender of the set it replaces: by place and species, else by species', () => {
    const sets = readTeamPaste(TEAM).sets;
    const info = infoOfTeam(sets);
    expect(teamOfInfo(info, sets)[0].gender).toBe('M');
    expect(teamOfInfo(info)[0].gender).toBe('');
    expect(teamOfInfo({ pokemon: [info.pokemon[2], info.pokemon[0]] }, sets)[1].gender).toBe('M');
  });

  test('an edited move reaches the sets and an empty team gives none', () => {
    const info = infoOfTeam(readTeamPaste(TEAM).sets);
    const edited = { pokemon: info.pokemon.map((pokemon, index) => (index === 0 ? { ...pokemon, moves: [{ ...pokemon.moves[0], name: 'Outrage' }, ...pokemon.moves.slice(1)] } : pokemon)) };
    expect(teamOfInfo(edited)[0].moves[0]).toBe('Outrage');
    expect(teamOfInfo({ pokemon: [] })).toEqual([]);
  });
});
