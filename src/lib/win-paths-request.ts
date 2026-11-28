import { forcedWinInput, type EvalResult, type StaticRuleset, type TeraAllowance, type TurnAnalysis, type WinPathsRequest } from '@fulllifegames/eval-engine';

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
  proof?: boolean;
}

function proofFields(result: EvalResult | null | undefined, side: Side, proof: boolean): Pick<WinPathsRequest, 'turns' | 'rootOrder' | 'proof'> | null {
  const forced = proof ? result?.forcedWin : undefined;
  if (!result || !forced) return null;
  return { turns: forced.turns, rootOrder: forcedWinInput(result, { depth: 1, samples: 1 }).rootOrder[side], proof: forced.choice ? { choice: forced.choice } : {} };
}

export function winPathsRequest({ side, turn, result, analysis, tera, sleepClause, ruleset, proof = false }: WinPathsRequestArgs): WinPathsRequest {
  const foe: Side = side === 'p1' ? 'p2' : 'p1';
  const played = analysis?.[side].played?.choice;
  const ranking = result?.perSide;
  const forced = proofFields(result, side, proof);
  return {
    side,
    turn,
    ...(forced ? { turns: forced.turns } : {}),
    ...(ranking ? {
      rootOrder: forced?.rootOrder ?? ranking[side].map(row => row.choice),
      first: { ...(ranking.p1[0] ? { p1: ranking.p1[0].choice } : {}), ...(ranking.p2[0] ? { p2: ranking.p2[0].choice } : {}) },
      foeRanking: ranking[foe].map(row => ({ choice: row.choice, ev: row.ev })),
    } : {}),
    ...(played ? { played } : {}),
    tera,
    sleepClause,
    ruleset,
    ...(forced ? { proof: forced.proof } : {}),
  };
}
