import { readFileSync } from 'fs';
import { describe, expect, test } from 'vitest';
import type { ReplayData } from '@fulllifegames/replay-core';
import { loadSimMods } from '../src/forward/sim-mods';
import { deserializeBattleExact } from '../src/forward/serialize';
import { serializeLiveBattle } from '../src/serialize';
import { LoggedRollPRNG } from '../src/branch/logged-rolls';
import { loggedDiceAt, loggedTurnDice } from '../src/dice/turn';
import { dieKey } from '../src/dice/types';
import { branchOf, mon } from './branch-dice-support';
import { reconstruct } from './arrival-turn';

/**
 * Round 82 (forced dice), step A7b: the chips at a viewed replay position. The picker there has a stored exact position, a
 * battle that serialization gave back without the first turn's `LoggedRollPRNG`; the log's dice come from the replay's own
 * lines (`loggedDiceAt`, no seed search). They must name the same dice the arrival reads after a branch started at that turn
 * (`loggedTurnDice`), so a chip reads the same before and after the first click.
 */
await loadSimMods('gen9championsou');

const feedback = (name: string): ReplayData =>
  JSON.parse(readFileSync(new URL(`../../../test/e2e-feedback/fixtures/${name}.json`, import.meta.url), 'utf-8')) as ReplayData;

const SCENES = [
  { kind: 'singles', fixture: 'smogtours-gen8ou-573756', turn: 73 },
  { kind: 'doubles', fixture: 'gen9doublesou-2663093831', turn: 8 },
  { kind: 'vgc', fixture: 'gen9vgc2026regi-2630685175', turn: 9 },
] as const;

const keys = (dice: { name: Parameters<typeof dieKey>[0] }[]): string[] => dice.map(die => dieKey(die.name)).sort();

describe('loggedDiceAt: the log\'s dice at a stored position', () => {
  describe.each(SCENES)('$kind ($fixture t$turn)', ({ fixture, turn }) => {
    test('names the dice the arrival reads, from a battle that serialization gave back', { timeout: 300000 }, async () => {
      const source = feedback(fixture);
      const { replay, runtime } = await reconstruct(fixture, turn, source);
      const live = runtime.battleStream.battle!;
      const expected = loggedTurnDice(live);
      expect(expected.length).toBeGreaterThan(0);
      const stored = deserializeBattleExact(serializeLiveBattle(live));
      expect(stored.prng).not.toBeInstanceOf(LoggedRollPRNG);
      expect(loggedTurnDice(stored)).toEqual([]);
      const dice = loggedDiceAt(stored, replay.log);
      expect(keys(dice)).toEqual(keys(expected));
      expect(dice.map(die => die.result).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
        .toEqual(expected.map(die => die.result).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    });

    test('leaves the battle as it was', { timeout: 300000 }, async () => {
      const source = feedback(fixture);
      const { replay, runtime } = await reconstruct(fixture, turn, source);
      const stored = deserializeBattleExact(serializeLiveBattle(runtime.battleStream.battle!));
      const before = serializeLiveBattle(stored);
      loggedDiceAt(stored, replay.log);
      expect(serializeLiveBattle(stored)).toBe(before);
    });
  });

  test('a position the replay has no turn for shows none', { timeout: 300000 }, async () => {
    const plain = await branchOf('gen9customgame', [mon('Pikachu', ['tackle'])], [mon('Snorlax', ['tackle'])], '1,2,3,4');
    expect(loggedDiceAt(plain.battleStream.battle!, '')).toEqual([]);
    // the same battle one turn on has no block in a log that stops before it
    const source = feedback(SCENES[0].fixture);
    const battle = plain.battleStream.battle!;
    battle.choose('p1', 'move 1');
    battle.choose('p2', 'move 1');
    expect(battle.turn).toBe(2);
    expect(loggedDiceAt(battle, source.log.split('|turn|2')[0])).toEqual([]);
  });
});
