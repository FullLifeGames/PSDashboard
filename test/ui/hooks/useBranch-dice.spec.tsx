import { describe, expect, test, beforeAll } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  buildTeamsFromReplay,
  getBranchSimulatorFormat,
  parseReplayLogWithObservations,
  replayRules,
} from '@fulllifegames/replay-core';
import { useBranch } from '../../../src/hooks/useBranch';
import { replayFixture, type ReplayKind } from '../fixtures/replay';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { branchFrameLog } from '../../../src/lib/branch-log';
import { parseExportedReplay } from '../../../src/lib/replay-file';
import { chainResults, loadSimMods, type ForcedDie } from '@fulllifegames/eval-engine';
import { decodeBranchShare, encodeBranchShare, makeBranchSharePayload } from '../../../src/lib/branch-share';
import { sideMarkTexts, turnDiceMarks } from '../../../src/lib/branch-dice-marks';
import { freshLog, setOf } from '../fixtures/dice-battle';
import type { Bench } from '../../../src/lib/bench';

describe('useBranch-dice', () => {
  function fixture(kind: ReplayKind) {
    const { replayData, snapshots, observations } = replayFixture(kind);
    const { p1Team, p2Team } = buildTeamsFromReplay(replayData.log, { observations });
    return { replayData, snapshots, p1Team, p2Team };
  }

  async function startAt(result: { current: ReturnType<typeof useBranch> }, data: ReturnType<typeof fixture>, turn: number, replayHistory?: unknown[]) {
    const { replayData, snapshots, p1Team, p2Team } = data;
    await act(async () => {
      await result.current.startBranch(getBranchSimulatorFormat(replayData), p1Team, p2Team, replayData.log, turn, snapshots[turn - 1] ?? null, {
        playerNames: [replayData.players[0], replayData.players[1]],
        snapshotFor: (boundary: number) => snapshots[boundary - 1] ?? null,
        ...(replayHistory ? { replayHistory: replayHistory as never } : {}),
      });
    });
  }

  const click = (state: NonNullable<ReturnType<typeof useBranch>['simState']>, side: 'p1' | 'p2', slot: number) => {
    const move = (side === 'p1' ? state.p1MovesBySlot : state.p2MovesBySlot)[slot].find(option => !option.disabled)!;
    return { kind: 'move' as const, moveId: move.name.toLowerCase().replace(/[^a-z0-9]/g, ''), moveName: move.name };
  };

  const withoutClock = (lines: string[]) => lines.filter(line => !line.startsWith('|t:|'));
  const CASES: { kind: ReplayKind; turn: number }[] = [{ kind: 'singles', turn: 2 }, { kind: 'doubles', turn: 1 }, { kind: 'vgc', turn: 1 }];

  describe.each(CASES)('a forced die through the branch hook, $kind', ({ kind, turn }) => {
    async function playWithDie() {
      const data = fixture(kind);
      const { result } = renderHook(() => useBranch());
      await startAt(result, data, turn);
      const before = result.current.simState!;
      const slots = before.p1MovesBySlot.length;
      const p1 = Array.from({ length: slots }, (_, slot) => click(before, 'p1', slot));
      const die: ForcedDie = { name: { slot: 'p1a', moveId: p1[0].moveId, targetSlot: 'p2a', kind: 'accuracy' }, result: { happens: false } };
      act(() => {
        p1.forEach((choice, slot) => result.current.setChoice('p1', slot === 0 ? { ...choice, dice: [die] } : choice, slot));
        Array.from({ length: slots }, (_, slot) => result.current.setChoice('p2', click(before, 'p2', slot), slot));
      });
      await act(async () => { await result.current.executeTurn(); });
      return { data, result, die, before };
    }

    test('the history entry keeps the dice on its choice and the report of the user\'s dice', async () => {
      const { result, die } = await playWithDie();
      expect(result.current.executeError).toBeNull();
      expect(result.current.history).toHaveLength(1);
      const entry = result.current.history[0];
      expect(entry.p1SlotChoices![0]).toMatchObject({ dice: [die] });
      expect(entry.p1SlotChoices!.slice(1).every(choice => choice === null || !('dice' in choice))).toBe(true);
      expect(entry.diceReport?.forced.map(report => report.die)).toEqual([die]);
      expect(['applied', 'no-draw', 'no-chance', 'blocked']).toContain(entry.diceReport!.forced[0].took);
    }, 120_000);

    test('a rebuild replays the forced dice: the same choices, the same report, the same lines', async () => {
      const { data, result } = await playWithDie();
      const recorded = result.current.history;
      expect(recorded[0].diceReport).toBeDefined();
      const log = withoutClock(result.current.simState!.log);
      act(() => result.current.stopBranch());
      await startAt(result, data, turn, recorded);
      expect(result.current.executeError).toBeNull();
      expect(result.current.history).toHaveLength(1);
      expect(result.current.history[0].p1SlotChoices).toEqual(recorded[0].p1SlotChoices);
      expect(result.current.history[0].diceReport).toEqual(recorded[0].diceReport);
      expect(withoutClock(result.current.simState!.log)).toEqual(log);
    }, 120_000);
  });

  describe('a turn without a forced die', () => {
    test('keeps today\'s history entry: no report, the choices as clicked', async () => {
      const data = fixture('singles');
      const { result } = renderHook(() => useBranch());
      await startAt(result, data, 2);
      const before = result.current.simState!;
      act(() => {
        result.current.setChoice('p1', click(before, 'p1', 0));
        result.current.setChoice('p2', click(before, 'p2', 0));
      });
      await act(async () => { await result.current.executeTurn(); });
      expect(result.current.history[0].p1SlotChoices).toEqual([click(before, 'p1', 0)]);
      expect('diceReport' in result.current.history[0]).toBe(false);
    }, 60_000);
  });
});

