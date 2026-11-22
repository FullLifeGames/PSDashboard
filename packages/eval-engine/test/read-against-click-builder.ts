import { analyzeTurn, type TurnAnalysis } from '../src/analysis';
import type { PlayedAction, PlayedTurn } from '../src/played';
import type { EvalMatrix, EvalResult, RankedChoice } from '../src/types';

/**
 * Round 89 (B6a): a turn of three own lines and three opponent lines, built for a singles and a doubles game and for either side
 * as the reader. Own line 0 is the engine's best, line 1 the played line, line 2 the safe line (the best floor). Opponent line 0
 * is the played line's punisher, line 1 the click, line 2 another reply. The two cells under test are the played line's and the
 * safe line's value against the click; every other number is fixed so that the shape (gamble, mistake, inaccuracy) holds.
 */

export type Kind = 'gamble' | 'mistake' | 'inaccuracy';
export type Reader = 'p1' | 'p2';

export interface Scene {
  kind: Kind;
  /** The side whose play is read; the other side is the opponent. */
  reader: Reader;
  /** The own-perspective cells against the click. */
  playedCell: number;
  safeCell: number;
  /** The payoff comes three turns later (a window read) instead of at once. */
  window?: boolean;
  /** No matrix on the result (a cached or HTTP result). */
  noMatrix?: boolean;
  /** Doubles only: one slot of the opponent's click never surfaced. */
  hiddenClick?: boolean;
  /** The reader's score fell across the turn by this much (own perspective); default: it kept ground. */
  lostGround?: number;
}

interface Line { choice: string; label: string }
interface Game {
  own: Line[];
  opp: Line[];
  ownPlayed: PlayedAction[] | PlayedAction;
  oppClick: PlayedAction[] | PlayedAction;
  doubles: boolean;
}

const move = (name: string, targetLoc?: number): PlayedAction => ({ kind: 'move', name, tera: false, ...(targetLoc === undefined ? {} : { targetLoc }) });

const doublesGame = (): Game => ({
  doubles: true,
  own: [
    { choice: 'move woodhammer 1, move protect', label: 'Wood Hammer→Calyrex-Shadow + Protect' },
    { choice: 'move uturn 2, move earthpower 2', label: 'U-turn→Zamazenta-Crowned + Earth Power→Zamazenta-Crowned' },
    { choice: 'move grassyglide 1, move earthpower 1', label: 'Grassy Glide→Calyrex-Shadow + Earth Power→Calyrex-Shadow' },
  ],
  opp: [
    { choice: 'move pollenpuff -2, move wideguard', label: 'Pollen Puff→Zamazenta-Crowned + Wide Guard' },
    { choice: 'move icywind, move protect', label: 'Icy Wind + Protect' },
    { choice: 'move taunt 1, move protect', label: 'Taunt→Rillaboom + Protect' },
  ],
  ownPlayed: [move('U-turn', 2), move('Earth Power', 2)],
  oppClick: [move('Icy Wind'), move('Protect')],
});

const singlesGame = (): Game => ({
  doubles: false,
  own: [
    { choice: 'move earthquake', label: 'Earthquake' },
    { choice: 'move uturn', label: 'U-turn' },
    { choice: 'move recover', label: 'Recover' },
  ],
  opp: [
    { choice: 'move taunt', label: 'Taunt' },
    { choice: 'move protect', label: 'Protect' },
    { choice: 'move roar', label: 'Roar' },
  ],
  ownPlayed: move('U-turn'),
  oppClick: move('Protect'),
});

export const GAMES: [string, () => Game][] = [['singles', singlesGame], ['doubles', doublesGame]];
export const READERS: Reader[] = ['p1', 'p2'];

/** Own-perspective values: best, played, safe against the punisher, the click and the other reply. */
const ownValues = (scene: Scene): number[][] => {
  const click = Math.max(scene.playedCell, scene.safeCell);
  return [
    [-0.05, click, 0.45],
    [-0.3, scene.playedCell, 0.45],
    [0.05, scene.safeCell, 0.5],
  ];
};

