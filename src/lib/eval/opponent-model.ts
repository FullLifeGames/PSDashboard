import type { EvalMatrix, ReadRecommendation } from './types';

/**
 * The exploitative "Read" lens: a boundedly-rational opponent model and a
 * best response over the ALREADY-SOLVED matrix — no new sim work. Pure,
 * main-bundle safe, deterministic.
 *
 * Model = λ·equilibriumMix + (1−λ)·softmax(τ·opponentOwnEVs), optionally
 * sharpened by the player's observed tendencies from this replay. λ is the
 * Restricted-Nash-Response honesty knob: reads stay anchored to balanced
 * play so a wrong model cannot fully faceplant. Verdict GRADING never uses
 * this — equilibrium stays the grade; the read is advice.
 */

/** RNR anchor: this share of the model is always the equilibrium mix. */
export const READ_LAMBDA = 0.3;
/** Softmax temperature over the opponent's own EVs (wp-units). */
export const READ_TAU = 4;
/** Reads only surface when the model's top probability reaches this. */
export const READ_CONFIDENCE = 0.55;

export interface OpponentModel {
  /** Aligned with the opponent's label array in the matrix. */
  probs: number[];
  /** Top probability — the model's confidence in its favourite. */
  confidence: number;
}

export interface PlayerTendencies {
  /** Share of main-choice turns spent clicking a move. */
  attackRate: number;
  /** Share spent switching. */
  switchRate: number;
  /** How often a move turn repeated the previous move (0..1). */
  repeatBias: number;
}

/**
 * Per-side action tendencies from the replay protocol: the first |move| or
 * non-pivot |switch| after each |turn| marker is that side's main choice.
 */
export function parseTendencies(log: string, side: 'p1' | 'p2'): PlayerTendencies {
  let moves = 0;
  let switches = 0;
  let repeats = 0;
  let repeatChances = 0;
  let lastMove: string | null = null;
  let settledThisTurn = false;
  let moved = false;
  let started = false; // leads before |turn|1 are not choices
  let pendingFaints = 0; // replacements after own faints are forced, not chosen

  for (const line of log.split('\n')) {
    if (line.startsWith('|turn|')) {
      started = true;
      settledThisTurn = false;
      moved = false;
      continue;
    }
    if (line.startsWith(`|faint|${side}`)) {
      pendingFaints += 1;
      continue;
    }
    if (line.startsWith(`|switch|${side}`) && pendingFaints > 0) {
      pendingFaints -= 1;
      continue;
    }
    if (!started || settledThisTurn) continue;
    if (line.startsWith(`|move|${side}`)) {
      const move = line.split('|')[3] ?? '';
      moves += 1;
      if (lastMove !== null) {
        repeatChances += 1;
        if (move === lastMove) repeats += 1;
      }
      lastMove = move;
      settledThisTurn = true;
      moved = true;
    } else if (line.startsWith(`|switch|${side}`) && !line.includes('[from]') && !moved) {
      switches += 1;
      lastMove = null;
      settledThisTurn = true;
    }
  }

  const total = moves + switches;
  return {
    attackRate: total > 0 ? moves / total : 0.5,
    switchRate: total > 0 ? switches / total : 0.5,
    repeatBias: repeatChances > 0 ? repeats / repeatChances : 0,
  };
}

/**
 * Switch-kind classification on the machine choice id ('switch 3',
 * 'team 12'); the display-label heuristic remains only as the fallback for
 * cached matrices written before choice ids existed.
 */
const isSwitchChoice = (choiceId: string | undefined, label: string): boolean =>
  choiceId !== undefined ? /^(?:switch |team )/.test(choiceId) : (label.startsWith('→') || label.startsWith('Lead '));

/**
 * The opponent model for `side`'s Read: probabilities over the OTHER side's
 * matrix options.
 */
