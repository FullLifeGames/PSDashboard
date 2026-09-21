import { test, expect, describe } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import { parseReplayLog } from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '../src/branch-engine';

/**
 * Round 55 (T74): an Encore that lands BEFORE its target moves bends the
 * target's click onto the encored move, and the protocol shows that move
 * ("Koraidon used Protect"), not the click. The rebuild read the line as
 * the choice and sent Protect, which runs at priority +4 BEFORE the Encore.
 * The sim counts an Encore on a target that has already moved one turn
 * longer, so the lock stood a turn too long, and a second Encore on the
 * turn it should have been free failed against the first
 * (gen9vgc2026regi-2629703929: locked t6 to t8 instead of t6 and t7, free
 * t9 to t11 instead of locked). The protocol shows what happened, not what
 * was clicked.
 */

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const mon = (species: string, ability: string, moves: string[], spe: number): PokemonSet => ({
  name: species, species, item: '', ability, moves, nature: 'Serious',
  evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe }, ivs, level: 100, teraType: 'Normal',
});

function rebuild(log: string, p1Team: PokemonSet[], p2Team: PokemonSet[], format: string, targetTurn: number) {
  const snapshots = parseReplayLog(log);
  return reconstructBranchRuntime({
    format, p1Team, p2Team, replayLog: log, targetTurn,
    snapshot: snapshots.find(entry => entry.turn === targetTurn) ?? null,
  });
}

/** Turn 1 Protect, turn 2 the Encore lands first, turns 3 and 4 locked, turn 5 free. */
const encoreTurns = (target: string, user: string) => [
  '|turn|1',
  `|move|${target}: Snorlax|Protect|${target}: Snorlax`,
  `|-singleturn|${target}: Snorlax|Protect`,
  `|move|${user}: Whimsicott|Cotton Guard|${user}: Whimsicott`,
  `|-boost|${user}: Whimsicott|def|3`,
  '|upkeep', '|turn|2',
  `|move|${user}: Whimsicott|Encore|${target}: Snorlax`,
  `|-start|${target}: Snorlax|Encore`,
  `|move|${target}: Snorlax|Protect||[still]`,
  `|-fail|${target}: Snorlax`,
  '|upkeep', '|turn|3',
  `|move|${target}: Snorlax|Protect|${target}: Snorlax`,
  `|-singleturn|${target}: Snorlax|Protect`,
  `|move|${user}: Whimsicott|Cotton Guard|${user}: Whimsicott`,
  `|-boost|${user}: Whimsicott|def|3`,
  '|upkeep', '|turn|4',
  `|move|${target}: Snorlax|Protect||[still]`,
  `|-fail|${target}: Snorlax`,
  `|move|${user}: Whimsicott|Cotton Guard|${user}: Whimsicott`,
  `|-boost|${user}: Whimsicott|def|0`,
  `|-end|${target}: Snorlax|Encore`,
  '|upkeep', '|turn|5',
];

const snorlax = mon('Snorlax', 'Immunity', ['Tackle', 'Protect'], 0);
const whimsicott = mon('Whimsicott', 'Infiltrator', ['Encore', 'Cotton Guard'], 252);

describe('an Encore that lands before its target moves (round 55)', () => {
  test('singles: the lock ends with the protocol, not a turn late', async () => {
    const log = [
      '|gametype|singles', '|player|p1|Alice||', '|player|p2|Bob||', '|gen|9', '|tier|[Gen 9] OU',
      '|poke|p1|Snorlax, M|', '|poke|p2|Whimsicott, F|', '|start',
      '|switch|p1a: Snorlax|Snorlax, M|100/100',
      '|switch|p2a: Whimsicott|Whimsicott, F|100/100',
      ...encoreTurns('p1a', 'p2a'),
    ].join('\n');

    const locked = await rebuild(log, [snorlax], [whimsicott], 'gen9ou', 4);
    const lockedBody = locked.battleStream.battle!.sides[0].active[0]!;
    expect(lockedBody.volatiles['encore']?.move).toBe('protect');
    expect(lockedBody.getMoveRequestData().moves.filter(move => !move.disabled).map(move => move.id)).toEqual(['protect']);

    const free = await rebuild(log, [snorlax], [whimsicott], 'gen9ou', 5);
    const freeBody = free.battleStream.battle!.sides[0].active[0]!;
    expect(!!freeBody.volatiles['encore']).toBe(false);
    expect(freeBody.getMoveRequestData().moves.filter(move => !move.disabled).map(move => move.id)).toEqual(['tackle', 'protect']);
  });

  test('doubles: the same lock on the second slot', async () => {
    const log = [
      '|gametype|doubles', '|player|p1|Alice||', '|player|p2|Bob||', '|gen|9', '|tier|[Gen 9] Doubles OU',
      '|poke|p1|Blissey, F|', '|poke|p1|Snorlax, M|', '|poke|p2|Chansey, F|', '|poke|p2|Whimsicott, F|', '|start',
      '|switch|p1a: Blissey|Blissey, F|100/100',
      '|switch|p1b: Snorlax|Snorlax, M|100/100',
      '|switch|p2a: Chansey|Chansey, F|100/100',
      '|switch|p2b: Whimsicott|Whimsicott, F|100/100',
      ...encoreTurns('p1b', 'p2b'),
    ].join('\n');
    const p1Team = [mon('Blissey', 'Natural Cure', ['Soft-Boiled', 'Seismic Toss'], 0), snorlax];
    const p2Team = [mon('Chansey', 'Natural Cure', ['Soft-Boiled', 'Seismic Toss'], 0), whimsicott];

    const locked = await rebuild(log, p1Team, p2Team, 'gen9doublesou', 4);
    expect(locked.battleStream.battle!.sides[0].active[1]!.volatiles['encore']?.move).toBe('protect');

    const free = await rebuild(log, p1Team, p2Team, 'gen9doublesou', 5);
    expect(!!free.battleStream.battle!.sides[0].active[1]!.volatiles['encore']).toBe(false);
    expect(free.choiceErrors.count).toBe(0);
  });
});
