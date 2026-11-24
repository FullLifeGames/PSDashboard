import { test, expect, describe } from 'vitest';
import { Battle, Teams, Battle as LiveBattle, type PokemonSet } from '@pkmn/sim';
import {
  extractProtocolEvents,
  scoreAlignment,
  compareAlignment,
  isPerfectAlignment,
  summarizeAlignment,
  ALIGNMENT_SEEDS,
  chooseAlignedSeed,
  type AlignmentScore,
  type TurnAlignmentRecord,
} from '../src/hax-alignment';
import { serializeBattleStable, trialAdvanceLog } from '../src/forward-model';
import { readFileSync } from 'node:fs';
import {
  buildTeamsFromReplay,
  getBranchSimulatorFormat,
  parseReplayLog,
  parseReplayLogWithObservations,
  replayBringOnly,
} from '@fulllifegames/replay-core';
import { buildChoiceLockContext } from '../src/choice-lock';
import { reconstructBranchRuntime } from '../src/branch-engine';

describe('extractProtocolEvents', () => {
  test('reads faints, win, and normalizes idents without slot letters', () => {
    const events = extractProtocolEvents([
      '|move|p1a: Sweeper|Ice Beam|p2a: Wall',
      '|faint|p2a: Wall',
      '|win|Alice',
    ]);
    expect([...events.faints]).toEqual(['p2:wall']);
    expect(events.ended).toBe(true);
    expect(events.winner).toBe('Alice');
    expect(events.moveOrder).toEqual(['p1:sweeper:icebeam']);
  });

  test('attributes |-miss| to the source\'s preceding move and reads [miss] tags', () => {
    const events = extractProtocolEvents([
      '|move|p1a: Keldeo|Hydro Pump|p2a: Chansey',
      '|-miss|p1a: Keldeo|p2a: Chansey',
      '|move|p2a: Chansey|Seismic Toss|p1a: Keldeo|[miss]',
    ]);
    expect(events.misses.get('p1:keldeo:hydropump')).toBe(1);
    expect(events.misses.get('p2:chansey:seismictoss')).toBe(1);
  });

  test('reads crits, secondaries, hitcounts, cant reasons, confusion self-hits', () => {
    const events = extractProtocolEvents([
      '|move|p1a: Cinccino|Tail Slap|p2a: Skarmory',
      '|-crit|p2a: Skarmory',
      '|-hitcount|p2a: Skarmory|4',
      '|move|p2a: Skarmory|Body Press|p1a: Cinccino',
      '|-status|p1a: Cinccino|par',
      '|-boost|p2a: Skarmory|def|1',
      '|cant|p1a: Cinccino|par',
      '|-activate|p1a: Cinccino|confusion',
      '|-damage|p1a: Cinccino|120/241|[from] confusion',
    ]);
    expect(events.crits.get('p2:skarmory')).toBe(1);
    expect(events.hitCounts.get('p2:skarmory:4')).toBe(1);
    expect(events.secondaries.get('p1:cinccino:status:par')).toBe(1);
    expect(events.secondaries.get('p2:skarmory:boost:def:1')).toBe(1);
    expect(events.cants.get('p1:cinccino:par')).toBe(1);
    expect(events.confusionSelfHits.get('p1:cinccino')).toBe(1);
  });

  test('skips |split| secret lines so sim logs score like replay logs', () => {
    const events = extractProtocolEvents([
      '|split|p2',
      '|-damage|p2a: Wall|187/324|[from] confusion',   // secret (absolute HP)
      '|-damage|p2a: Wall|58/100|[from] confusion',    // public
    ]);
    expect(events.confusionSelfHits.get('p2:wall')).toBe(1);
  });
});

