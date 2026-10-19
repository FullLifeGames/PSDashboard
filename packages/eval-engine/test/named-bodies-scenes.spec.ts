import { describe, expect, test } from 'vitest';
import { entries, lastTurn, play, rebuiltWith, set } from './named-games-support';

/**
 * Round 72, T238: the lookups of eval-engine/src/branch with the replay's own names in the sets, none left out. The
 * teams are the sets the simulator played the game with, so every name reaches the lookups as the game wrote it: Japanese
 * and Chinese names (the id is ""), two names of one id, one name on two bodies, a decorated name. The rebuilt game must
 * enter every body as the game did, in the same order, with no choice the simulator refuses. Singles and doubles.
 */
async function sameGame(format: string, p1: ReturnType<typeof set>[], p2: ReturnType<typeof set>[], commands: string[]) {
  const log = await play(format, p1, p2, commands);
  const again = await rebuiltWith(format, log, p1, p2);
  expect(again.entries).toEqual(entries(log));
  expect(again.turn).toBe(lastTurn(log));
  expect(again.errors).toBe(0);
  return log;
}

describe('a game rebuilt with every name of the replay in the sets', () => {
  test('doubles: four Japanese names, the leads are the third and the fourth, a bench body comes in', async () => {
    const log = await sameGame('gen9doublescustomgame',
      [set('Blossom', 'Amoonguss'), set('Mouse', 'Pikachu'), set('Sir Bench', 'Incineroar'), set('Thrower', 'Whimsicott')],
      [set('グレンタウン', 'Armarouge'), set('チョコクロワ', 'Indeedee-F'), set('うみのうた', 'Primarina'), set('ワスレイヌ', 'Houndstone')],
      ['>p1 team 1234', '>p2 team 3412', '>p1 move 1 1, move 1 1\n>p2 move 1 1, move 1 1', '>p1 move 1 1, move 1 1\n>p2 switch 3, move 1 1', '>p1 move 1 1, move 1 1\n>p2 move 1 1, move 1 1']);
    expect(log).toMatch(/\|switch\|p2a: うみのうた\|Primarina/);
  }, 60_000);

  test('singles: Chinese names, two decorated names of one id, the lead is the third, three switches', async () => {
    const log = await sameGame('gen9customgame',
      [set('Mouse', 'Pikachu'), set('Clef', 'Clefable')],
      [set('我大哥', 'Garchomp'), set('Rias!', 'Dragapult'), set('Rias?', 'Snorlax'), set('Akeno【‿♥‿】', 'Clefable')],
      ['>p1 team 12', '>p2 team 3241', '>p1 move 1\n>p2 move 1', '>p1 move 1\n>p2 switch 2', '>p1 move 1\n>p2 switch 3', '>p1 move 1\n>p2 switch 4']);
    expect(log).toMatch(/\|switch\|p2a: Rias\?\|Snorlax/);
  }, 60_000);

  test('doubles: one name on two bodies, and Japanese names beside them, each comes in as its own species', async () => {
    const log = await sameGame('gen9doublescustomgame',
      [set('Blossom', 'Amoonguss'), set('Mouse', 'Pikachu')],
      [set('Twin', 'Dragapult'), set('Twin', 'Snorlax'), set('うみのうた', 'Primarina'), set('ワスレイヌ', 'Houndstone')],
      ['>p1 team 12', '>p2 team 2431', '>p1 move 1 1, move 1 1\n>p2 move 1 1, move 1 1', '>p1 move 1 1, move 1 1\n>p2 switch 3, move 1 1']);
    expect(log).toMatch(/\|switch\|p2a: Twin\|Snorlax/);
  }, 60_000);
});
