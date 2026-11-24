/** The same turn on the main line, at most its last: the "Main line" option and the way back from a variation. */
export const mainLineTarget = (viewTurn: number, maxTurn: number) => ({ turn: Math.min(viewTurn, maxTurn), line: 'main' as const });