export function modelOpponent(
  matrix: EvalMatrix,
  side: 'p1' | 'p2',
  tendencies?: PlayerTendencies,
): OpponentModel {
  const opponent = side === 'p1' ? 'p2' : 'p1';
  const labels = opponent === 'p1' ? matrix.p1Labels : matrix.p2Labels;
  const choices = opponent === 'p1' ? matrix.p1Choices : matrix.p2Choices;
  const myLabels = side === 'p1' ? matrix.p1Labels : matrix.p2Labels;
  const myChoices = side === 'p1' ? matrix.p1Choices : matrix.p2Choices;
  const equilibrium = matrix.mixes[opponent];

  // Status-quo-biased reference for MY play: humans click what is best
  // against the field AS IT STANDS, discounting switch-outs — softmaxing
  // against my full equilibrium mix would find only indifference (that is
  // what equilibrium support means). My mix restricted to move options,
  // renormalized; uniform over moves as fallback; full mix if I can only switch.
  const rawMyMix = matrix.mixes[side];
  const moveIndices = myLabels.map((label, index) => ({ label, index }))
    .filter(entry => !isSwitchChoice(myChoices?.[entry.index], entry.label))
    .map(entry => entry.index);
  const myMix = new Array<number>(myLabels.length).fill(0);
  if (moveIndices.length > 0) {
    let mass = 0;
    for (const index of moveIndices) mass += rawMyMix[index] ?? 0;
    for (const index of moveIndices) {
      myMix[index] = mass > 0 ? (rawMyMix[index] ?? 0) / mass : 1 / moveIndices.length;
    }
  } else {
    for (let index = 0; index < myMix.length; index++) myMix[index] = rawMyMix[index] ?? 0;
  }

  // The opponent's own EV per option against the status-quo reference.
  const ownEv = labels.map((_, index) => {
    let value = 0;
    if (opponent === 'p2') {
      for (let i = 0; i < myMix.length; i++) value += matrix.values[i][index] * myMix[i];
      return -value; // p2's own perspective
    }
    for (let j = 0; j < myMix.length; j++) value += matrix.values[index][j] * myMix[j];
    return value;
  });

  const maxEv = Math.max(...ownEv);
  const weights = ownEv.map(value => Math.exp(READ_TAU * (value - maxEv)));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  let probs = labels.map((_, index) =>
    READ_LAMBDA * (equilibrium[index] ?? 0) + (1 - READ_LAMBDA) * (weights[index] / weightTotal));

  // Tendency prior: reallocate mass between move-kind and switch-kind option
  // groups toward the player's observed rates; within-group shape stands.
  if (tendencies) {
    const switchMass = probs.reduce((sum, p, index) => sum + (isSwitchChoice(choices?.[index], labels[index]) ? p : 0), 0);
    const moveMass = 1 - switchMass;
    if (switchMass > 0 && moveMass > 0) {
      probs = probs.map((p, index) => isSwitchChoice(choices?.[index], labels[index])
        ? p * (tendencies.switchRate / switchMass)
        : p * (tendencies.attackRate / moveMass));
      const total = probs.reduce((sum, p) => sum + p, 0);
      probs = probs.map(p => p / total);
    }
  }

  return { probs, confidence: Math.max(...probs) };
}

/**
 * Best response to the opponent model, own perspective. Returns null when
 * the model is not confident or the read agrees with the equilibrium best —
 * a read that recommends the equilibrium line is not a read.
 */
export function computeRead(
  matrix: EvalMatrix,
  side: 'p1' | 'p2',
  tendencies?: PlayerTendencies,
): ReadRecommendation | null {
  const myLabels = side === 'p1' ? matrix.p1Labels : matrix.p2Labels;
  const oppLabels = side === 'p1' ? matrix.p2Labels : matrix.p1Labels;
  if (myLabels.length < 2 || oppLabels.length < 2) return null;

  const model = modelOpponent(matrix, side, tendencies);
  if (model.confidence < READ_CONFIDENCE) return null;

  const ownValue = (mine: number, theirs: number) =>
    side === 'p1' ? matrix.values[mine][theirs] : -matrix.values[theirs][mine];

  const oppEquilibrium = matrix.mixes[side === 'p1' ? 'p2' : 'p1'];
  let bestRead = 0;
  let bestReadEv = -Infinity;
  let bestEquilibrium = 0;
  let bestEquilibriumEv = -Infinity;
  for (let mine = 0; mine < myLabels.length; mine++) {
    let modelEv = 0;
    let equilibriumEv = 0;
    for (let theirs = 0; theirs < oppLabels.length; theirs++) {
      modelEv += model.probs[theirs] * ownValue(mine, theirs);
      equilibriumEv += (oppEquilibrium[theirs] ?? 0) * ownValue(mine, theirs);
    }
    if (modelEv > bestReadEv) {
      bestReadEv = modelEv;
      bestRead = mine;
    }
    if (equilibriumEv > bestEquilibriumEv) {
      bestEquilibriumEv = equilibriumEv;
      bestEquilibrium = mine;
    }
  }

  if (bestRead === bestEquilibrium) return null;

  let worstCase = Infinity;
  for (let theirs = 0; theirs < oppLabels.length; theirs++) {
    worstCase = Math.min(worstCase, ownValue(bestRead, theirs));
  }

  const myChoices = side === 'p1' ? matrix.p1Choices : matrix.p2Choices;
  return {
    choice: {
      label: myLabels[bestRead], ev: bestReadEv, worstCase,
      ...(myChoices?.[bestRead] !== undefined ? { choiceId: myChoices[bestRead] } : {}),
    },
    net: bestReadEv,
    confidence: model.confidence,
    breakdown: oppLabels.map((label, theirs) => ({
      label,
      prob: model.probs[theirs],
      value: ownValue(bestRead, theirs),
    })),
  };
}
