import { describe, expect, test } from 'vitest';
import { entries, lastTurn, play, rebuiltWith, set } from './named-games-support';

/**
 * Round 72, T238: the stream line that seats a player carries the packed team inside JSON. A name with a backslash or
 * a quote broke that line (`J36Venom/⌵⟧^𓉶^⟦⌵\` of gen9doublesou-2693607366 ended in a backslash that escaped the closing
 * quote), so the side was never seated and the reconstruction died on `requestState` of a null side. The fault is older
 * than the replay's names in the sets: a pasted team or a sheet with such a name reached it as well. The teams here are
 * the sets the simulator played the game with, so the build's choice of names is out of the picture.
 */
describe('a team with a backslash or a quote in a name seats its player', () => {
  test('doubles: names with a backslash, a quote and a trailing backslash on both sides', async () => {
    const format = 'gen9doublescustomgame';
    const p1 = [set('Say "hi"', 'Amoonguss'), set('Mouse\\', 'Pikachu')];
    const p2 = [set('J36Venom/⌵\\', 'Garchomp'), set('Say "hi"', 'Dragapult'), set('Plain', 'Snorlax')];
    const log = await play(format, p1, p2,
      ['>p1 team 12', '>p2 team 123', '>p1 move 1 1, move 1 1\n>p2 move 1 1, move 1 1', '>p1 move 1 1, move 1 1\n>p2 switch 3, move 1 1']);
    expect(log).toMatch(/\|switch\|p2a: J36Venom\/⌵\\\|Garchomp/);
    const again = await rebuiltWith(format, log, p1, p2);
    expect(again.entries).toEqual(entries(log));
    expect(again.turn).toBe(lastTurn(log));
    expect(again.errors).toBe(0);
  }, 60_000);

  test('singles: a name with a backslash and a name with a quote', async () => {
    const format = 'gen9customgame';
    const p1 = [set('Back\\slash', 'Pikachu'), set('Clef', 'Clefable')];
    const p2 = [set('Say "hi"', 'Garchomp'), set('End\\', 'Snorlax')];
    const log = await play(format, p1, p2,
      ['>p1 team 12', '>p2 team 12', '>p1 move 1\n>p2 move 1', '>p1 move 1\n>p2 switch 2']);
    expect(log).toMatch(/\|switch\|p2a: Say "hi"\|Garchomp/);
    const again = await rebuiltWith(format, log, p1, p2);
    expect(again.entries).toEqual(entries(log));
    expect(again.turn).toBe(lastTurn(log));
    expect(again.errors).toBe(0);
  }, 60_000);
});
