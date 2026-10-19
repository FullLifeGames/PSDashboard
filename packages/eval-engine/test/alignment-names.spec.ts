import { readFileSync } from 'fs';
import { test, expect, describe } from 'vitest';
import { Battle as LiveBattle, Teams, type Battle, type PokemonSet } from '@pkmn/sim';
import {
  buildTeamsFromReplay, getBranchSimulatorFormat, parseReplayLog, parseReplayLogWithObservations, replayBringOnly,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';
import { extractProtocolEvents, scoreAlignment } from '../src/hax-alignment';

/**
 * Round 67 (G4): the hax alignment reads the protocol with the sim's names.
 * The protocol names a body by its nickname, the sim by its set's name (the
 * base species for built teams); keyed by name, a nicknamed body's faint
 * never met the sim's, and a trial in which it lived scored better than one
 * in which it fainted as in the game (751543 t19: Draco Meteor's miss was
 * chosen, Landorus lived and taunted Dragapult).
 * Round 72 (T238): the build names every set as the protocol names its body, so the sim's names are the protocol's
 * and the alignment reads the block's lines as they are (the translator, protocol-names.ts, is gone).
 */

type Replay = { id: string; format: string; formatid?: string; players: string[]; log: string };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8')) as Replay;

const mon = (species: string, moves: string[]): PokemonSet => ({
  name: species, species, item: '', ability: 'No Ability', moves, nature: 'Serious', gender: '', level: 100,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

function make(format: string, p1: PokemonSet[], p2: PokemonSet[]): Battle {
  const battle = new LiveBattle({ formatid: format as never, seed: [1, 2, 3, 4], p1: { name: 'A', team: Teams.pack(p1) }, p2: { name: 'B', team: Teams.pack(p2) } });
  if (battle.sides.some(side => side.requestState === 'teampreview')) {
    battle.choose('p1', `team ${p1.map((_, index) => index + 1).join('')}`);
    battle.choose('p2', `team ${p2.map((_, index) => index + 1).join('')}`);
  }
  return battle;
}

describe('the simulator\'s body names are the protocol\'s names', () => {
  const log = [
    '|showteam|p1|Landorus-Therian||Leftovers|Intimidate|Taunt|||M|||100|]Dragonite||HeavyDutyBoots|Multiscale|IceSpinner|||F|||100|',
    '|switch|p1a: Last Regrets|Landorus-Therian, M|100/100',
    '|switch|p2b: kanye|Incineroar, M|100/100',
  ].join('\n');

  test('the built sets carry the nicknames the lines show, so the events keyed by name meet', () => {
    const { p1Team, p2Team } = buildTeamsFromReplay(log);
    const battle = make('gen9customgame', p1Team, p2Team);
    expect(battle.sides[0].pokemon.map(body => body.name)).toEqual(['Last Regrets', 'Dragonite']);
    expect(battle.sides[1].pokemon.map(body => body.name)).toEqual(['kanye']);
  });

  test.each([
    ['gen9customgame', 'p1a'],
    ['gen9doublescustomgame', 'p1b'],
  ])('%s: a nicknamed faint meets the sim\'s faint of the same body', (format, slot) => {
    const { p1Team } = buildTeamsFromReplay(log.replace('p1a: Last Regrets', `${slot}: Last Regrets`));
    const battle = make(format, [mon('Gholdengo', ['Nasty Plot']), ...p1Team.filter(set => set.species === 'Landorus-Therian')], [mon('Dragapult', ['Draco Meteor']), mon('Clefable', ['Moonblast'])]);
    expect(battle.sides[0].pokemon[1].name).toBe('Last Regrets');
    const protocol = [
      `|move|p2a: Dragapult|Draco Meteor|${slot}: Last Regrets`, `|-damage|${slot}: Last Regrets|0 fnt`,'|-unboost|p2a: Dragapult|spa|2', `|faint|${slot}: Last Regrets`,
    ];
    // The sim's lines name the body as the set does, the protocol as the player did: the same words.
    const sim = protocol.map(line => line.replaceAll('Last Regrets', battle.sides[0].pokemon[1].name));
    expect(scoreAlignment(extractProtocolEvents(protocol), extractProtocolEvents(sim))).toEqual({ endedMismatch: false, faintMismatches: 0, softMismatches: 0 });
    // A set under the species' own name (as the build made it before round 72) does not meet the protocol's name.
    const plain = make(format, [mon('Gholdengo', ['Nasty Plot']), mon('Landorus-Therian', ['Taunt'])], [mon('Dragapult', ['Draco Meteor']), mon('Clefable', ['Moonblast'])]);
    expect(plain.sides[0].pokemon[1].name).toBe('Landorus');
    expect(scoreAlignment(extractProtocolEvents(protocol), extractProtocolEvents(protocol.map(line => line.replaceAll('Last Regrets', 'Landorus')))).faintMismatches).toBe(2);
  });
});

describe('scene: 751543, the alignment keeps the KO the game had', () => {
  test('block 19 aligns, and Dragapult carries no Taunt at boundary 20', { timeout: 240000 }, async () => {
    const replay = fixture('smogtours-gen9ou-751543.json');
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
    const snapshotFor = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
    let dragapultTaunted: boolean | null = null;
    const runtime = await reconstructBranchRuntime({
      format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log,
      bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
      targetTurn: 21, snapshot: snapshotFor(21),
      choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
      capturePositions: {
        snapshotFor,
        onPosition: (turn, battle) => {
          if (turn === 20 && dragapultTaunted === null) dragapultTaunted = 'taunt' in battle.sides[1].active[0]!.volatiles;
        },
      },
    });
    expect(runtime.haxAlignment.find(record => record.turn === 19)?.trialPerfect).toBe(true);
    expect(dragapultTaunted).toBe(false);
  });
});

describe('scene: doubles 912884, Bleakwind Storm KOs the nicknamed Ting-Lu', () => {
  test('block 7 aligns, and the sim plays JOHN PEEL\'s faint', { timeout: 240000 }, async () => {
    const replay = fixture('smogtours-gen9doublesou-912884.json');
    const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders });
    const snapshotFor = (turn: number) => snapshots[Math.min(turn - 1, snapshots.length - 1)] ?? null;
    const runtime = await reconstructBranchRuntime({
      format: getBranchSimulatorFormat(replay), p1Team, p2Team, replayLog: replay.log,
      bringOnly: replayBringOnly(replay, parseReplayLog(replay.log)) ?? undefined,
      targetTurn: 8, snapshot: snapshotFor(8),
      choiceLocks: buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations),
      capturePositions: { snapshotFor, onPosition: () => {} },
    });
    const log = runtime.battleStream.battle!.log;
    const block = log.slice(log.lastIndexOf('|turn|7') + 1, log.lastIndexOf('|turn|8'));
    expect(runtime.haxAlignment.find(record => record.turn === 7)?.trialPerfect).toBe(true);
    expect(block.some(line => line.startsWith('|faint|p2') && line.includes(': JOHN PEEL'))).toBe(true);
  });
});