const replay = parseExportedReplay(readFileSync(join('test', 'e2e', 'fixtures', 'gpl-replay-DzBQ5azlO5l.html'), 'utf-8'), 'gpl-replay-DzBQ5azlO5l.html');

describe('GPL DzBQ5azlO5l turn 13, Air Slash with a forced flinch', () => {
  const hit: ForcedDie = { name: { slot: 'p1a', moveId: 'airslash', targetSlot: 'p2a', kind: 'accuracy' }, result: { happens: true } };
  const flinch: ForcedDie = { name: { slot: 'p1a', moveId: 'airslash', targetSlot: 'p2a', kind: 'secondary', effectId: 'flinch' }, result: { happens: true } };

  test('the branch log shows Cobalion flinching, and the frame log carries the mark before it', async () => {
    const { snapshots, observations } = parseReplayLogWithObservations(replay.log);
    const { p1Team, p2Team } = buildTeamsFromReplay(replay.log, { observations });
    const { result } = renderHook(() => useBranch());
    await act(async () => {
      await result.current.startBranch(getBranchSimulatorFormat(replay), p1Team, p2Team, replay.log, 13, snapshots[12] ?? null, {
        playerNames: [replay.players[0], replay.players[1]],
        snapshotFor: (boundary: number) => snapshots[boundary - 1] ?? null,
      });
    });
    const before = result.current.simState!;
    const move = (name: string, moves: typeof before.p1MovesBySlot) => moves[0].find(option => option.name === name)!;
    act(() => {
      result.current.setChoice('p1', { kind: 'move', moveId: 'airslash', moveName: 'Air Slash', dice: [hit, flinch] }, 0);
      result.current.setChoice('p2', { kind: 'move', moveId: 'heavyslam', moveName: move('Heavy Slam', before.p2MovesBySlot).name }, 0);
    });
    await act(async () => { await result.current.executeTurn(); });
    expect(result.current.executeError).toBeNull();
    const entry = result.current.history[0];
    expect(entry.diceReport!.forced.map(report => [report.die.name.kind, report.took])).toEqual([['accuracy', 'applied'], ['secondary', 'applied']]);
    expect(entry.dieLines!.map(line => line.text)).toEqual([expect.stringMatching(/^Forced: Air Slash hits, /), 'Forced: Air Slash flinch, 30 %']);
    const frame = branchFrameLog(result.current.simState!.log, result.current.history.flatMap(item => item.dieLines ?? [])).split('\n');
    const mark = frame.indexOf('|-message|Forced: Air Slash flinch, 30 %');
    const cant = frame.findIndex(line => line.startsWith('|cant|p2a: King Bradley|flinch'));
    expect(mark).toBeGreaterThanOrEqual(0);
    expect(cant).toBeGreaterThan(mark);
    expect(frame.some(line => line.startsWith('|move|p2a: King Bradley|Heavy Slam'))).toBe(false);
  }, 180_000);
});

beforeAll(async () => {
  await loadSimMods('gen9championsou');
});

const mon = (species: string, moves: string[], extra = {}) => setOf(species, moves, { level: 50, ...extra });
const CAP = { evs: { hp: 32, atk: 32, def: 0, spa: 0, spd: 2, spe: 0 } };

