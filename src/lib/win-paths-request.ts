import type { EvalResult, StaticRuleset, TeraAllowance, TurnAnalysis, WinPathsRequest } from '@fulllifegames/eval-engine';

/**
 * Round 89 (#130, G8b): the request of the win-path job for a turn of the replay. The ranking is the turn's own (the sweep's result):
 * the engine's first choice of each side at the root, the loser's rows best first (the order a stronger play tries), the opponent's
 * rows with their values (the size of each mistake), and the choice the loser played when the log shows it. The object is built in
 * one fixed order, so the client's memo (it keys on the request as JSON) answers a repeated question at once.
 */
type Side = 'p1' | 'p2';

export interface WinPathsRequestArgs {
  side: Side;
  turn: number;
  result: EvalResult | null | undefined;
  analysis: Pick<TurnAnalysis, 'p1' | 'p2'> | null | undefined;
  tera: TeraAllowance;
  sleepClause: boolean;
  ruleset: StaticRuleset;
}

export function winPathsRequest({ side, turn, result, analysis, tera, sleepClause, ruleset }: WinPathsRequestArgs): WinPathsRequest {
  const foe: Side = side === 'p1' ? 'p2' : 'p1';
  const played = analysis?.[side].played?.choice;
  const ranking = result?.perSide;
  return {
    side,
    turn,
    ...(ranking ? {
      rootOrder: ranking[side].map(row => row.choice),
      first: { ...(ranking.p1[0] ? { p1: ranking.p1[0].choice } : {}), ...(ranking.p2[0] ? { p2: ranking.p2[0].choice } : {}) },
      foeRanking: ranking[foe].map(row => ({ choice: row.choice, ev: row.ev })),
    } : {}),
    ...(played ? { played } : {}),
    tera,
    sleepClause,
    ruleset,
  };
}
