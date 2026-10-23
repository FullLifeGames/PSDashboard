import { test, expect, describe } from 'vitest';
import { Battle as LiveBattle, Teams, type Battle, type PokemonSet } from '@pkmn/sim';
import { parseReplayLogWithObservations } from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { collectForcedSwitchSpecies, getMainChoice, parseTurnBlocks } from '../src/branch/protocol-choices';
import { rulesDex } from '@fulllifegames/replay-core';

/**
 * Round 67 (T133): an Emergency Exit or Wimp Out switch that comes before the
 * holder acts answers the request the ability made. The simulator writes the
 * ability's |-activate| line on the holder, the request break `|`, then the
 * switch. Before, the rebuild read that switch as the side's turn-start
 * choice: the replacement came in first and took the hit meant for the holder.
 */

const mon = (species: string, item: string, ability: string, moves: string[], spe = 0): PokemonSet => ({
  name: species, species, item, ability, moves, nature: 'Serious', gender: '', level: 100,
  evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 0, spe }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

function make(format: string, p1: PokemonSet[], p2: PokemonSet[]): Battle {
  const battle = new LiveBattle({ formatid: format as never, seed: [1, 2, 3, 4], p1: { name: 'A', team: Teams.pack(p1) }, p2: { name: 'B', team: Teams.pack(p2) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

/** The public log: the omniscient |split| secret lines and the sim's timestamps dropped. */
const publicLines = (log: string[]) =>
  log.filter((line, index, all) => !line.startsWith('|split|') && !all[index - 1]?.startsWith('|split|') && !line.startsWith('|t:|'));

/** Plays turn 1 (the holder at `hpShare` of its HP, p1's forced switch answered), then reads it back as the rebuild does. */
function readTurn(format: string, p1: PokemonSet[], p2: PokemonSet[], choices: [string, string], forcedAnswer: string, hpShare: number) {
  const played = make(format, p1, p2);
  const holder = played.sides[0].active[0]!;
  holder.hp = Math.floor(holder.maxhp * hpShare);
  played.choose('p1', choices[0]);
  played.choose('p2', choices[1]);
  if (played.sides[0].requestState === 'switch') played.choose('p1', forcedAnswer);
  const turn = parseTurnBlocks(publicLines(played.log).join('\n')).turns.find(entry => entry.turn === 1)!;
  expect(turn.preUpkeep.some(line => line.startsWith('|-activate|p1a:') && line.includes('ability: '))).toBe(true);
  return {
    forced: collectForcedSwitchSpecies(turn.preUpkeep, turn.postUpkeep, 'p1', rulesDex(9)),
    main: getMainChoice(turn.preUpkeep, 'p1', make(format, p1, p2) as never),
  };
}

const golisopod = mon('Golisopod', 'Leftovers', 'Emergency Exit', ['Liquidation', 'First Impression']);
const corviknight = mon('Corviknight', 'Leftovers', 'Pressure', ['Brave Bird']);
const tauros = mon('Tauros', 'Leftovers', 'Intimidate', ['Body Slam'], 252);

describe('the forced list reads the switch an ability asked for', () => {
  test.each([7, 8, 9])('gen %i: an Emergency Exit switch before the holder acts answers the ability\'s request', gen => {
    const read = readTurn(`gen${gen}customgame`, [golisopod, corviknight], [tauros], ['move liquidation', 'move bodyslam'], 'switch 2', 0.55);
    expect(read.forced).toEqual(['Corviknight']);
    expect(read.main).toMatch(/^move 1\b/);
  });

  test.each([7, 9])('gen %i: Wimp Out does the same', gen => {
    const read = readTurn(`gen${gen}customgame`, [mon('Wimpod', 'Eviolite', 'Wimp Out', ['Struggle Bug']), corviknight],
      [mon('Chansey', 'Eviolite', 'Natural Cure', ['Seismic Toss'], 252)], ['move strugglebug', 'move seismictoss'], 'switch 2', 0.6);
    expect(read.forced).toEqual(['Corviknight']);
    expect(read.main).toMatch(/^move 1\b/);
  });

  test('doubles: the Emergency Exit switch in p1a answers the request, p1b keeps its move', () => {
    const read = readTurn('gen9doublescustomgame',
      [golisopod, mon('Blissey', 'Leftovers', 'Natural Cure', ['Soft-Boiled']), corviknight],
      [tauros, mon('Chansey', 'Eviolite', 'Natural Cure', ['Soft-Boiled'])],
      ['move liquidation 1, move softboiled', 'move bodyslam 1, move softboiled'], 'switch 3, pass', 0.55);
    expect(read.forced).toEqual(['Corviknight']);
    const [holder, partner] = read.main.split(', ');
    expect(holder).toMatch(/^move 1\b/);
    expect(partner).toBe('move 1');
  });

  test('a chosen switch after another ability\'s -activate on the slot stays the side\'s choice', () => {
    const pursued = [
      '|move|p2a: Weavile|Pursuit|p1a: Cofagrigus|[from]Pursuit',
      '|-damage|p1a: Cofagrigus|60/100',
      '|-activate|p1a: Cofagrigus|ability: Mummy|Pressure|[of] p2a: Weavile',
      '|switch|p1a: Ferrothorn|Ferrothorn|100/100',
    ];
    expect(collectForcedSwitchSpecies(pursued, [], 'p1', rulesDex(9))).toEqual([]);
    // Even across a request break: Mummy's Dex entry asks for no switch.
    expect(collectForcedSwitchSpecies([...pursued.slice(0, 3), '|', pursued[3]], [], 'p1', rulesDex(9))).toEqual([]);
  });
});

describe('the rebuild plays the Emergency Exit as the game did', () => {
  test('the replacement comes in on the ability\'s request and the hit lands on the holder', { timeout: 240000 }, async () => {
    const p1 = [mon('Golisopod', 'Leftovers', 'Emergency Exit', ['Liquidation', 'First Impression']), corviknight];
    const p2 = [mon('Rillaboom', 'Choice Band', 'Grassy Surge', ['Drum Beating'], 252)];
    const played = make('gen9customgame', p1, p2);
    played.choose('p1', 'move liquidation');
    played.choose('p2', 'move drumbeating');
    if (played.sides[0].requestState === 'switch') played.choose('p1', 'switch 2');
    const replayLog = publicLines(played.log).join('\n');
    const { snapshots } = parseReplayLogWithObservations(replayLog);
    const runtime = await reconstructBranchRuntime({
      format: 'gen9customgame', p1Team: p1, p2Team: p2, replayLog, targetTurn: 2, snapshot: snapshots[1],
    });
    const lines = publicLines(runtime.battleStream.battle!.log);
    const block = lines.slice(lines.indexOf('|turn|1'));
    expect(runtime.choiceErrors.count).toBe(0);
    expect(block.find(line => line.startsWith('|move|p2a: Rillaboom|Drum Beating|'))?.split('|')[4]).toBe('p1a: Golisopod');
    expect(block.some(line => line.startsWith('|switch|p1a: Corviknight|'))).toBe(true);
  });
});
