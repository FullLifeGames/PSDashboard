import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { toId, type ReplayData } from '@fulllifegames/replay-core';
import type { AppController } from '../../../src/hooks/useAppController';
import { evalResult } from '../fixtures/eval-result';
import { stubReplayFetch } from '../fixtures/network';
import { realReplayWorkerClient } from '../fixtures/worker';

const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));

// Positions rebuild for real on the test thread; the live search answers from a script.
const SCORE = 0.79;
vi.mock('../../../src/lib/eval/worker-client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/lib/eval/worker-client')>();
  class ScriptedEvalWorkerClient {
    async evaluate() { return evalResult('singles', { score: SCORE }); }
    async evalPair() { return SCORE; }
    cancel() {}
    dispose() {}
  }
  return { ...actual, EvalWorkerClient: ScriptedEvalWorkerClient };
});

const { useAppController } = await import('../../../src/hooks/useAppController');
const { WorkspaceEvalColumn } = await import('../../../src/components/WorkspaceEvalColumn');

/**
 * Round 70 (T216), through the real controller: a variation played late in a real game. The gold point of the
 * variation and the panel's bar print one number, at the fainted share of the variation's own board (read here off
 * the rosters the branch recorded), not at the opening map the bar used to take and not at the main line's share of
 * that turn number. The branch is a real reconstruction of a late position of 655336 (singles) and 2663093831
 * (doubles); the search answers 0.79 for p1.
 */
const kAt = (share: number) => 1.85 + 5 * Math.min(0.25, Math.max(0, share - 0.25));
const pct = (score: number, share = 0) => Math.round(100 / (1 + Math.exp(-kAt(share) * score)));

function Column({ latestRef }: { latestRef: { current: AppController | null } }) {
  const app = useAppController();
  useEffect(() => { latestRef.current = app; });
  const replay = app.ctx.replay.replayData;
  return replay ? <WorkspaceEvalColumn app={app} replayData={replay} /> : null;
}

beforeEach(() => {
  worker.current = realReplayWorkerClient();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The share of fainted bodies on a recorded board: both rosters, a body at 0 HP counted down. */
const shareOfBoard = (entry: { p1Pokemon: { fainted: boolean; hp: number }[]; p2Pokemon: { fainted: boolean; hp: number }[] }) => {
  const bodies = [...entry.p1Pokemon, ...entry.p2Pokemon];
  return bodies.filter(body => body.fainted || body.hp <= 0).length / bodies.length;
};

describe('the variation of a late position prints one number in the graph and in the panel', () => {
  test.each([
    ['singles', 'smogtours-gen6ou-655336'],
    ['doubles', 'gen9doublesou-2663093831'],
  ] as const)('%s (%s)', async (_kind, id) => {
    const replay = JSON.parse(readFileSync(join('test', 'e2e-feedback', 'fixtures', `${id}.json`), 'utf-8')) as ReplayData;
    stubReplayFetch([replay]);
    const latest = { current: null as AppController | null };
    const app = () => latest.current!;
    render(<Column latestRef={latest} />);
    await act(async () => { await app().ctx.replay.loadReplay(replay.id); });
    await waitFor(() => expect(app().engine.smogonPending).toBe(false));

    // The first turn from which a third of the bodies lay down: the map the bar reads there is not the opening one.
    const snapshots = app().ctx.replay.snapshots;
    const lateTurn = snapshots.findIndex(snapshot => {
      const bodies = [...snapshot.p1.pokemon, ...snapshot.p2.pokemon];
      return bodies.length > 0 && bodies.filter(body => body.fainted).length / bodies.length >= 0.3;
    }) + 1;
    expect(lateTurn).toBeGreaterThan(1);

    act(() => app().board.timeline.navigateTo({ turn: lateTurn, line: 'main' }));
    act(() => app().board.deviation.requestDeviation(null));
    await waitFor(() => expect(app().board.timeline.liveEvalView).toBe(true), { timeout: 90_000 });
    await waitFor(() => expect(app().ctx.branch.simState).not.toBeNull(), { timeout: 90_000 });

    // Both sides play a legal move from every slot: one that needs no target, else the first target the simulator lists.
    const sim = app().ctx.branch.simState!;
    const firstLegal = (moves: typeof sim.p1MovesBySlot[0]) => {
      const move = moves.find(candidate => !candidate.disabled && !candidate.requiresTarget) ?? moves.find(candidate => !candidate.disabled)!;
      const targetLoc = move.requiresTarget ? move.targetOptions[0]?.targetLoc : undefined;
      return { kind: 'move' as const, moveId: toId(move.name), moveName: move.name, ...(targetLoc !== undefined ? { targetLoc } : {}) };
    };
    for (const side of ['p1', 'p2'] as const) {
      sim[`${side}MovesBySlot`].forEach((moves, slot) => act(() => app().board.deviation.handleSetChoice(side, firstLegal(moves), slot)));
    }
    await act(async () => { await app().handleExecuteTurn(); });
    await waitFor(() => expect(app().ctx.branch.history.length).toBeGreaterThan(0), { timeout: 60_000 });
    await waitFor(() => expect(app().board.timeline.viewingVariation).toBe(true), { timeout: 30_000 });

    // The live search of the variation's tip scores the point and fills the bar.
    act(() => app().engine.evalView.handleEvaluate());
    await waitFor(() => expect(app().ctx.evaluation.status).toBe('done'), { timeout: 60_000 });

    const tip = app().ctx.branch.history.at(-1)!;
    const share = shareOfBoard(tip);
    expect(share, 'the variation board is late').toBeGreaterThanOrEqual(0.3);
    const expected = pct(SCORE, share);
    expect(expected, 'the scene tells the maps apart').not.toBe(pct(SCORE));

    const tooltip = document.querySelector('rect[data-line="variation"] title')!.textContent;
    expect(tooltip).toContain(`${replay.players[0]} ${expected}% · ${replay.players[1]} ${100 - expected}%`);
    expect(screen.getByRole('img', { name: /^Advantage estimate:/ })).toHaveAttribute(
      'aria-label', `Advantage estimate: ${replay.players[0]} ${expected}%, ${replay.players[1]} ${100 - expected}%`,
    );
  }, 240_000);
});
