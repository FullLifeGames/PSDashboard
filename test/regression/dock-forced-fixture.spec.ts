import { describe, expect, test } from 'vitest';
import { parseReplayLog } from '@fulllifegames/replay-core';
import { doublesForcedReplay, doublesReplay } from '../e2e/fixtures/doubles-replay';

/**
 * Round 84 (A7d): the hand-written replay of the e2e case "two forced slots of one side". The replacements in the log are string
 * replacements, so each one is pinned here: a replacement that matches nothing would leave the plain doubles game and the e2e case
 * would wait two minutes for a scene that never arises (the A7c run).
 */
describe('the forced doubles fixture', () => {
  const sheet = (log: string, name: string) => log.split('\n').find(line => line.includes('View team') && line.startsWith(`|c| ${name}`)) ?? '';
  const alice = sheet(doublesForcedReplay.log, 'Alice');

  test('Pikachu and Eevee carry Memento in place of their first move', () => {
    expect(alice).toContain('Pikachu @ Light Ball<br />Ability: Static<br />EVs: 4 HP &#x2f; 252 SpA &#x2f; 252 Spe<br />Timid Nature<br />- Memento<br />- Quick Attack<br />- Protect');
    expect(alice).toContain('Eevee @ Eviolite<br />Ability: Adaptability<br />EVs: 252 Atk &#x2f; 4 SpD &#x2f; 252 Spe<br />Jolly Nature<br />- Memento<br />- Quick Attack<br />- Protect');
    expect(sheet(doublesReplay.log, 'Alice')).not.toContain('Memento');
  });

  test('P1 lists six bodies, four of them on the bench, and the sheet names all six', () => {
    const listed = doublesForcedReplay.log.split('\n').filter(line => line.startsWith('|poke|p1|')).map(line => line.split('|')[3].split(',')[0]);
    expect(listed).toEqual(['Pikachu', 'Eevee', 'Raichu', 'Jolteon', 'Vaporeon', 'Flareon']);
    for (const name of listed) expect(alice, name).toContain(`${name}`);
    expect(alice).toContain('Vaporeon<br />Ability: Water Absorb<br />- Scald<br />- Protect');
    expect(alice).toContain('Flareon<br />Ability: Flash Fire<br />- Flare Blitz<br />- Protect');
  });

  test('P2 and the leads are the plain game\'s, and the log parses to the same turns', () => {
    const p2 = (log: string) => log.split('\n').filter(line => line.startsWith('|poke|p2|') || line.startsWith('|switch|'));
    expect(p2(doublesForcedReplay.log)).toEqual(p2(doublesReplay.log));
    expect(parseReplayLog(doublesForcedReplay.log)).toHaveLength(parseReplayLog(doublesReplay.log).length);
    expect(doublesForcedReplay.id).toBe('gen9doubles-forced-test');
  });
});
