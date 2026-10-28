import { useCallback, useEffect, useRef } from 'react';
import { APP_COMMIT, APP_VERSION } from '../lib/app-version';
import { buildReplayTeams } from '../lib/eval-acquire';
import {
  buildSupportState, isSupportState, issueUrl, supportFileName, type SupportState, type SupportStateInputs,
} from '../lib/support-state';
import type { ReplayContext } from './controller/replay-context';
import type { Transients } from './controller/transients';
import type { BoardController } from './controller/board-controller';

interface SupportApp {
  ctx: ReplayContext;
  transients: Transients;
  board: BoardController;
}

/** Everything the file holds except the built teams, read at event time. */
function gatherInputs(app: SupportApp, createdAt: string): Omit<SupportStateInputs, 'builtSets'> {
  const { replay, branch, evaluation, knowledge, shared } = app.ctx;
  const { timeline, deviation } = app.board;
  const { transients } = app;
  return {
    createdAt,
    app: { version: APP_VERSION, commit: APP_COMMIT, url: window.location.href, embed: replay.embed },
    browser: { userAgent: navigator.userAgent, width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio },
    replay: replay.replayData,
    knowledge: { teamText: knowledge.teamText, editedP1Info: knowledge.editedP1Info, editedP2Info: knowledge.editedP2Info },
    variation: { startTurn: branch.variationStartTurn, branching: branch.branching, history: branch.history },
    view: {
      turn: timeline.viewTurnRef.current, line: timeline.viewLine, t0: timeline.viewT0,
      viewingVariation: timeline.viewingVariation, liveTip: timeline.liveTip,
    },
    choices: {
      draft: transients.draftChoices,
      live: { p1: branch.simState?.p1Choices ?? [], p2: branch.simState?.p2Choices ?? [] },
    },
    // In the order a reader looks for them: the execute error under the pickers first.
    messages: {
      executeError: branch.executeError,
      branchDivergence: deviation.branchDivergence,
      evaluationError: evaluation.error,
      playOutNotice: transients.playOutNotice?.text ?? null,
      replayError: replay.error,
      teamPasteError: knowledge.teamPasteError || null,
      sharedBranchError: shared.sharedBranchError,
    },
    engine: {
      prefs: evaluation.prefs, fastPlayOut: transients.fastPlayOut, animateBranchTurns: app.ctx.animateBranchTurns,
      playOutActive: !!transients.playOut?.active,
    },
  };
}

/** The whole file: the inputs plus the teams the app builds now (cached spreads only, never a new solve). */
async function captureState(app: SupportApp, createdAt: string): Promise<SupportState> {
  const { replayData } = app.ctx.replay;
  const builtSets = replayData
    ? await buildReplayTeams(replayData, app.ctx.teamSources, undefined, { cachedOnly: true }).catch(() => null)
    : null;
  return buildSupportState({ ...gatherInputs(app, createdAt), builtSets });
}

function downloadJson(value: unknown, fileName: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One macrotask: the state set before it has rendered, and the latest controller holds it. */
const settle = () => new Promise(resolve => window.setTimeout(resolve, 0));

/** Sets, variation, pointer and drafts of a saved state, onto the loaded replay of that state. */
async function restoreState(latest: React.RefObject<SupportApp>, state: unknown): Promise<void> {
  if (!isSupportState(state)) throw new Error('Not a PS Dashboard state file (kind ps-dashboard-state, version 1).');
  const loaded = latest.current.ctx.replay.replayData;
  if (!loaded || loaded.id !== state.replay?.id) throw new Error(`Load the replay ${state.replay?.id ?? '(none)'} first.`);
  const { knowledge } = latest.current.ctx;
  knowledge.setEditedP1Info(state.knowledge.editedP1Info);
  knowledge.setEditedP2Info(state.knowledge.editedP2Info);
  knowledge.setPinnedTeams(state.builtSets);
  const { startTurn, history } = state.variation;
  if (startTurn !== null && history.length > 0) {
    await latest.current.board.deviation.restoreVariation({
      startTurn, history,
      prefill: { p1Choices: state.choices.live.p1, p2Choices: state.choices.live.p2 },
      pinnedTeams: state.builtSets,
    });
  }
  await settle();
  const { timeline } = latest.current.board;
  if (state.view.t0) timeline.handleGraphSelectLine(0);
  else timeline.navigateTo({ turn: state.view.turn, line: state.view.line });
  await settle();
  latest.current.transients.setDraftChoices(state.choices.draft);
}

type StateHandle = { capture: () => Promise<SupportState>; restore: (state: unknown) => Promise<void> };

/**
 * Round 77 (user gate 28.10.2026, "1a 2a 3a 4a 5a"): the support side of the app. "Report issue" opens the
 * filled issue form and downloads the state file; `window.__psState` captures and restores a state for the
 * reproduction script (e2e/repro-state.spec.ts).
 */
export function useSupport(app: SupportApp) {
  const latest = useRef(app);
  useEffect(() => {
    latest.current = app;
  });
  const reportIssue = useCallback(() => {
    const createdAt = new Date().toISOString();
    const quick = buildSupportState({ ...gatherInputs(latest.current, createdAt), builtSets: null });
    const fileName = supportFileName(quick);
    // Inside the click, before any await: a tab opened later is a popup the browser may block.
    window.open(issueUrl(quick, fileName), '_blank', 'noopener');
    void captureState(latest.current, createdAt).then(state => downloadJson(state, fileName));
  }, []);
  useEffect(() => {
    const handle: StateHandle = {
      capture: () => captureState(latest.current, new Date().toISOString()),
      restore: state => restoreState(latest, state),
    };
    (window as Window & { __psState?: StateHandle }).__psState = handle;
    return () => {
      delete (window as Window & { __psState?: StateHandle }).__psState;
    };
  }, []);
  return { reportIssue };
}
