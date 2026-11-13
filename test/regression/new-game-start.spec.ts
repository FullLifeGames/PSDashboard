import { describe, expect, test } from 'vitest';
import { PRNG, Teams } from '@pkmn/sim';
import { readTeamPaste, seedProblem, startNewGame, startProblem } from '../../src/lib/new-game/start';
import { newGameSeed } from '../../src/lib/new-game/record';

/**
 * Round 89 (lane H, #105), stage H4: what the New game dialog does with its fields. The paste is read as Showdown reads it; the
 * seed is the simulator's own format, checked by its PRNG; Start returns the record at Team Preview, in singles, doubles, VGC
 * and Champions, with the level the format gives.
 */

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
    for (const good of ['1,2,3,4', ' 65535,0,7,300 ', 'gen5,0123456789abcdef', 'GEN5,0123456789ABCDEF']) expect(seedProblem(good), good).toBeNull();
    for (const bad of ['', '1,2,3', '1,2,3,4,5', '1,2,3,65536', '1,2,3,x', 'abc', 'gen5,xyz', 'sodium,00', '-1,2,3,4']) expect(seedProblem(bad), bad).not.toBeNull();
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
});