const SCENES = [
  {
    kind: 'singles', format: 'gen9ou', move: 'tripleaxel', moveName: 'Triple Axel', hits: 3, count: 2,
    p1: [mon('Weavile', ['tripleaxel'])], p2: [mon('Blissey', ['splash'])], p1Moves: [{ targetLoc: undefined }], p2Moves: [{ moveId: 'splash', moveName: 'Splash' }],
  },
  {
    kind: 'doubles', format: 'gen9doublesou', move: 'populationbomb', moveName: 'Population Bomb', hits: 10, count: 4,
    p1: [mon('Blissey', ['splash']), mon('Maushold', ['populationbomb'])], p2: [mon('Blissey', ['splash']), mon('Chansey', ['splash'])],
    p1Moves: [{ moveId: 'splash', moveName: 'Splash' }, { targetLoc: 1 }], p2Moves: [{ moveId: 'splash', moveName: 'Splash' }, { moveId: 'splash', moveName: 'Splash' }],
  },
  {
    kind: 'Champions singles', format: 'gen9championsou', move: 'tripleaxel', moveName: 'Triple Axel', hits: 3, count: 2,
    p1: [mon('Weavile', ['tripleaxel'], CAP)], p2: [mon('Blissey', ['splash'], CAP)], p1Moves: [{ targetLoc: undefined }], p2Moves: [{ moveId: 'splash', moveName: 'Splash' }],
  },
  {
    kind: 'Champions doubles', format: 'gen9championsdoublescustomgame', move: 'populationbomb', moveName: 'Population Bomb', hits: 10, count: 4,
    p1: [mon('Blissey', ['splash'], CAP), mon('Maushold', ['populationbomb'], CAP)], p2: [mon('Blissey', ['splash'], CAP), mon('Chansey', ['splash'], CAP)],
    p1Moves: [{ moveId: 'splash', moveName: 'Splash' }, { targetLoc: 1 }], p2Moves: [{ moveId: 'splash', moveName: 'Splash' }, { moveId: 'splash', moveName: 'Splash' }],
  },
] as const;

describe.each(SCENES)('a count of hits forced on $moveName, $kind', scene => {
  test(`${scene.count} hits play ${scene.count} hits, and the history, the link and the frame say "${scene.count} hits" once`, async () => {
    const { result } = renderHook(() => useBranch());
    const p1 = [...scene.p1];
    const p2 = [...scene.p2];
    await act(async () => {
      await result.current.startBranch(scene.format, p1, p2, freshLog({ format: scene.format, p1, p2 }), 1, null, { playerNames: ['A', 'B'] });
    });
    expect(result.current.simState).not.toBeNull();
    const doubles = scene.kind.includes('doubles');
    const slot = doubles ? 1 : 0;
    const name = { slot: doubles ? 'p1b' : 'p1a', moveId: scene.move, targetSlot: 'p2a' } as const;
    const dice: ForcedDie[] = [
      { name: { ...name, kind: 'accuracy' }, result: { happens: true } },
      ...chainResults(scene.count, scene.hits).map(({ hit, happens }): ForcedDie => ({ name: { ...name, kind: 'accuracy', hit }, result: { happens } })),
    ];
    act(() => {
      scene.p1Moves.forEach((choice, index) => result.current.setChoice('p1', { kind: 'move', moveId: scene.move, moveName: scene.moveName, ...choice, ...(index === slot ? { dice } : {}) } as never, index));
      scene.p2Moves.forEach((choice, index) => result.current.setChoice('p2', { kind: 'move', ...choice } as never, index));
    });
    await act(async () => { await result.current.executeTurn(); });
    expect(result.current.executeError).toBeNull();
    const current = result.current;
    expect(current.history).toHaveLength(1);

    expect(current.simState!.log.filter(line => line.startsWith('|-hitcount|p2a')).map(line => line.split('|')[3])).toEqual([String(scene.count)]);
    expect(sideMarkTexts(turnDiceMarks(current.history, 0), 'p1')).toEqual([`${scene.moveName}: ${scene.count} hits`]);

    const lines = branchFrameLog(current.simState!.log, current.history.flatMap(entry => entry.dieLines ?? [])).split('\n').filter(line => line.startsWith('|-message|Forced'));
    expect(lines.map(line => line.replace(/, [\d.]+ %$/, ''))).toEqual([`|-message|Forced: ${scene.moveName} hits`, `|-message|Forced: ${scene.moveName} ${scene.count} hits`]);

    const replay = { id: 'gen9test-1', format: scene.format, formatid: scene.format, players: ['A', 'B'], log: '', uploadtime: 0, views: 0 };
    const payload = decodeBranchShare(encodeBranchShare(makeBranchSharePayload({ replay, branchTurn: 1, history: current.history, finalLog: '' })));
    expect(payload.choices[0].p1DiceLabels).toEqual([`${scene.moveName}: ${scene.count} hits`]);
  }, 180_000);
});

