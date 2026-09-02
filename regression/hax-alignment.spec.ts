import { test, expect } from '@playwright/test';
import { Battle, Teams } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import {
  extractProtocolEvents, scoreAlignment, compareAlignment, isPerfectAlignment,
  summarizeAlignment, ALIGNMENT_SEEDS, chooseAlignedSeed,
  type AlignmentScore, type TurnAlignmentRecord,
} from '../packages/eval-engine/src/hax-alignment';
import { serializeBattleStable, trialAdvanceLog } from '../packages/eval-engine/src/forward-model';

test.describe('extractProtocolEvents', () => {
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

test.describe('scoreAlignment + compareAlignment', () => {
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
    // A mover only present on one side is a count mismatch story, not an order one:
    const oneSided = block(['|move|p1a: A|Tackle|p2a: B']);
    expect(scoreAlignment(expected, oneSided).softMismatches).toBeGreaterThan(0);
  });
});

test.describe('seed list + summary', () => {
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

/** Keldeo Hydro Pump (80% accurate) into a wall — the seed decides the miss. */
function hydroPosition(): { serialized: string } {
  const battle = new Battle({
    formatid: 'gen9customgame' as never,
    seed: '9,8,7,6',
    p1: { name: 'p1', team: Teams.pack([makeSet('Keldeo', ['hydropump'], { ability: 'Justified' })]) },
    p2: { name: 'p2', team: Teams.pack([makeSet('Blissey', ['softboiled'], { ability: 'Natural Cure' })]) },
  });
  // gen9customgame opens with team preview; answer it so the serialized
  // checkpoint sits at a normal move-request turn boundary.
  battle.choose('p1', 'team 1');
  battle.choose('p2', 'team 1');
  return { serialized: serializeBattleStable(battle) };
}

test.describe('trialAdvanceLog', () => {
  test('returns only the lines this advance emitted', () => {
    const result = trialAdvanceLog(hydroPosition(), 'move 1', 'move 1', ALIGNMENT_SEEDS[0]);
    expect(result.log.length).toBeGreaterThan(0);
    expect(result.log.some(line => line.startsWith('|move|p1a: Keldeo|Hydro Pump'))).toBe(true);
    // No pre-advance history (team preview / lead switches from the fork's past):
    expect(result.log.some(line => line.startsWith('|start'))).toBe(false);
  });

  test('the pinned seed list spreads an 80%-accuracy roll both ways', () => {
    const position = hydroPosition();
    const outcomes = ALIGNMENT_SEEDS.map(seed => {
      const trial = trialAdvanceLog(position, 'move 1', 'move 1', seed);
      return extractProtocolEvents(trial.log).misses.size > 0 ? 'miss' : 'hit';
    });
    // Sanity for the search: both outcomes must be reachable within the list.
    // If this ever fails, the pinned list cannot align accuracy rolls — that
    // is a design-level finding, not a flaky test (the run is deterministic).
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

test.describe('chooseAlignedSeed', () => {
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
    // Every trial hits (1 soft mismatch vs the expected miss) — all tie.
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
