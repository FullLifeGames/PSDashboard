import { perfSpan, type ReplacementPoint } from '@fulllifegames/eval-engine';
import type { GraphSweepParams, SweepData, SweepEnv } from './sweep-types';

/**
 * Why the game line is short, worded by shape. The counts describe the
 * RECONSTRUCTION pass — one fast replay of the game that hands out every
 * turn's position — which settles seconds after "Analyze game" while the
 * per-turn evaluations are still streaming, so the wording must not claim
 * analysis that has not happened yet. A missing FINAL turn alone is the
 * cascade's mildest form (the simulated line reaches the game's end one
 * turn early — the draft replay does this) and gets a calm story without
 * set-correction advice; anything else is genuine divergence.
 */
export function coverageNotice(positions: (string | null)[]): string | null {
  const total = positions.length;
  const covered = positions.filter(Boolean).length;
  if (total === 0 || covered === total) return null;
  if (covered === 0) {
    return 'The replay could not be reconstructed from the guessed sets: no turn has a live position to analyze. Correcting items/moves via Edit Player/Opp is the common fix.';
  }
  if (covered === total - 1 && positions[total - 1] === null) {
    return "The simulated replay reached the game's end one turn early, so the real game's final turn has no live position to analyze; the rest of the line is unaffected.";
  }
  return `The reconstruction diverged from the real game: ${covered} of ${total} turns could be reconstructed for analysis. Correcting items/moves via Edit Player/Opp is the common fix.`;
}

/**
 * An unexplained short line is the worst outcome: the sweep leaves gaps for every turn the reconstruction never produced, and
 * the panel used to show that as a blank graph with no reason given.
 */
function noteCoverage(data: SweepData, positions: (string | null)[], diagnostics: string[]): void {
  data.notice = coverageNotice(positions);
  if (diagnostics.length === 0) return;
  const extra = diagnostics.join(' ');
  data.notice = data.notice ? `${data.notice} ${extra}` : extra;
}

/**
 * Round 79 (T290): the open replacement requests of the knockouts stream out of the same reconstruction as the turn positions,
 * by `turn.ordinal`. A waiter resolves with the request's position, or with null once the reconstruction settled without it
 * (a knockout the simulator did not play): a silent gap, never an error.
 */
function makeReplacementChannel() {
  const arrived = new Map<string, string>();
  const waiters = new Map<string, ((serialized: string | null) => void)[]>();
  return {
    offer(point: ReplacementPoint, serialized: string) {
      const key = `${point.turn}.${point.ordinal}`;
      arrived.set(key, serialized);
      for (const resolve of waiters.get(key) ?? []) resolve(serialized);
      waiters.delete(key);
    },
    /** The request's position now, or a promise the stream or the settled reconstruction answers. */
    wait(turn: number, ordinal: number, settled: boolean, start: () => void): Promise<string | null> {
      const key = `${turn}.${ordinal}`;
      const found = arrived.get(key);
      if (found) return Promise.resolve(found);
      if (settled) return Promise.resolve(null);
      start();
      return new Promise(resolve => waiters.set(key, [...(waiters.get(key) ?? []), resolve]));
    },
    settle() {
      for (const list of waiters.values()) for (const resolve of list) resolve(null);
      waiters.clear();
    },
  };
}

/**
 * Lazily-run single-pass acquisition, pipelined: positions stream out of
 * the ongoing reconstruction, so the first search starts after the first
 * captured turn instead of after the whole replay pass. Started at most
 * once; a failure fails every waiting turn instead of retrying.
 */
export function makePositionSource(params: GraphSweepParams, data: SweepData): Pick<SweepEnv, 'positionFor' | 'replacementPositionFor'> {
  const arrived = new Map<number, string>();
  const replacements = makeReplacementChannel();
  const waiters = new Map<number, { resolve(serialized: string): void; reject(error: unknown): void }[]>();
  let acquireStarted = false;
  let acquireSettled = false;
  let acquireError: unknown = null;
  const settleWaiters = () => {
    for (const [turn, list] of waiters) {
      for (const waiter of list) {
        const found = arrived.get(turn);
        if (found) waiter.resolve(found);
        else waiter.reject(acquireError ?? new Error(`No position captured for turn ${turn}.`));
      }
    }
    waiters.clear();
    replacements.settle();
  };
  const acquireDiagnostics: string[] = [];
  const startAcquisition = () => {
    if (acquireStarted) return;
    acquireStarted = true;
    const onReplacement = params.replacementRounds?.length ? replacements.offer : undefined;
    params.acquireAll!(() => {}, (turn, serialized) => {
      arrived.set(turn, serialized);
      for (const waiter of waiters.get(turn) ?? []) waiter.resolve(serialized);
      waiters.delete(turn);
    }, message => acquireDiagnostics.push(message), onReplacement).then(positions => {
      positions.forEach((serialized, index) => {
        if (serialized) arrived.set(index + 1, serialized);
      });
      noteCoverage(data, positions, acquireDiagnostics);
    }).catch(error => {
      acquireError = error;
      data.notice = `The replay could not be reconstructed: ${error instanceof Error ? error.message : String(error)}`;
    }).finally(() => {
      acquireSettled = true;
      settleWaiters();
    });
  };
  const positionFor = (turn: number): Promise<string> => perfSpan('position-wait', () => {
    if (!params.acquireAll) return params.acquireFor(turn)(() => {});
    const found = arrived.get(turn);
    if (found) return Promise.resolve(found);
    if (acquireSettled) {
      return Promise.reject(acquireError ?? new Error(`No position captured for turn ${turn}.`));
    }
    startAcquisition();
    return new Promise((resolve, reject) => {
      const list = waiters.get(turn) ?? [];
      list.push({ resolve, reject });
      waiters.set(turn, list);
    });
  });
  return {
    positionFor,
    replacementPositionFor: (turn, ordinal) => replacements.wait(turn, ordinal, !params.acquireAll || acquireSettled, startAcquisition),
  };
}
