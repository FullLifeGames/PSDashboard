import { describe, expect, test } from 'vitest';
import { Battle, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { inferOpponentTeam } from '../src/opponent-inferrer';

/**
 * Round 73 (T230): the opponent lookup by nickname read only `switch` and `drag` lines. An Illusion that ends prints
 * `|replace|p2a: Zoroark|Zoroark, L50, M`, and every move line after it names `p2a: Zoroark`, a name no switch line carried
 * (smogtours-gen7uu-321437: the Zoroark had no move on the sheet). The lookup follows replace lines. Real simulator battles,
 * singles and doubles.
 */

type Format = 'singles' | 'doubles';

const mon = (species: string, ability: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability, moves, nature: 'Serious', gender: '', level: 100,
  evs: { hp: 252, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});
const ZOROARK = mon('Zoroark', 'Illusion', ['Night Daze', 'Flamethrower', 'Sludge Bomb', 'Nasty Plot']);
const HAWLUCHA = mon('Hawlucha', 'Limber', ['Splash']);
const SLOWBRO = mon('Slowbro', 'Regenerator', ['Splash']);
const TOXAPEX = mon('Toxapex', 'Regenerator', ['Tackle', 'Splash']);

function play(format: Format): string {
  const doubles = format === 'doubles';
  // Illusion copies the last member of the team, so Zoroark leads with Hawlucha's looks.
  const p1 = doubles ? [TOXAPEX, TOXAPEX] : [TOXAPEX];
  const p2 = doubles ? [ZOROARK, SLOWBRO, HAWLUCHA] : [ZOROARK, HAWLUCHA];
  const battle = new Battle({
    formatid: toID(`gen7${doubles ? 'doubles' : ''}customgame`) as never, seed: [1, 2, 3, 4],
    p1: { name: 'Alpha', team: Teams.pack(p1.map((body, index) => ({ ...body, name: `${body.species}${index}` }))) },
    p2: { name: 'Beta', team: Teams.pack(p2) },
  });
  if (battle.requestState === 'teampreview') {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  // Turn 1: Zoroark (as Hawlucha) is hit and the Illusion ends. Turns 2 to 4: Zoroark clicks three more moves under its own name.
  const hit = doubles ? 'move 1 1, move 1 1' : 'move 1';
  const clicks = [1, 2, 3, 4].map(index => (doubles ? `move ${index}${index < 4 ? ' 1' : ''}, move 1` : `move ${index}`));
  clicks.forEach(click => {
    expect(battle.choose('p1', hit)).toBe(true);
    expect(battle.choose('p2', click)).toBe(true);
  });
  const lines = battle.log;
  return lines.filter((line, index) => !line.startsWith('|split|') && !lines[index - 1]?.startsWith('|split|')).join('\n');
}

describe('the Zoroark behind an ended Illusion books its moves (T230)', () => {
  for (const format of ['singles', 'doubles'] as const) {
    test(`${format}: the replace line makes the Zoroark name known`, () => {
      const log = play(format);
      expect(log).toMatch(/\|replace\|p2a: Zoroark\|Zoroark/);
      expect(log).toContain('|switch|p2a: Hawlucha|Hawlucha');
      const zoroark = inferOpponentTeam(log, 'p2').pokemon.find(entry => entry.species === 'Zoroark')!;
      const names = zoroark.moves.map(move => move.name);
      // Turn 1 is played under the disguise, so the move of that turn books on the disguised species (a limit, not the fix).
      expect(names).toEqual(expect.arrayContaining(['Flamethrower', 'Sludge Bomb', 'Nasty Plot']));
    });
  }
});