const EV: Record<Kind, number> = { gamble: 0.395, mistake: 0.15, inaccuracy: 0.25 };
const BEST_EV = 0.4;
const SAFE_FLOOR = 0.05;
const PLAYED_FLOOR = -0.3;

export interface Built {
  analysis: TurnAnalysis;
  names: [string, string];
  reader: Reader;
}

export function buildScene(make: () => Game, scene: Scene): Built {
  const game = make();
  const { reader } = scene;
  const sign = reader === 'p1' ? 1 : -1;
  const values = ownValues(scene);
  const ownRows: RankedChoice[] = game.own.map((line, index) => ({
    choice: line.choice, label: line.label,
    ev: [BEST_EV, EV[scene.kind], 0.3][index], expected: [BEST_EV, EV[scene.kind], 0.3][index],
    worstCase: [-0.05, PLAYED_FLOOR, SAFE_FLOOR][index],
    punishedBy: game.opp[0].label,
  }));
  const oppRows: RankedChoice[] = game.opp.map((line, index) => ({
    choice: line.choice, label: line.label, ev: -0.4 - 0.001 * index, expected: -0.4, worstCase: -0.9, punishedBy: game.own[0].label,
  }));
  // values[p1 row][p2 column], p1's value: the reader's own value for p1, its negation (transposed) for p2.
  const grid = reader === 'p1'
    ? values
    : game.opp.map((_, p1Row) => game.own.map((__, p2Col) => -values[p2Col][p1Row]));
  const p1Lines = reader === 'p1' ? game.own : game.opp;
  const p2Lines = reader === 'p1' ? game.opp : game.own;
  const matrix: EvalMatrix = {
    p1Labels: p1Lines.map(line => line.label), p2Labels: p2Lines.map(line => line.label),
    p1Choices: p1Lines.map(line => line.choice), p2Choices: p2Lines.map(line => line.choice),
    values: grid, mixes: { p1: p1Lines.map(() => 1 / 3), p2: p2Lines.map(() => 1 / 3) },
  };
  const result: EvalResult = {
    score: 0.2 * sign, interval: 0.02, depthCompleted: 1,
    perSide: { p1: reader === 'p1' ? ownRows : oppRows, p2: reader === 'p1' ? oppRows : ownRows },
    ...(scene.noMatrix ? {} : { matrix }),
  };
  const oppClick = scene.hiddenClick && game.doubles ? [(game.oppClick as PlayedAction[])[0], null] : game.oppClick;
  const sidePlayed = (action: PlayedAction[] | PlayedAction | (PlayedAction | null)[]) =>
    Array.isArray(action) ? { slots: action, single: null } : { slots: undefined, single: action };
  const own = sidePlayed(game.ownPlayed);
  const opp = sidePlayed(oppClick);
  const played: PlayedTurn = {
    p1: reader === 'p1' ? own.single : opp.single, p2: reader === 'p1' ? opp.single : own.single,
    ...(game.doubles ? {
      p1Slots: reader === 'p1' ? own.slots : opp.slots, p2Slots: reader === 'p1' ? opp.slots : own.slots,
    } : {}),
  };
  // Own-perspective outcomes, turned into p1's perspective.
  const immediate = scene.window ? 0.1 : 0.3;
  const kept = scene.lostGround === undefined ? 0.3 : 0.2 - scene.lostGround;
  const analysis = analyzeTurn({
    turn: 8, result, played, playedOutcome: immediate * sign,
    ...(scene.window ? { futureOutcomes: [0.15 * sign, 0.4 * sign, null] } : {}),
    scoreBefore: 0.2 * sign, scoreAfter: kept * sign,
    faintedFraction: 0.5, faintedFractionAfter: 0.5, actives: { p1: null, p2: null, gen: 9 },
  });
  return { analysis, names: ['Alpha', 'Beta'], reader };
}
