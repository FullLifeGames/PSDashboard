import { useCallback, useMemo, useState } from 'react';
import { replayRules, type ReplayData } from '@fulllifegames/replay-core';
import type { EvalLine } from '@fulllifegames/eval-engine';
import type { AppController } from './useAppController';
import { lineHistory } from '../lib/line-history';
import { snapshotAt } from '../lib/eval-acquire';
import { lineAnchor, type LineConfirm, type LinesHost } from '../lib/line-view';

/** The replace-confirm text, as every other way into a variation words it. */
const replaceMessage = (turn: number, span: { startTurn: number; length: number }) =>
  `Play this line from turn ${turn}: replace the existing variation from turn ${span.startTurn} ` +
  `(${span.length} ${span.length === 1 ? 'turn' : 'turns'})?`;

/** The question a click raised: the line, its turn and the variation it asked about (a question about another one is stale). */
interface AskedReplace { line: EvalLine; turn: number; span: { startTurn: number; length: number } }

/**
 * Round 89 (#104), step G3: the click on ▶ Play. The line is the history of a variation (`lineHistory`), and the variation
 * restore every saved variation takes (`restoreVariation`) rebuilds the game at the graded turn and plays it with the dice the line
 * names. An existing variation goes only after the replace confirm; the pointer follows the new tip, where Let it play out
 * continues with the simulator's own dice. Step G4b: the confirm is the hook's own `confirm`, which the clicked line's block shows
 * (the dock's banner stood out of sight from the right column); it is derived from the variation in hand, so a question about a
 * variation that has since changed is gone without an effect.
 */
export function usePlayLine(app: AppController): { onPlay: (line: EvalLine, turn: number) => void; confirm: LineConfirm | null } {
  const { restoreVariation } = app.board.deviation;
  const { timeline } = app.board;
  const { variationSpan, followNextTip, setVariationScores } = timeline;
  const { setPlayOutNotice } = app.transients;
  const { prefs, setPrefs } = app.ctx.evaluation;
  const [asked, setAsked] = useState<AskedReplace | null>(null);
  const run = useCallback((line: EvalLine, turn: number) => {
    setAsked(null);
    setPlayOutNotice(null);
    // a click on a line shows the engine's view of what stands, as a click on an engine row does
    if (!prefs.auto) setPrefs({ ...prefs, auto: true });
    setVariationScores([]);
    followNextTip();
    void restoreVariation({
      startTurn: turn, history: lineHistory(line, turn), prefill: { p1Choices: [], p2Choices: [] }, pinnedTeams: null,
    });
  }, [restoreVariation, followNextTip, setVariationScores, setPlayOutNotice, prefs, setPrefs]);
  const onPlay = useCallback((line: EvalLine, turn: number) => {
    if (variationSpan) setAsked({ line, turn, span: { startTurn: variationSpan.startTurn, length: variationSpan.length } });
    else run(line, turn);
  }, [variationSpan, run]);
  const current = asked && variationSpan && asked.span.startTurn === variationSpan.startTurn && asked.span.length === variationSpan.length
    ? asked
    : null;
  const confirm = useMemo((): LineConfirm | null => current && {
    anchor: lineAnchor(current.line, current.turn),
    message: replaceMessage(current.turn, current.span),
    proceed: () => run(current.line, current.turn),
    cancel: () => setAsked(null),
  }, [current, run]);
  return { onPlay, confirm };
}

/** The host of the Lines section: the game's rules, the field at the graded turn's start and ▶ Play. */
export function useLinesHost(app: AppController, replayData: ReplayData): LinesHost {
  const { onPlay, confirm } = usePlayLine(app);
  const { snapshots } = app.ctx.replay;
  const { analysisTurn } = app.board.timeline;
  return useMemo(() => ({
    rules: replayRules(replayData),
    snapshot: analysisTurn !== null && analysisTurn >= 1 ? snapshotAt(snapshots, analysisTurn) : null,
    snapshotAt: (turn: number) => snapshotAt(snapshots, turn),
    onPlay,
    confirm,
  }), [replayData, snapshots, analysisTurn, onPlay, confirm]);
}