describe('scoreAlignment + compareAlignment', () => {
  const block = (lines: string[]) => extractProtocolEvents(lines);

  test('extra sim event counts exactly like a missing one (symmetry)', () => {
    const expected = block(['|move|p1a: A|Scald|p2a: B']);
    const critTrial = block(['|move|p1a: A|Scald|p2a: B', '|-crit|p2a: B']);
    const forward = scoreAlignment(expected, critTrial);
    const backward = scoreAlignment(critTrial, expected);
    expect(forward.softMismatches).toBe(1);
    expect(backward.softMismatches).toBe(1);
  });

  test('a faint mismatch dominates any soft count; ended dominates faints', () => {
    const oneFaint: AlignmentScore = { endedMismatch: false, faintMismatches: 1, softMismatches: 0 };
    const manySoft: AlignmentScore = { endedMismatch: false, faintMismatches: 0, softMismatches: 99 };
    const endedOnly: AlignmentScore = { endedMismatch: true, faintMismatches: 0, softMismatches: 0 };
    expect(compareAlignment(manySoft, oneFaint)).toBeLessThan(0);
    expect(compareAlignment(oneFaint, endedOnly)).toBeLessThan(0);
    expect(compareAlignment(oneFaint, { ...oneFaint })).toBe(0);
  });

  test('deterministic secondaries (Dragon Dance both sides) cancel out', () => {
    const lines = ['|move|p1a: Mence|Dragon Dance|p1a: Mence', '|-boost|p1a: Mence|atk|1', '|-boost|p1a: Mence|spe|1'];
    const score = scoreAlignment(block(lines), block(lines));
    expect(isPerfectAlignment(score)).toBe(true);
  });

  test('move order differs only among common movers (speed tie signal)', () => {
    const expected = block(['|move|p1a: A|Tackle|p2a: B', '|move|p2a: B|Tackle|p1a: A']);
    const flipped = block(['|move|p2a: B|Tackle|p1a: A', '|move|p1a: A|Tackle|p2a: B']);
    expect(scoreAlignment(expected, flipped).softMismatches).toBe(1);
    const oneSided = block(['|move|p1a: A|Tackle|p2a: B']);
    expect(scoreAlignment(expected, oneSided).softMismatches).toBeGreaterThan(0);
  });
});

describe('seed list + summary', () => {
  test('ALIGNMENT_SEEDS pins 16 distinct seeds with legacy continuity at index 0', () => {
    expect(ALIGNMENT_SEEDS.length).toBe(16);
    expect(ALIGNMENT_SEEDS[0]).toBe('1,2,3,4');
    expect(new Set(ALIGNMENT_SEEDS).size).toBe(16);
  });

  test('summarizeAlignment aggregates perfect/soft/faint/ended', () => {
    const record = (actual: AlignmentScore, turn: number): TurnAlignmentRecord => ({
      turn, seed: '1,2,3,4', trialPerfect: false, trialsFailed: 0, candidatesTried: 1, actual,
    });
    const summary = summarizeAlignment([
      record({ endedMismatch: false, faintMismatches: 0, softMismatches: 0 }, 1),
      record({ endedMismatch: false, faintMismatches: 0, softMismatches: 2 }, 2),
      record({ endedMismatch: true, faintMismatches: 1, softMismatches: 0 }, 3),
    ]);
    expect(summary).toEqual({ turns: 3, perfectTurns: 1, softResidual: 2, faintResidualTurns: 1, endedMismatches: 1 });
  });

  test('summarizeAlignment counts the forced turns that play under another seed, apart from the fallback turns', () => {
    const perfect: AlignmentScore = { endedMismatch: false, faintMismatches: 0, softMismatches: 0 };
    const record = (turn: number, seed: string, via: 'forced' | 'fallback'): TurnAlignmentRecord => ({
      turn, seed: seed as never, via, trialPerfect: false, trialsFailed: 0, candidatesTried: 0, actual: perfect,
    });
    const summary = summarizeAlignment([
      record(1, '1,2,3,4', 'forced'), record(2, '5,9,13,17', 'forced'), record(3, '2,4,6,8', 'forced'), record(4, '5,9,13,17', 'fallback'),
    ]);
    expect(summary.seededTurns).toBe(2);
    expect(summary.fallbackTurns).toBe(1);
    expect(summarizeAlignment([record(1, '1,2,3,4', 'forced')]).seededTurns).toBeUndefined();
  });
});

