import { useCallback, useMemo } from 'react';
import { replayRules, type ReplayData } from '@fulllifegames/replay-core';
import type { EvalLine } from '@fulllifegames/eval-engine';
import type { AppController } from './useAppController';
import { lineHistory } from '../lib/line-history';
import { snapshotAt } from '../lib/eval-acquire';
import type { LinesHost } from '../lib/line-view';

/** The replace-confirm text, as every other way into a variation words it. */
const replaceMessage = (turn: number, span: { startTurn: number; length: number }) =>
  `Play this line from turn ${turn}: replace the existing variation from turn ${span.startTurn} ` +
  `(${span.length} ${span.length === 1 ? 'turn' : 'turns'})?`;

/**
 * Round 89 (#104), step G3: the click on ▶ Play. The line is the history of a variation (`lineHistory`), and the variation
 * restore every saved variation takes (`restoreVariation`) rebuilds the game at the graded turn and plays it with the dice the line
 * names. An existing variation goes only after the replace confirm; the pointer follows the new tip, where Let it play out
 * continues with the simulator's own dice.
 */
export function usePlayLine(app: AppController) {
  const { restoreVariation } = app.board.deviation;
  const { timeline } = app.board;
  const { variationSpan, followNextTip, setVariationScores } = timeline;
  const { setPendingConfirm, setPlayOutNotice } = app.transients;
  const { prefs, setPrefs } = app.ctx.evaluation;
  return useCallback((line: EvalLine, turn: number) => {
    const run = () => {
      setPlayOutNotice(null);
      // a click on a line shows the engine's view of what stands, as a click on an engine row does
      if (!prefs.auto) setPrefs({ ...prefs, auto: true });
      setVariationScores([]);
      followNextTip();
      void restoreVariation({
        startTurn: turn, history: lineHistory(line, turn), prefill: { p1Choices: [], p2Choices: [] }, pinnedTeams: null,
      });
    };
    if (variationSpan) {
      setPendingConfirm({ message: replaceMessage(turn, variationSpan), proceed: () => { setPendingConfirm(null); run(); } });
      return;
    }
    run();
  }, [restoreVariation, variationSpan, followNextTip, setVariationScores, setPendingConfirm, setPlayOutNotice, prefs, setPrefs]);
}

/** The host of the Lines section: the game's rules, the field at the graded turn's start and ▶ Play. */
export function useLinesHost(app: AppController, replayData: ReplayData): LinesHost {
  const playLine = usePlayLine(app);
  const { snapshots } = app.ctx.replay;
  const { analysisTurn } = app.board.timeline;
  return useMemo(() => ({
    rules: replayRules(replayData),
    snapshot: analysisTurn !== null && analysisTurn >= 1 ? snapshotAt(snapshots, analysisTurn) : null,
    onPlay: playLine,
  }), [replayData, snapshots, analysisTurn, playLine]);
}
