import { test, expect, describe } from 'vitest';
import type { PokemonSet } from '@pkmn/sim';
import { parseReplayLog } from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { getMainChoice, parseTurnBlocks } from '../src/branch/protocol-choices';

/**
 * Round 55 (T70): a locked doubles slot (recharge, the release turn of Fly,
 * a continued rampage) answers a request with one entry and NO `target`.
 * The rebuild read the target type from `moveSlots[0]` or the Dex, hung a
 * target loc on the locked slot (`move 1 +1`), and the sim rejected the
 * whole side choice ("You can't choose a target for recharge"). The rebuild
 * then sent `default`, and the PARTNER played its first move instead of its
 * protocol move: 15 turns in 14 of 681 doubles replays of the fit corpus.
 * Singles never carries a loc and stays as it was.
 */

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const evs = { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const mon = (species: string, ability: string, moves: string[], teraType: string): PokemonSet => ({
  name: species, species, item: '', ability, moves, nature: 'Serious', evs, ivs, level: 100, teraType,
});

const doublesHead = (secondName: string, secondDetails: string) => [
  '|gametype|doubles', '|player|p1|Alice||', '|player|p2|Bob||', '|gen|9', '|tier|[Gen 9] Doubles OU',
  '|poke|p1|Blissey, F|', `|poke|p1|${secondDetails}|`, '|poke|p2|Chansey, F|', '|poke|p2|Happiny, F|', '|start',
  '|switch|p1a: Blissey|Blissey, F|100/100',
  `|switch|p1b: ${secondName}|${secondDetails}|100/100`,
  '|switch|p2a: Chansey|Chansey, F|100/100',
  '|switch|p2b: Happiny|Happiny, F|100/100',
];

const p2Doubles = [
  mon('Chansey', 'Natural Cure', ['Seismic Toss', 'Soft-Boiled'], 'Fairy'),
  mon('Happiny', 'Natural Cure', ['Seismic Toss', 'Pound'], 'Fairy'),
];

function rebuild(log: string, p1Team: PokemonSet[], p2Team: PokemonSet[], format: string, targetTurn: number) {
  const snapshots = parseReplayLog(log);
  return reconstructBranchRuntime({
    format, p1Team, p2Team, replayLog: log, targetTurn,
    snapshot: snapshots.find(entry => entry.turn === targetTurn) ?? null,
  });
}

async function composedAndPlayed(log: string, p1Team: PokemonSet[], p2Team: PokemonSet[], format: string) {
  const boundary = await rebuild(log, p1Team, p2Team, format, 2);
  const block = parseTurnBlocks(log).turns.find(turn => turn.turn === 2)!;
  const composed = getMainChoice(block.preUpkeep, 'p1', boundary.battleStream.battle!);
  const runtime = await rebuild(log, p1Team, p2Team, format, 3);
  return { composed, runtime };
}

describe('a locked slot carries no target loc (round 55)', () => {
  test('doubles recharge: the partner plays its protocol move', async () => {
    const log = [
      ...doublesHead('Snorlax', 'Snorlax, M'),
      '|turn|1',
      '|move|p1b: Snorlax|Hyper Beam|p2a: Chansey',
      '|-damage|p2a: Chansey|70/100',
      '|-mustrecharge|p1b: Snorlax',
      '|move|p1a: Blissey|Seismic Toss|p2b: Happiny',
      '|-damage|p2b: Happiny|80/100',
      '|upkeep', '|turn|2',
      '|cant|p1b: Snorlax|recharge',
      '|move|p1a: Blissey|Soft-Boiled|p1a: Blissey',
      '|-heal|p1a: Blissey|100/100',
      '|move|p2a: Chansey|Seismic Toss|p1a: Blissey',
      '|-damage|p1a: Blissey|90/100',
      '|upkeep', '|turn|3',
    ].join('\n');
    const p1Team = [
      mon('Blissey', 'Natural Cure', ['Seismic Toss', 'Soft-Boiled'], 'Fairy'),
      mon('Snorlax', 'Immunity', ['Hyper Beam', 'Rest'], 'Water'),
    ];

    const { composed, runtime } = await composedAndPlayed(log, p1Team, p2Doubles, 'gen9doublesou');
    const blissey = runtime.battleStream.battle!.sides[0].pokemon.find(p => p.species.name === 'Blissey')!;
    expect(composed).toBe('move 2, move 1');
    expect(runtime.choiceErrors.count).toBe(0);
    expect(blissey.lastMove?.id).toBe('softboiled');
  });

  test('doubles Fly release: the |move| branch drops the loc too', async () => {
    const log = [
      ...doublesHead('Corviknight', 'Corviknight, M'),
      '|turn|1',
      '|move|p1b: Corviknight|Fly||[still]',
      '|-prepare|p1b: Corviknight|Fly',
      '|move|p1a: Blissey|Seismic Toss|p2b: Happiny',
      '|-damage|p2b: Happiny|80/100',
      '|upkeep', '|turn|2',
      '|move|p1b: Corviknight|Fly|p2a: Chansey|[from]lockedmove',
      '|-damage|p2a: Chansey|85/100',
      '|move|p1a: Blissey|Soft-Boiled|p1a: Blissey',
      '|-heal|p1a: Blissey|100/100',
      '|upkeep', '|turn|3',
    ].join('\n');
    const p1Team = [
      mon('Blissey', 'Natural Cure', ['Seismic Toss', 'Soft-Boiled'], 'Fairy'),
      mon('Corviknight', 'Pressure', ['Fly', 'Roost'], 'Steel'),
    ];

    const { composed, runtime } = await composedAndPlayed(log, p1Team, p2Doubles, 'gen9doublesou');
    const blissey = runtime.battleStream.battle!.sides[0].pokemon.find(p => p.species.name === 'Blissey')!;
    expect(composed).toBe('move 2, move 1');
    expect(runtime.choiceErrors.count).toBe(0);
    expect(blissey.lastMove?.id).toBe('softboiled');
  });

  test('singles recharge never carried a loc', async () => {
    const log = [
      '|gametype|singles', '|player|p1|Alice||', '|player|p2|Bob||', '|gen|9', '|tier|[Gen 9] OU',
      '|poke|p1|Snorlax, M|', '|poke|p1|Blissey, F|', '|poke|p2|Chansey, F|', '|poke|p2|Happiny, F|', '|start',
      '|switch|p1a: Snorlax|Snorlax, M|100/100',
      '|switch|p2a: Chansey|Chansey, F|100/100',
      '|turn|1',
      '|move|p1a: Snorlax|Hyper Beam|p2a: Chansey',
      '|-damage|p2a: Chansey|70/100',
      '|-mustrecharge|p1a: Snorlax',
      '|move|p2a: Chansey|Soft-Boiled|p2a: Chansey',
      '|-heal|p2a: Chansey|100/100',
      '|upkeep', '|turn|2',
      '|cant|p1a: Snorlax|recharge',
      '|move|p2a: Chansey|Seismic Toss|p1a: Snorlax',
      '|-damage|p1a: Snorlax|90/100',
      '|upkeep', '|turn|3',
    ].join('\n');
    const p1Team = [
      mon('Snorlax', 'Immunity', ['Hyper Beam', 'Rest'], 'Water'),
      mon('Blissey', 'Natural Cure', ['Seismic Toss', 'Soft-Boiled'], 'Fairy'),
    ];

    const { composed, runtime } = await composedAndPlayed(log, p1Team, p2Doubles, 'gen9ou');
    expect(composed).toBe('move 1');
    expect(runtime.choiceErrors.count).toBe(0);
  });
});