function makeSet(species: string, moves: string[], extras: Partial<PokemonSet> = {}): PokemonSet {
  return {
    name: species, species, item: '', ability: 'Pressure', gender: '',
    nature: 'Hardy', level: 100,
    evs: { hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    moves, ...extras,
  } as PokemonSet;
}

function hydroPosition(): { serialized: string } {
  const battle = new Battle({
    formatid: 'gen9customgame' as never,
    seed: '9,8,7,6',
    p1: { name: 'p1', team: Teams.pack([makeSet('Keldeo', ['hydropump'], { ability: 'Justified' })]) },
    p2: { name: 'p2', team: Teams.pack([makeSet('Blissey', ['softboiled'], { ability: 'Natural Cure' })]) },
  });
  battle.choose('p1', 'team 1');
  battle.choose('p2', 'team 1');
  return { serialized: serializeBattleStable(battle) };
}

describe('trialAdvanceLog', () => {
  test('returns only the lines this advance emitted', () => {
    const result = trialAdvanceLog(hydroPosition(), 'move 1', 'move 1', ALIGNMENT_SEEDS[0]);
    expect(result.log.length).toBeGreaterThan(0);
    expect(result.log.some(line => line.startsWith('|move|p1a: Keldeo|Hydro Pump'))).toBe(true);
    expect(result.log.some(line => line.startsWith('|start'))).toBe(false);
  });

  test('the pinned seed list spreads an 80%-accuracy roll both ways', () => {
    const position = hydroPosition();
    const outcomes = ALIGNMENT_SEEDS.map(seed => {
      const trial = trialAdvanceLog(position, 'move 1', 'move 1', seed);
      return extractProtocolEvents(trial.log).misses.size > 0 ? 'miss' : 'hit';
    });
    // Both outcomes must be reachable within the list, or the pinned list cannot align accuracy rolls.
    expect(new Set(outcomes).size).toBe(2);
  });

  test('identical inputs are bit-deterministic', () => {
    const position = hydroPosition();
    const a = trialAdvanceLog(position, 'move 1', 'move 1', ALIGNMENT_SEEDS[3]);
    const b = trialAdvanceLog(position, 'move 1', 'move 1', ALIGNMENT_SEEDS[3]);
    expect(a.log.filter(line => !line.startsWith('|t:|')))
      .toEqual(b.log.filter(line => !line.startsWith('|t:|')));
  });
});

describe('chooseAlignedSeed', () => {
  const missBlock = [
    '|move|p1a: Keldeo|Hydro Pump|p2a: Blissey',
    '|-miss|p1a: Keldeo|p2a: Blissey',
  ];
  const hitBlock = ['|move|p1a: Keldeo|Hydro Pump|p2a: Blissey'];

  test('candidate-0 fast path: a perfect first trial ends the search', () => {
    let calls = 0;
    const choice = chooseAlignedSeed({
      expected: extractProtocolEvents(missBlock),
      trial: () => { calls++; return { log: missBlock }; },
    });
    expect(choice.seed).toBe('1,2,3,4');
    expect(choice.trialPerfect).toBe(true);
    expect(choice.candidatesTried).toBe(1);
    expect(calls).toBe(1);
  });

  test('searches until the first perfect candidate and stops there', () => {
    const perfectAt = ALIGNMENT_SEEDS[4];
    const choice = chooseAlignedSeed({
      expected: extractProtocolEvents(missBlock),
      trial: seed => ({ log: seed === perfectAt ? missBlock : hitBlock }),
    });
    expect(choice.seed).toBe(perfectAt);
    expect(choice.trialPerfect).toBe(true);
    expect(choice.candidatesTried).toBe(5);
  });

  test('no perfect candidate: strict-improvement argmin, ties keep the earlier seed', () => {
    const choice = chooseAlignedSeed({
      expected: extractProtocolEvents(missBlock),
      trial: () => ({ log: hitBlock }),
    });
    expect(choice.seed).toBe('1,2,3,4');
    expect(choice.trialPerfect).toBe(false);
    expect(choice.trialScore?.softMismatches).toBe(1);
    expect(choice.candidatesTried).toBe(ALIGNMENT_SEEDS.length);
  });

  test('failed trials count and an all-failed search falls back to candidate 0', () => {
    const choice = chooseAlignedSeed({
      expected: extractProtocolEvents(missBlock),
      trial: () => null,
    });
    expect(choice.seed).toBe('1,2,3,4');
    expect(choice.trialScore).toBeNull();
    expect(choice.trialsFailed).toBe(ALIGNMENT_SEEDS.length);
  });

  test('shouldStop halts the loop and keeps the best so far', () => {
    let calls = 0;
    const choice = chooseAlignedSeed({
      expected: extractProtocolEvents(missBlock),
      trial: () => { calls++; return { log: hitBlock }; },
      shouldStop: () => calls >= 3,
    });
    expect(calls).toBe(3);
    expect(choice.seed).toBe('1,2,3,4');
    expect(choice.candidatesTried).toBe(3);
  });
});

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
    const sim = protocol.map(line => line.replaceAll('Last Regrets', battle.sides[0].pokemon[1].name));
    expect(scoreAlignment(extractProtocolEvents(protocol), extractProtocolEvents(sim))).toEqual({ endedMismatch: false, faintMismatches: 0, softMismatches: 0 });
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
    // The record scores the block the turn emitted under the log's dice, not the chosen seed's (perfect) trial.
    const record = runtime.haxAlignment.find(entry => entry.turn === 19);
    expect(record).toMatchObject({ via: 'forced', actual: { endedMismatch: false, faintMismatches: 0, softMismatches: 0 } });
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
    const record = runtime.haxAlignment.find(entry => entry.turn === 7);
    expect(record).toMatchObject({ via: 'forced', actual: { endedMismatch: false, faintMismatches: 0, softMismatches: 0 } });
    expect(block.some(line => line.startsWith('|faint|p2') && line.includes(': JOHN PEEL'))).toBe(true);
  });
});
