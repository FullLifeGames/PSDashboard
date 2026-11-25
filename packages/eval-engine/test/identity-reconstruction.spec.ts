import { describe, expect, test } from 'vitest';
import { buildTeamsFromReplay } from '@fulllifegames/replay-core';
import { entries, lastTurn, play, rebuiltWith, set } from './named-games-support';

function rebuilt(format: string, log: string) {
  const { p1Team, p2Team } = buildTeamsFromReplay(log);
  return rebuiltWith(format, log, p1Team, p2Team);
}

describe('a body whose name has no id or shares it, or breaks a JSON line, comes in as the replay shows it', () => {
  test('doubles: four Japanese names, the leads are the third and the fourth, a bench body comes in', async () => {
    const format = 'gen9doublescustomgame';
    const log = await play(format,
      [set('Blossom', 'Amoonguss'), set('Mouse', 'Pikachu'), set('Sir Bench', 'Incineroar'), set('Thrower', 'Whimsicott')],
      [set('グレンタウン', 'Armarouge'), set('チョコクロワ', 'Indeedee-F'), set('うみのうた', 'Primarina'), set('ワスレイヌ', 'Houndstone')],
      ['>p1 team 1234', '>p2 team 3412', '>p1 move 1 1, move 1 1\n>p2 move 1 1, move 1 1', '>p1 move 1 1, move 1 1\n>p2 switch 3, move 1 1', '>p1 move 1 1, move 1 1\n>p2 move 1 1, move 1 1']);
    expect(log).toMatch(/\|switch\|p2a: うみのうた\|Primarina/);
    const again = await rebuilt(format, log);
    expect(again.entries).toEqual(entries(log));
    expect(again.turn).toBe(lastTurn(log));
    expect(again.errors).toBe(0);
  }, 60_000);

  test('singles: Chinese names and two decorated names of one id, the lead is the fourth, three switches, one name stays', async () => {
    const format = 'gen9customgame';
    const log = await play(format,
      [set('Mouse', 'Pikachu'), set('Clef', 'Clefable')],
      [set('我大哥', 'Garchomp'), set('Rias!', 'Dragapult'), set('Rias?', 'Snorlax'), set('Akeno【‿♥‿】', 'Clefable')],
      ['>p1 team 12', '>p2 team 4231', '>p1 move 1\n>p2 move 1', '>p1 move 1\n>p2 switch 2', '>p1 move 1\n>p2 switch 3', '>p1 move 1\n>p2 switch 4']);
    expect(log).toMatch(/\|switch\|p2a: Akeno【‿♥‿】\|Clefable/);
    const again = await rebuilt(format, log);
    expect(again.entries).toEqual(entries(log));
    expect(again.turn).toBe(lastTurn(log));
    expect(again.errors).toBe(0);
  }, 60_000);

  test('doubles: a backslash and a quote in a name reach the simulator as written', async () => {
    const format = 'gen9doublescustomgame';
    const log = await play(format,
      [set('Blossom', 'Amoonguss'), set('Mouse', 'Pikachu')],
      [set('J36Venom/⌵\\', 'Garchomp'), set('Say "hi"', 'Dragapult'), set('Plain', 'Snorlax')],
      ['>p1 team 12', '>p2 team 123', '>p1 move 1 1, move 1 1\n>p2 move 1 1, move 1 1', '>p1 move 1 1, move 1 1\n>p2 switch 3, move 1 1']);
    expect(log).toMatch(/\|switch\|p2a: J36Venom\/⌵\\\|Garchomp/);
    const again = await rebuilt(format, log);
    expect(again.entries).toEqual(entries(log));
    expect(again.turn).toBe(lastTurn(log));
    expect(again.errors).toBe(0);
  }, 60_000);
});
