import { readFileSync } from 'fs';
import { test, expect } from '@playwright/test';
import type { PokemonSet } from '@pkmn/sim';
import { buildChoiceLockContext, buildChoiceLockTrails, corroborateChoiceItem, protocolChoiceLock } from '../packages/eval-engine/src/choice-lock';
import { parseReplayLogWithObservations } from '../packages/replay-core/src/protocol-parser';
import { parseSmogonChaosStats } from '../src/lib/smogon-stats';
import { buildTeamsFromReplay } from '../packages/replay-core/src/team-builder';
import { reconstructBranchRuntime } from '../packages/eval-engine/src/branch-engine';
import { getBranchSimulatorFormat } from '../packages/replay-core/src/replay-format';
import { searchOptions } from '../packages/eval-engine/src/search';
import { createRootPosition, serializeBattleStable } from '../packages/eval-engine/src/forward-model';

const log = (lines: string[]) => lines.join('\n');

const set = (species: string, item: string, moves: string[]): PokemonSet => ({
  name: species, species, item, ability: 'No Ability', moves,
  nature: 'Hardy',
  evs: { hp: 0, atk: 252, def: 0, spa: 252, spd: 0, spe: 4 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  level: 100, gender: '',
});

test.describe('protocol choice-lock trails', () => {
  test('a single repeated move since entry locks; a second distinct move disproves', () => {
    const trails = buildChoiceLockTrails(log([
      '|switch|p1a: Keldeo|Keldeo|100/100',
      '|switch|p2a: Chansey|Chansey|100/100',
      '|turn|1',
      '|move|p1a: Keldeo|Hydro Pump|p2a: Chansey',
      '|turn|2',
      '|move|p1a: Keldeo|Hydro Pump|p2a: Chansey',
      '|turn|3',
      '|move|p1a: Keldeo|Secret Sword|p2a: Chansey',
      '|turn|4',
    ]));
    expect(protocolChoiceLock(trails, 'p1', 2)).toEqual({ species: 'Keldeo', moveId: 'hydropump' });
    expect(protocolChoiceLock(trails, 'p1', 3)).toEqual({ species: 'Keldeo', moveId: 'hydropump' });
    // Two distinct moves since entry: no choice item can explain the trail.
    expect(protocolChoiceLock(trails, 'p1', 4)).toBeNull();
    // Fresh entry, no move yet: nothing to lock on.
    expect(protocolChoiceLock(trails, 'p1', 1)).toBeNull();
    expect(protocolChoiceLock(trails, 'p2', 3)).toBeNull();
  });

  test('a re-entry resets the trail', () => {
    const trails = buildChoiceLockTrails(log([
      '|switch|p1a: Keldeo|Keldeo|100/100',
      '|turn|1',
      '|move|p1a: Keldeo|Hydro Pump|p2a: Chansey',
      '|turn|2',
      '|switch|p1a: Lando|Landorus-Therian|100/100',
      '|turn|3',
      '|switch|p1a: Keldeo|Keldeo|100/100',
      '|turn|4',
    ]));
    expect(protocolChoiceLock(trails, 'p1', 4)).toBeNull();
  });

  test('an item event on the active since entry disturbs the trail (Trick family)', () => {
    const trails = buildChoiceLockTrails(log([
      '|switch|p1a: Plume|Vileplume|100/100',
      '|turn|1',
      '|-item|p1a: Plume|Choice Scarf|[from] move: Trick',
      '|move|p1a: Plume|Sludge Bomb|p2a: Chansey',
      '|turn|2',
    ]));
    expect(protocolChoiceLock(trails, 'p1', 2)).toBeNull();
  });

  test('|cant| does not break the trail; |drag| counts as entry', () => {
    const trails = buildChoiceLockTrails(log([
      '|drag|p1a: Keldeo|Keldeo|100/100',
      '|turn|1',
      '|move|p1a: Keldeo|Hydro Pump|p2a: Chansey',
      '|turn|2',
      '|cant|p1a: Keldeo|par',
      '|turn|3',
    ]));
    expect(protocolChoiceLock(trails, 'p1', 3)).toEqual({ species: 'Keldeo', moveId: 'hydropump' });
  });
});

test.describe('choice-item damage corroboration', () => {
  // Bands measured once (gen6, Keldeo Hydro Pump vs the shared inline
  // spread on Mew, ± the 0.02 HP-bar slack): Specs 0.766-0.947,
  // Mystic Water 0.608-0.762, unboosted 0.502-0.639 — disjoint, so the
  // pinned fractions below each sit strictly inside exactly one band.
  const teams = {
    p1Team: [set('Keldeo', 'Choice Specs', ['Hydro Pump'])],
    p2Team: [set('Mew', '', ['Protect'])],
  };
  const observation = (fraction: number) => [{
    attackerSpecies: 'Keldeo', defenderSpecies: 'Mew', attackerSide: 'p1' as const,
    moveId: 'hydropump', observedFraction: fraction,
    attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
  }];

  test('an observation only the ×1.5 boost explains corroborates', () => {
    expect(corroborateChoiceItem('p1', 'Keldeo', 'Choice Specs', teams, observation(0.85), 6)).toBe('corroborated');
  });

  test('an observation only the unboosted damage explains contradicts', () => {
    expect(corroborateChoiceItem('p1', 'Keldeo', 'Choice Specs', teams, observation(0.55), 6)).toBe('contradicted');
  });

  test('no usable observations stays ambiguous (stamp proceeds on the guess)', () => {
    expect(corroborateChoiceItem('p1', 'Keldeo', 'Choice Specs', teams, [], 6)).toBe('ambiguous');
  });
});

test.describe('choice-lock context', () => {
  const contextLog = [
    '|player|p1|Alice|', '|player|p2|Bob|', '|gen|6', '|tier|[Gen 6] OU',
    '|poke|p1|Keldeo|', '|poke|p2|Chansey|',
    '|start',
    '|switch|p1a: Keldeo|Keldeo|100/100',
    '|switch|p2a: Chansey|Chansey|100/100',
    '|turn|1',
  ].join('\n');

  test('revealed choice items are eligible without corroboration; guessed ones consult damage', () => {
    const teams = {
      p1Team: [set('Keldeo', 'Choice Specs', ['Hydro Pump'])],
      p2Team: [set('Chansey', '', ['Protect'])],
    };
    const context = buildChoiceLockContext(contextLog, teams, []);
    // No revealed item, no observations: guessed Specs stays eligible
    // (ambiguous never blocks).
    expect(context.eligibility.p1['keldeo']).toBe(true);
    // A non-choice item is never eligible.
    expect(context.eligibility.p2['chansey']).toBeFalsy();
    expect(context.trails.p1.get(1)).toBeTruthy();
  });

  test('a contradicted guessed choice item loses eligibility', () => {
    // The 0.55 fraction sits strictly inside the unboosted band and outside
    // both boost bands (measured in the corroboration block above).
    const teams = {
      p1Team: [set('Keldeo', 'Choice Specs', ['Hydro Pump'])],
      p2Team: [set('Mew', '', ['Protect'])],
    };
    const context = buildChoiceLockContext(contextLog, teams, [{
      attackerSpecies: 'Keldeo', defenderSpecies: 'Mew', attackerSide: 'p1',
      moveId: 'hydropump', observedFraction: 0.55,
      attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
    }]);
    expect(context.eligibility.p1['keldeo']).toBe(false);
  });
});

test('649664: after its t23 Hydro Pump, Keldeo @ Specs is a locked side (the corpus gap\'s mechanism)', async () => {
  // Protocol facts: Keldeo enters at the end of t22 (Excadrill faints), fires
  // its first Hydro Pump during t23 — so t24 is the protocol-locked boundary
  // the t23 grading plays through (the corpus-gap claim "the pump was
  // forced, not a gamble" lives on this follow-up position).
  test.setTimeout(240_000);
  const replay = JSON.parse(readFileSync('e2e-feedback/fixtures/smogtours-gen6ou-649664.json', 'utf-8')) as {
    id: string; format: string; formatid?: string; players: string[]; log: string;
  };
  const { snapshots, observations, speedOrders } = parseReplayLogWithObservations(replay.log);
  const usageStats = parseSmogonChaosStats(
    JSON.parse(readFileSync('e2e-feedback/fixtures/smogon/_stats_gen6ou.json.json', 'utf-8')),
    { format: 'gen6ou', month: 'pinned' },
  );
  const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations, speedOrders, usageStats });
  const choiceLocks = buildChoiceLockContext(replay.log, { p1Team, p2Team }, observations);
  const runtime = await reconstructBranchRuntime({
    format: getBranchSimulatorFormat(replay),
    p1Team,
    p2Team,
    replayLog: replay.log,
    targetTurn: 24,
    snapshot: snapshots[Math.min(23, snapshots.length - 1)] ?? null,
    capturePositions: {
      snapshotFor: boundary => snapshots[Math.min(boundary - 1, snapshots.length - 1)] ?? null,
      onPosition: () => {},
    },
    choiceLocks,
  });
  const battle = runtime.battleStream.battle!;
  const root = createRootPosition(serializeBattleStable(battle));
  const keldeoSide = battle.sides[0].active[0]?.species.name === 'Keldeo' ? 'p1' as const
    : battle.sides[1].active[0]?.species.name === 'Keldeo' ? 'p2' as const : null;
  expect(keldeoSide).not.toBeNull();
  const moves = searchOptions(root, keldeoSide!).map(option => option.choice).filter(choice => choice.startsWith('move '));
  expect(moves).toEqual(['move hydropump']);
});
