import type { EvalResult, StaticRuleset, TeraAllowance, TurnAnalysis, WinPathsRequest } from '@fulllifegames/eval-engine';

// Built in one fixed order, so the client's memo (it keys on the request as JSON) answers a repeated question at once.
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