async function started(kind: ReplayKind, bench: (open: { p2: string[] }) => Bench | null) {
  const { replayData, snapshots, observations } = replayFixture(kind);
  const { p1Team, p2Team } = buildTeamsFromReplay(replayData.log, { observations });
  const turn = 2;
  const start = (hook: { current: ReturnType<typeof useBranch> }) => act(async () => {
    await hook.current.startBranch(getBranchSimulatorFormat(replayData), p1Team, p2Team, replayData.log, turn, snapshots[turn - 1] ?? null, {
      playerNames: [replayData.players[0], replayData.players[1]],
      snapshotFor: (boundary: number) => snapshots[boundary - 1] ?? null,
    });
  });
  const whole = renderHook(() => useBranch());
  await start(whole.result);
  const offered = [...new Set(whole.result.current.simState!.p2SwitchesBySlot.flat().map(option => option.species))];
  const limited = bench({ p2: offered });
  const filtered = renderHook(() => useBranch(limited));
  await start(filtered.result);
  return { whole: whole.result, filtered: filtered.result, offered, limited, rules: replayRules(replayData) };
}

describe.each([['singles' as const], ['doubles' as const]])('useBranch with a bench, %s', (kind) => {
  test('the state offers only the brought bodies of a limited side and leaves the other side whole', async () => {
    const run = await started(kind, open => ({ lists: { p1: [], p2: open.p2.slice(0, 1) }, rules: replayRules(replayFixture(kind).replayData) }));
    expect(run.offered.length).toBeGreaterThan(1);
    const state = run.filtered.current.simState!;
    expect([...new Set(state.p2SwitchesBySlot.flat().map(option => option.species))]).toEqual(run.offered.slice(0, 1));
    expect(state.p2Switches.map(option => option.species)).toEqual(run.offered.slice(0, 1));
    expect(state.p1SwitchesBySlot).toEqual(run.whole.current.simState!.p1SwitchesBySlot);
    expect(run.filtered.current.getBattle()?.sides[1].pokemon.length).toBe(run.whole.current.getBattle()?.sides[1].pokemon.length);
  }, 60_000);

  test('the engine state keeps every body: a ranked choice, the play-out and a forced replacement reach the unbrought ones', async () => {
    const run = await started(kind, open => ({ lists: { p1: [], p2: open.p2.slice(0, 1) }, rules: replayRules(replayFixture(kind).replayData) }));
    const engine = run.filtered.current.engineSimState!;
    expect(engine.p2SwitchesBySlot).toEqual(run.whole.current.simState!.p2SwitchesBySlot);
    expect(engine.p2Switches).toEqual(run.whole.current.simState!.p2Switches);
    expect(run.filtered.current.simState!.p2SwitchesBySlot).not.toEqual(engine.p2SwitchesBySlot);
  }, 60_000);

  test('no bench leaves the state as the simulator gave it', async () => {
    const run = await started(kind, () => null);
    expect(run.filtered.current.simState!.p2SwitchesBySlot).toEqual(run.whole.current.simState!.p2SwitchesBySlot);
  }, 60_000);

  test('the filter holds after a turn ran', async () => {
    const run = await started(kind, open => ({ lists: { p1: [], p2: open.p2.slice(0, 1) }, rules: replayRules(replayFixture(kind).replayData) }));
    const result = run.filtered;
    const slots = kind === 'doubles' ? 2 : 1;
    const move = (side: 'p1' | 'p2', slot: number) => {
      const option = (side === 'p1' ? result.current.simState!.p1MovesBySlot : result.current.simState!.p2MovesBySlot)[slot].find(entry => !entry.disabled)!;
      return { kind: 'move' as const, moveId: option.name.toLowerCase().replace(/[^a-z0-9]/g, ''), moveName: option.name };
    };
    for (let slot = 0; slot < slots; slot += 1) {
      act(() => result.current.setChoice('p1', move('p1', slot), slot));
      act(() => result.current.setChoice('p2', move('p2', slot), slot));
    }
    await act(async () => { await result.current.executeTurn(); });
    const after = result.current.simState!;
    const alive = new Set(after.p2SwitchesBySlot.flat().map(option => option.species));
    for (const species of alive) expect(run.offered.slice(0, 1)).toContain(species);
  }, 60_000);
});
