import { describe, expect, test, beforeAll } from 'vitest';
import { Battle, PRNG, Dex } from '@pkmn/sim';
import { readGameSeed, checkGameTeams, loadSimMods, startGameLog } from '../src/index';
import type { PokemonSet } from '@pkmn/sim';
import { legalTeams } from './new-game-teams';

/**
 * Round 89 (lane H, #105, stage H4b; user ruling 13.11.2026): the seed a new game starts on is set by hand in the dialog, so the
 * engine decides which texts are a seed. The simulator is the oracle: every seed it draws passes and rolls the same dice from the
 * normalized text; a text the simulator would take but never draws (a number above 65535) is refused on purpose (D-E2).
 */

describe('readGameSeed', () => {
  test('the simulator\'s own draws pass unchanged and roll the same first dice from the normalized seed', () => {
    for (let draw = 0; draw < 1000; draw += 1) {
      const text = PRNG.generateSeed();
      const read = readGameSeed(text);
      expect(read).toEqual({ seed: text });
      expect(new PRNG(text).random(1000)).toBe(new PRNG((read as { seed: string }).seed).random(1000));
    }
  });

  test('spaces and capital letters are dropped, so a pasted seed reads like a typed one', () => {
    expect(readGameSeed(' 1, 2 ,3,\t4 ')).toEqual({ seed: '1,2,3,4' });
    expect(readGameSeed('SODIUM,00AB')).toEqual({ seed: 'sodium,00ab' });
    expect(readGameSeed('Gen5,0123456789ABCDEF')).toEqual({ seed: 'gen5,0123456789abcdef' });
  });

  test('a sodium seed of 1 to 64 hex digits passes and a battle started on it keeps it as its starting seed', () => {
    const text = `sodium,${'0123456789abcdef'.repeat(2)}`;
    expect(readGameSeed(text)).toEqual({ seed: text });
    const battle = new Battle({ formatid: 'gen9customgame' as never, seed: text as never, p1: { team: [{ species: 'Pikachu', moves: ['splash'] } as never] }, p2: { team: [{ species: 'Pikachu', moves: ['splash'] } as never] } } as never);
    expect(battle.prng.startingSeed).toBe(text);
    expect(readGameSeed('sodium,a')).toEqual({ seed: 'sodium,a' });
    expect(readGameSeed(`sodium,${'f'.repeat(64)}`)).toEqual({ seed: `sodium,${'f'.repeat(64)}` });
  });

  test.each([
    ['an empty field', ''],
    ['three numbers', '1,2,3'],
    ['five numbers', '1,2,3,4,5'],
    ['a number above 65535 (the simulator takes it, never draws it)', '70000,1,2,3'],
    ['a negative number', '-1,2,3,4'],
    ['a fraction', '1.5,2,3,4'],
    ['words', 'abc'],
    ['a sodium seed without digits', 'sodium,'],
    ['a sodium seed of 65 digits', `sodium,${'a'.repeat(65)}`],
    ['a sodium seed with a letter beyond f', 'sodium,xyz'],
    ['a gen5 seed of 15 digits', `gen5,${'a'.repeat(15)}`],
  ])('%s is refused with a problem that names the forms', (_what, text) => {
    const read = readGameSeed(text);
    expect(read).toHaveProperty('problem');
    expect((read as { problem: string }).problem).toMatch(/four whole numbers/);
    expect((read as { problem: string }).problem).toMatch(/sodium/);
  });
});

describe('new-game-refused', () => {
  const FORMATS = ['gen9ou', 'gen9doublesou', 'gen9vgc2025regi', 'gen9championsou', 'gen9championsvgc2026regmc'];
  const UNKNOWN = 'Zzqxvwk';

  beforeAll(async () => {
    await loadSimMods('gen9championsou');
  }, 60_000);

  describe('the refusal of an unknown species, per side', () => {
    for (const id of FORMATS) {
      test(`${id}: the check names what Start refuses, and a known side has none`, async () => {
        const base = legalTeams(id);
        if ('problems' in base) throw new Error(`${id} has no legal team`);
        const bad: PokemonSet[] = [{ ...base.p2[0], species: UNKNOWN, name: UNKNOWN }, ...base.p2.slice(1)];
        const checked = await checkGameTeams(id, { p1: base.p1, p2: bad });
        expect(checked.refused).toEqual({ p1: null, p2: `${UNKNOWN} is no Pokémon of ${Dex.formats.get(id).name}. Fix the set to start.` });
        const started = await startGameLog({ format: id, p1Team: base.p1, p2Team: bad }).then(() => 'started', (error: Error) => error.message);
        expect(started).toBe(checked.refused.p2);
        expect((await checkGameTeams(id, base)).refused).toEqual({ p1: null, p2: null });
      }, 60_000);
    }
  });
});
