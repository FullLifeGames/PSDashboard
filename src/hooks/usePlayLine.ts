import { useCallback, useMemo, useState } from 'react';
import { replayRules, type ReplayData } from '@fulllifegames/replay-core';
import type { EvalLine } from '@fulllifegames/eval-engine';
import type { AppController } from './useAppController';
import { lineHistory } from '../lib/line-history';
import { snapshotAt } from '../lib/eval-acquire';
import { lineAnchor, type LineConfirm, type LinesHost } from '../lib/line-view';
import { useWinPaths } from './useWinPaths';

const replaceMessage = (turn: number, span: { startTurn: number; length: number }) =>
  `Play this line from turn ${turn}: replace the existing variation from turn ${span.startTurn} ` +
  `(${span.length} ${span.length === 1 ? 'turn' : 'turns'})?`;

interface AskedReplace { line: EvalLine; turn: number; span: { startTurn: number; length: number } }

/** The click on ▶ Play: the line becomes a variation from the graded turn, with its dice, after the replace confirm. */
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

export function useLinesHost(app: AppController, replayData: ReplayData): LinesHost {
  const { onPlay, confirm } = usePlayLine(app);
  const winPaths = useWinPaths(app, replayData);
  const { snapshots } = app.ctx.replay;
  const { analysisTurn } = app.board.timeline;
  const earlyLines = app.analysis.earlyLines ?? null;
  const lineComing = app.analysis.lineComing;
  const hardMode = !!app.ctx.evaluation.prefs.hardMode;
  return useMemo(() => ({
    rules: replayRules(replayData),
    snapshot: analysisTurn !== null && analysisTurn >= 1 ? snapshotAt(snapshots, analysisTurn) : null,
    snapshotAt: (turn: number) => snapshotAt(snapshots, turn),
    onPlay,
    confirm,
    winPaths,
    earlyLines,
    lineComing,
    ...(hardMode ? { hardMode } : {}),
  }), [replayData, snapshots, analysisTurn, onPlay, confirm, winPaths, earlyLines, lineComing, hardMode]);
}
