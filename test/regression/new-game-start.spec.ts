import { describe, expect, test } from 'vitest';
import { Dex, PRNG, TeamValidator, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { readTeamPaste, seedProblem, startNewGame, startBlocks, startProblem, stopsStart } from '../../src/lib/new-game/start';
import { newGameSeed } from '../../src/lib/new-game/record';

const TEAM = `Garchomp @ Rocky Helmet
Ability: Rough Skin
EVs: 252 HP / 4 Def / 252 Spe
Jolly Nature
- Earthquake
- Dragon Tail
- Stealth Rock
- Spikes

Gliscor @ Toxic Orb
Ability: Poison Heal
Impish Nature
- Earthquake
- Knock Off
- Spikes
- Protect

Clefable @ Leftovers
Ability: Magic Guard
- Moonblast
- Moonlight
- Calm Mind
- Flamethrower`;

const FOUR = `Garchomp\n- Earthquake\n\nCharizard\n- Flamethrower\n\nTyranitar\n- Crunch\n\nStarmie\n- Surf\n\nSnorlax\n- Return\n\nGengar\n- Shadow Ball`;

describe('the team paste', () => {
  test('reads the sets of a Showdown export in order and counts the blocks without a move line apart', () => {
    const read = readTeamPaste(`${TEAM}\n\nasdf asdf`);
    expect(read.sets.map(set => set.species)).toEqual(['Garchomp', 'Gliscor', 'Clefable']);
    expect(read.skipped).toEqual(['asdfasdf']);
    expect(read.sets[0].moves).toEqual(['Earthquake', 'Dragon Tail', 'Stealth Rock', 'Spikes']);
  });

  test('an empty box reads nothing, and Windows line endings and German stat names read as in the loader', () => {
    expect(readTeamPaste('')).toEqual({ sets: [], skipped: [] });
    const german = readTeamPaste('Garchomp\r\nEVs: 252 KP / 252 Init\r\n- Earthquake');
    expect(german.sets[0].evs).toMatchObject({ hp: 252, spe: 252 });
  });
});

describe('the seed field', () => {
  test('accepts the simulator\'s formats and refuses the rest', () => {
    for (const good of ['1,2,3,4', ' 65535,0,7,300 ', 'gen5,0123456789abcdef', 'GEN5,0123456789ABCDEF', 'sodium,00', 'SODIUM,0123 abcd']) expect(seedProblem(good), good).toBeNull();
    for (const bad of ['', '1,2,3', '1,2,3,4,5', '1,2,3,65536', '1,2,3,x', 'abc', 'gen5,xyz', 'sodium,xyz', '-1,2,3,4']) expect(seedProblem(bad), bad).not.toBeNull();
  });

  test('the simulator takes every accepted seed and every drawn one: 200 fresh seeds, each valid', () => {
    for (let draw = 0; draw < 200; draw += 1) {
      const seed = newGameSeed('fresh');
      expect(seedProblem(seed), seed).toBeNull();
      expect(new PRNG(seed).getSeed()).toBe(seed);
    }
    for (const seed of ['gen5,0123456789abcdef', 'GEN5,0123456789ABCDEF']) {
      expect(new PRNG(seed.toLowerCase()).getSeed()).toMatch(/^\d+,\d+,\d+,\d+$/);
    }
  });
});

// Oracle: a refused ability shows in `validateSet` as "ability <name> ...".
function firstAllowedAbility(format: string, species: string): string {
  const dex = Dex.forFormat(Dex.formats.get(format));
  const slots = dex.species.get(species).abilities as Record<string, string | undefined>;
  const names = (['0', '1', 'H', 'S'] as const).map(slot => slots[slot]).filter((name): name is string => !!name);
  const validator = TeamValidator.get(format);
  const refused = (ability: string) => {
    const set = { name: species, species, item: '', ability, moves: [], nature: 'Hardy', gender: '', evs: {}, ivs: {}, level: 100 } as unknown as PokemonSet;
    return (validator.validateSet(set, {}) ?? []).some(problem => problem.includes(`ability ${ability} `));
  };
  return names.find(name => !refused(name)) ?? names[0];
}

describe('Start', () => {
  test('refuses a side without a set and a bad seed, in the dialog\'s words', () => {
    expect(startProblem({ texts: ['', ''] })).toBe('Paste a team for each player to start.');
    expect(startProblem({ texts: ['', TEAM] })).toBe('Paste a team for Player 1 to start.');
    expect(startProblem({ texts: [TEAM, 'Garchomp'] })).toBe('Paste a team for Player 2 to start.');
    expect(startProblem({ texts: [TEAM, TEAM], seed: '1,2' })).toMatch(/four whole numbers/);
    expect(startProblem({ texts: [TEAM, TEAM], seed: '' })).toBeNull();
    expect(startProblem({ texts: [TEAM, TEAM], seed: '9,9,9,9' })).toBeNull();
    const seven = Array.from({ length: 7 }, (_, index) => `Garchomp\n- Earthquake${' '.repeat(index)}`).join('\n\n');
    expect(startProblem({ texts: [seven, TEAM] })).toMatch(/at most 6/);
  });

  test('one rule names what stops Start by box: a side, the seed, and a species the check refused; the simulator\'s other problems never stop it', () => {
    const seven = Array.from({ length: 7 }, (_, index) => `Garchomp\n- Earthquake${' '.repeat(index)}`).join('\n\n');
    expect(startBlocks({ texts: [TEAM, TEAM] })).toEqual({ teams: [null, null], seed: null });
    expect(startBlocks({ texts: ['', seven] })).toEqual({ teams: ['Paste a team for Player 1 to start.', 'A team holds at most 6 Pokémon.'], seed: null });
    expect(startBlocks({ texts: [TEAM, TEAM], seed: '1,2' }).seed).toMatch(/four whole numbers/);
    const refusal = 'Zzqxvwk is no Pokémon of [Gen 9] OU. Fix the set to start.';
    expect(startBlocks({ texts: [TEAM, TEAM], refused: [null, refusal] }).teams).toEqual([null, refusal]);
    expect(stopsStart(startBlocks({ texts: [TEAM, TEAM], refused: [null, refusal] }))).toBe(true);
    expect(stopsStart(startBlocks({ texts: [TEAM, TEAM], seed: '1,2,3,4' }))).toBe(false);
    expect(startProblem({ texts: [TEAM, seven] })).toBe('A team holds at most 6 Pokémon.');
  });

  const FORMATS: { id: string; name: string; level: number; gameType: 'singles' | 'doubles'; bring: number | null }[] = [
    { id: 'gen9ou', name: '[Gen 9] OU', level: 100, gameType: 'singles', bring: null },
    { id: 'gen9doublesou', name: '[Gen 9] Doubles OU', level: 100, gameType: 'doubles', bring: null },
    { id: 'gen9vgc2025regi', name: '[Gen 9] VGC 2025 Reg I', level: 50, gameType: 'doubles', bring: 4 },
    { id: 'gen9championsou', name: '[Gen 9 Champions] OU', level: 50, gameType: 'singles', bring: null },
    { id: 'gen9championsvgc2026regmc', name: '[Gen 9 Champions] VGC 2026 Reg M-C', level: 50, gameType: 'doubles', bring: 4 },
  ];
  for (const format of FORMATS) {
    test(`${format.name}: both pastes become the record's teams at the format's level, the seed and the names are kept`, async () => {
      const record = await startNewGame({ format: format.id, formatName: format.name, names: ['  ', 'Marrowkid'], texts: [FOUR, FOUR], seed: '5,6,7,8' });
      expect(record.format).toBe(format.id);
      expect(record.formatName).toBe(format.name);
      expect(record.players).toEqual(['Player 1', 'Marrowkid']);
      expect(record.seed).toBe('5,6,7,8');
      expect(record.entries).toEqual([]);
      expect(record.turns).toBe(0);
      expect(record.header.some(line => line.startsWith('|gametype|'))).toBe(true);
      expect(record.header.find(line => line.startsWith('|gametype|'))).toBe(`|gametype|${format.gameType}`);
      expect(record.bringCount).toBe(format.bring);
      expect(record.teams.p1.map(set => set.species)).toEqual(['Garchomp', 'Charizard', 'Tyranitar', 'Starmie', 'Snorlax', 'Gengar']);
      expect(new Set(record.teams.p1.map(set => set.level))).toEqual(new Set([format.level]));
      expect(Teams.pack(record.teams.p1)).not.toBe('');
    }, 60_000);
  }

  test('an empty seed field draws a fresh seed the simulator accepts, a different one each game', async () => {
    const first = await startNewGame({ format: 'gen9ou', formatName: '[Gen 9] OU', names: ['', ''], texts: [TEAM, TEAM], seed: '' });
    const second = await startNewGame({ format: 'gen9ou', formatName: '[Gen 9] OU', names: ['', ''], texts: [TEAM, TEAM] });
    expect(seedProblem(first.seed)).toBeNull();
    expect(first.seed).not.toBe(second.seed);
    expect(first.id).not.toBe(second.id);
  }, 60_000);

  test('the record gets what the box shows: a fresh game has no body and its id names a new game', async () => {
    const record = await startNewGame({ format: 'gen9ou', formatName: '[Gen 9] OU', names: ['Ann', 'Bo'], texts: [TEAM, TEAM], seed: '1,2,3,4' });
    expect(record.id).toMatch(/^newgame-[0-9a-z]{10}$/);
    expect(record.body).toEqual([]);
  }, 60_000);

  for (const [label, format, formatName, gen] of [
    ['singles', 'gen9ou', '[Gen 9] OU', 9], ['doubles', 'gen9doublesou', '[Gen 9] Doubles OU', 9], ['VGC', 'gen9vgc2025regi', '[Gen 9] VGC 2025 Reg I', 9],
    ['Champions', 'gen9championsou', '[Gen 9 Champions] OU', 9], ['a Custom Game', 'gen9customgame', '[Gen 9] Custom Game', 9], ['an older generation', 'gen4ou', '[Gen 4] OU', 4], ['a generation without abilities', 'gen2ou', '[Gen 2] OU', 2],
  ] as const) {
    test(`${label}: a set without an ability is saved with the species' first ability (${formatName})`, async () => {
      const record = await startNewGame({ format, formatName, names: ['Ann', 'Bo'], texts: [FOUR, TEAM], seed: '1,2,3,4' });
      for (const set of record.teams.p1) {
        expect(set.ability ?? '', `${set.species} in ${format}`).toBe(gen >= 3 ? firstAllowedAbility(format, set.species) : '');
      }
      expect(record.teams.p2.map(set => set.ability)).toEqual(readTeamPaste(TEAM).sets.map(set => set.ability));
    }, 60_000);
  }
});
